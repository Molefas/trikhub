import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import {
  getImports,
  checkForbiddenImports,
  checkDynamicCodeExecution,
  findToolUsage,
  FORBIDDEN_IMPORTS,
  // V2 rules
  schemaHasNoUnconstrainedStrings,
  checkNoFreeStringsInAgentData,
  checkTemplateFieldsExist,
  checkHasResponseTemplates,
  extractTemplatePlaceholders,
} from '../../packages/js/linter/src/rules.js';
import type { TrikManifest, ActionDefinition } from '../../packages/js/manifest/src/types.js';

function createSourceFile(code: string): ts.SourceFile {
  return ts.createSourceFile('test.ts', code, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
}

describe('trik-linter rules', () => {
  describe('getImports', () => {
    // Proves: Linter can detect static ES module imports
    it('should extract static imports', () => {
      const code = `
        import { foo } from 'bar';
        import baz from 'qux';
        import * as all from 'everything';
      `;
      const sf = createSourceFile(code);
      const imports = getImports(sf);

      expect(imports).toContain('bar');
      expect(imports).toContain('qux');
      expect(imports).toContain('everything');
    });

    // Proves: Linter can detect dynamic imports (await import())
    it('should extract dynamic imports', () => {
      const code = `
        const mod = await import('dynamic-module');
      `;
      const sf = createSourceFile(code);
      const imports = getImports(sf);

      expect(imports).toContain('dynamic-module');
    });
  });

  describe('checkForbiddenImports', () => {
    // Proves: Triks cannot import dangerous Node.js modules (fs, child_process)
    it('should detect forbidden imports', () => {
      const code = `
        import fs from 'fs';
        import { spawn } from 'child_process';
        import { ChatAnthropic } from '@langchain/anthropic';
      `;
      const sf = createSourceFile(code);
      const results = checkForbiddenImports(sf);

      expect(results.length).toBe(2);
      expect(results.some(r => r.message.includes('fs'))).toBe(true);
      expect(results.some(r => r.message.includes('child_process'))).toBe(true);
    });

    // Proves: Linter catches node: protocol imports (can't bypass via prefix)
    it('should detect node: prefixed imports', () => {
      const code = `
        import fs from 'node:fs';
        import { createServer } from 'node:http';
      `;
      const sf = createSourceFile(code);
      const results = checkForbiddenImports(sf);

      expect(results.length).toBe(2);
    });

    // Proves: Safe libraries (langgraph, zod) are allowed
    it('should allow safe imports', () => {
      const code = `
        import { StateGraph } from '@langchain/langgraph';
        import { ChatAnthropic } from '@langchain/anthropic';
        import { z } from 'zod';
      `;
      const sf = createSourceFile(code);
      const results = checkForbiddenImports(sf);

      expect(results.length).toBe(0);
    });
  });

  describe('checkDynamicCodeExecution', () => {
    // Proves: eval() is blocked (prevents runtime code injection)
    it('should detect eval usage', () => {
      const code = `
        const result = eval('1 + 1');
      `;
      const sf = createSourceFile(code);
      const results = checkDynamicCodeExecution(sf);

      expect(results.length).toBe(1);
      expect(results[0].rule).toBe('no-dynamic-code');
      expect(results[0].message).toContain('eval');
    });

    // Proves: new Function() is blocked (another code injection vector)
    it('should detect Function constructor', () => {
      const code = `
        const fn = new Function('a', 'return a + 1');
      `;
      const sf = createSourceFile(code);
      const results = checkDynamicCodeExecution(sf);

      expect(results.length).toBe(1);
      expect(results[0].message).toContain('Function');
    });

    // Proves: Normal function definitions are not flagged (no false positives)
    it('should not flag normal function calls', () => {
      const code = `
        function myFunc() { return 1; }
        const result = myFunc();
      `;
      const sf = createSourceFile(code);
      const results = checkDynamicCodeExecution(sf);

      expect(results.length).toBe(0);
    });
  });

  describe('findToolUsage', () => {
    // Proves: Linter can discover tool declarations for capability auditing
    it('should find tool() calls', () => {
      const code = `
        const myTool = tool("calculator", {
          description: "A calculator",
        });
      `;
      const sf = createSourceFile(code);
      const tools = findToolUsage(sf);

      expect(tools).toContain('calculator');
    });
  });
});

// Helper to create manifests for testing
interface ManifestOverrides extends Omit<Partial<TrikManifest>, 'actions'> {
  actions: Record<string, Partial<ActionDefinition>>;
}

function createManifest(overrides: ManifestOverrides): TrikManifest {
  const actions: Record<string, ActionDefinition> = {};
  for (const [name, actionDef] of Object.entries(overrides.actions)) {
    actions[name] = {
      responseMode: actionDef.responseMode ?? 'template',
      inputSchema: actionDef.inputSchema ?? { type: 'object' },
      agentDataSchema: actionDef.agentDataSchema,
      userContentSchema: actionDef.userContentSchema,
      responseTemplates: actionDef.responseTemplates,
      description: actionDef.description ?? `Test action ${name}`,
    };
  }

  return {
    id: overrides.id ?? 'test-trik',
    name: overrides.name ?? 'Test Trik',
    description: overrides.description ?? 'A test trik',
    version: overrides.version ?? '1.0.0',
    actions,
    capabilities: overrides.capabilities ?? { tools: [], canRequestClarification: false },
    limits: overrides.limits ?? { maxExecutionTimeMs: 30000, maxLlmCalls: 5, maxToolCalls: 10 },
    entry: overrides.entry ?? { module: './graph.js', export: 'graph' },
  };
}

describe('Linter rules - type-directed privilege separation', () => {
  describe('schemaHasNoUnconstrainedStrings', () => {
    // Proves: Bare strings are rejected (can carry prompt injection)
    it('should reject unconstrained string', () => {
      const schema = { type: 'string' as const };
      const violations = schemaHasNoUnconstrainedStrings(schema);
      expect(violations).toContain('root');
    });

    // Proves: Enum-constrained strings are safe (finite set of values)
    it('should allow string with enum', () => {
      const schema = { type: 'string' as const, enum: ['success', 'error'] };
      const violations = schemaHasNoUnconstrainedStrings(schema);
      expect(violations).toHaveLength(0);
    });

    // Proves: Const strings are safe (single known value)
    it('should allow string with const', () => {
      const schema = { type: 'string' as const, const: 'fixed-value' };
      const violations = schemaHasNoUnconstrainedStrings(schema);
      expect(violations).toHaveLength(0);
    });

    // Proves: Pattern-constrained strings are safe (regex limits content)
    it('should allow string with pattern', () => {
      const schema = { type: 'string' as const, pattern: '^[a-z-]+$' };
      const violations = schemaHasNoUnconstrainedStrings(schema);
      expect(violations).toHaveLength(0);
    });

    // Proves: UUID format is safe (structured, no free text)
    it('should allow string with allowed format (uuid)', () => {
      const schema = { type: 'string' as const, format: 'uuid' };
      const violations = schemaHasNoUnconstrainedStrings(schema);
      expect(violations).toHaveLength(0);
    });

    // Proves: Date-time format is safe (structured, no free text)
    it('should allow string with allowed format (date-time)', () => {
      const schema = { type: 'string' as const, format: 'date-time' };
      const violations = schemaHasNoUnconstrainedStrings(schema);
      expect(violations).toHaveLength(0);
    });

    // Proves: Nested unsafe strings are caught (deep schema traversal)
    it('should reject nested unconstrained string in object', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          title: { type: 'string' as const }, // BAD - unconstrained
          status: { type: 'string' as const, enum: ['ok', 'error'] }, // OK
        },
      };
      const violations = schemaHasNoUnconstrainedStrings(schema);
      expect(violations).toContain('root.title');
      expect(violations).not.toContain('root.status');
    });

    // Proves: Array items are checked (can't hide unsafe strings in arrays)
    it('should reject unconstrained string in array items', () => {
      const schema = {
        type: 'array' as const,
        items: { type: 'string' as const }, // BAD
      };
      const violations = schemaHasNoUnconstrainedStrings(schema);
      expect(violations).toContain('root[]');
    });

    // Proves: Primitive types (number, boolean, integer) are always safe
    it('should allow safe types (number, boolean, integer)', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          count: { type: 'integer' as const },
          score: { type: 'number' as const },
          active: { type: 'boolean' as const },
        },
      };
      const violations = schemaHasNoUnconstrainedStrings(schema);
      expect(violations).toHaveLength(0);
    });

    // Proves: additionalProperties are checked (can't bypass via dynamic keys)
    it('should check additionalProperties', () => {
      const schema = {
        type: 'object' as const,
        additionalProperties: { type: 'string' as const }, // BAD
      };
      const violations = schemaHasNoUnconstrainedStrings(schema);
      expect(violations).toContain('root[additionalProperties]');
    });
  });

  describe('checkNoFreeStringsInAgentData', () => {
    // Proves: THE CORE RULE - agentData cannot contain free-form strings
    it('should error when agentDataSchema has unconstrained string', () => {
      const manifest = createManifest({
        actions: {
          search: {
            responseMode: 'template',
            agentDataSchema: {
              type: 'object',
              properties: {
                message: { type: 'string' }, // UNSAFE - can carry prompt injection
              },
            },
            responseTemplates: { success: { text: '{{message}}' } },
          },
        },
      });
      const results = checkNoFreeStringsInAgentData(manifest, 'test.json');
      expect(results.some(r => r.rule === 'no-free-strings-in-agent-data')).toBe(true);
    });

    // Proves: Safe types in agentData pass validation
    it('should pass when agentDataSchema has only safe types', () => {
      const manifest = createManifest({
        actions: {
          search: {
            responseMode: 'template',
            agentDataSchema: {
              type: 'object',
              properties: {
                count: { type: 'integer' },
                template: { type: 'string', enum: ['success', 'empty'] },
                articleIds: {
                  type: 'array',
                  items: { type: 'string', format: 'id' },
                },
              },
            },
            responseTemplates: { success: { text: 'Found {{count}}' } },
          },
        },
      });
      const results = checkNoFreeStringsInAgentData(manifest, 'test.json');
      expect(results).toHaveLength(0);
    });

    // Proves: Passthrough mode skips agentData check (content never reaches agent)
    it('should skip passthrough mode actions', () => {
      const manifest = createManifest({
        actions: {
          details: {
            responseMode: 'passthrough',
            // No agentDataSchema check needed for passthrough
          },
        },
      });
      const results = checkNoFreeStringsInAgentData(manifest, 'test.json');
      expect(results).toHaveLength(0);
    });
  });

  describe('checkTemplateFieldsExist', () => {
    // Proves: Templates can only reference declared schema fields
    it('should error when template references non-existent field', () => {
      const manifest = createManifest({
        actions: {
          search: {
            responseMode: 'template',
            agentDataSchema: {
              type: 'object',
              properties: { count: { type: 'integer' } },
            },
            responseTemplates: {
              success: { text: 'Found {{count}} with {{missing}}' },
            },
          },
        },
      });
      const results = checkTemplateFieldsExist(manifest, 'test.json');
      // Should have exactly one error for "missing" field
      expect(results).toHaveLength(1);
      expect(results[0].message).toContain('{{missing}}');
      // Should NOT complain about "count" since it exists in schema
      expect(results[0].message).not.toContain('{{count}}');
    });

    // Proves: Valid template-schema alignment passes
    it('should pass when all template fields exist in schema', () => {
      const manifest = createManifest({
        actions: {
          search: {
            responseMode: 'template',
            agentDataSchema: {
              type: 'object',
              properties: {
                count: { type: 'integer' },
                topic: { type: 'string', pattern: '^[a-z]+$' },
              },
            },
            responseTemplates: {
              success: { text: 'Found {{count}} articles about {{topic}}' },
            },
          },
        },
      });
      const results = checkTemplateFieldsExist(manifest, 'test.json');
      expect(results).toHaveLength(0);
    });
  });

  describe('checkHasResponseTemplates', () => {
    // Proves: Template mode requires templates (no arbitrary trik output)
    it('should error when template mode action has no templates', () => {
      const manifest = createManifest({
        actions: {
          search: {
            responseMode: 'template',
            agentDataSchema: { type: 'object' },
            // Missing responseTemplates
          },
        },
      });
      const results = checkHasResponseTemplates(manifest, 'test.json');
      expect(results.some(r => r.rule === 'has-response-templates')).toBe(true);
    });

    // Proves: Properly configured template mode passes
    it('should pass when template mode action has templates', () => {
      const manifest = createManifest({
        actions: {
          search: {
            responseMode: 'template',
            agentDataSchema: { type: 'object' },
            responseTemplates: { success: { text: 'Done' } },
          },
        },
      });
      const results = checkHasResponseTemplates(manifest, 'test.json');
      expect(results).toHaveLength(0);
    });
  });

  describe('extractTemplatePlaceholders', () => {
    // Proves: Placeholder extraction works for template validation
    it('should extract placeholders from template text', () => {
      const placeholders = extractTemplatePlaceholders('Found {{count}} articles about {{topic}}');
      expect(placeholders).toContain('count');
      expect(placeholders).toContain('topic');
      expect(placeholders).toHaveLength(2);
    });

    // Proves: Templates without placeholders are handled correctly
    it('should handle template with no placeholders', () => {
      const placeholders = extractTemplatePlaceholders('No results found');
      expect(placeholders).toHaveLength(0);
    });
  });
});
