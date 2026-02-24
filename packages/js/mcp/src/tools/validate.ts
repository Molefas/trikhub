/**
 * validate_manifest — v2 implementation.
 *
 * Validates a v2 manifest using the @trikhub/manifest validator,
 * reports errors with fix suggestions, and returns quality score.
 */

import { validateManifest } from '@trikhub/manifest';
import type { ValidateResult } from './types.js';

// ============================================================================
// Error-to-fix mapping
// ============================================================================

const FIX_MAP: Array<{ pattern: RegExp; fix: string }> = [
  {
    pattern: /schemaVersion/i,
    fix: 'Set "schemaVersion": 2 at the top level of your manifest.',
  },
  {
    pattern: /agent.*required|required.*agent/i,
    fix: 'Add an "agent" object with "mode", "handoffDescription", and "domain" fields.',
  },
  {
    pattern: /handoffDescription.*minLength|handoffDescription.*short/i,
    fix: 'Make handoffDescription at least 10 characters. Describe what your trik does clearly for handoff routing.',
  },
  {
    pattern: /handoffDescription.*maxLength|handoffDescription.*long/i,
    fix: 'Keep handoffDescription under 500 characters. Be concise but descriptive.',
  },
  {
    pattern: /mode.*enum/i,
    fix: 'Set agent.mode to "conversational" (for LLM agents) or "tool" (to export native tools).',
  },
  {
    pattern: /domain.*minItems/i,
    fix: 'Add at least one domain tag in agent.domain. Example: ["content curation", "article generation"].',
  },
  {
    pattern: /systemPrompt.*mutually exclusive|systemPromptFile.*mutually exclusive/i,
    fix: 'Use either agent.systemPrompt (inline) or agent.systemPromptFile (path to .md), not both.',
  },
  {
    pattern: /conversational.*requires.*systemPrompt/i,
    fix: 'Conversational mode requires a system prompt. Add agent.systemPrompt or agent.systemPromptFile.',
  },
  {
    pattern: /unconstrained.*string|logSchema.*unconstrained/i,
    fix: 'Add constraints to string fields in logSchema: use enum, format, pattern, or maxLength.',
  },
  {
    pattern: /placeholder.*logSchema|logSchema.*placeholder/i,
    fix: 'Add a logSchema entry for each {{placeholder}} in your logTemplate.',
  },
  {
    pattern: /tool.*mode.*requires.*tools|tools.*required.*tool.*mode/i,
    fix: 'Tool-mode triks must have a "tools" block with inputSchema and outputSchema for each tool.',
  },
  {
    pattern: /inputSchema.*required|outputSchema.*required/i,
    fix: 'Tool-mode tools need both "inputSchema" and "outputSchema". Define the JSON Schema for input and output.',
  },
  {
    pattern: /outputSchema.*unconstrained/i,
    fix: 'Output schema strings must be constrained (enum, maxLength, pattern, or format) for security.',
  },
  {
    pattern: /outputTemplate.*required|required.*outputTemplate/i,
    fix: 'Tool-mode tools need an "outputTemplate" with {{placeholders}} for each outputSchema field. Example: "{{status}} ({{resultId}})".',
  },
  {
    pattern: /agent-safe|not agent-safe|maxLength.*not.*agent/i,
    fix: 'outputSchema strings must use enum, format, or pattern — maxLength alone is not agent-safe. If your tool returns free-form text, use conversational mode instead.',
  },
  {
    pattern: /outputTemplate.*placeholder.*outputSchema|placeholder.*not.*outputSchema/i,
    fix: 'Every {{placeholder}} in outputTemplate must match a property in outputSchema. Check for typos.',
  },
  {
    pattern: /entry.*required|entry.*module/i,
    fix: 'Add an "entry" object with "module" (path to compiled file) and "export" (export name).',
  },
  {
    pattern: /id.*pattern/i,
    fix: 'Trik ID must be lowercase alphanumeric with dashes, starting with a letter. Example: "my-trik".',
  },
];

function findFix(message: string): string {
  for (const { pattern, fix } of FIX_MAP) {
    if (pattern.test(message)) {
      return fix;
    }
  }
  return 'Check the TrikHub documentation for the correct manifest format.';
}

function extractPath(message: string): string {
  // Try to extract a JSON path from the error message
  const pathMatch = message.match(/^([\w./[\]]+):/);
  if (pathMatch) {
    return pathMatch[1];
  }

  // Try to extract from "tools.NAME.logSchema" patterns
  const toolMatch = message.match(/(tools\.\w+(?:\.\w+)*)/);
  if (toolMatch) {
    return toolMatch[1];
  }

  // Try to extract "agent.xxx" patterns
  const agentMatch = message.match(/(agent(?:\.\w+)*)/);
  if (agentMatch) {
    return agentMatch[1];
  }

  return 'manifest';
}

// ============================================================================
// Public API
// ============================================================================

export function validateTrikManifest(
  manifestJson: string,
  strict?: boolean,
): ValidateResult {
  // 1. Parse JSON
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestJson);
  } catch (e) {
    return {
      valid: false,
      errors: [
        {
          path: 'manifest.json',
          message: `Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}`,
          fix: 'Fix the JSON syntax. Use a JSON validator or your IDE to find the error.',
        },
      ],
      warnings: [],
      qualityScore: 0,
    };
  }

  // 2. Run v2 validator
  const result = validateManifest(manifest);

  // 3. Convert to MCP tool output format
  const errors = (result.errors || []).map((msg) => ({
    path: extractPath(msg),
    message: msg,
    fix: findFix(msg),
  }));

  const warnings = (result.warnings || []).map((msg) => ({
    path: extractPath(msg),
    message: msg,
    suggestion: findFix(msg),
  }));

  // 4. Add strict-mode warnings
  if (strict && result.valid) {
    const m = manifest as Record<string, unknown>;

    if (!m.author) {
      warnings.push({
        path: 'author',
        message: 'Missing optional "author" field.',
        suggestion: 'Add an "author" field with your name or organization.',
      });
    }

    if (!m.repository) {
      warnings.push({
        path: 'repository',
        message: 'Missing optional "repository" field.',
        suggestion: 'Add a "repository" field with your git repository URL.',
      });
    }

    if (!m.license) {
      warnings.push({
        path: 'license',
        message: 'Missing optional "license" field.',
        suggestion: 'Add a "license" field (e.g., "MIT", "Apache-2.0").',
      });
    }
  }

  return {
    valid: result.valid,
    errors,
    warnings,
    qualityScore: result.qualityScore ?? 0,
  };
}
