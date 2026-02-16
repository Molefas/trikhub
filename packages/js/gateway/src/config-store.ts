import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { TrikConfigContext, TrikManifest } from '@trikhub/manifest';

/**
 * Structure of the secrets file (~/.trikhub/secrets.json or .trikhub/secrets.json)
 */
export interface SecretsFile {
  /** Config values keyed by trik ID */
  [trikId: string]: Record<string, string>;
}

/**
 * Options for creating a ConfigStore
 */
export interface ConfigStoreOptions {
  /**
   * Path to the global secrets file.
   * Defaults to ~/.trikhub/secrets.json
   */
  globalSecretsPath?: string;

  /**
   * Path to the local secrets file (project-level).
   * Defaults to .trikhub/secrets.json in cwd
   */
  localSecretsPath?: string;

  /**
   * Whether to allow local secrets to override global secrets.
   * Defaults to true.
   */
  allowLocalOverride?: boolean;
}

/**
 * Interface for configuration storage implementations
 */
export interface ConfigStore {
  /**
   * Load secrets from configured paths.
   * Should be called before getting config for any trik.
   */
  load(): Promise<void>;

  /**
   * Reload secrets from disk.
   */
  reload(): Promise<void>;

  /**
   * Get the config context for a specific trik.
   * The returned context only exposes values for that trik.
   */
  getForTrik(trikId: string): TrikConfigContext;

  /**
   * Validate that all required config values are present for a trik.
   * Returns an array of missing required keys, or empty array if all present.
   */
  validateConfig(manifest: TrikManifest): string[];

  /**
   * Get all configured trik IDs.
   */
  getConfiguredTriks(): string[];
}

/**
 * Implementation of TrikConfigContext that wraps a config object
 */
class ConfigContext implements TrikConfigContext {
  constructor(
    private readonly config: Record<string, string>,
    private readonly defaults: Record<string, string> = {}
  ) {}

  get(key: string): string | undefined {
    return this.config[key] ?? this.defaults[key];
  }

  has(key: string): boolean {
    return key in this.config || key in this.defaults;
  }

  keys(): string[] {
    const allKeys = new Set([
      ...Object.keys(this.config),
      ...Object.keys(this.defaults),
    ]);
    return Array.from(allKeys);
  }
}

/**
 * Empty config context for triks that don't have any config
 */
const EMPTY_CONFIG_CONTEXT: TrikConfigContext = {
  get: () => undefined,
  has: () => false,
  keys: () => [],
};

/**
 * File-based ConfigStore implementation.
 * Loads secrets from global (~/.trikhub/secrets.json) and local (.trikhub/secrets.json) files.
 * Local secrets override global secrets when both are present.
 */
export class FileConfigStore implements ConfigStore {
  private readonly globalPath: string;
  private readonly localPath: string;
  private readonly allowLocalOverride: boolean;

  private globalSecrets: SecretsFile = {};
  private localSecrets: SecretsFile = {};
  private loaded = false;

  constructor(options: ConfigStoreOptions = {}) {
    this.globalPath =
      options.globalSecretsPath ?? join(homedir(), '.trikhub', 'secrets.json');
    this.localPath =
      options.localSecretsPath ?? join(process.cwd(), '.trikhub', 'secrets.json');
    this.allowLocalOverride = options.allowLocalOverride ?? true;
  }

  async load(): Promise<void> {
    // Load global secrets
    if (existsSync(this.globalPath)) {
      try {
        const content = await readFile(this.globalPath, 'utf-8');
        this.globalSecrets = JSON.parse(content);
      } catch (error) {
        console.warn(
          `[ConfigStore] Failed to load global secrets from ${this.globalPath}:`,
          error instanceof Error ? error.message : 'Unknown error'
        );
        this.globalSecrets = {};
      }
    }

    // Load local secrets
    if (this.allowLocalOverride && existsSync(this.localPath)) {
      try {
        const content = await readFile(this.localPath, 'utf-8');
        this.localSecrets = JSON.parse(content);
      } catch (error) {
        console.warn(
          `[ConfigStore] Failed to load local secrets from ${this.localPath}:`,
          error instanceof Error ? error.message : 'Unknown error'
        );
        this.localSecrets = {};
      }
    }

    this.loaded = true;
  }

  async reload(): Promise<void> {
    this.globalSecrets = {};
    this.localSecrets = {};
    this.loaded = false;
    await this.load();
  }

  getForTrik(trikId: string): TrikConfigContext {
    if (!this.loaded) {
      console.warn(
        '[ConfigStore] Secrets not loaded. Call load() before getForTrik().'
      );
      return EMPTY_CONFIG_CONTEXT;
    }

    const globalConfig = this.globalSecrets[trikId] ?? {};
    const localConfig = this.allowLocalOverride
      ? this.localSecrets[trikId] ?? {}
      : {};

    // Merge global and local, with local taking precedence
    const mergedConfig = { ...globalConfig, ...localConfig };

    // If no config exists for this trik, return empty context
    if (Object.keys(mergedConfig).length === 0) {
      return EMPTY_CONFIG_CONTEXT;
    }

    return new ConfigContext(mergedConfig);
  }

  validateConfig(manifest: TrikManifest): string[] {
    const missingKeys: string[] = [];

    if (!manifest.config?.required || manifest.config.required.length === 0) {
      return missingKeys;
    }

    const configContext = this.getForTrik(manifest.id);

    for (const requirement of manifest.config.required) {
      if (!configContext.has(requirement.key)) {
        missingKeys.push(requirement.key);
      }
    }

    return missingKeys;
  }

  getConfiguredTriks(): string[] {
    const trikIds = new Set([
      ...Object.keys(this.globalSecrets),
      ...Object.keys(this.localSecrets),
    ]);
    return Array.from(trikIds);
  }

  /**
   * Get the paths being used (for debugging)
   */
  getPaths(): { global: string; local: string } {
    return {
      global: this.globalPath,
      local: this.localPath,
    };
  }
}

/**
 * In-memory ConfigStore for testing or programmatic configuration
 */
export class InMemoryConfigStore implements ConfigStore {
  private secrets: SecretsFile = {};
  private defaults: Record<string, Record<string, string>> = {};

  constructor(initialSecrets: SecretsFile = {}) {
    this.secrets = { ...initialSecrets };
  }

  async load(): Promise<void> {
    // No-op for in-memory store
  }

  async reload(): Promise<void> {
    // No-op for in-memory store
  }

  /**
   * Set secrets for a specific trik
   */
  setForTrik(trikId: string, config: Record<string, string>): void {
    this.secrets[trikId] = { ...config };
  }

  /**
   * Set defaults from manifest (optional configs with default values)
   */
  setDefaultsFromManifest(manifest: TrikManifest): void {
    if (!manifest.config?.optional) return;

    const defaults: Record<string, string> = {};
    for (const opt of manifest.config.optional) {
      if (opt.default !== undefined) {
        defaults[opt.key] = opt.default;
      }
    }

    if (Object.keys(defaults).length > 0) {
      this.defaults[manifest.id] = defaults;
    }
  }

  getForTrik(trikId: string): TrikConfigContext {
    const config = this.secrets[trikId] ?? {};
    const defaults = this.defaults[trikId] ?? {};

    if (Object.keys(config).length === 0 && Object.keys(defaults).length === 0) {
      return EMPTY_CONFIG_CONTEXT;
    }

    return new ConfigContext(config, defaults);
  }

  validateConfig(manifest: TrikManifest): string[] {
    const missingKeys: string[] = [];

    if (!manifest.config?.required || manifest.config.required.length === 0) {
      return missingKeys;
    }

    const configContext = this.getForTrik(manifest.id);

    for (const requirement of manifest.config.required) {
      if (!configContext.has(requirement.key)) {
        missingKeys.push(requirement.key);
      }
    }

    return missingKeys;
  }

  getConfiguredTriks(): string[] {
    return Object.keys(this.secrets);
  }

  /**
   * Clear all secrets
   */
  clear(): void {
    this.secrets = {};
    this.defaults = {};
  }
}
