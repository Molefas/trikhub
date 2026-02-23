// Types
export type {
  JSONSchema,
  TrikManifest,
  TrikCapabilities,
  TrikLimits,
  TrikEntry,
  TrikRuntime,
  // Session/Storage capabilities
  SessionCapabilities,
  StorageCapabilities,
  // Configuration types
  ConfigRequirement,
  TrikConfig,
  TrikConfigContext,
  // Storage types
  TrikStorageContext,
} from './types.js';

// Validation
export {
  validateManifest,
  validateData,
  createValidator,
  SchemaValidator,
  type ValidationResult,
} from './validator.js';
