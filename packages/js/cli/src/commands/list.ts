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
  runtime?: string;
}

interface NpmTriksConfig {
  triks: string[];
  /** Packages installed from TrikHub registry (not npm) - includes cross-language triks */
  trikhub?: Record<string, string>; // packageName -> version
}

interface TrikInfo {
  name: string;
  version: string;
  description?: string;
  agentMode?: string;
  exists: boolean;
  /** Whether this is a cross-language trik (stored in .trikhub/triks/) */
  crossLanguage?: boolean;
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
      trikhub: config.trikhub ?? {},
    };
  } catch {
    return { triks: [] };
  }
}

/**
 * Get info about an installed trik from node_modules or .trikhub/triks/
 */
async function getTrikInfo(
  packageName: string,
  baseDir: string,
  config: NpmTriksConfig
): Promise<TrikInfo> {
  // First, check node_modules (for JS triks installed via npm)
  const nodeModulesPath = join(baseDir, 'node_modules', ...packageName.split('/'));
  const packageJsonPath = join(nodeModulesPath, 'package.json');

  if (existsSync(nodeModulesPath)) {
    const info: TrikInfo = {
      name: packageName,
      version: 'unknown',
      exists: true,
      crossLanguage: false,
    };

    // Prefer version from config.trikhub (more accurate for recently installed/upgraded triks)
    // Fall back to package.json version in node_modules
    if (config.trikhub?.[packageName]) {
      info.version = config.trikhub[packageName];
    } else if (existsSync(packageJsonPath)) {
      try {
        const content = await readFile(packageJsonPath, 'utf-8');
        const pkg = JSON.parse(content);
        info.version = pkg.version || 'unknown';
      } catch {
        // Ignore errors reading package.json
      }
    }

    // Get description from package.json
    if (existsSync(packageJsonPath)) {
      try {
        const content = await readFile(packageJsonPath, 'utf-8');
        const pkg = JSON.parse(content);
        info.description = pkg.description;
      } catch {
        // Ignore errors reading package.json
      }
    }

    // Get agent mode from manifest.json
    const manifestJsonPath = join(nodeModulesPath, 'manifest.json');
    if (existsSync(manifestJsonPath)) {
      try {
        const content = await readFile(manifestJsonPath, 'utf-8');
        const manifest = JSON.parse(content);
        info.agentMode = manifest.agent?.mode;
      } catch {
        // Ignore errors reading manifest.json
      }
    }

    return info;
  }

  // Second, check .trikhub/triks/ (for cross-language triks)
  const triksPath = join(baseDir, NPM_CONFIG_DIR, 'triks', ...packageName.split('/'));

  if (existsSync(triksPath)) {
    const info: TrikInfo = {
      name: packageName,
      version: config.trikhub?.[packageName] || 'unknown',
      exists: true,
      crossLanguage: true,
    };

    // Try to find manifest.json for description and agent mode (may be in subdirectory for Python packages)
    const manifestPath = join(triksPath, 'manifest.json');
    if (existsSync(manifestPath)) {
      try {
        const content = await readFile(manifestPath, 'utf-8');
        const manifest = JSON.parse(content);
        info.description = manifest.description;
        info.agentMode = manifest.agent?.mode;
      } catch {
        // Ignore errors
      }
    } else {
      // For Python packages, manifest may be in a subdirectory (package_name/manifest.json)
      try {
        const { readdir } = await import('node:fs/promises');
        const entries = await readdir(triksPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            const subManifest = join(triksPath, entry.name, 'manifest.json');
            if (existsSync(subManifest)) {
              const content = await readFile(subManifest, 'utf-8');
              const manifest = JSON.parse(content);
              info.description = manifest.description;
              info.agentMode = manifest.agent?.mode;
              break;
            }
          }
        }
      } catch {
        // Ignore errors
      }
    }

    return info;
  }

  // Trik not found in either location
  return {
    name: packageName,
    version: config.trikhub?.[packageName] || 'unknown',
    exists: false,
    crossLanguage: !!config.trikhub?.[packageName],
  };
}

export async function listCommand(options: ListOptions): Promise<void> {
  const baseDir = process.cwd();
  const config = await readNpmConfig(baseDir);

  let triksToShow = config.triks;
  if (options.runtime) {
    const configPath = getNpmConfigPath(baseDir);
    if (existsSync(configPath)) {
      try {
        const content = await readFile(configPath, 'utf-8');
        const fullConfig = JSON.parse(content);
        const runtimes = fullConfig.runtimes ?? {};
        triksToShow = config.triks.filter((name: string) => {
          const rt = runtimes[name] ?? 'node';
          return rt === options.runtime;
        });
      } catch {
        // If we can't read runtimes, show all
      }
    }
  }

  if (options.json) {
    const triks = await Promise.all(
      triksToShow.map((name) => getTrikInfo(name, baseDir, config))
    );
    console.log(JSON.stringify({
      configPath: getNpmConfigPath(baseDir),
      triks,
    }, null, 2));
    return;
  }

  if (triksToShow.length === 0) {
    console.log(chalk.yellow('No triks installed.'));
    console.log(chalk.dim('\nUse `trik install @scope/name` to install a trik'));
    console.log(chalk.dim('Use `trik sync` to discover triks in node_modules'));
    return;
  }

  console.log(chalk.bold(`\nInstalled triks (${triksToShow.length}):\n`));

  for (const trikName of triksToShow) {
    const info = await getTrikInfo(trikName, baseDir, config);

    const status = info.exists
      ? chalk.green('●')
      : chalk.red('○');

    const name = chalk.cyan(trikName);
    const version = chalk.dim(`v${info.version}`);

    console.log(`  ${status} ${name} ${version}`);

    if (info.description) {
      console.log(chalk.dim(`      ${info.description}`));
    }

    if (info.agentMode) {
      console.log(chalk.dim(`      [${info.agentMode}]`));
    }

    if (info.crossLanguage && info.exists) {
      console.log(chalk.dim(`      📦 Cross-language trik (in .trikhub/triks/)`));
    }

    if (!info.exists) {
      if (info.crossLanguage) {
        console.log(chalk.red(`      ⚠ Not in .trikhub/triks/! Run 'trik install ${trikName}'`));
      } else {
        console.log(chalk.red(`      ⚠ Not in node_modules! Run 'npm install' or 'trik install ${trikName}'`));
      }
    }

    console.log();
  }
}
