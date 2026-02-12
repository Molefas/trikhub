// Gateway (local filesystem execution)
export {
  TrikGateway,
  type TrikGatewayConfig,
  type ExecuteTrikOptions,
  type GatewayResultWithSession,
  // Trik discovery types
  type ToolDefinition,
  type TrikInfo,
  type GetToolDefinitionsOptions,
  // Config-based loading types
  type TrikHubConfig,
  type LoadFromConfigOptions,
} from './gateway.js';

// Session storage
export { type SessionStorage, InMemorySessionStorage } from './session-storage.js';

// Config store
export {
  type ConfigStore,
  type ConfigStoreOptions,
  type SecretsFile,
  FileConfigStore,
  InMemoryConfigStore,
} from './config-store.js';

// Storage provider
export {
  type StorageProvider,
  JsonFileStorageProvider,
  InMemoryStorageProvider,
} from './storage-provider.js';

// Re-export types from trik-manifest for convenience
export type {
  TrikManifest,
  ActionDefinition,
  ResponseMode,
  JSONSchema,
  ResponseTemplate,
  GatewayResult,
  GatewaySuccess,
  GatewaySuccessTemplate,
  GatewaySuccessPassthrough,
  GatewayError,
  GatewayClarification,
  ClarificationQuestion,
  ClarificationAnswer,
  // Session types
  SessionCapabilities,
  SessionHistoryEntry,
  TrikSession,
  SessionContext,
  // Passthrough types
  PassthroughContent,
  PassthroughDeliveryReceipt,
  UserContentReference,
  // Config types
  ConfigRequirement,
  TrikConfig,
  TrikConfigContext,
  // Storage types
  StorageCapabilities,
  TrikStorageContext,
} from '@trikhub/manifest';
