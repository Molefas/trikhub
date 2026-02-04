import ts from 'typescript';

/**
 * Lint result severity
 */
export type LintSeverity = 'error' | 'warning' | 'info';

/**
 * A single lint result
 */
export interface LintResult {
  rule: string;
  severity: LintSeverity;
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

/**
 * List of forbidden Node.js core modules
 */
export const FORBIDDEN_IMPORTS = [
  'fs',
  'fs/promises',
  'child_process',
  'net',
  'http',
  'https',
  'dgram',
  'dns',
  'tls',
  'cluster',
  'worker_threads',
  'vm',
  'process',
];

/**
 * List of forbidden global function calls
 */
export const FORBIDDEN_CALLS = ['eval', 'Function'];

/**
 * Extract all import specifiers from a source file
 */
export function getImports(sourceFile: ts.SourceFile): string[] {
  const imports: string[] = [];

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier;
      if (ts.isStringLiteral(moduleSpecifier)) {
        imports.push(moduleSpecifier.text);
      }
    }
    // Also check for dynamic imports
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) {
          imports.push(arg.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

/**
 * Check for forbidden imports
 */
export function checkForbiddenImports(
  sourceFile: ts.SourceFile,
  forbiddenList: string[] = FORBIDDEN_IMPORTS
): LintResult[] {
  const results: LintResult[] = [];
  const imports = getImports(sourceFile);

  for (const imp of imports) {
    // Check direct matches and node: prefix
    const normalizedImport = imp.startsWith('node:') ? imp.slice(5) : imp;

    if (forbiddenList.includes(normalizedImport)) {
      results.push({
        rule: 'no-forbidden-imports',
        severity: 'error',
        message: `Forbidden import: "${imp}" - skills cannot use this module`,
        file: sourceFile.fileName,
      });
    }
  }

  return results;
}

/**
 * Check for dynamic code execution (eval, Function constructor)
 */
export function checkDynamicCodeExecution(sourceFile: ts.SourceFile): LintResult[] {
  const results: LintResult[] = [];

  function visit(node: ts.Node) {
    // Check for eval()
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && callee.text === 'eval') {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        results.push({
          rule: 'no-dynamic-code',
          severity: 'error',
          message: 'Use of eval() is forbidden in skills',
          file: sourceFile.fileName,
          line: line + 1,
          column: character + 1,
        });
      }
    }

    // Check for new Function()
    if (ts.isNewExpression(node)) {
      const expression = node.expression;
      if (ts.isIdentifier(expression) && expression.text === 'Function') {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        results.push({
          rule: 'no-dynamic-code',
          severity: 'error',
          message: 'Use of Function constructor is forbidden in skills',
          file: sourceFile.fileName,
          line: line + 1,
          column: character + 1,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return results;
}

/**
 * Find tool usages in the source file
 * This is a heuristic - looks for common LangGraph tool patterns
 */
export function findToolUsage(sourceFile: ts.SourceFile): string[] {
  const tools: string[] = [];

  function visit(node: ts.Node) {
    // Look for @tool decorator or tool() calls
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && callee.text === 'tool') {
        // tool("name", ...) pattern
        const firstArg = node.arguments[0];
        if (firstArg && ts.isStringLiteral(firstArg)) {
          tools.push(firstArg.text);
        }
      }
    }

    // Look for StructuredTool class definitions
    if (ts.isClassDeclaration(node)) {
      const heritage = node.heritageClauses;
      if (heritage) {
        for (const clause of heritage) {
          for (const type of clause.types) {
            if (ts.isIdentifier(type.expression) && type.expression.text === 'StructuredTool') {
              // Get the name property
              for (const member of node.members) {
                if (ts.isPropertyDeclaration(member)) {
                  const name = member.name;
                  if (ts.isIdentifier(name) && name.text === 'name') {
                    const initializer = member.initializer;
                    if (initializer && ts.isStringLiteral(initializer)) {
                      tools.push(initializer.text);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return tools;
}

/**
 * Check that all tools used are declared in manifest
 */
export function checkUndeclaredTools(
  sourceFile: ts.SourceFile,
  declaredTools: string[]
): LintResult[] {
  const results: LintResult[] = [];
  const usedTools = findToolUsage(sourceFile);

  for (const tool of usedTools) {
    if (!declaredTools.includes(tool)) {
      results.push({
        rule: 'undeclared-tool',
        severity: 'error',
        message: `Tool "${tool}" is used but not declared in manifest.capabilities.tools`,
        file: sourceFile.fileName,
      });
    }
  }

  return results;
}

/**
 * Check for process.env access (potential secret leakage)
 */
export function checkProcessEnvAccess(sourceFile: ts.SourceFile): LintResult[] {
  const results: LintResult[] = [];

  function visit(node: ts.Node) {
    if (ts.isPropertyAccessExpression(node)) {
      // Check for process.env
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'process' &&
        ts.isIdentifier(node.expression.name) &&
        node.expression.name.text === 'env'
      ) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        results.push({
          rule: 'no-process-env',
          severity: 'warning',
          message: 'Accessing process.env - ensure no secrets are leaked in skill output',
          file: sourceFile.fileName,
          line: line + 1,
          column: character + 1,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return results;
}

// ============================================
// Linter Rules: Type-Directed Privilege Separation
// ============================================

import type { JSONSchema, SkillManifest } from '@saaas-poc/skill-manifest';

/**
 * Allowed string formats in agentDataSchema.
 * These are safe because they have constrained, predictable values.
 */
export const ALLOWED_AGENT_STRING_FORMATS = ['id', 'date', 'date-time', 'uuid', 'email', 'url'];

/**
 * Recursively check if a schema contains unconstrained strings.
 * Returns array of paths where unconstrained strings are found.
 */
export function schemaHasNoUnconstrainedStrings(
  schema: JSONSchema,
  path: string = 'root'
): string[] {
  const violations: string[] = [];

  // Handle array type
  if (Array.isArray(schema.type)) {
    if (schema.type.includes('string')) {
      // String is one of the allowed types - check if constrained
      if (!isConstrainedString(schema)) {
        violations.push(path);
      }
    }
  } else if (schema.type === 'string') {
    // Direct string type - must be constrained
    if (!isConstrainedString(schema)) {
      violations.push(path);
    }
  }

  // Recursively check properties
  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      violations.push(...schemaHasNoUnconstrainedStrings(propSchema, `${path}.${key}`));
    }
  }

  // Recursively check array items
  if (schema.items) {
    violations.push(...schemaHasNoUnconstrainedStrings(schema.items, `${path}[]`));
  }

  // Check additionalProperties if it's a schema
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    violations.push(
      ...schemaHasNoUnconstrainedStrings(schema.additionalProperties, `${path}[additionalProperties]`)
    );
  }

  // Check $defs
  if (schema.$defs) {
    for (const [key, defSchema] of Object.entries(schema.$defs)) {
      violations.push(...schemaHasNoUnconstrainedStrings(defSchema, `${path}.$defs.${key}`));
    }
  }

  return violations;
}

/**
 * Check if a string schema is properly constrained
 */
function isConstrainedString(schema: JSONSchema): boolean {
  // Has enum constraint
  if (schema.enum && Array.isArray(schema.enum) && schema.enum.length > 0) {
    return true;
  }

  // Has const constraint
  if (schema.const !== undefined) {
    return true;
  }

  // Has pattern constraint
  if (schema.pattern && typeof schema.pattern === 'string') {
    return true;
  }

  // Has allowed format constraint
  if (schema.format && ALLOWED_AGENT_STRING_FORMATS.includes(schema.format)) {
    return true;
  }

  return false;
}

/**
 * Check that agentDataSchema contains no free-form strings.
 * This is the core security rule for type-directed privilege separation.
 */
export function checkNoFreeStringsInAgentData(
  manifest: SkillManifest,
  manifestPath: string
): LintResult[] {
  const results: LintResult[] = [];

  for (const [actionName, action] of Object.entries(manifest.actions)) {
    // Only check agentDataSchema for template mode actions
    if (action.responseMode === 'template' && action.agentDataSchema) {
      const violations = schemaHasNoUnconstrainedStrings(
        action.agentDataSchema,
        `actions.${actionName}.agentDataSchema`
      );

      for (const violationPath of violations) {
        results.push({
          rule: 'no-free-strings-in-agent-data',
          severity: 'error',
          message: `Unconstrained string found at ${violationPath}. ` +
            `Strings in agentDataSchema must have: enum, const, pattern, or format (${ALLOWED_AGENT_STRING_FORMATS.join(', ')})`,
          file: manifestPath,
        });
      }
    }
  }

  return results;
}

/**
 * Extract placeholder names from template text.
 * Placeholders use {{fieldName}} syntax.
 */
export function extractTemplatePlaceholders(templateText: string): string[] {
  const regex = /\{\{(\w+)\}\}/g;
  const placeholders: string[] = [];
  let match;

  while ((match = regex.exec(templateText)) !== null) {
    placeholders.push(match[1]);
  }

  return placeholders;
}

/**
 * Get all top-level field names from a schema
 */
export function getSchemaFieldNames(schema: JSONSchema): string[] {
  const fields: string[] = [];

  if (schema.properties) {
    fields.push(...Object.keys(schema.properties));
  }

  return fields;
}

/**
 * Check that all template placeholders reference fields in agentDataSchema.
 */
export function checkTemplateFieldsExist(
  manifest: SkillManifest,
  manifestPath: string
): LintResult[] {
  const results: LintResult[] = [];

  for (const [actionName, action] of Object.entries(manifest.actions)) {
    // Only check template fields for template mode actions with schemas and templates
    if (action.responseMode !== 'template' || !action.agentDataSchema || !action.responseTemplates) {
      continue;
    }

    const schemaFields = getSchemaFieldNames(action.agentDataSchema);

    for (const [templateId, template] of Object.entries(action.responseTemplates)) {
      const placeholders = extractTemplatePlaceholders(template.text);

      for (const placeholder of placeholders) {
        if (!schemaFields.includes(placeholder)) {
          results.push({
            rule: 'template-fields-exist',
            severity: 'error',
            message: `Template "${templateId}" in action "${actionName}" references field "{{${placeholder}}}" ` +
              `which does not exist in agentDataSchema. Available fields: ${schemaFields.join(', ') || 'none'}`,
            file: manifestPath,
          });
        }
      }
    }
  }

  return results;
}

/**
 * Check that template mode V2 actions have at least one response template.
 */
export function checkHasResponseTemplates(
  manifest: SkillManifest,
  manifestPath: string
): LintResult[] {
  const results: LintResult[] = [];

  for (const [actionName, action] of Object.entries(manifest.actions)) {
    // Only check template mode actions
    if (action.responseMode !== 'template') {
      continue;
    }

    const templateCount = action.responseTemplates ? Object.keys(action.responseTemplates).length : 0;

    if (templateCount === 0) {
      results.push({
        rule: 'has-response-templates',
        severity: 'error',
        message: `Template mode action "${actionName}" has no response templates. ` +
          `Template mode actions must define at least one response template.`,
        file: manifestPath,
      });
    }
  }

  return results;
}

/**
 * Check that template mode V2 actions have a "default" or commonly expected template.
 */
export function checkDefaultTemplateRecommended(
  manifest: SkillManifest,
  manifestPath: string
): LintResult[] {
  const results: LintResult[] = [];
  const commonTemplates = ['default', 'success', 'result'];

  for (const [actionName, action] of Object.entries(manifest.actions)) {
    // Only check template mode actions with templates
    if (action.responseMode !== 'template' || !action.responseTemplates) {
      continue;
    }

    const templateIds = Object.keys(action.responseTemplates);
    const hasCommon = templateIds.some((id) => commonTemplates.includes(id));

    if (!hasCommon && templateIds.length > 0) {
      results.push({
        rule: 'default-template-recommended',
        severity: 'warning',
        message: `Action "${actionName}" has no common template (${commonTemplates.join(', ')}). ` +
          `Consider adding a "success" or "default" template for clarity.`,
        file: manifestPath,
      });
    }
  }

  return results;
}
