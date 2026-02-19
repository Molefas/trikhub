/**
 * @deprecated Use @trikhub/linter instead.
 *
 * This validator is deprecated and no longer used by the CLI.
 * All validation is now centralized in @trikhub/linter which provides:
 * - Support for both Node.js and Python package structures
 * - Consistent validation between `trik lint` and `trik publish`
 * - Full manifest schema validation via @trikhub/manifest
 *
 * Migration:
 *   import { TrikLinter } from '@trikhub/linter';
 *   const linter = new TrikLinter({ checkCompiledEntry: true });
 *   const results = await linter.lintManifestOnly(trikPath);
 *
 * This file will be removed in a future version.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { findUnconstrainedStrings, type JSONSchema } from '@trikhub/manifest';

/**
 * @deprecated Use LintResult[] from @trikhub/linter instead.
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
  schemaVersion: 1;
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
  };
  limits: {
    maxExecutionTimeMs: number;
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
 * @deprecated Use TrikLinter.lintManifestOnly() from @trikhub/linter instead.
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
  const requiredFields = ['schemaVersion', 'id', 'name', 'version', 'description', 'entry', 'actions', 'capabilities', 'limits'];
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
        // Check for unconstrained strings in agentDataSchema (security check)
        const unconstrained = findUnconstrainedStrings(
          action.agentDataSchema as JSONSchema,
          `actions.${actionName}.agentDataSchema`
        );
        for (const path of unconstrained) {
          errors.push(`Action "${actionName}": Unconstrained string at ${path}`);
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
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * @deprecated Use TrikLinter.formatResults() from @trikhub/linter instead.
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
