// Core manifest types
export type {
  JSONSchema,
  TrikManifest,
  // Agent types
  AgentMode,
  AgentDefinition,
  ModelPreferences,
  ToolDeclaration,
  // Capabilities
  TrikCapabilities,
  TrikLimits,
  SessionCapabilities,
  StorageCapabilities,
  // Entry point
  TrikEntry,
  TrikRuntime,
  // Configuration
  ConfigRequirement,
  TrikConfig,
  // Runtime communication
  TrikConfigContext,
  TrikStorageContext,
  TrikContext,
  TrikAgent,
  TrikResponse,
  ToolCallRecord,
  // Gateway session
  HandoffLogType,
  HandoffLogEntry,
  HandoffSession,
} from './types.js';

// Validation
export {
  validateManifest,
  diagnoseError,
  validateData,
  createValidator,
  SchemaValidator,
  type ValidationResult,
} from './validator.js';
