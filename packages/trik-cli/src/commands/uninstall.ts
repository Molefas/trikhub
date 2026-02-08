/**
 * trik uninstall command
 *
 * Removes a trik from both package.json and .trikhub/config.json.
 *
 * Workflow:
 * 1. Remove from .trikhub/config.json
 * 2. Run npm/pnpm/yarn uninstall
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import chalk from 'chalk';
import ora from 'ora';

interface NpmTriksConfig {
  triks: string[];
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
 * Remove a trik from the config
 */
async function removeTrikFromConfig(packageName: string, baseDir: string): Promise<boolean> {
  const config = await readNpmConfig(baseDir);

  if (!config.triks.includes(packageName)) {
    return false;
  }

  config.triks = config.triks.filter((t) => t !== packageName);
  await writeNpmConfig(config, baseDir);
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

    // Remove from config first
    spinner.start(`Removing ${chalk.cyan(packageName)} from config...`);
    const wasInConfig = await removeTrikFromConfig(packageName, baseDir);

    if (!wasInConfig) {
      spinner.info(`${chalk.yellow(packageName)} was not in .trikhub/config.json`);
    } else {
      spinner.succeed(`Removed ${chalk.green(packageName)} from .trikhub/config.json`);
    }

    // Detect package manager
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
        uninstallArgs.push('uninstall', packageName);
        break;
    }

    // Run package manager uninstall
    spinner.start(`Uninstalling ${chalk.cyan(packageName)}...`);
    spinner.stopAndPersist({ symbol: '📦', text: `Uninstalling ${chalk.cyan(packageName)}...` });

    await runCommand(pm, uninstallArgs, baseDir);

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
