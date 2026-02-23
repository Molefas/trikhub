// Core API
export { wrapAgent } from './wrap-agent.js';
export type {
  InvokableAgent,
  AgentFactory,
  WrapAgentOptions,
} from './wrap-agent.js';

// Transfer-back tool
export { transferBackTool, TRANSFER_BACK_TOOL_NAME } from './transfer-back.js';

// Message interceptor (advanced usage)
export { extractToolInfo } from './interceptor.js';
export type { ExtractedToolInfo } from './interceptor.js';

// Re-exported types from @trikhub/manifest (convenience)
export type {
  TrikAgent,
  TrikContext,
  TrikResponse,
  TrikConfigContext,
  TrikStorageContext,
  ToolCallRecord,
} from './types.js';
