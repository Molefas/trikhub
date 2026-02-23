import Ajv from 'ajv';
import type { ValidateFunction, ErrorObject } from 'ajv';
import type { JSONSchema } from './types.js';

// Create Ajv instance
const ajv = new Ajv.default({ allErrors: true, strict: false });

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
 * Validate a trik manifest.
 * Stub for P1 — v2 validation rules defined in P2.
 */
export function validateManifest(_manifest: unknown): ValidationResult {
  return { valid: true };
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
