/**
 * Configuration resolution for TrikHub CLI
 *
 * Supports both local (project-level) and global configurations.
 *
 * Resolution order:
 * 1. Local: .trikhub/config.json in current directory
 * 2. Global: ~/.trikhub/config.json in home directory
 *
 * If neither exists, user is prompted to choose where to set up.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { TrikConfig, DEFAULT_CONFIG } from '../types.js';
import chalk from 'chalk';
import { select, confirm } from '@inquirer/prompts';

/**
 * Configuration scope - where the config lives
 */
export type ConfigScope = 'local' | 'global';

/**
 * Resolved configuration context
 */
export interface ConfigContext {
  /** The scope of this config (local or global) */
  scope: ConfigScope;

  /** Base directory where .trikhub folder lives */
  baseDir: string;

  /** Full path to the .trikhub directory */
  trikhubDir: string;

  /** Full path to config.json */
  configPath: string;

  /** Full path to triks.lock */
  lockfilePath: string;

  /** Full path to triks/ directory */
  triksDir: string;

  /** The loaded configuration */
  config: TrikConfig;
}

/**
 * Get the local trikhub directory path (in current working directory)
 */
export function getLocalTrikhubDir(): string {
  return join(process.cwd(), '.trikhub');
}

/**
 * Get the global trikhub directory path (in home directory)
 */
export function getGlobalTrikhubDir(): string {
  return join(homedir(), '.trikhub');
}

/**
 * Check if a local config exists in the current directory
 */
export function hasLocalConfig(): boolean {
  const localConfigPath = join(getLocalTrikhubDir(), 'config.json');
  return existsSync(localConfigPath);
}

/**
 * Check if a global config exists in the home directory
 */
export function hasGlobalConfig(): boolean {
  const globalConfigPath = join(getGlobalTrikhubDir(), 'config.json');
  return existsSync(globalConfigPath);
}

/**
 * Load a config file from a path, merging with defaults
 */
function loadConfigFromPath(configPath: string): TrikConfig {
  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content) as Partial<TrikConfig>;
    return { ...DEFAULT_CONFIG, ...config };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Create a ConfigContext from a base directory
 *
 * For local configs, we merge global auth settings with local settings.
 * This ensures auth tokens are always inherited from global config.
 */
function createContext(baseDir: string, scope: ConfigScope): ConfigContext {
  const trikhubDir = join(baseDir, '.trikhub');
  const configPath = join(trikhubDir, 'config.json');
  let config = loadConfigFromPath(configPath);

  // For local configs, inherit auth from global config
  if (scope === 'local') {
    const globalConfigPath = join(getGlobalTrikhubDir(), 'config.json');
    const globalConfig = loadConfigFromPath(globalConfigPath);

    // Merge: local overrides global, but inherit auth settings from global
    config = {
      ...config,
      authToken: config.authToken ?? globalConfig.authToken,
      authExpiresAt: config.authExpiresAt ?? globalConfig.authExpiresAt,
      publisherUsername: config.publisherUsername ?? globalConfig.publisherUsername,
    };
  }

  // For local configs, triksDirectory is relative to the .trikhub folder
  // For global configs, it uses the config value (which may be absolute)
  let triksDir: string;
  if (scope === 'local') {
    // Local triks are stored in .trikhub/triks/
    triksDir = join(trikhubDir, 'triks');
  } else {
    // Global uses the configured path (default: ~/.trikhub/triks)
    triksDir = config.triksDirectory.startsWith('~')
      ? config.triksDirectory.replace('~', homedir())
      : config.triksDirectory;
  }

  return {
    scope,
    baseDir,
    trikhubDir,
    configPath,
    lockfilePath: join(trikhubDir, 'triks.lock'),
    triksDir,
    config,
  };
}

/**
 * Initialize a new configuration at the specified location
 */
export function initializeConfig(scope: ConfigScope): ConfigContext {
  const baseDir = scope === 'local' ? process.cwd() : homedir();
  const trikhubDir = join(baseDir, '.trikhub');
  const triksDir = join(trikhubDir, 'triks');
  const configPath = join(trikhubDir, 'config.json');

  // Create directories
  if (!existsSync(trikhubDir)) {
    mkdirSync(trikhubDir, { recursive: true });
  }
  if (!existsSync(triksDir)) {
    mkdirSync(triksDir, { recursive: true });
  }

  // Create config file with defaults
  const config: TrikConfig = {
    ...DEFAULT_CONFIG,
    // For local configs, use relative path
    triksDirectory: scope === 'local' ? '.trikhub/triks' : DEFAULT_CONFIG.triksDirectory,
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2));

  return createContext(baseDir, scope);
}

/**
 * Resolve configuration - find the appropriate config to use
 *
 * This is the main entry point for config resolution.
 * It checks local first, then global, then prompts if neither exists.
 *
 * @param options - Resolution options
 * @param options.interactive - If false, don't prompt user (use global by default)
 */
export async function resolveConfig(options?: {
  interactive?: boolean;
}): Promise<ConfigContext> {
  const interactive = options?.interactive ?? true;

  // 1. Check for local config first
  if (hasLocalConfig()) {
    return createContext(process.cwd(), 'local');
  }

  // 2. Check for global config
  if (hasGlobalConfig()) {
    if (!interactive) {
      // Non-interactive mode: just use global
      return createContext(homedir(), 'global');
    }

    // Interactive mode: ask user if they want to use global
    console.log(chalk.cyan('\nNo local .trikhub configuration found.'));
    console.log(chalk.dim(`Global configuration exists at ${getGlobalTrikhubDir()}\n`));

    const useGlobal = await confirm({
      message: 'Use global configuration?',
      default: true,
    });

    if (useGlobal) {
      return createContext(homedir(), 'global');
    }

    // User wants local - create it
    console.log(chalk.dim('\nInitializing local configuration...'));
    return initializeConfig('local');
  }

  // 3. No config exists anywhere - prompt user to set up
  if (!interactive) {
    // Non-interactive mode: create global by default
    return initializeConfig('global');
  }

  console.log(chalk.cyan('\nNo TrikHub configuration found.'));
  console.log(chalk.dim('Triks need a place to be installed.\n'));

  const scope = await select<ConfigScope>({
    message: 'Where would you like to set up TrikHub?',
    choices: [
      {
        value: 'global' as ConfigScope,
        name: `Global (${chalk.dim('~/.trikhub')})`,
        description: 'Install triks in your home directory. Available to all projects.',
      },
      {
        value: 'local' as ConfigScope,
        name: `Local (${chalk.dim('./.trikhub')})`,
        description: 'Install triks in this project directory. Project-specific configuration.',
      },
    ],
    default: 'global',
  });

  console.log(chalk.dim(`\nInitializing ${scope} configuration...`));
  return initializeConfig(scope);
}

/**
 * Get the current config context without prompting
 *
 * Returns local if it exists, otherwise global.
 * Creates global if neither exists (for backwards compatibility).
 */
export function getConfigContext(): ConfigContext {
  if (hasLocalConfig()) {
    return createContext(process.cwd(), 'local');
  }

  if (hasGlobalConfig()) {
    return createContext(homedir(), 'global');
  }

  // Fallback: create global config for backwards compatibility
  return initializeConfig('global');
}

/**
 * Save configuration to the context's config path
 */
export function saveConfig(ctx: ConfigContext, config: TrikConfig): void {
  // Ensure directory exists
  if (!existsSync(ctx.trikhubDir)) {
    mkdirSync(ctx.trikhubDir, { recursive: true });
  }
  writeFileSync(ctx.configPath, JSON.stringify(config, null, 2));
  ctx.config = config;
}
