// Core API
export { wrapAgent } from './wrap-agent.js';
export type {
  InvokableAgent,
  AgentFactory,
  WrapAgentOptions,
} from './wrap-agent.js';

// Tool-mode API
export { wrapToolHandlers } from './wrap-tool-handlers.js';
export type { ToolHandler } from './wrap-tool-handlers.js';

// Transfer-back tool
export { transferBackTool, TRANSFER_BACK_TOOL_NAME } from './transfer-back.js';

// Message interceptor (advanced usage)
export { extractToolInfo } from './interceptor.js';
export type { ExtractedToolInfo } from './interceptor.js';

// Workspace tools (filesystem + shell for containerized triks)
export {
  getWorkspaceTools,
  getActiveWorkspaceToolNames,
  WORKSPACE_TOOL_NAMES,
  WORKSPACE_SYSTEM_PROMPT,
} from './workspace-tools.js';

// Registry tools (trik management capability)
export {
  getRegistryTools,
  getActiveRegistryToolNames,
  REGISTRY_TOOL_NAMES,
  REGISTRY_SYSTEM_PROMPT,
} from './registry-tools.js';

// Filesystem + shell tool handlers (low-level)
export { createFilesystemHandlers, filesystemToolSchemas } from './filesystem-tools.js';
export type { FilesystemHandlers, ToolSchema } from './filesystem-tools.js';
export { createShellHandlers, shellToolSchemas } from './shell-tools.js';
export type { ShellHandlers, ShellDefaults } from './shell-tools.js';

// Re-exported types from @trikhub/manifest (convenience)
export type {
  TrikAgent,
  TrikContext,
  TrikResponse,
  TrikConfigContext,
  TrikStorageContext,
  ToolCallRecord,
  ToolExecutionResult,
} from './types.js';
