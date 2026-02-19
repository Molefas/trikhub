/**
 * Assertion helpers for E2E tests
 *
 * Provides utilities to verify trik installations:
 * - Config file content (.trikhub/config.json)
 * - Cross-language trik downloads (.trikhub/triks/)
 * - Package manager integrations
 */

import { readFile, access, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';

export interface TriksConfig {
  triks: string[];
  trikhub?: Record<string, string>;
  runtimes?: Record<string, 'node' | 'python'>;
}

/**
 * Read and parse .trikhub/config.json from a project
 */
export async function readTriksConfig(projectDir: string): Promise<TriksConfig> {
  const configPath = join(projectDir, '.trikhub', 'config.json');

  try {
    const content = await readFile(configPath, 'utf-8');
    return JSON.parse(content) as TriksConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { triks: [] };
    }
    throw error;
  }
}

/**
 * Read package.json from a project
 */
export async function readPackageJson(
  projectDir: string
): Promise<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }> {
  const packagePath = join(projectDir, 'package.json');

  try {
    const content = await readFile(packagePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Assert that a trik is registered in .trikhub/config.json
 *
 * @param projectDir - Path to the project directory
 * @param trikName - Full trik name (e.g., '@scope/name')
 * @param expectedRuntime - Optional expected runtime ('node' or 'python')
 */
export async function assertTrikInConfig(
  projectDir: string,
  trikName: string,
  expectedRuntime?: 'node' | 'python'
): Promise<void> {
  const config = await readTriksConfig(projectDir);

  expect(
    config.triks,
    `Expected ${trikName} to be in config.triks`
  ).toContain(trikName);

  if (expectedRuntime && config.runtimes) {
    expect(
      config.runtimes[trikName],
      `Expected ${trikName} to have runtime '${expectedRuntime}'`
    ).toBe(expectedRuntime);
  }
}

/**
 * Assert that a trik is NOT in .trikhub/config.json
 *
 * @param projectDir - Path to the project directory
 * @param trikName - Full trik name (e.g., '@scope/name')
 */
export async function assertTrikNotInConfig(
  projectDir: string,
  trikName: string
): Promise<void> {
  const config = await readTriksConfig(projectDir);

  expect(
    config.triks,
    `Expected ${trikName} to NOT be in config.triks`
  ).not.toContain(trikName);
}

/**
 * Get the path where a cross-language trik would be downloaded
 *
 * @param projectDir - Path to the project directory
 * @param trikName - Full trik name (e.g., '@scope/name')
 */
export function getTrikDirPath(projectDir: string, trikName: string): string {
  // Handle scoped packages: @scope/name -> .trikhub/triks/@scope/name
  if (trikName.startsWith('@')) {
    const parts = trikName.split('/');
    return join(projectDir, '.trikhub', 'triks', parts[0], parts[1]);
  }
  return join(projectDir, '.trikhub', 'triks', trikName);
}

/**
 * Assert that a cross-language trik exists in .trikhub/triks/
 *
 * @param projectDir - Path to the project directory
 * @param trikName - Full trik name (e.g., '@scope/name')
 */
export async function assertTrikInTriksDir(
  projectDir: string,
  trikName: string
): Promise<void> {
  const trikDir = getTrikDirPath(projectDir, trikName);

  // Check directory exists
  expect(
    existsSync(trikDir),
    `Expected trik directory to exist: ${trikDir}`
  ).toBe(true);

  // Check manifest.json exists (may be at root or in subdirectory for Python packages)
  const manifestAtRoot = existsSync(join(trikDir, 'manifest.json'));
  let manifestInSubdir = false;

  if (!manifestAtRoot) {
    // Check for Python package structure: package_name/manifest.json
    try {
      const entries = await readdir(trikDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          if (existsSync(join(trikDir, entry.name, 'manifest.json'))) {
            manifestInSubdir = true;
            break;
          }
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
  }

  expect(
    manifestAtRoot || manifestInSubdir,
    `Expected manifest.json in trik directory: ${trikDir}`
  ).toBe(true);
}

/**
 * Assert that a cross-language trik directory does NOT exist
 *
 * @param projectDir - Path to the project directory
 * @param trikName - Full trik name (e.g., '@scope/name')
 */
export async function assertTrikNotInTriksDir(
  projectDir: string,
  trikName: string
): Promise<void> {
  const trikDir = getTrikDirPath(projectDir, trikName);

  expect(
    existsSync(trikDir),
    `Expected trik directory to NOT exist: ${trikDir}`
  ).toBe(false);
}

/**
 * Assert that a trik has node_modules installed (for JS triks in Python projects)
 *
 * @param projectDir - Path to the project directory
 * @param trikName - Full trik name (e.g., '@scope/name')
 */
export async function assertTrikHasNodeModules(
  projectDir: string,
  trikName: string
): Promise<void> {
  const trikDir = getTrikDirPath(projectDir, trikName);
  const nodeModulesDir = join(trikDir, 'node_modules');

  expect(
    existsSync(nodeModulesDir),
    `Expected node_modules in trik directory: ${nodeModulesDir}`
  ).toBe(true);
}

/**
 * Assert that a trik is in package.json dependencies (for same-runtime JS installs)
 *
 * @param projectDir - Path to the project directory
 * @param trikName - Full trik name (e.g., '@scope/name')
 */
export async function assertTrikInPackageJson(
  projectDir: string,
  trikName: string
): Promise<void> {
  const pkg = await readPackageJson(projectDir);
  const deps = pkg.dependencies || {};

  expect(
    deps[trikName],
    `Expected ${trikName} to be in package.json dependencies`
  ).toBeDefined();
}

/**
 * Assert that a trik is NOT in package.json dependencies
 *
 * @param projectDir - Path to the project directory
 * @param trikName - Full trik name (e.g., '@scope/name')
 */
export async function assertTrikNotInPackageJson(
  projectDir: string,
  trikName: string
): Promise<void> {
  const pkg = await readPackageJson(projectDir);
  const deps = pkg.dependencies || {};

  expect(
    deps[trikName],
    `Expected ${trikName} to NOT be in package.json dependencies`
  ).toBeUndefined();
}
