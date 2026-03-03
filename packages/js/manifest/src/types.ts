/**
 * JSON Schema type (subset for our needs)
 */
export interface JSONSchema {
  type?: string | string[];
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  $ref?: string;
  $defs?: Record<string, JSONSchema>;
  additionalProperties?: boolean | JSONSchema;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  format?: string;
  description?: string;
  default?: unknown;
  [key: string]: unknown;
}

// ============================================================================
// Manifest Types
// ============================================================================

/**
 * Agent mode determines how the trik interacts with users.
 * - "conversational": Agent with LLM, handles multi-turn conversations via handoff
 * - "tool": Exports native tools to the main agent (no handoff, no session)
 */
export type AgentMode = 'conversational' | 'tool';

/**
 * Model preferences for the agent's LLM.
 */
export interface ModelPreferences {
  /** Provider hint: "anthropic", "openai", "any" */
  provider?: string;
  /** Required model capabilities, e.g. ["tool_use"] */
  capabilities?: string[];
  /** Temperature for generation (0.0-2.0) */
  temperature?: number;
}

/**
 * Agent definition — the core of a v2 manifest.
 * Declares how this trik operates as an agent.
 */
export interface AgentDefinition {
  /** How this agent operates */
  mode: AgentMode;
  /** Description used to generate the handoff tool for the main agent (required for conversational mode) */
  handoffDescription?: string;
  /** Inline system prompt (conversational mode) */
  systemPrompt?: string;
  /** Path to system prompt file, relative to manifest (conversational mode) */
  systemPromptFile?: string;
  /** LLM model preferences */
  model?: ModelPreferences;
  /** Domain tags describing this agent's expertise */
  domain: string[];
}

/**
 * Tool declaration in the manifest.
 * For conversational mode: metadata for logging and quality scoring (runtime schemas live in code).
 * For tool mode: the full runtime contract — inputSchema, outputSchema, and outputTemplate are required.
 */
export interface ToolDeclaration {
  /** What this tool does */
  description: string;
  /** Template for log entries when this tool is called. Placeholders: {{field}} */
  logTemplate?: string;
  /** Schema for log template placeholder values. Must use constrained types. */
  logSchema?: Record<string, JSONSchema>;
  /** Input schema for tool-mode triks (JSON Schema for the tool's input) */
  inputSchema?: JSONSchema;
  /** Output schema for tool-mode triks (JSON Schema for the tool's output, constrained types) */
  outputSchema?: JSONSchema;
  /** Template for output sent to the main LLM. Placeholders: {{field}}.
   *  Required for tool-mode triks. Only agent-safe fields allowed. */
  outputTemplate?: string;
}

/**
 * Session capabilities for multi-turn conversations
 */
export interface SessionCapabilities {
  /** Whether session state is enabled for this trik */
  enabled: boolean;
  /** Maximum session duration in milliseconds (default: 30 minutes) */
  maxDurationMs?: number;
}

/**
 * Storage capabilities for persistent data
 */
export interface StorageCapabilities {
  /** Whether storage is enabled for this trik */
  enabled: boolean;
  /** Maximum storage size in bytes (default: 100MB) */
  maxSizeBytes?: number;
  /** Whether storage persists across sessions (default: true) */
  persistent?: boolean;
}

/**
 * Configuration requirement declared in manifest
 */
export interface ConfigRequirement {
  /** The key name for this config value */
  key: string;
  /** Human-readable description of what this config is for */
  description: string;
  /** Default value if not provided (only for optional configs) */
  default?: string;
}

/**
 * Configuration requirements for a trik
 */
export interface TrikConfig {
  /** Required configuration values - trik will fail to execute without these */
  required?: ConfigRequirement[];
  /** Optional configuration values - trik can work without these */
  optional?: ConfigRequirement[];
}

/**
 * Filesystem capabilities for sandboxed file access.
 * Triks declaring this capability run inside a Docker container with a mounted /workspace directory.
 */
export interface FilesystemCapabilities {
  /** Whether filesystem access is enabled */
  enabled: boolean;
  /** Max total size of workspace directory in bytes (default: 500MB) */
  maxSizeBytes?: number;
}

/**
 * Shell capabilities for command execution.
 * Requires filesystem to also be enabled. Triks run inside a Docker container.
 */
export interface ShellCapabilities {
  /** Whether shell command execution is enabled */
  enabled: boolean;
  /** Max time per command in ms (default: 30000) */
  timeoutMs?: number;
  /** Max concurrent processes (default: 3) */
  maxConcurrent?: number;
}

/**
 * Trik capabilities declared in manifest
 */
export interface TrikCapabilities {
  /**
   * Session capabilities for multi-turn conversations.
   * @enforcement enforced - Gateway creates/manages sessions based on these settings
   */
  session?: SessionCapabilities;

  /**
   * Storage capabilities for persistent data.
   * @enforcement enforced - Gateway provides storage context and enforces quotas
   */
  storage?: StorageCapabilities;

  /**
   * Filesystem capabilities for sandboxed file access.
   * @enforcement enforced - Gateway runs trik in Docker container with mounted workspace
   */
  filesystem?: FilesystemCapabilities;

  /**
   * Shell capabilities for command execution.
   * @enforcement enforced - Gateway runs trik in Docker container. Requires filesystem.
   */
  shell?: ShellCapabilities;
}

/**
 * Resource limits for trik execution
 */
export interface TrikLimits {
  /** Maximum time per turn in milliseconds */
  maxTurnTimeMs: number;
}

/**
 * Runtime environment for trik execution
 */
export type TrikRuntime = 'node' | 'python';

/**
 * Entry point configuration
 */
export interface TrikEntry {
  /** Path to the compiled module (relative to trik directory) */
  module: string;
  /** Export name to use (usually "default") */
  export: string;
  /**
   * Runtime environment for this trik.
   * - "node": JavaScript/TypeScript trik (default, executed in-process)
   * - "python": Python trik (executed via subprocess worker)
   */
  runtime?: TrikRuntime;
}

/**
 * The trik manifest — v2 with agent-based handoff architecture.
 */
export interface TrikManifest {
  /** Schema version (must be 2) */
  schemaVersion: 2;
  /** Unique identifier for the trik */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what the trik does */
  description: string;
  /** Semantic version */
  version: string;

  /** Agent definition — how this trik operates */
  agent: AgentDefinition;

  /** Internal tools the agent uses (manifest-level metadata, not runtime schemas) */
  tools?: Record<string, ToolDeclaration>;
  /** Declared capabilities */
  capabilities?: TrikCapabilities;
  /** Resource limits */
  limits?: TrikLimits;
  /** Entry point */
  entry: TrikEntry;
  /** Configuration requirements (API keys, tokens, etc.) */
  config?: TrikConfig;

  /** Optional: author name */
  author?: string;
  /** Optional: repository URL */
  repository?: string;
  /** Optional: license identifier */
  license?: string;
}

// ============================================================================
// Runtime Communication Types
// ============================================================================

/**
 * Configuration context passed to triks.
 * Provides access to user-configured values (API keys, tokens, etc.).
 */
export interface TrikConfigContext {
  /** Get a configuration value by key. Returns undefined if not configured. */
  get(key: string): string | undefined;
  /** Check if a configuration key is set. */
  has(key: string): boolean;
  /** Get all configured keys (without values, for debugging). */
  keys(): string[];
}

/**
 * Storage context passed to triks.
 * Provides persistent key-value storage scoped to the trik.
 */
export interface TrikStorageContext {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown, ttl?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(prefix?: string): Promise<string[]>;
  getMany(keys: string[]): Promise<Map<string, unknown>>;
  setMany(entries: Record<string, unknown>): Promise<void>;
}

/**
 * Context passed to a trik agent on each message.
 */
export interface TrikContext {
  sessionId: string;
  config: TrikConfigContext;
  storage: TrikStorageContext;
  /** Capabilities declared in the trik's manifest, populated by the gateway/worker. */
  capabilities?: TrikCapabilities;
}

/**
 * Record of a tool call made by the agent during message processing.
 */
export interface ToolCallRecord {
  /** Tool name */
  tool: string;
  /** Input passed to the tool */
  input: Record<string, unknown>;
  /** Output returned by the tool */
  output: Record<string, unknown>;
}

/**
 * Response from a trik agent after processing a message.
 */
export interface TrikResponse {
  /** The agent's response message to show to the user */
  message: string;
  /** Whether to transfer the conversation back to the main agent */
  transferBack: boolean;
  /** Tool calls made during processing (for log template filling) */
  toolCalls?: ToolCallRecord[];
}

/**
 * Result from executing a tool-mode trik tool.
 */
export interface ToolExecutionResult {
  output: Record<string, unknown>;
}

/**
 * The contract a trik agent must implement.
 * Conversational triks implement processMessage().
 * Tool-mode triks implement executeTool().
 */
export interface TrikAgent {
  processMessage?(message: string, context: TrikContext): Promise<TrikResponse>;
  executeTool?(toolName: string, input: Record<string, unknown>, context: TrikContext): Promise<ToolExecutionResult>;
}

// ============================================================================
// Gateway Session Types
// ============================================================================

/**
 * Type of handoff log entry
 */
export type HandoffLogType = 'handoff_start' | 'tool_execution' | 'handoff_end';

/**
 * A single log entry in a handoff session.
 * Built from tool call data + manifest logTemplates.
 */
export interface HandoffLogEntry {
  timestamp: number;
  type: HandoffLogType;
  summary: string;
}

/**
 * A handoff session tracks a conversation with a trik agent.
 */
export interface HandoffSession {
  sessionId: string;
  trikId: string;
  log: HandoffLogEntry[];
  createdAt: number;
  lastActivityAt: number;
}
