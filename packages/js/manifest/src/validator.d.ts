import type { ValidateFunction } from 'ajv';
import type { JSONSchema } from './types.js';
export interface ValidationResult {
    valid: boolean;
    errors?: string[];
}
/**
 * Validate a trik manifest
 */
export declare function validateManifest(manifest: unknown): ValidationResult;
/**
 * Create a validator function for a given JSON Schema
 */
export declare function createValidator(schema: JSONSchema): ValidateFunction;
/**
 * Validate data against a JSON Schema
 */
export declare function validateData(schema: JSONSchema, data: unknown): ValidationResult;
/**
 * Validator class that caches compiled schemas
 */
export declare class SchemaValidator {
    private cache;
    /**
     * Get or create a validator for the given schema
     */
    getValidator(schemaId: string, schema: JSONSchema): ValidateFunction;
    /**
     * Validate data against a cached schema
     */
    validate(schemaId: string, schema: JSONSchema, data: unknown): ValidationResult;
    /**
     * Clear the schema cache
     */
    clear(): void;
}
//# sourceMappingURL=validator.d.ts.map