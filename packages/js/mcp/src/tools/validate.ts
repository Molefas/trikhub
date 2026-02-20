/**
 * Manifest Validation Tool
 *
 * Validates trik manifests against schema and security rules,
 * providing detailed error messages and fix suggestions.
 */

import { validateManifest, type TrikManifest } from '@trikhub/manifest';
import type { ValidationResult, ValidationError, ValidationWarning } from './types.js';

/**
 * Allowed string formats for agentData
 */
const ALLOWED_AGENT_STRING_FORMATS = ['id', 'date', 'date-time', 'uuid', 'email', 'url'];

/**
 * Check if a string schema is properly constrained
 */
function isConstrainedString(schema: Record<string, unknown>): boolean {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return true;
  if (schema.const !== undefined) return true;
  if (typeof schema.pattern === 'string') return true;
  if (typeof schema.format === 'string' && ALLOWED_AGENT_STRING_FORMATS.includes(schema.format)) return true;
  return false;
}

/**
 * Recursively check for unconstrained strings in agentData schema
 */
function findUnconstrainedStrings(
  schema: Record<string, unknown>,
  path: string
): string[] {
  const violations: string[] = [];

  // Handle array type
  if (Array.isArray(schema.type)) {
    if (schema.type.includes('string') && !isConstrainedString(schema)) {
      violations.push(path);
    }
  } else if (schema.type === 'string') {
    if (!isConstrainedString(schema)) {
      violations.push(path);
    }
  }

  // Check properties
  if (schema.properties && typeof schema.properties === 'object') {
    for (const [key, propSchema] of Object.entries(schema.properties as Record<string, Record<string, unknown>>)) {
      violations.push(...findUnconstrainedStrings(propSchema, `${path}.${key}`));
    }
  }

  // Check array items
  if (schema.items && typeof schema.items === 'object') {
    violations.push(...findUnconstrainedStrings(schema.items as Record<string, unknown>, `${path}[]`));
  }

  return violations;
}

/**
 * Extract placeholders from template text
 */
function extractPlaceholders(text: string): string[] {
  const regex = /\{\{(\w+)\}\}/g;
  const placeholders: string[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    placeholders.push(match[1]);
  }
  return placeholders;
}

/**
 * Validate a manifest object
 */
export function validateTrikManifest(
  manifestContent: string,
  strict: boolean = false
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  let securityScore = 100;

  // Parse JSON
  let manifest: TrikManifest;
  try {
    manifest = JSON.parse(manifestContent);
  } catch (e) {
    return {
      valid: false,
      errors: [{
        path: 'root',
        message: 'Invalid JSON syntax',
        fix: 'Check for missing commas, brackets, or quotes',
      }],
      warnings: [],
      securityScore: 0,
    };
  }

  // Validate against schema
  const schemaResult = validateManifest(manifest);
  if (!schemaResult.valid) {
    for (const error of schemaResult.errors || []) {
      errors.push({
        path: 'schema',
        message: error,
        fix: 'See https://trikhub.com/docs/reference/manifest-schema',
      });
    }
    securityScore -= 50;
  }

  // Check each action
  if (manifest.actions) {
    for (const [actionName, action] of Object.entries(manifest.actions)) {
      const actionPath = `actions.${actionName}`;

      // Check response mode requirements
      if (action.responseMode === 'template') {
        // Template mode must have agentDataSchema
        if (!action.agentDataSchema) {
          errors.push({
            path: `${actionPath}.agentDataSchema`,
            message: 'Template mode requires agentDataSchema',
            fix: 'Add an agentDataSchema with constrained fields',
          });
          securityScore -= 20;
        } else {
          // Check for unconstrained strings
          const violations = findUnconstrainedStrings(
            action.agentDataSchema as Record<string, unknown>,
            `${actionPath}.agentDataSchema`
          );
          for (const violation of violations) {
            errors.push({
              path: violation,
              message: 'Unconstrained string in agentDataSchema',
              fix: `Add enum, const, pattern, or format (${ALLOWED_AGENT_STRING_FORMATS.join(', ')})`,
            });
            securityScore -= 10;
          }
        }

        // Template mode must have responseTemplates
        if (!action.responseTemplates || Object.keys(action.responseTemplates).length === 0) {
          errors.push({
            path: `${actionPath}.responseTemplates`,
            message: 'Template mode requires at least one responseTemplate',
            fix: 'Add responseTemplates with template text using {{field}} syntax',
          });
          securityScore -= 15;
        } else {
          // Check template placeholders reference real fields
          const schemaFields = action.agentDataSchema?.properties
            ? Object.keys(action.agentDataSchema.properties as Record<string, unknown>)
            : [];

          for (const [templateId, template] of Object.entries(action.responseTemplates)) {
            const placeholders = extractPlaceholders(template.text);
            for (const placeholder of placeholders) {
              if (!schemaFields.includes(placeholder)) {
                errors.push({
                  path: `${actionPath}.responseTemplates.${templateId}`,
                  message: `Placeholder {{${placeholder}}} not found in agentDataSchema`,
                  fix: `Add "${placeholder}" to agentDataSchema.properties or remove from template`,
                });
                securityScore -= 5;
              }
            }
          }

          // Suggest common template names
          const templateIds = Object.keys(action.responseTemplates);
          const commonNames = ['success', 'error', 'default'];
          if (!templateIds.some((id) => commonNames.includes(id))) {
            warnings.push({
              path: `${actionPath}.responseTemplates`,
              message: 'No common template name found',
              suggestion: `Consider using "success", "error", or "default" for clarity`,
            });
          }
        }
      } else if (action.responseMode === 'passthrough') {
        // Passthrough mode must have userContentSchema
        if (!action.userContentSchema) {
          errors.push({
            path: `${actionPath}.userContentSchema`,
            message: 'Passthrough mode requires userContentSchema',
            fix: 'Add userContentSchema describing the content structure',
          });
          securityScore -= 15;
        }
      }

      // Check for missing description
      if (!action.description && strict) {
        warnings.push({
          path: `${actionPath}.description`,
          message: 'Action missing description',
          suggestion: 'Add a description to help users understand the action',
        });
      }

      // Check input schema
      if (!action.inputSchema) {
        warnings.push({
          path: `${actionPath}.inputSchema`,
          message: 'Action missing inputSchema',
          suggestion: 'Add inputSchema even if empty ({ "type": "object" })',
        });
      }
    }
  } else {
    errors.push({
      path: 'actions',
      message: 'Manifest must define at least one action',
      fix: 'Add an "actions" object with action definitions',
    });
    securityScore -= 30;
  }

  // Check capabilities
  if (!manifest.capabilities) {
    errors.push({
      path: 'capabilities',
      message: 'Manifest must define capabilities',
      fix: 'Add "capabilities": { "tools": [] }',
    });
    securityScore -= 10;
  }

  // Check limits
  if (!manifest.limits?.maxExecutionTimeMs) {
    warnings.push({
      path: 'limits.maxExecutionTimeMs',
      message: 'Missing execution time limit',
      suggestion: 'Add limits.maxExecutionTimeMs (recommended: 30000)',
    });
  } else if (manifest.limits.maxExecutionTimeMs > 60000) {
    warnings.push({
      path: 'limits.maxExecutionTimeMs',
      message: 'Execution time limit is very high (>60s)',
      suggestion: 'Consider reducing to improve user experience',
    });
  }

  // Check entry point
  if (!manifest.entry?.module) {
    errors.push({
      path: 'entry.module',
      message: 'Missing entry point module',
      fix: 'Add entry.module path (e.g., "./dist/index.js")',
    });
    securityScore -= 10;
  }

  // Clamp security score
  securityScore = Math.max(0, Math.min(100, securityScore));

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    securityScore,
  };
}

/**
 * Error diagnosis patterns
 */
const ERROR_PATTERNS: Array<{
  pattern: RegExp;
  explanation: string;
  rootCause: string;
  fix: string;
  docs: string[];
}> = [
  {
    pattern: /unconstrained string/i,
    explanation: 'Strings in agentDataSchema must be constrained to prevent prompt injection.',
    rootCause: 'A string field in agentDataSchema has no constraints (enum, const, pattern, or format).',
    fix: 'Add one of: enum: ["value1", "value2"], const: "fixedValue", pattern: "^regex$", or format: "uuid"',
    docs: ['https://trikhub.com/docs/concepts/security'],
  },
  {
    pattern: /template.*not found/i,
    explanation: 'A template placeholder references a field that does not exist in agentDataSchema.',
    rootCause: 'The {{fieldName}} in your template text does not match any property in agentDataSchema.',
    fix: 'Either add the field to agentDataSchema.properties or correct the placeholder name.',
    docs: ['https://trikhub.com/docs/reference/manifest-schema#templates'],
  },
  {
    pattern: /responseTemplates.*required/i,
    explanation: 'Template mode actions must have at least one response template.',
    rootCause: 'The action uses responseMode: "template" but has no responseTemplates.',
    fix: 'Add responseTemplates: { "success": { "text": "Your template with {{placeholders}}" } }',
    docs: ['https://trikhub.com/docs/concepts/response-modes'],
  },
  {
    pattern: /userContentSchema.*required/i,
    explanation: 'Passthrough mode actions must define the user content structure.',
    rootCause: 'The action uses responseMode: "passthrough" but has no userContentSchema.',
    fix: 'Add userContentSchema: { "type": "object", "properties": { "content": { "type": "string" } } }',
    docs: ['https://trikhub.com/docs/concepts/response-modes'],
  },
  {
    pattern: /invalid json/i,
    explanation: 'The manifest file contains invalid JSON syntax.',
    rootCause: 'There is a syntax error in the JSON file (missing comma, bracket, or quote).',
    fix: 'Use a JSON validator or IDE to find the syntax error.',
    docs: [],
  },
  {
    pattern: /entry.*not found/i,
    explanation: 'The compiled entry point file does not exist.',
    rootCause: 'The file specified in entry.module has not been built yet.',
    fix: 'Run npm build (TypeScript) or ensure the Python module exists.',
    docs: ['https://trikhub.com/docs/creating-triks'],
  },
];

/**
 * Diagnose an error and suggest fixes
 */
export function diagnoseError(
  error: string,
  context?: 'publish' | 'lint' | 'runtime'
): {
  explanation: string;
  rootCause: string;
  suggestedFix: string;
  relatedDocs: string[];
} {
  // Find matching pattern
  for (const pattern of ERROR_PATTERNS) {
    if (pattern.pattern.test(error)) {
      return {
        explanation: pattern.explanation,
        rootCause: pattern.rootCause,
        suggestedFix: pattern.fix,
        relatedDocs: pattern.docs,
      };
    }
  }

  // Generic response
  return {
    explanation: `Error occurred during ${context || 'operation'}: ${error}`,
    rootCause: 'Unable to determine specific root cause.',
    suggestedFix: 'Check the error message and review the related documentation.',
    relatedDocs: ['https://trikhub.com/docs'],
  };
}
