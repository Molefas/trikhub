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

/**
 * Session capabilities for multi-turn conversations
 */
export interface SessionCapabilities {
  /** Whether session state is enabled for this trik */
  enabled: boolean;
  /** Maximum session duration in milliseconds (default: 30 minutes) */
  maxDurationMs?: number;
  /** Maximum number of history entries to keep (default: 20) */
  maxHistoryEntries?: number;
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
 * Trik capabilities declared in manifest
 */
export interface TrikCapabilities {
  /**
   * List of tool names this trik uses.
   * @enforcement declarative - Used for registry search and tooling, not enforced at runtime
   */
  tools: string[];

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
}

/**
 * Resource limits for trik execution
 */
export interface TrikLimits {
  /**
   * Maximum execution time in milliseconds.
   * @enforcement enforced - Gateway aborts execution after this timeout
   */
  maxExecutionTimeMs: number;
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

// ============================================
// Wire Protocol Types (for remote triks)
// ============================================

/**
 * Request to execute a trik
 */
export interface ExecuteRequest {
  requestId: string;
  input: unknown;
}

/**
 * Clarification question from a trik
 */
export interface ClarificationQuestion {
  questionId: string;
  questionText: string;
  questionType: 'text' | 'multiple_choice' | 'boolean';
  options?: string[];
  required?: boolean;
}

/**
 * Answer to a clarification question
 */
export interface ClarificationAnswer {
  questionId: string;
  answer: string | boolean;
}

/**
 * Request to provide clarification answers
 */
export interface ClarifyRequest {
  sessionId: string;
  answers: ClarificationAnswer[];
}

/**
 * Successful execution response
 */
export interface SuccessResponse {
  requestId: string;
  type: 'result';
  agentData: unknown;
  userContent?: unknown;
}

/**
 * Clarification needed response
 */
export interface ClarificationResponse {
  requestId: string;
  type: 'clarification_needed';
  sessionId: string;
  questions: ClarificationQuestion[];
}

/**
 * Error response
 */
export interface ErrorResponse {
  requestId: string;
  type: 'error';
  code: string;
  message: string;
}

/**
 * Union of all possible execution responses
 */
export type ExecuteResponse = SuccessResponse | ClarificationResponse | ErrorResponse;

// ============================================
// Gateway Result Types
// ============================================

export type GatewayErrorCode =
  | 'TRIK_NOT_FOUND'
  | 'INVALID_INPUT'
  | 'INVALID_OUTPUT'
  | 'TIMEOUT'
  | 'EXECUTION_ERROR'
  | 'NOT_ALLOWED'
  | 'NETWORK_ERROR';

export interface GatewayError {
  success: false;
  code: GatewayErrorCode;
  error: string;
  details?: unknown;
}

export interface GatewayClarification {
  success: false;
  code: 'CLARIFICATION_NEEDED';
  sessionId: string;
  questions: ClarificationQuestion[];
}

// ============================================
// Type-Directed Privilege Separation Types
// ============================================

/**
 * Allowed string formats in agentDataSchema.
 * These are safe because they have constrained, predictable values.
 */
export type AllowedAgentStringFormat = 'id' | 'date' | 'date-time' | 'uuid' | 'email' | 'url';

/**
 * Response template for agent responses.
 * Templates are filled with values from agentData only.
 */
export interface ResponseTemplate {
  /** The template text with {{placeholder}} syntax */
  text: string;
  /** Optional condition for when to use this template */
  condition?: string;
}

/**
 * Response mode for an action.
 * - template: Agent sees agentData + template, fills and outputs directly
 * - passthrough: Agent gets receipt only, content flows through passthrough renderer
 */
export type ResponseMode = 'template' | 'passthrough';

/**
 * Action definition for triks.
 * Each action declares ONE response mode: template OR passthrough.
 */
export interface ActionDefinition {
  /** Description of what this action does */
  description?: string;

  /** JSON Schema for action input */
  inputSchema: JSONSchema;

  /**
   * Response mode for this action.
   * - "template": Agent sees agentData + template text, fills it, outputs directly
   * - "passthrough": Agent gets receipt only, content delivered via passthrough renderer
   */
  responseMode: ResponseMode;

  /**
   * Schema for data the agent can reason over (template mode).
   * MUST NOT contain free-form strings - only:
   * - integers, numbers, booleans
   * - strings with enum constraint
   * - strings with format constraint (id, date, date-time, uuid, email, url)
   * - strings with pattern constraint
   * - arrays/objects containing only the above
   *
   * Required for template mode.
   */
  agentDataSchema?: JSONSchema;

  /**
   * Response templates keyed by template ID (template mode).
   * Agent selects which template to use via agentData.template field.
   * Templates can only reference fields from agentDataSchema.
   *
   * Required for template mode.
   */
  responseTemplates?: Record<string, ResponseTemplate>;

  /**
   * Schema for content shown to the user (passthrough mode).
   * Free-form strings allowed here.
   * This content is delivered via passthrough renderer - agent never sees it.
   *
   * Required for passthrough mode.
   */
  userContentSchema?: JSONSchema;
}

/**
 * The trik manifest - the single source of truth for the trik contract.
 * Triks define actions with type-directed privilege separation.
 */
export interface TrikManifest {
  /**
   * Schema version for migration support.
   * Current version: 1
   */
  schemaVersion: 1;

  /** Unique identifier for the trik */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what the trik does */
  description: string;
  /** Semantic version */
  version: string;

  /** Map of action names to their definitions */
  actions: Record<string, ActionDefinition>;

  /** Declared capabilities */
  capabilities: TrikCapabilities;
  /** Resource limits */
  limits: TrikLimits;
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

// ============================================
// Gateway Success Types
// ============================================

/**
 * Gateway success for template mode
 */
export interface GatewaySuccessTemplate<TAgent> {
  success: true;
  /** Response mode */
  responseMode: 'template';
  /** Data for agent reasoning - structured, no free text */
  agentData: TAgent;
  /** Template text for agent to fill with agentData values */
  templateText?: string;
}

/**
 * Gateway success for passthrough mode
 */
export interface GatewaySuccessPassthrough {
  success: true;
  /** Response mode */
  responseMode: 'passthrough';
  /** Reference to content that will be delivered via passthrough */
  userContentRef: string;
  /** Content type for the receipt */
  contentType: string;
  /** Optional metadata the agent can see */
  metadata?: Record<string, unknown>;
}

/**
 * Gateway success - either template or passthrough mode
 */
export type GatewaySuccess<TAgent = unknown> =
  | GatewaySuccessTemplate<TAgent>
  | GatewaySuccessPassthrough;

/**
 * Gateway result type
 */
export type GatewayResult<TAgent = unknown> =
  | GatewaySuccess<TAgent>
  | GatewayError
  | GatewayClarification;

// ============================================
// Passthrough Mode Types
// ============================================

/**
 * User content with content type for passthrough mode.
 * When userContent has this structure and contentType matches
 * passthroughContentTypes, it can be delivered via passthrough.
 */
export interface PassthroughContent {
  /** Type of content being delivered (e.g., "recipe", "article") */
  contentType: string;
  /** The actual free-text content */
  content: string;
  /** Optional metadata that the agent CAN see */
  metadata?: Record<string, unknown>;
}

/**
 * Receipt returned to agent after passthrough delivery.
 * The agent sees this instead of the actual content.
 */
export interface PassthroughDeliveryReceipt {
  /** Indicates content was delivered */
  delivered: true;
  /** What type of content was delivered */
  contentType: string;
  /** Optional metadata from the content (safe data only) */
  metadata?: Record<string, unknown>;
}

/**
 * Content reference stored by gateway for later delivery.
 */
export interface UserContentReference {
  /** Unique reference ID */
  ref: string;
  /** The trik and action that produced this content */
  trikId: string;
  actionName: string;
  /** The actual content (stored, not returned to agent) */
  content: PassthroughContent;
  /** When this reference was created */
  createdAt: number;
  /** When this reference expires */
  expiresAt: number;
}

// ============================================
// Session State Types
// ============================================

/**
 * Entry in the session history.
 * Triks receive the full history to resolve references like "the healthcare article".
 */
export interface SessionHistoryEntry {
  /** When this entry was created */
  timestamp: number;
  /** Which action was called */
  action: string;
  /** The input that was passed to the action */
  input: unknown;
  /** The agentData returned by the action */
  agentData: unknown;
  /** The userContent returned by the action (trik can use for reference resolution) */
  userContent?: unknown;
}

/**
 * Session state maintained by the gateway.
 * Passed to triks so they can resolve references and maintain context.
 */
export interface TrikSession {
  /** Unique session identifier */
  sessionId: string;
  /** Trik this session belongs to */
  trikId: string;
  /** When the session was created */
  createdAt: number;
  /** When the session was last accessed */
  lastActivityAt: number;
  /** When the session expires */
  expiresAt: number;
  /** History of previous interactions */
  history: SessionHistoryEntry[];
}

/**
 * Session context passed to triks in graph input
 */
export interface SessionContext {
  /** Session identifier */
  sessionId: string;
  /** Full history for reference resolution */
  history: SessionHistoryEntry[];
}

/**
 * Configuration context passed to triks in graph input.
 * Provides access to user-configured values (API keys, tokens, etc.).
 */
export interface TrikConfigContext {
  /**
   * Get a configuration value by key.
   * Returns undefined if the key is not configured.
   */
  get(key: string): string | undefined;

  /**
   * Check if a configuration key is set.
   */
  has(key: string): boolean;

  /**
   * Get all configured keys (without values, for debugging).
   */
  keys(): string[];
}

/**
 * Storage context passed to triks in graph input.
 * Provides persistent key-value storage scoped to the trik.
 */
export interface TrikStorageContext {
  /**
   * Get a value by key.
   * Returns null if the key doesn't exist.
   */
  get(key: string): Promise<unknown | null>;

  /**
   * Set a value by key.
   * @param key - The key to store
   * @param value - The value to store (must be JSON-serializable)
   * @param ttl - Optional time-to-live in milliseconds
   */
  set(key: string, value: unknown, ttl?: number): Promise<void>;

  /**
   * Delete a key.
   * Returns true if the key existed and was deleted.
   */
  delete(key: string): Promise<boolean>;

  /**
   * List all keys, optionally filtered by prefix.
   */
  list(prefix?: string): Promise<string[]>;

  /**
   * Get multiple values at once.
   */
  getMany(keys: string[]): Promise<Map<string, unknown>>;

  /**
   * Set multiple values at once.
   */
  setMany(entries: Record<string, unknown>): Promise<void>;
}

// ============================================
// Graph Input/Output Types (for local triks)
// ============================================

/**
 * Input passed to a trik graph
 */
export interface GraphInput {
  /** The action input */
  input: unknown;
  /** Which action to execute */
  action: string;
  /** Clarification answers if resuming from clarification */
  clarificationAnswers?: Record<string, string | boolean>;
  /** Session context for multi-turn conversations */
  session?: SessionContext;
  /** Configuration context for accessing user-provided config values */
  config?: TrikConfigContext;
  /** Storage context for persistent data */
  storage?: TrikStorageContext;
}

/**
 * Result returned from a trik graph
 */
export interface GraphResult {
  /**
   * Response mode for this result.
   * Can override the manifest's default responseMode for this action.
   * Useful when no template fits and trik wants to return free-form content.
   */
  responseMode?: ResponseMode;

  /** Data for agent reasoning - structured, no free text (template mode) */
  agentData?: unknown;

  /** Content for user display - free text (passthrough mode) */
  userContent?: unknown;

  /** Whether clarification is needed */
  needsClarification?: boolean;
  /** Single clarification question */
  clarificationQuestion?: ClarificationQuestion;
  /** Multiple clarification questions */
  clarificationQuestions?: ClarificationQuestion[];
  /** If true, end the session after this response */
  endSession?: boolean;
}
