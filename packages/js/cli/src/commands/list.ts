/**
 * trik list command
 *
 * Lists all installed triks from .trikhub/config.json.
 */

import chalk from 'chalk';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

interface ListOptions {
  json?: boolean;
}

interface NpmTriksConfig {
  triks: string[];
}

interface TrikInfo {
  name: string;
  version: string;
  description?: string;
  exists: boolean;
}

const NPM_CONFIG_DIR = '.trikhub';
const NPM_CONFIG_FILE = 'config.json';

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
 * Get info about an installed trik from node_modules
 */
async function getTrikInfo(packageName: string, baseDir: string): Promise<TrikInfo> {
  const packagePath = join(baseDir, 'node_modules', ...packageName.split('/'));
  const packageJsonPath = join(packagePath, 'package.json');

  const info: TrikInfo = {
    name: packageName,
    version: 'unknown',
    exists: existsSync(packagePath),
  };

  if (info.exists && existsSync(packageJsonPath)) {
    try {
      const content = await readFile(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(content);
      info.version = pkg.version || 'unknown';
      info.description = pkg.description;
    } catch {
      // Ignore errors reading package.json
    }
  }

  return info;
}

export async function listCommand(options: ListOptions): Promise<void> {
  const baseDir = process.cwd();
  const config = await readNpmConfig(baseDir);

  if (options.json) {
    const triks = await Promise.all(
      config.triks.map((name) => getTrikInfo(name, baseDir))
    );
    console.log(JSON.stringify({
      configPath: getNpmConfigPath(baseDir),
      triks,
    }, null, 2));
    return;
  }

  if (config.triks.length === 0) {
    console.log(chalk.yellow('No triks installed.'));
    console.log(chalk.dim('\nUse `trik install @scope/name` to install a trik'));
    console.log(chalk.dim('Use `trik sync` to discover triks in node_modules'));
    return;
  }

  console.log(chalk.bold(`\nInstalled triks (${config.triks.length}):\n`));

  for (const trikName of config.triks) {
    const info = await getTrikInfo(trikName, baseDir);

    const status = info.exists
      ? chalk.green('●')
      : chalk.red('○');

    const name = chalk.cyan(trikName);
    const version = chalk.dim(`v${info.version}`);

    console.log(`  ${status} ${name} ${version}`);

    if (info.description) {
      console.log(chalk.dim(`      ${info.description}`));
    }

    if (!info.exists) {
      console.log(chalk.red(`      ⚠ Not in node_modules! Run 'npm install' or 'trik install ${trikName}'`));
    }

    console.log();
  }
}
