/**
 * trik sync command
 *
 * Discovers trik packages in node_modules and adds them to the config.
 * This enables npm-based trik installation:
 *   1. Add trik to package.json dependencies
 *   2. Run npm install
 *   3. Run trik sync to register the trik
 */

import { readdir, stat, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { validateManifest } from '@trikhub/manifest';

interface SyncOptions {
  dryRun?: boolean;
  json?: boolean;
}

interface NpmTriksConfig {
  /** List of npm package names that are triks */
  triks: string[];
}

interface SyncResult {
  added: string[];
  alreadyConfigured: string[];
  total: number;
}

const NPM_CONFIG_DIR = '.trikhub';
const NPM_CONFIG_FILE = 'config.json';

/**
 * Get the path to the npm-based config file
 */
function getNpmConfigPath(baseDir: string = process.cwd()): string {
  return join(baseDir, NPM_CONFIG_DIR, NPM_CONFIG_FILE);
}

/**
 * Read the npm-based trik config
 */
async function readNpmConfig(baseDir: string = process.cwd()): Promise<NpmTriksConfig> {
  const configPath = getNpmConfigPath(baseDir);

  if (!existsSync(configPath)) {
    return { triks: [] };
  }

  try {
    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as NpmTriksConfig;
    return {
      triks: Array.isArray(config.triks) ? config.triks : [],
    };
  } catch {
    return { triks: [] };
  }
}

/**
 * Write the npm-based trik config
 */
async function writeNpmConfig(config: NpmTriksConfig, baseDir: string = process.cwd()): Promise<void> {
  const configPath = getNpmConfigPath(baseDir);
  const configDir = dirname(configPath);

  if (!existsSync(configDir)) {
    await mkdir(configDir, { recursive: true });
  }

  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/**
 * Check if a package directory contains a valid trik manifest
 */
async function isTrikPackage(packagePath: string): Promise<boolean> {
  const manifestPath = join(packagePath, 'manifest.json');

  if (!existsSync(manifestPath)) {
    return false;
  }

  try {
    const content = await readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(content);

    // Use the manifest validator from @trikhub/manifest
    const validation = validateManifest(manifest);
    return validation.valid;
  } catch {
    return false;
  }
}

/**
 * Scan node_modules for packages that are triks
 */
async function discoverTriksInNodeModules(nodeModulesPath: string): Promise<string[]> {
  const triks: string[] = [];

  if (!existsSync(nodeModulesPath)) {
    return triks;
  }

  try {
    const entries = await readdir(nodeModulesPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '.bin' || entry.name === '.cache') continue;

      const entryPath = join(nodeModulesPath, entry.name);

      // Handle scoped packages (@scope/package)
      if (entry.name.startsWith('@')) {
        try {
          const scopedEntries = await readdir(entryPath, { withFileTypes: true });

          for (const scopedEntry of scopedEntries) {
            if (!scopedEntry.isDirectory()) continue;

            const packageName = `${entry.name}/${scopedEntry.name}`;
            const packagePath = join(entryPath, scopedEntry.name);

            if (await isTrikPackage(packagePath)) {
              triks.push(packageName);
            }
          }
        } catch {
          // Skip unreadable scope directories
        }
      } else {
        // Regular package
        if (await isTrikPackage(entryPath)) {
          triks.push(entry.name);
        }
      }
    }
  } catch {
    // node_modules doesn't exist or isn't readable
  }

  return triks;
}

/**
 * Sync command implementation
 */
export async function syncCommand(options: SyncOptions): Promise<void> {
  const spinner = ora();
  const baseDir = process.cwd();
  const nodeModulesPath = join(baseDir, 'node_modules');

  try {
    spinner.start('Scanning node_modules for triks...');

    // Discover triks in node_modules
    const discoveredTriks = await discoverTriksInNodeModules(nodeModulesPath);

    if (discoveredTriks.length === 0) {
      spinner.info('No triks found in node_modules.');
      console.log(chalk.dim('\nTriks are npm packages with a manifest.json file.'));
      console.log(chalk.dim('Install a trik package and run sync again.'));
      return;
    }

    spinner.succeed(`Found ${discoveredTriks.length} trik(s) in node_modules`);

    // Read current config
    const config = await readNpmConfig(baseDir);
    const currentTriks = new Set(config.triks);

    const result: SyncResult = {
      added: [],
      alreadyConfigured: [],
      total: discoveredTriks.length,
    };

    for (const trik of discoveredTriks) {
      if (currentTriks.has(trik)) {
        result.alreadyConfigured.push(trik);
      } else {
        result.added.push(trik);
      }
    }

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (result.added.length === 0) {
      console.log(chalk.green('\n✓ All discovered triks are already configured.'));
      return;
    }

    if (options.dryRun) {
      console.log(chalk.yellow('\nDry run - would add the following triks to config:\n'));
      for (const trik of result.added) {
        console.log(chalk.cyan(`  + ${trik}`));
      }
    } else {
      // Update config
      config.triks = [...config.triks, ...result.added].sort();
      await writeNpmConfig(config, baseDir);

      console.log(chalk.green('\nAdded to .trikhub/config.json:\n'));
      for (const trik of result.added) {
        console.log(chalk.cyan(`  + ${trik}`));
      }
    }

    if (result.alreadyConfigured.length > 0) {
      console.log(chalk.dim('\nAlready configured:'));
      for (const trik of result.alreadyConfigured) {
        console.log(chalk.dim(`  = ${trik}`));
      }
    }

    console.log(chalk.dim(`\nTotal: ${result.total} trik(s), ${result.added.length} added`));

  } catch (error) {
    spinner.fail('Sync failed');
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}
