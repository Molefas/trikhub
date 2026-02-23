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

/**
 * The trik manifest - stub for P1 (v2 types defined in P2).
 */
export interface TrikManifest {
  /** Schema version */
  schemaVersion: number;
  /** Unique identifier for the trik */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what the trik does */
  description: string;
  /** Semantic version */
  version: string;
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

/**
 * Configuration context passed to triks.
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
 * Storage context passed to triks.
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
