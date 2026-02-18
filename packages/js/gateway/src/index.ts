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
  SqliteStorageProvider,
  InMemoryStorageProvider,
} from './storage-provider.js';

// Python worker (for executing Python triks)
export {
  PythonWorker,
  type PythonWorkerConfig,
  type ExecutePythonTrikOptions,
  getSharedPythonWorker,
  shutdownSharedPythonWorker,
} from './python-worker.js';

// Worker protocol (for cross-language trik execution)
export {
  // JSON-RPC types
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcError,
  // Worker methods
  type WorkerMethod,
  type InvokeParams,
  type HealthParams,
  type ShutdownParams,
  // Response types
  type InvokeResult,
  type HealthResult,
  // Storage proxy types
  type StorageMethod,
  type StorageGetParams,
  type StorageSetParams,
  type StorageDeleteParams,
  type StorageListParams,
  type StorageGetManyParams,
  type StorageSetManyParams,
  // Error codes
  WorkerErrorCodes,
  // Message builders
  createRequest,
  createInvokeRequest,
  createHealthRequest,
  createShutdownRequest,
  createStorageRequest,
  createSuccessResponse,
  createErrorResponse,
  // Message parsing
  parseMessage,
  isRequest,
  isResponse,
  serializeMessage,
} from './worker-protocol.js';

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
