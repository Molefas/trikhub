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
  FilesystemCapabilities,
  ShellCapabilities,
  TrikManagementCapabilities,
  // Entry point
  TrikEntry,
  TrikRuntime,
  // Configuration
  ConfigRequirement,
  TrikConfig,
  // Runtime communication
  TrikConfigContext,
  TrikStorageContext,
  TrikRegistryContext,
  TrikProgressEvent,
  TrikContext,
  TrikAgent,
  TrikResponse,
  ToolCallRecord,
  ToolExecutionResult,
  // Registry context return types
  TrikSearchResult,
  TrikSearchResultItem,
  InstalledTrikInfo,
  TrikInstallResult,
  TrikUninstallResult,
  TrikUpgradeResult,
  TrikDetailInfo,
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
  type ValidationResult,
} from './validator.js';
