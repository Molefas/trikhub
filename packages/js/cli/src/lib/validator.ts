/**
 * Trik Validator
 *
 * Validates downloaded triks before installation.
 * This is a lightweight validator for the CLI - the full linter
 * is available in @saaas-sdk/linter for skill development.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Manifest structure (simplified for validation)
 */
interface TrikManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  entry: {
    module: string;
    export: string;
  };
  actions: Record<string, TrikAction>;
  capabilities: {
    tools: string[];
    canRequestClarification: boolean;
  };
  limits: {
    maxExecutionTimeMs: number;
    maxLlmCalls: number;
    maxToolCalls: number;
  };
}

interface TrikAction {
  responseMode: 'template' | 'passthrough';
  inputSchema?: unknown;
  agentDataSchema?: unknown;
  userContentSchema?: unknown;
  responseTemplates?: Record<string, { text: string }>;
  description?: string;
}

/**
 * Allowed string formats in agentDataSchema
 * Free-form strings without these constraints are security risks
 */
const ALLOWED_STRING_FORMATS = ['date', 'date-time', 'time', 'email', 'uri', 'uuid', 'id'];

/**
 * Check if a JSON Schema allows unconstrained strings
 *
 * Unconstrained strings in agentData can lead to prompt injection
 * because the agent's output would flow directly to the user.
 */
function hasUnconstrainedStrings(schema: unknown, path = ''): string[] {
  const issues: string[] = [];

  if (!schema || typeof schema !== 'object') {
    return issues;
  }

  const s = schema as Record<string, unknown>;

  // Check if this is a string type
  if (s.type === 'string') {
    const hasEnum = Array.isArray(s.enum) && s.enum.length > 0;
    const hasConst = s.const !== undefined;
    const hasPattern = typeof s.pattern === 'string';
    const hasAllowedFormat = ALLOWED_STRING_FORMATS.includes(s.format as string);

    if (!hasEnum && !hasConst && !hasPattern && !hasAllowedFormat) {
      issues.push(
        `${path || 'root'}: Unconstrained string type. ` +
          `Use enum, const, pattern, or format (${ALLOWED_STRING_FORMATS.join(', ')}) to constrain.`
      );
    }
  }

  // Recurse into object properties
  if (s.properties && typeof s.properties === 'object') {
    for (const [key, value] of Object.entries(s.properties)) {
      issues.push(...hasUnconstrainedStrings(value, `${path}.${key}`));
    }
  }

  // Recurse into array items
  if (s.items) {
    issues.push(...hasUnconstrainedStrings(s.items, `${path}[]`));
  }

  // Check additionalProperties
  if (s.additionalProperties && typeof s.additionalProperties === 'object') {
    issues.push(...hasUnconstrainedStrings(s.additionalProperties, `${path}[*]`));
  }

  // Check anyOf, oneOf, allOf
  for (const combinator of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(s[combinator])) {
      (s[combinator] as unknown[]).forEach((subSchema, i) => {
        issues.push(...hasUnconstrainedStrings(subSchema, `${path}(${combinator}[${i}])`));
      });
    }
  }

  return issues;
}

/**
 * Validate a trik at the given path
 */
export function validateTrik(trikPath: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Check manifest.json exists
  const manifestPath = join(trikPath, 'manifest.json');
  if (!existsSync(manifestPath)) {
    return {
      valid: false,
      errors: ['Missing manifest.json'],
      warnings: [],
    };
  }

  // 2. Parse manifest
  let manifest: TrikManifest;
  try {
    const content = readFileSync(manifestPath, 'utf-8');
    manifest = JSON.parse(content);
  } catch (error) {
    return {
      valid: false,
      errors: [`Invalid manifest.json: ${error instanceof Error ? error.message : 'Parse error'}`],
      warnings: [],
    };
  }

  // 3. Validate required fields
  const requiredFields = ['id', 'name', 'version', 'description', 'entry', 'actions', 'capabilities', 'limits'];
  for (const field of requiredFields) {
    if (!(field in manifest)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  // 4. Validate entry point
  if (!manifest.entry?.module || !manifest.entry?.export) {
    errors.push('Invalid entry: must have module and export');
  } else {
    const entryPath = join(trikPath, manifest.entry.module);
    if (!existsSync(entryPath)) {
      errors.push(`Entry point not found: ${manifest.entry.module}`);
    }
  }

  // 5. Validate actions
  if (!manifest.actions || Object.keys(manifest.actions).length === 0) {
    errors.push('Manifest must define at least one action');
  }

  // 6. Check each action for privilege separation
  for (const [actionName, action] of Object.entries(manifest.actions || {})) {
    // Validate responseMode
    if (!['template', 'passthrough'].includes(action.responseMode)) {
      errors.push(`Action "${actionName}": Invalid responseMode "${action.responseMode}"`);
      continue;
    }

    // Template mode: must have agentDataSchema and responseTemplates
    if (action.responseMode === 'template') {
      if (!action.agentDataSchema) {
        errors.push(`Action "${actionName}": Template mode requires agentDataSchema`);
      } else {
        // Check for unconstrained strings in agentDataSchema
        const stringIssues = hasUnconstrainedStrings(
          action.agentDataSchema,
          `actions.${actionName}.agentDataSchema`
        );
        for (const issue of stringIssues) {
          errors.push(`Action "${actionName}": ${issue}`);
        }
      }

      if (!action.responseTemplates || Object.keys(action.responseTemplates).length === 0) {
        errors.push(`Action "${actionName}": Template mode requires responseTemplates`);
      }
    }

    // Passthrough mode: must have userContentSchema
    if (action.responseMode === 'passthrough') {
      if (!action.userContentSchema) {
        errors.push(`Action "${actionName}": Passthrough mode requires userContentSchema`);
      }
    }
  }

  // 7. Validate limits
  if (manifest.limits) {
    if (manifest.limits.maxExecutionTimeMs > 120000) {
      warnings.push('maxExecutionTimeMs is very high (>2min)');
    }
    if (manifest.limits.maxLlmCalls > 50) {
      warnings.push('maxLlmCalls is very high (>50)');
    }
    if (manifest.limits.maxToolCalls > 100) {
      warnings.push('maxToolCalls is very high (>100)');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Format validation result for display
 */
export function formatValidationResult(result: ValidationResult): string {
  const lines: string[] = [];

  if (result.valid) {
    lines.push('Validation passed');
  } else {
    lines.push('Validation failed');
  }

  for (const error of result.errors) {
    lines.push(`  [error] ${error}`);
  }

  for (const warning of result.warnings) {
    lines.push(`  [warn] ${warning}`);
  }

  return lines.join('\n');
}
