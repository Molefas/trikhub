import Ajv from 'ajv';
import type { ValidateFunction, ErrorObject } from 'ajv';
import type { JSONSchema } from './types.js';

// Create Ajv instance
const ajv = new Ajv.default({ allErrors: true, strict: false });

// ============================================================================
// Validation Result Types
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
  qualityScore?: number;
}

// ============================================================================
// v2 Manifest JSON Schema
// ============================================================================

const configRequirementSchema = {
  type: 'object',
  properties: {
    key: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    default: { type: 'string' },
  },
  required: ['key', 'description'],
  additionalProperties: false,
};

const manifestSchema = {
  type: 'object',
  properties: {
    schemaVersion: { const: 2 },
    id: { type: 'string', minLength: 1, pattern: '^[a-z][a-z0-9-]*$' },
    name: { type: 'string', minLength: 1 },
    description: { type: 'string', minLength: 1 },
    version: { type: 'string', minLength: 1 },

    agent: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['conversational', 'one-shot'] },
        handoffDescription: { type: 'string', minLength: 10, maxLength: 500 },
        systemPrompt: { type: 'string' },
        systemPromptFile: { type: 'string' },
        model: {
          type: 'object',
          properties: {
            provider: { type: 'string' },
            capabilities: { type: 'array', items: { type: 'string' } },
            temperature: { type: 'number', minimum: 0, maximum: 2 },
          },
          additionalProperties: false,
        },
        domain: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          minItems: 1,
        },
      },
      required: ['mode', 'handoffDescription', 'domain'],
      additionalProperties: false,
    },

    tools: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          description: { type: 'string', minLength: 1 },
          logTemplate: { type: 'string' },
          logSchema: {
            type: 'object',
            additionalProperties: { type: 'object' },
          },
        },
        required: ['description'],
        additionalProperties: false,
      },
    },

    capabilities: {
      type: 'object',
      properties: {
        session: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            maxDurationMs: { type: 'number', minimum: 0 },
          },
          required: ['enabled'],
          additionalProperties: false,
        },
        storage: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            maxSizeBytes: { type: 'number', minimum: 0 },
            persistent: { type: 'boolean' },
          },
          required: ['enabled'],
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },

    limits: {
      type: 'object',
      properties: {
        maxTurnTimeMs: { type: 'number', minimum: 0 },
      },
      required: ['maxTurnTimeMs'],
      additionalProperties: false,
    },

    config: {
      type: 'object',
      properties: {
        required: { type: 'array', items: configRequirementSchema },
        optional: { type: 'array', items: configRequirementSchema },
      },
      additionalProperties: false,
    },

    entry: {
      type: 'object',
      properties: {
        module: { type: 'string', minLength: 1 },
        export: { type: 'string', minLength: 1 },
        runtime: { type: 'string', enum: ['node', 'python'] },
      },
      required: ['module', 'export'],
      additionalProperties: false,
    },

    author: { type: 'string' },
    repository: { type: 'string' },
    license: { type: 'string' },
  },
  required: ['schemaVersion', 'id', 'name', 'description', 'version', 'agent', 'entry'],
  additionalProperties: false,
};

const compiledManifestSchema = ajv.compile(manifestSchema);

// ============================================================================
// Generic domain tags that are too broad
// ============================================================================

const GENERIC_DOMAIN_TAGS = new Set([
  'general',
  'utility',
  'utilities',
  'misc',
  'miscellaneous',
  'other',
  'helper',
  'tools',
  'tool',
]);

// ============================================================================
// Log Template Validation
// ============================================================================

/**
 * Extract {{placeholder}} names from a log template string.
 */
function extractPlaceholders(template: string): string[] {
  const matches = template.match(/\{\{(\w+)\}\}/g);
  if (!matches) return [];
  return matches.map((m) => m.slice(2, -2));
}

/**
 * Check if a JSON Schema value type is constrained (safe for log context).
 *
 * Safe: integers, numbers, booleans, strings with enum/format/pattern, strings with maxLength
 * Rejected: unconstrained free-form strings (no enum, format, pattern, or maxLength)
 */
function isConstrainedType(schema: JSONSchema): boolean {
  const type = schema.type;

  // Non-string primitives are always safe
  if (type === 'integer' || type === 'number' || type === 'boolean') {
    return true;
  }

  // Enums are always safe
  if (schema.enum) {
    return true;
  }

  // Strings must be constrained
  if (type === 'string') {
    return !!(schema.enum || schema.format || schema.pattern || schema.maxLength);
  }

  // Arrays/objects not supported in logSchema
  return false;
}

// ============================================================================
// Semantic Validation (beyond JSON Schema)
// ============================================================================

interface SemanticIssue {
  type: 'error' | 'warning';
  message: string;
}

/**
 * Run semantic validation rules on a structurally valid manifest.
 */
function validateSemantics(manifest: Record<string, unknown>): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  const agent = manifest.agent as Record<string, unknown>;
  const mode = agent.mode as string;
  const tools = manifest.tools as Record<string, Record<string, unknown>> | undefined;

  // --- Mode consistency ---

  if (mode === 'conversational') {
    const hasPrompt = !!agent.systemPrompt;
    const hasPromptFile = !!agent.systemPromptFile;

    if (hasPrompt && hasPromptFile) {
      issues.push({
        type: 'error',
        message: 'agent: systemPrompt and systemPromptFile are mutually exclusive — use one or the other',
      });
    } else if (!hasPrompt && !hasPromptFile) {
      issues.push({
        type: 'error',
        message: 'agent: conversational mode requires systemPrompt or systemPromptFile',
      });
    }
  }

  if (mode === 'one-shot') {
    if (agent.systemPrompt) {
      issues.push({
        type: 'warning',
        message: 'agent: systemPrompt is unnecessary for one-shot mode (no LLM)',
      });
    }
    if (agent.systemPromptFile) {
      issues.push({
        type: 'warning',
        message: 'agent: systemPromptFile is unnecessary for one-shot mode (no LLM)',
      });
    }
  }

  // --- Generic domain tags ---

  const domain = agent.domain as string[];
  for (const tag of domain) {
    if (GENERIC_DOMAIN_TAGS.has(tag.toLowerCase())) {
      issues.push({
        type: 'warning',
        message: `agent.domain: "${tag}" is too generic — use specific domain tags for better routing`,
      });
    }
  }

  // --- Log template validation ---

  if (tools) {
    for (const [toolName, toolDef] of Object.entries(tools)) {
      const logTemplate = toolDef.logTemplate as string | undefined;
      const logSchema = toolDef.logSchema as Record<string, JSONSchema> | undefined;

      if (logTemplate) {
        const placeholders = extractPlaceholders(logTemplate);

        if (placeholders.length > 0 && !logSchema) {
          issues.push({
            type: 'error',
            message: `tools.${toolName}: logTemplate has placeholders (${placeholders.join(', ')}) but no logSchema`,
          });
        } else if (logSchema) {
          // Check every placeholder has a logSchema entry
          for (const ph of placeholders) {
            if (!(ph in logSchema)) {
              issues.push({
                type: 'error',
                message: `tools.${toolName}: logTemplate placeholder "{{${ph}}}" has no entry in logSchema`,
              });
            }
          }
        }
      }

      // Check logSchema values are constrained
      if (logSchema) {
        for (const [field, fieldSchema] of Object.entries(logSchema)) {
          if (!isConstrainedType(fieldSchema)) {
            issues.push({
              type: 'error',
              message: `tools.${toolName}.logSchema.${field}: unconstrained string — add enum, format, pattern, or maxLength`,
            });
          }
        }
      }
    }
  }

  return issues;
}

// ============================================================================
// Quality Score
// ============================================================================

/**
 * Calculate the quality score for a manifest (0-100).
 */
function calculateQualityScore(manifest: Record<string, unknown>): number {
  let score = 100;
  const agent = manifest.agent as Record<string, unknown>;
  const mode = agent.mode as string;
  const tools = manifest.tools as Record<string, Record<string, unknown>> | undefined;

  // Missing handoffDescription: -30
  if (!agent.handoffDescription) {
    score -= 30;
  } else if ((agent.handoffDescription as string).length < 20) {
    // handoffDescription too short: -15
    score -= 15;
  }

  // Missing domain tags: -15
  const domain = agent.domain as string[] | undefined;
  if (!domain || domain.length === 0) {
    score -= 15;
  }

  // Missing systemPrompt for conversational: -25
  if (mode === 'conversational' && !agent.systemPrompt && !agent.systemPromptFile) {
    score -= 25;
  }

  // Missing entry.module: -25
  const entry = manifest.entry as Record<string, unknown> | undefined;
  if (!entry?.module) {
    score -= 25;
  }

  // Missing limits: -10
  if (!manifest.limits) {
    score -= 10;
  }

  // Generic domain tags: -5
  if (domain) {
    const hasGeneric = domain.some((tag) => GENERIC_DOMAIN_TAGS.has((tag as string).toLowerCase()));
    if (hasGeneric) {
      score -= 5;
    }
  }

  // Tool-level deductions
  if (tools) {
    for (const [_toolName, toolDef] of Object.entries(tools)) {
      // Missing tool description: -5
      if (!toolDef.description) {
        score -= 5;
      }

      // Missing logTemplate: -3
      if (!toolDef.logTemplate) {
        score -= 3;
      }

      // Unconstrained logSchema strings: -10 per field
      const logSchema = toolDef.logSchema as Record<string, JSONSchema> | undefined;
      if (logSchema) {
        for (const [_field, fieldSchema] of Object.entries(logSchema)) {
          if (!isConstrainedType(fieldSchema)) {
            score -= 10;
          }
        }
      }
    }
  }

  return Math.max(0, score);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Format ajv errors into readable strings
 */
function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors) return [];
  return errors.map((e) => {
    const path = e.instancePath || 'root';
    return `${path}: ${e.message}`;
  });
}

/**
 * Validate a v2 trik manifest.
 *
 * Performs three levels of validation:
 * 1. JSON Schema structure validation
 * 2. Semantic validation (mode consistency, log templates, constrained strings)
 * 3. Quality score calculation
 */
export function validateManifest(manifest: unknown): ValidationResult {
  // 1. Structural validation via JSON Schema
  const structureValid = compiledManifestSchema(manifest);
  if (!structureValid) {
    return {
      valid: false,
      errors: formatErrors(compiledManifestSchema.errors),
    };
  }

  // 2. Semantic validation
  const issues = validateSemantics(manifest as Record<string, unknown>);
  const errors = issues.filter((i) => i.type === 'error').map((i) => i.message);
  const warnings = issues.filter((i) => i.type === 'warning').map((i) => i.message);

  // 3. Quality score
  const qualityScore = calculateQualityScore(manifest as Record<string, unknown>);

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
    qualityScore,
  };
}

// ============================================================================
// Error Diagnosis
// ============================================================================

interface DiagnosisResult {
  explanation: string;
  suggestion: string;
}

const ERROR_PATTERNS: Array<{ pattern: RegExp; diagnosis: DiagnosisResult }> = [
  {
    pattern: /agent/i,
    diagnosis: {
      explanation: 'v2 manifests require an agent block declaring mode, handoff description, and domain tags.',
      suggestion: 'Add an "agent" object with "mode", "handoffDescription", and "domain" fields.',
    },
  },
  {
    pattern: /handoffDescription/i,
    diagnosis: {
      explanation: 'The handoff description generates the tool that routes users to your trik.',
      suggestion: 'Add agent.handoffDescription with a clear description (10-500 chars) of what your trik does.',
    },
  },
  {
    pattern: /systemPrompt/i,
    diagnosis: {
      explanation: 'Conversational triks need a system prompt to define personality and behavior.',
      suggestion: 'Add agent.systemPrompt (inline) or agent.systemPromptFile (path to .md file). Use one, not both.',
    },
  },
  {
    pattern: /mode/i,
    diagnosis: {
      explanation: "Valid modes: 'conversational' (agent with LLM) or 'one-shot' (deterministic, no LLM).",
      suggestion: 'Set agent.mode to "conversational" or "one-shot".',
    },
  },
  {
    pattern: /domain.*generic|generic.*domain/i,
    diagnosis: {
      explanation: 'Specific domain tags help transfer-back decisions. Generic tags like "general" are too broad.',
      suggestion: 'Replace generic tags with specific ones like "content curation", "data analysis", etc.',
    },
  },
  {
    pattern: /unconstrained.*logSchema|logSchema.*unconstrained/i,
    diagnosis: {
      explanation: 'Log values flow into the main agent\'s context. Strings need constraints to prevent injection.',
      suggestion: 'Add enum, format, pattern, or maxLength to string fields in logSchema.',
    },
  },
  {
    pattern: /placeholder.*logSchema|logSchema.*placeholder/i,
    diagnosis: {
      explanation: 'Every {{placeholder}} in logTemplate must have a matching entry in logSchema.',
      suggestion: 'Add the missing field to logSchema with a constrained type definition.',
    },
  },
];

/**
 * Diagnose a validation error and provide actionable guidance.
 */
export function diagnoseError(errorMessage: string): DiagnosisResult | null {
  for (const { pattern, diagnosis } of ERROR_PATTERNS) {
    if (pattern.test(errorMessage)) {
      return diagnosis;
    }
  }
  return null;
}

// ============================================================================
// Utility Exports (kept from v1 for downstream use)
// ============================================================================

/**
 * Create a validator function for a given JSON Schema
 */
export function createValidator(schema: JSONSchema): ValidateFunction {
  return ajv.compile(schema);
}

/**
 * Validate data against a JSON Schema
 */
export function validateData(schema: JSONSchema, data: unknown): ValidationResult {
  const validate = ajv.compile(schema);
  const valid = validate(data);
  if (valid) {
    return { valid: true };
  }
  return {
    valid: false,
    errors: formatErrors(validate.errors),
  };
}

/**
 * Validator class that caches compiled schemas
 */
export class SchemaValidator {
  private cache = new Map<string, ValidateFunction>();

  getValidator(schemaId: string, schema: JSONSchema): ValidateFunction {
    const cached = this.cache.get(schemaId);
    if (cached) {
      return cached;
    }
    const validator = ajv.compile(schema);
    this.cache.set(schemaId, validator);
    return validator;
  }

  validate(schemaId: string, schema: JSONSchema, data: unknown): ValidationResult {
    const validator = this.getValidator(schemaId, schema);
    const valid = validator(data);
    if (valid) {
      return { valid: true };
    }
    return {
      valid: false,
      errors: formatErrors(validator.errors),
    };
  }

  clear(): void {
    this.cache.clear();
  }
}
