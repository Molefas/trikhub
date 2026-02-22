/**
 * trik uninstall command
 *
 * Removes a trik from both package.json and .trikhub/config.json.
 *
 * Workflow:
 * 1. Check if it's a cross-language trik (stored in .trikhub/triks/)
 * 2. Remove from .trikhub/config.json
 * 3. If cross-language: delete from .trikhub/triks/
 * 4. If same-language: run npm/pnpm/yarn uninstall
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import chalk from 'chalk';
import ora from 'ora';

type TrikRuntime = 'node' | 'python';

interface NpmTriksConfig {
  triks: string[];
  trikhub?: Record<string, string>;
  runtimes?: Record<string, TrikRuntime>;
}

type PackageManager = 'npm' | 'pnpm' | 'yarn';

const NPM_CONFIG_DIR = '.trikhub';
const NPM_CONFIG_FILE = 'config.json';

/**
 * Detect which package manager is being used in the project
 */
function detectPackageManager(baseDir: string): PackageManager {
  if (existsSync(join(baseDir, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (existsSync(join(baseDir, 'yarn.lock'))) {
    return 'yarn';
  }
  return 'npm';
}

/**
 * Run a command and return a promise
 */
function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: true,
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Get the path to the npm-based config file
 */
function getNpmConfigPath(baseDir: string): string {
  return join(baseDir, NPM_CONFIG_DIR, NPM_CONFIG_FILE);
}

/**
 * Read the npm-based trik config
 */
async function readNpmConfig(baseDir: string): Promise<NpmTriksConfig> {
  const configPath = getNpmConfigPath(baseDir);

  if (!existsSync(configPath)) {
    return { triks: [] };
  }

  try {
    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as NpmTriksConfig;
    return {
      triks: Array.isArray(config.triks) ? config.triks : [],
      trikhub: config.trikhub ?? {},
      runtimes: config.runtimes ?? {},
    };
  } catch {
    return { triks: [] };
  }
}

/**
 * Write the npm-based trik config
 */
async function writeNpmConfig(config: NpmTriksConfig, baseDir: string): Promise<void> {
  const configPath = getNpmConfigPath(baseDir);
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/**
 * Remove a trik from the config and return its runtime
 */
async function removeTrikFromConfig(
  packageName: string,
  baseDir: string
): Promise<{ wasInConfig: boolean; runtime?: TrikRuntime }> {
  const config = await readNpmConfig(baseDir);

  if (!config.triks.includes(packageName)) {
    return { wasInConfig: false };
  }

  // Get the runtime before removing
  const runtime = config.runtimes?.[packageName];

  // Remove from all config fields
  config.triks = config.triks.filter((t) => t !== packageName);

  if (config.trikhub && packageName in config.trikhub) {
    delete config.trikhub[packageName];
  }

  if (config.runtimes && packageName in config.runtimes) {
    delete config.runtimes[packageName];
  }

  await writeNpmConfig(config, baseDir);
  return { wasInConfig: true, runtime };
}

/**
 * Get the path to a cross-language trik in .trikhub/triks/
 */
function getTrikDirPath(baseDir: string, packageName: string): string {
  // Handle scoped packages: @scope/name -> .trikhub/triks/@scope/name
  if (packageName.startsWith('@')) {
    const parts = packageName.split('/');
    return join(baseDir, '.trikhub', 'triks', parts[0], parts[1]);
  }
  return join(baseDir, '.trikhub', 'triks', packageName);
}

/**
 * Remove a cross-language trik directory from .trikhub/triks/
 */
async function removeTrikDirectory(baseDir: string, packageName: string): Promise<boolean> {
  const trikDir = getTrikDirPath(baseDir, packageName);

  if (!existsSync(trikDir)) {
    return false;
  }

  await rm(trikDir, { recursive: true, force: true });
  return true;
}

export async function uninstallCommand(trikInput: string): Promise<void> {
  const spinner = ora();
  const baseDir = process.cwd();

  try {
    // Parse package name (remove @ version suffix if present)
    let packageName = trikInput;
    const atIndex = trikInput.lastIndexOf('@');
    if (atIndex > 0) {
      packageName = trikInput.substring(0, atIndex);
    }

    // Check if package.json exists
    const packageJsonPath = join(baseDir, 'package.json');
    if (!existsSync(packageJsonPath)) {
      console.log(chalk.red('No package.json found in current directory.'));
      process.exit(1);
    }

    // Remove from config first and get the runtime
    spinner.start(`Removing ${chalk.cyan(packageName)} from config...`);
    const { wasInConfig, runtime } = await removeTrikFromConfig(packageName, baseDir);

    if (!wasInConfig) {
      spinner.info(`${chalk.yellow(packageName)} was not in .trikhub/config.json`);
    } else {
      spinner.succeed(`Removed ${chalk.green(packageName)} from .trikhub/config.json`);
    }

    // Check if the trik is stored in .trikhub/triks/ (TrikHub-managed)
    const trikDirPath = getTrikDirPath(baseDir, packageName);
    const isInTriksDir = existsSync(trikDirPath);

    // Also check node_modules for npm-based triks
    const nodeModulesPath = join(baseDir, 'node_modules', ...packageName.split('/'));
    const isInNodeModules = existsSync(nodeModulesPath);

    // Remove from .trikhub/triks/ if present (TrikHub-managed triks)
    if (isInTriksDir) {
      spinner.start(`Removing ${chalk.cyan(packageName)} from .trikhub/triks/...`);
      await removeTrikDirectory(baseDir, packageName);
      spinner.succeed(`Removed ${chalk.green(packageName)} from .trikhub/triks/`);
    }

    // Remove from node_modules if present (npm-based triks)
    if (isInNodeModules) {
      const pm = detectPackageManager(baseDir);

      // Build uninstall command
      const uninstallArgs: string[] = [];

      switch (pm) {
        case 'pnpm':
          uninstallArgs.push('remove', packageName);
          break;
        case 'yarn':
          uninstallArgs.push('remove', packageName);
          break;
        case 'npm':
        default:
          uninstallArgs.push('uninstall', '--prefix', baseDir, packageName);
          break;
      }

      spinner.start(`Uninstalling ${chalk.cyan(packageName)}...`);
      spinner.stopAndPersist({ symbol: '📦', text: `Uninstalling ${chalk.cyan(packageName)}...` });

      await runCommand(pm, uninstallArgs, baseDir);
    }

    if (!isInTriksDir && !isInNodeModules && !wasInConfig) {
      console.log(chalk.yellow(`${packageName} was not installed`));
      return;
    }

    console.log();
    console.log(chalk.green(`✓ Uninstalled ${packageName}`));

  } catch (error) {
    spinner.fail('Uninstall failed');
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}
