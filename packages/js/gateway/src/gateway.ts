import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import {
  type TrikManifest,
  type TrikRuntime,
  validateManifest,
} from '@trikhub/manifest';
import { PythonWorker, type PythonWorkerConfig } from './python-worker.js';
import { type ConfigStore, FileConfigStore } from './config-store.js';
import { type StorageProvider, SqliteStorageProvider } from './storage-provider.js';

interface LoadedTrik {
  manifest: TrikManifest;
  module: unknown;
  path: string;
  runtime: TrikRuntime;
}

export interface TrikGatewayConfig {
  allowedTriks?: string[];
  /**
   * Directory containing installed triks for auto-discovery.
   * Supports scoped directory structure: triksDirectory/@scope/trik-name/
   * Use '~' for home directory (e.g., '~/.trikhub/triks')
   */
  triksDirectory?: string;
  /**
   * Configuration store for trik secrets (API keys, tokens, etc.).
   * Defaults to FileConfigStore which reads from ~/.trikhub/secrets.json
   * and .trikhub/secrets.json (local overrides global).
   */
  configStore?: ConfigStore;
  /**
   * Storage provider for persistent trik data.
   * Defaults to SqliteStorageProvider which stores data in ~/.trikhub/storage/
   */
  storageProvider?: StorageProvider;
  /**
   * Whether to validate that all required config values are present when loading triks.
   * Defaults to true. Set to false to skip validation (e.g., for listing triks).
   */
  validateConfig?: boolean;
  /**
   * Configuration for Python worker (used for Python triks).
   * If not provided, defaults will be used when a Python trik is loaded.
   */
  pythonWorkerConfig?: PythonWorkerConfig;
}

/**
 * Configuration file structure for .trikhub/config.json
 */
export interface TrikHubConfig {
  /** List of installed trik package names */
  triks: string[];
}

export interface LoadFromConfigOptions {
  /** Path to the config file. Defaults to .trikhub/config.json in cwd */
  configPath?: string;
  /** Base directory for resolving node_modules. Defaults to dirname of configPath */
  baseDir?: string;
}

export class TrikGateway {
  private config: TrikGatewayConfig;
  private configStore: ConfigStore;
  private storageProvider: StorageProvider;
  private configLoaded = false;
  private pythonWorker: PythonWorker | null = null;

  // Loaded triks (by trik ID)
  private triks = new Map<string, LoadedTrik>();

  constructor(config: TrikGatewayConfig = {}) {
    this.config = config;
    this.configStore = config.configStore ?? new FileConfigStore();
    this.storageProvider = config.storageProvider ?? new SqliteStorageProvider();
  }

  /**
   * Initialize the gateway by loading configuration.
   * Should be called before loading any triks.
   */
  async initialize(): Promise<void> {
    if (!this.configLoaded) {
      await this.configStore.load();
      this.configLoaded = true;
    }
  }

  /**
   * Get the config store (for CLI integration)
   */
  getConfigStore(): ConfigStore {
    return this.configStore;
  }

  /**
   * Get the storage provider (for CLI integration)
   */
  getStorageProvider(): StorageProvider {
    return this.storageProvider;
  }

  async loadTrik(trikPath: string): Promise<TrikManifest> {
    const manifestPath = join(trikPath, 'manifest.json');
    const manifestContent = await readFile(manifestPath, 'utf-8');
    const manifestData = JSON.parse(manifestContent);

    const validation = validateManifest(manifestData);
    if (!validation.valid) {
      throw new Error(`Invalid manifest at ${manifestPath}: ${validation.errors?.join(', ')}`);
    }

    const manifest = manifestData as TrikManifest;

    if (this.config.allowedTriks && !this.config.allowedTriks.includes(manifest.id)) {
      throw new Error(`Trik "${manifest.id}" is not in the allowlist`);
    }

    const runtime: TrikRuntime = manifest.entry.runtime ?? 'node';

    if (runtime === 'python') {
      this.triks.set(manifest.id, { manifest, module: null, path: trikPath, runtime });
      await this.ensurePythonWorker();
    } else {
      const modulePath = join(trikPath, manifest.entry.module);
      const moduleUrl = pathToFileURL(modulePath).href;
      const mod = await import(moduleUrl);
      this.triks.set(manifest.id, { manifest, module: mod, path: trikPath, runtime });
    }

    return manifest;
  }

  /**
   * Ensure Python worker is started.
   */
  private async ensurePythonWorker(): Promise<PythonWorker> {
    if (!this.pythonWorker) {
      this.pythonWorker = new PythonWorker(this.config.pythonWorkerConfig);
    }
    if (!this.pythonWorker.ready) {
      await this.pythonWorker.start();
    }
    return this.pythonWorker;
  }

  /**
   * Shutdown the Python worker if running.
   */
  async shutdown(): Promise<void> {
    if (this.pythonWorker) {
      await this.pythonWorker.shutdown();
      this.pythonWorker = null;
    }
  }

  /**
   * Load all triks from a directory.
   * Supports scoped directory structure: directory/@scope/trik-name/
   */
  async loadTriksFromDirectory(directory: string): Promise<TrikManifest[]> {
    const resolvedDir = directory.startsWith('~')
      ? join(homedir(), directory.slice(1))
      : resolve(directory);

    const manifests: TrikManifest[] = [];
    const errors: Array<{ path: string; error: string }> = [];

    try {
      const entries = await readdir(resolvedDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const entryPath = join(resolvedDir, entry.name);

        if (entry.name.startsWith('@')) {
          const scopedEntries = await readdir(entryPath, { withFileTypes: true });

          for (const scopedEntry of scopedEntries) {
            if (!scopedEntry.isDirectory()) continue;

            const trikPath = join(entryPath, scopedEntry.name);
            const manifestPath = join(trikPath, 'manifest.json');

            try {
              const manifestStat = await stat(manifestPath);
              if (manifestStat.isFile()) {
                const manifest = await this.loadTrik(trikPath);
                manifests.push(manifest);
              }
            } catch (error) {
              errors.push({
                path: trikPath,
                error: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          }
        } else {
          const trikPath = entryPath;
          const manifestPath = join(trikPath, 'manifest.json');

          try {
            const manifestStat = await stat(manifestPath);
            if (manifestStat.isFile()) {
              const manifest = await this.loadTrik(trikPath);
              manifests.push(manifest);
            }
          } catch (error) {
            errors.push({
              path: trikPath,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(
          `Failed to read triks directory "${resolvedDir}": ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }
    }

    if (errors.length > 0) {
      console.warn(`[TrikGateway] Failed to load ${errors.length} trik(s):`);
      for (const { path, error } of errors) {
        console.warn(`  - ${path}: ${error}`);
      }
    }

    return manifests;
  }

  /**
   * Load triks from the configured triksDirectory (if set).
   */
  async loadInstalledTriks(): Promise<TrikManifest[]> {
    if (!this.config.triksDirectory) {
      return [];
    }
    return this.loadTriksFromDirectory(this.config.triksDirectory);
  }

  /**
   * Load triks from a config file (.trikhub/config.json).
   */
  async loadTriksFromConfig(options: LoadFromConfigOptions = {}): Promise<TrikManifest[]> {
    const configPath = options.configPath ?? join(process.cwd(), '.trikhub', 'config.json');
    const baseDir = options.baseDir ?? dirname(configPath);

    if (!existsSync(configPath)) {
      console.log(`[TrikGateway] No config file found at ${configPath}`);
      return [];
    }

    let config: TrikHubConfig;
    try {
      const configContent = await readFile(configPath, 'utf-8');
      config = JSON.parse(configContent);
    } catch (error) {
      throw new Error(
        `Failed to read config file "${configPath}": ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }

    if (!Array.isArray(config.triks)) {
      console.log('[TrikGateway] Config file has no triks array');
      return [];
    }

    const manifests: TrikManifest[] = [];
    const errors: Array<{ trik: string; error: string }> = [];

    const require = createRequire(join(baseDir, 'package.json'));
    const triksDir = join(dirname(configPath), 'triks');

    for (const trikName of config.triks) {
      try {
        let trikPath: string;
        let foundInNodeModules = false;

        try {
          const manifestPath = require.resolve(`${trikName}/manifest.json`);
          trikPath = dirname(manifestPath);
          foundInNodeModules = true;
        } catch {
          try {
            const packageMain = require.resolve(trikName);
            trikPath = dirname(packageMain);

            const manifestPath = join(trikPath, 'manifest.json');
            if (!existsSync(manifestPath)) {
              const parentManifest = join(dirname(trikPath), 'manifest.json');
              if (existsSync(parentManifest)) {
                trikPath = dirname(trikPath);
              } else {
                throw new Error(`Package "${trikName}" does not have a manifest.json`);
              }
            }
            foundInNodeModules = true;
          } catch {
            foundInNodeModules = false;
            trikPath = '';
          }
        }

        if (!foundInNodeModules) {
          const crossLangPath = join(triksDir, ...trikName.split('/'));

          const directManifest = join(crossLangPath, 'manifest.json');
          if (existsSync(directManifest)) {
            trikPath = crossLangPath;
          } else {
            const entries = existsSync(crossLangPath)
              ? await readdir(crossLangPath, { withFileTypes: true })
              : [];

            let foundInSubdir = false;
            for (const entry of entries) {
              if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_')) {
                const subManifest = join(crossLangPath, entry.name, 'manifest.json');
                if (existsSync(subManifest)) {
                  trikPath = join(crossLangPath, entry.name);
                  foundInSubdir = true;
                  break;
                }
              }
            }

            if (!foundInSubdir) {
              throw new Error(
                `Package "${trikName}" not found in node_modules or .trikhub/triks/`
              );
            }
          }
        }

        const manifest = await this.loadTrik(trikPath);
        manifests.push(manifest);
      } catch (error) {
        errors.push({
          trik: trikName,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    if (errors.length > 0) {
      console.warn(`[TrikGateway] Failed to load ${errors.length} trik(s) from config:`);
      for (const { trik, error } of errors) {
        console.warn(`  - ${trik}: ${error}`);
      }
    }

    if (manifests.length > 0) {
      console.log(`[TrikGateway] Loaded ${manifests.length} trik(s) from config`);
    }

    return manifests;
  }

  getManifest(trikId: string): TrikManifest | undefined {
    return this.triks.get(trikId)?.manifest;
  }

  getLoadedTriks(): string[] {
    return Array.from(this.triks.keys());
  }

  isLoaded(trikId: string): boolean {
    return this.triks.has(trikId);
  }

  /**
   * Unload a trik from memory.
   */
  unloadTrik(trikId: string): boolean {
    return this.triks.delete(trikId);
  }
}
