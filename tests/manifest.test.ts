import { describe, it, expect } from 'vitest';
import {
  validateManifest,
  validateData,
  SchemaValidator,
  type TrikManifest,
} from '../packages/trik-manifest/src/index.js';

describe('trik-manifest', () => {
  describe('validateManifest', () => {
    // Proves: Well-formed manifests with actions pass validation
    it('should validate a complete manifest', () => {
      const manifest: TrikManifest = {
        id: 'test-trik',
        name: 'Test Trik',
        description: 'A test trik',
        version: '1.0.0',
        actions: {
          search: {
            responseMode: 'template',
            inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
            agentDataSchema: { type: 'object', properties: { count: { type: 'integer' } } },
            responseTemplates: { success: { text: 'Found {{count}} results' } },
          },
        },
        capabilities: { tools: [], canRequestClarification: false },
        limits: { maxExecutionTimeMs: 30000, maxLlmCalls: 5, maxToolCalls: 10 },
        entry: { module: './graph.js', export: 'default' },
      };

      const result = validateManifest(manifest);
      expect(result.valid).toBe(true);
    });

    // Proves: Incomplete manifests are rejected (all required fields enforced)
    it('should reject manifest with missing required fields', () => {
      const manifest = {
        id: 'test-trik',
        // missing other required fields
      };

      const result = validateManifest(manifest);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    // Proves: Version format is validated (prevents malformed manifests)
    it('should reject manifest with invalid version format', () => {
      const manifest = {
        id: 'test-trik',
        name: 'Test',
        description: 'Test',
        version: 'not-semver', // invalid
        actions: {
          test: {
            responseMode: 'template',
            inputSchema: { type: 'object' },
            agentDataSchema: { type: 'object' },
            responseTemplates: { success: { text: 'Done' } },
          },
        },
        capabilities: { tools: [], canRequestClarification: false },
        limits: { maxExecutionTimeMs: 30000, maxLlmCalls: 5, maxToolCalls: 10 },
        entry: { module: './graph.js', export: 'default' },
      };

      const result = validateManifest(manifest);
      expect(result.valid).toBe(false);
    });

    // Proves: Template mode requires agentDataSchema and responseTemplates
    it('should reject template mode action without agentDataSchema', () => {
      const manifest = {
        id: 'test-trik',
        name: 'Test',
        description: 'Test',
        version: '1.0.0',
        actions: {
          test: {
            responseMode: 'template',
            inputSchema: { type: 'object' },
            // Missing agentDataSchema and responseTemplates
          },
        },
        capabilities: { tools: [], canRequestClarification: false },
        limits: { maxExecutionTimeMs: 30000, maxLlmCalls: 5, maxToolCalls: 10 },
        entry: { module: './graph.js', export: 'default' },
      };

      const result = validateManifest(manifest);
      expect(result.valid).toBe(false);
    });

    // Proves: Passthrough mode requires userContentSchema
    it('should reject passthrough mode action without userContentSchema', () => {
      const manifest = {
        id: 'test-trik',
        name: 'Test',
        description: 'Test',
        version: '1.0.0',
        actions: {
          test: {
            responseMode: 'passthrough',
            inputSchema: { type: 'object' },
            // Missing userContentSchema
          },
        },
        capabilities: { tools: [], canRequestClarification: false },
        limits: { maxExecutionTimeMs: 30000, maxLlmCalls: 5, maxToolCalls: 10 },
        entry: { module: './graph.js', export: 'default' },
      };

      const result = validateManifest(manifest);
      expect(result.valid).toBe(false);
    });

    // Proves: Valid passthrough mode manifest passes
    it('should validate passthrough mode action with userContentSchema', () => {
      const manifest = {
        id: 'test-trik',
        name: 'Test',
        description: 'Test',
        version: '1.0.0',
        actions: {
          details: {
            responseMode: 'passthrough',
            inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
            userContentSchema: {
              type: 'object',
              properties: {
                contentType: { type: 'string' },
                content: { type: 'string' },
              },
            },
          },
        },
        capabilities: { tools: [], canRequestClarification: false },
        limits: { maxExecutionTimeMs: 30000, maxLlmCalls: 5, maxToolCalls: 10 },
        entry: { module: './graph.js', export: 'default' },
      };

      const result = validateManifest(manifest);
      expect(result.valid).toBe(true);
    });
  });

  describe('validateData', () => {
    // Proves: Schema validation works for runtime data checking
    it('should validate data against schema', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      };

      expect(validateData(schema, { name: 'John', age: 30 }).valid).toBe(true);
      expect(validateData(schema, { name: 'John' }).valid).toBe(true);
      expect(validateData(schema, { age: 30 }).valid).toBe(false); // missing name
      expect(validateData(schema, { name: 123 }).valid).toBe(false); // wrong type
    });
  });

  describe('SchemaValidator', () => {
    // Proves: Validators are cached for performance
    it('should cache validators', () => {
      const validator = new SchemaValidator();
      const schema = { type: 'string' };

      const v1 = validator.getValidator('test', schema);
      const v2 = validator.getValidator('test', schema);

      expect(v1).toBe(v2); // same instance
    });

    // Proves: Cached validators work correctly for repeated validation
    it('should validate with cached validator', () => {
      const validator = new SchemaValidator();
      const schema = { type: 'number', minimum: 0 };

      expect(validator.validate('test', schema, 5).valid).toBe(true);
      expect(validator.validate('test', schema, -1).valid).toBe(false);
    });
  });
});
