/**
 * diagnose_error — v2 implementation.
 *
 * Explains v2 error messages and suggests fixes.
 * Uses @trikhub/manifest diagnoseError as foundation, adds context-specific guidance.
 */

import { diagnoseError as manifestDiagnose } from '@trikhub/manifest';
import type { DiagnoseResult } from './types.js';

// ============================================================================
// v2 Error patterns
// ============================================================================

interface ErrorPattern {
  pattern: RegExp;
  diagnosis: DiagnoseResult;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  // Agent block errors
  {
    pattern: /missing.*agent|agent.*required|no agent/i,
    diagnosis: {
      explanation:
        'v2 manifests require an "agent" block that declares how your trik operates as an agent.',
      rootCause: 'The manifest is missing the required "agent" object.',
      suggestedFix:
        'Add an "agent" object with "mode" ("conversational" or "tool"), "handoffDescription" (required for conversational), and "domain" (array of specific tags).',
      relatedDocs: ['https://trikhub.dev/docs/manifest#agent'],
    },
  },

  // Handoff description
  {
    pattern: /handoffDescription/i,
    diagnosis: {
      explanation:
        'The handoff description is used to generate the tool that routes users to your trik. It must be descriptive enough for the main agent to make routing decisions.',
      rootCause: 'The handoff description is missing, too short (<10 chars), or too long (>500 chars).',
      suggestedFix:
        'Set agent.handoffDescription to a clear description of what your trik does, between 10 and 500 characters.',
      relatedDocs: ['https://trikhub.dev/docs/manifest#handoff-description'],
    },
  },

  // System prompt errors
  {
    pattern: /systemPrompt.*systemPromptFile|mutually exclusive/i,
    diagnosis: {
      explanation:
        'You can provide a system prompt inline (agent.systemPrompt) or as a file path (agent.systemPromptFile), but not both.',
      rootCause: 'Both systemPrompt and systemPromptFile are set.',
      suggestedFix:
        'Remove one. Use systemPromptFile for longer prompts (recommended): agent.systemPromptFile: "./src/prompts/system.md".',
      relatedDocs: ['https://trikhub.dev/docs/manifest#system-prompt'],
    },
  },

  {
    pattern: /conversational.*systemPrompt|systemPrompt.*conversational/i,
    diagnosis: {
      explanation:
        'Conversational agents need a system prompt to define their personality and behavior.',
      rootCause: 'Conversational mode requires either systemPrompt or systemPromptFile, but neither is set.',
      suggestedFix:
        'Add agent.systemPromptFile: "./src/prompts/system.md" and create the file with your prompt.',
      relatedDocs: ['https://trikhub.dev/docs/manifest#system-prompt'],
    },
  },

  // Mode errors
  {
    pattern: /mode.*invalid|invalid.*mode|mode.*enum/i,
    diagnosis: {
      explanation:
        'Agent mode must be "conversational" (agent with LLM for multi-turn conversations) or "tool" (export native tools to main agent).',
      rootCause: 'agent.mode has an invalid value.',
      suggestedFix:
        'Set agent.mode to "conversational" or "tool".',
      relatedDocs: ['https://trikhub.dev/docs/manifest#agent-mode'],
    },
  },

  // Domain tag errors
  {
    pattern: /domain.*generic|generic.*domain/i,
    diagnosis: {
      explanation:
        'Specific domain tags help the main agent decide when to route to your trik. Generic tags like "general" or "utility" reduce routing accuracy.',
      rootCause: 'One or more domain tags are too generic.',
      suggestedFix:
        'Replace generic tags with specific ones like "content curation", "data analysis", "code review", etc.',
      relatedDocs: ['https://trikhub.dev/docs/manifest#domain-tags'],
    },
  },

  {
    pattern: /domain.*minItems|domain.*empty/i,
    diagnosis: {
      explanation:
        'Domain tags are required for handoff routing. At least one specific tag must be provided.',
      rootCause: 'The agent.domain array is empty or missing.',
      suggestedFix:
        'Add at least one domain tag: agent.domain: ["your-specific-domain"].',
      relatedDocs: ['https://trikhub.dev/docs/manifest#domain-tags'],
    },
  },

  // Log schema errors
  {
    pattern: /unconstrained.*logSchema|logSchema.*unconstrained/i,
    diagnosis: {
      explanation:
        'Log values flow into the main agent\'s context window. Unconstrained strings could allow prompt injection.',
      rootCause: 'A string field in logSchema has no constraints (no enum, format, pattern, or maxLength).',
      suggestedFix:
        'Add constraints to string fields: use enum (for known values), maxLength (for free text), pattern (for formats), or format ("date", "uuid", etc.).',
      relatedDocs: ['https://trikhub.dev/docs/manifest#log-schema'],
    },
  },

  {
    pattern: /placeholder.*logSchema|logSchema.*placeholder|logTemplate.*placeholder/i,
    diagnosis: {
      explanation:
        'Every {{placeholder}} in a logTemplate must have a matching entry in logSchema that defines its type.',
      rootCause: 'A logTemplate placeholder references a field not defined in logSchema.',
      suggestedFix:
        'Add the missing field to logSchema. Example: "count": { "type": "integer" }.',
      relatedDocs: ['https://trikhub.dev/docs/manifest#log-templates'],
    },
  },

  // Linter: has-source-files
  {
    pattern: /no (typescript|python) source files|no source files|has-source-files/i,
    diagnosis: {
      explanation:
        'The linter checks that the trik directory contains source files. For TypeScript triks, it scans for .ts/.tsx files (excluding .test., .spec., and .d.ts). For Python triks, it scans for .py files.',
      rootCause: 'No source files were found in the trik root or src/ directory.',
      suggestedFix:
        'Ensure your source files are in the trik root or in a src/ subdirectory. For TypeScript triks, check that .ts files exist. For Python triks, check that .py files exist in one of these locations.',
      relatedDocs: ['https://trikhub.dev/docs/creating-triks/structure'],
    },
  },

  // Entry point errors
  {
    pattern: /entry.*not found|module.*not found|cannot find.*entry/i,
    diagnosis: {
      explanation:
        'The entry point specified in manifest.json must point to a file that exports your agent.',
      rootCause: 'The file specified in entry.module does not exist.',
      suggestedFix:
        'For TypeScript triks, run `npm run build` to compile and verify entry.module points to the compiled output (e.g., "./dist/index.js"). For Python triks, verify entry.module points to the correct .py source file (e.g., "./src/agent.py").',
      relatedDocs: ['https://trikhub.dev/docs/manifest#entry-point'],
    },
  },

  // JSON errors
  {
    pattern: /invalid json|json.*parse|unexpected token/i,
    diagnosis: {
      explanation: 'The manifest.json file contains invalid JSON syntax.',
      rootCause: 'A JSON syntax error prevents parsing the manifest.',
      suggestedFix:
        'Check for missing commas, unmatched brackets, or trailing commas. Use your IDE or a JSON validator.',
      relatedDocs: ['https://trikhub.dev/docs/manifest'],
    },
  },

  // Schema version
  {
    pattern: /schemaVersion|schema.*version/i,
    diagnosis: {
      explanation:
        'v2 manifests must have "schemaVersion": 2. This distinguishes them from v1 manifests.',
      rootCause: 'schemaVersion is missing or not set to 2.',
      suggestedFix: 'Set "schemaVersion": 2 at the top level of your manifest.json.',
      relatedDocs: ['https://trikhub.dev/docs/manifest#schema-version'],
    },
  },
];

// ============================================================================
// Public API
// ============================================================================

export function diagnoseErrorTool(
  error: string,
  context?: 'publish' | 'lint' | 'runtime',
): DiagnoseResult {
  // Try MCP-level patterns first (more detailed with rootCause + relatedDocs)
  for (const { pattern, diagnosis } of ERROR_PATTERNS) {
    if (pattern.test(error)) {
      if (context) {
        const contextNote = getContextNote(context);
        return {
          ...diagnosis,
          suggestedFix: `${diagnosis.suggestedFix}\n\n${contextNote}`,
        };
      }
      return diagnosis;
    }
  }

  // Fall back to manifest package diagnosis
  const manifestDiagnosis = manifestDiagnose(error);
  if (manifestDiagnosis) {
    const result: DiagnoseResult = {
      explanation: manifestDiagnosis.explanation,
      rootCause: manifestDiagnosis.explanation,
      suggestedFix: manifestDiagnosis.suggestion,
      relatedDocs: ['https://trikhub.dev/docs/manifest'],
    };
    if (context) {
      result.suggestedFix += `\n\n${getContextNote(context)}`;
    }
    return result;
  }

  // Fallback
  return {
    explanation: 'This error was not recognized. It may be a new error type or a non-TrikHub error.',
    rootCause: error,
    suggestedFix:
      'Check the TrikHub documentation or run `trik lint .` for a full validation report.',
    relatedDocs: ['https://trikhub.dev/docs'],
  };
}

function getContextNote(context: 'publish' | 'lint' | 'runtime'): string {
  switch (context) {
    case 'publish':
      return 'This error occurred during publish. Fix the issue and run `trik lint .` before retrying `trik publish`.';
    case 'lint':
      return 'This was caught by the linter. Fix the manifest and re-run `trik lint .` to verify.';
    case 'runtime':
      return 'This error occurred at runtime. Check your agent implementation and verify it matches the manifest declaration.';
  }
}
