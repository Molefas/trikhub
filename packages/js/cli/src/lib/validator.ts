/**
 * @deprecated Use @trikhub/linter instead.
 *
 * v1 validator removed in P1. All validation now through @trikhub/linter.
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateTrik(_trikPath: string): ValidationResult {
  return { valid: true, errors: [], warnings: [] };
}

export function formatValidationResult(result: ValidationResult): string {
  return result.valid ? 'Validation passed' : 'Validation failed';
}
