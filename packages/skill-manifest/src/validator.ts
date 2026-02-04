import Ajv from 'ajv';
import type { ValidateFunction, ErrorObject } from 'ajv';
import type { JSONSchema } from './types.js';

// Create Ajv instance
const ajv = new Ajv.default({ allErrors: true, strict: false });

/**
 * Common manifest properties
 */
const commonManifestProperties = {
  id: { type: 'string', minLength: 1 },
  name: { type: 'string', minLength: 1 },
  description: { type: 'string' },
  version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+' },
  capabilities: {
    type: 'object',
    properties: {
      tools: { type: 'array', items: { type: 'string' } },
      canRequestClarification: { type: 'boolean' },
    },
    required: ['tools', 'canRequestClarification'],
  },
  limits: {
    type: 'object',
    properties: {
      maxExecutionTimeMs: { type: 'number', minimum: 0 },
      maxLlmCalls: { type: 'number', minimum: 0 },
      maxToolCalls: { type: 'number', minimum: 0 },
    },
    required: ['maxExecutionTimeMs', 'maxLlmCalls', 'maxToolCalls'],
  },
  entry: {
    type: 'object',
    properties: {
      module: { type: 'string', minLength: 1 },
      export: { type: 'string', minLength: 1 },
    },
    required: ['module', 'export'],
  },
  author: { type: 'string' },
  repository: { type: 'string' },
  license: { type: 'string' },
};

/**
 * Action definition for template mode (requires agentDataSchema + responseTemplates)
 */
const actionSchemaTemplate: JSONSchema = {
  type: 'object',
  properties: {
    responseMode: { type: 'string', const: 'template' },
    inputSchema: { type: 'object' },
    agentDataSchema: { type: 'object' },
    userContentSchema: { type: 'object' },
    responseTemplates: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          text: { type: 'string' },
        },
        required: ['text'],
      },
    },
    description: { type: 'string' },
  },
  required: ['responseMode', 'inputSchema', 'agentDataSchema', 'responseTemplates'],
};

/**
 * Action definition for passthrough mode (requires userContentSchema)
 */
const actionSchemaPassthrough: JSONSchema = {
  type: 'object',
  properties: {
    responseMode: { type: 'string', const: 'passthrough' },
    inputSchema: { type: 'object' },
    userContentSchema: { type: 'object' },
    description: { type: 'string' },
  },
  required: ['responseMode', 'inputSchema', 'userContentSchema'],
};

/**
 * JSON Schema for validating SkillManifest
 */
const manifestSchema: JSONSchema = {
  type: 'object',
  properties: {
    ...commonManifestProperties,
    actions: {
      type: 'object',
      additionalProperties: {
        anyOf: [actionSchemaTemplate, actionSchemaPassthrough],
      },
      minProperties: 1,
    },
  },
  required: [
    'id',
    'name',
    'description',
    'version',
    'actions',
    'capabilities',
    'limits',
    'entry',
  ],
};

const validateManifestSchema = ajv.compile(manifestSchema);

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

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
 * Validate a skill manifest
 */
export function validateManifest(manifest: unknown): ValidationResult {
  const valid = validateManifestSchema(manifest);
  if (valid) {
    return { valid: true };
  }
  return {
    valid: false,
    errors: formatErrors(validateManifestSchema.errors),
  };
}

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

  /**
   * Get or create a validator for the given schema
   */
  getValidator(schemaId: string, schema: JSONSchema): ValidateFunction {
    const cached = this.cache.get(schemaId);
    if (cached) {
      return cached;
    }
    const validator = ajv.compile(schema);
    this.cache.set(schemaId, validator);
    return validator;
  }

  /**
   * Validate data against a cached schema
   */
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

  /**
   * Clear the schema cache
   */
  clear(): void {
    this.cache.clear();
  }
}
