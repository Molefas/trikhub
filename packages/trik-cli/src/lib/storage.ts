/**
 * Storage and configuration management for TrikHub CLI
 *
 * This module handles trik installation paths and lockfile management.
 * All functions now work with ConfigContext for local/global support.
 */

import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  TrikConfig,
  TrikLockfile,
  InstalledTrik,
  DEFAULT_CONFIG,
} from '../types.js';
import { ConfigContext, getConfigContext } from './config.js';

// ============================================================================
// Legacy exports for backwards compatibility
// These use the default (global) config context
// ============================================================================

/**
 * @deprecated Use ConfigContext instead. This is kept for backwards compatibility.
 */
export const TRIKHUB_DIR = join(homedir(), '.trikhub');

/**
 * @deprecated Use ConfigContext.configPath instead.
 */
export const CONFIG_PATH = join(TRIKHUB_DIR, 'config.json');

/**
 * @deprecated Use ConfigContext.lockfilePath instead.
 */
export const LOCKFILE_PATH = join(TRIKHUB_DIR, 'triks.lock');

/**
 * @deprecated Use ConfigContext.triksDir instead.
 */
export const TRIKS_DIR = join(TRIKHUB_DIR, 'triks');

// ============================================================================
// Directory Management
// ============================================================================

/**
 * Ensure the TrikHub directory structure exists for a context
 */
export function ensureDirectories(ctx?: ConfigContext): void {
  const context = ctx ?? getConfigContext();

  if (!existsSync(context.trikhubDir)) {
    mkdirSync(context.trikhubDir, { recursive: true });
  }
  if (!existsSync(context.triksDir)) {
    mkdirSync(context.triksDir, { recursive: true });
  }
}

/**
 * Ensure parent directory exists for a path
 */
export function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ============================================================================
// Config Management (Legacy - prefer using config.ts directly)
// ============================================================================

/**
 * Load the CLI configuration
 * @deprecated Use resolveConfig() from config.ts for full local/global support
 */
export function loadConfig(): TrikConfig {
  const ctx = getConfigContext();
  return ctx.config;
}

/**
 * Save the CLI configuration
 * @deprecated Use saveConfig() from config.ts with a ConfigContext
 */
export function saveConfig(config: TrikConfig): void {
  const ctx = getConfigContext();
  ensureDirectories(ctx);
  writeFileSync(ctx.configPath, JSON.stringify(config, null, 2));
}

// ============================================================================
// Lockfile Management
// ============================================================================

/**
 * Load the lockfile for a context
 */
export function loadLockfile(ctx?: ConfigContext): TrikLockfile {
  const context = ctx ?? getConfigContext();
  ensureDirectories(context);

  if (!existsSync(context.lockfilePath)) {
    const empty: TrikLockfile = {
      lockfileVersion: 1,
      triks: {},
    };
    saveLockfile(empty, context);
    return empty;
  }

  try {
    const content = readFileSync(context.lockfilePath, 'utf-8');
    return JSON.parse(content) as TrikLockfile;
  } catch {
    return {
      lockfileVersion: 1,
      triks: {},
    };
  }
}

/**
 * Save the lockfile for a context
 */
export function saveLockfile(lockfile: TrikLockfile, ctx?: ConfigContext): void {
  const context = ctx ?? getConfigContext();
  ensureDirectories(context);
  writeFileSync(context.lockfilePath, JSON.stringify(lockfile, null, 2));
}

/**
 * Add or update a trik in the lockfile
 */
export function addToLockfile(trik: InstalledTrik, ctx?: ConfigContext): void {
  const context = ctx ?? getConfigContext();
  const lockfile = loadLockfile(context);
  lockfile.triks[trik.fullName] = trik;
  saveLockfile(lockfile, context);
}

/**
 * Remove a trik from the lockfile
 */
export function removeFromLockfile(fullName: string, ctx?: ConfigContext): void {
  const context = ctx ?? getConfigContext();
  const lockfile = loadLockfile(context);
  delete lockfile.triks[fullName];
  saveLockfile(lockfile, context);
}

// ============================================================================
// Trik Path Management
// ============================================================================

/**
 * Get the installation path for a trik
 *
 * @example getTrikPath("@acme/article-search") => "~/.trikhub/triks/@acme/article-search"
 * @example getTrikPath("@acme/article-search", localCtx) => "./.trikhub/triks/@acme/article-search"
 */
export function getTrikPath(fullName: string, ctx?: ConfigContext): string {
  const context = ctx ?? getConfigContext();
  // fullName is like "@acme/article-search"
  return join(context.triksDir, fullName);
}

/**
 * Get the triks directory for a context
 */
export function getTriksDir(ctx?: ConfigContext): string {
  const context = ctx ?? getConfigContext();
  return context.triksDir;
}

// ============================================================================
// Trik Status Queries
// ============================================================================

/**
 * Check if a trik is installed
 */
export function isTrikInstalled(fullName: string, ctx?: ConfigContext): boolean {
  const context = ctx ?? getConfigContext();
  const lockfile = loadLockfile(context);
  return fullName in lockfile.triks;
}

/**
 * Get installed trik info
 */
export function getInstalledTrik(fullName: string, ctx?: ConfigContext): InstalledTrik | null {
  const context = ctx ?? getConfigContext();
  const lockfile = loadLockfile(context);
  return lockfile.triks[fullName] ?? null;
}

/**
 * Get all installed triks
 */
export function getInstalledTriks(ctx?: ConfigContext): InstalledTrik[] {
  const context = ctx ?? getConfigContext();
  const lockfile = loadLockfile(context);
  return Object.values(lockfile.triks);
}
