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
} from '@trikhub/manifest';
