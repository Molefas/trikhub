/**
 * trik upgrade command
 *
 * Upgrades an installed trik to the latest version.
 */

import { existsSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import * as semver from 'semver';
import { parseTrikName, InstalledTrik } from '../types.js';
import { registry } from '../lib/registry.js';
import { getConfigContext, ConfigContext } from '../lib/config.js';
import {
  getInstalledTrik,
  getInstalledTriks,
  isTrikInstalled,
  removeFromLockfile,
  getTrikPath,
} from '../lib/storage.js';
import { installCommand } from './install.js';

interface UpgradeOptions {
  force?: boolean;
}

interface NpmTriksConfig {
  triks: string[];
  trikhub?: Record<string, string>;
}

/**
 * Read npm-based config.json
 */
async function readNpmConfig(baseDir: string): Promise<NpmTriksConfig> {
  const configPath = join(baseDir, '.trikhub', 'config.json');
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
 * Check if a trik is installed (checks both lockfile and npm config)
 */
async function isAnyTrikInstalled(fullName: string, ctx: ConfigContext): Promise<boolean> {
  // Check lockfile first (TrikHub registry triks)
  if (isTrikInstalled(fullName, ctx)) {
    return true;
  }
  // Check npm config (npm-based triks)
  if (ctx.scope === 'local') {
    const npmConfig = await readNpmConfig(process.cwd());
    return npmConfig.triks.includes(fullName);
  }
  return false;
}

interface NpmInstalledTrik {
  fullName: string;
  version: string;
  isNpmBased: true;
}

type AnyInstalledTrik = InstalledTrik | NpmInstalledTrik;

/**
 * Get installed trik info (checks both lockfile and npm config)
 */
async function getAnyInstalledTrik(fullName: string, ctx: ConfigContext): Promise<AnyInstalledTrik | null> {
  // Check lockfile first
  const lockfileTrik = getInstalledTrik(fullName, ctx);
  if (lockfileTrik) {
    return lockfileTrik;
  }
  // Check npm config
  if (ctx.scope === 'local') {
    const npmConfig = await readNpmConfig(process.cwd());
    if (npmConfig.triks.includes(fullName)) {
      const version = npmConfig.trikhub?.[fullName] || 'unknown';
      return {
        fullName,
        version,
        isNpmBased: true,
      };
    }
  }
  return null;
}

export async function upgradeCommand(
  trikInput: string,
  options: UpgradeOptions
): Promise<void> {
  const spinner = ora();

  try {
    // Get the current config context (local if available, otherwise global)
    const ctx = getConfigContext();

    // Parse the trik name
    const { fullName } = parseTrikName(trikInput);

    // Check if installed in this scope (lockfile or npm config)
    const isInstalled = await isAnyTrikInstalled(fullName, ctx);
    if (!isInstalled) {
      console.log(chalk.red(`${fullName} is not installed`));
      if (ctx.scope === 'local') {
        console.log(chalk.dim(`  (checked in ${ctx.trikhubDir})`));
      }
      console.log(chalk.dim(`Use 'trik install ${fullName}' to install it`));
      process.exit(1);
    }

    const installed = await getAnyInstalledTrik(fullName, ctx);
    if (!installed) {
      console.log(chalk.red(`Could not find installation info for ${fullName}`));
      process.exit(1);
    }

    // Fetch latest version from registry
    spinner.start(`Checking for updates to ${chalk.cyan(fullName)}...`);
    const trikInfo = await registry.getTrik(fullName);

    // For npm-based triks not in TrikHub registry, suggest npm update
    if ('isNpmBased' in installed && installed.isNpmBased) {
      if (!trikInfo) {
        // Not in TrikHub registry - pure npm package
        spinner.stop();
        console.log(chalk.yellow(`${fullName} is installed via npm (not in TrikHub registry).`));
        console.log(chalk.dim(`Current version: v${installed.version}`));
        console.log();
        console.log(chalk.cyan('To upgrade, run:'));
        console.log(chalk.dim(`  npm update ${fullName}`));
        return;
      }
      // In TrikHub registry - we can check for updates and upgrade
      spinner.stop();
    }

    if (!trikInfo) {
      spinner.fail(`Trik ${chalk.red(fullName)} not found in registry`);
      process.exit(1);
    }

    const currentVersion = installed.version;
    const latestVersion = trikInfo.latestVersion;

    // Compare versions
    if (!options.force && semver.gte(currentVersion, latestVersion)) {
      spinner.succeed(
        `${chalk.green(fullName)} is already up to date (v${currentVersion})`
      );
      return;
    }

    spinner.text = `Upgrading ${chalk.cyan(fullName)} from v${currentVersion} to v${latestVersion}...`;

    // Handle npm-based triks - migrate to TrikHub-managed installation
    if ('isNpmBased' in installed && installed.isNpmBased) {
      spinner.stop();

      console.log(chalk.cyan(`\nMigrating ${fullName} to TrikHub-managed installation...\n`));

      const { execSync } = await import('node:child_process');
      const { writeFile } = await import('node:fs/promises');

      try {
        // 1. Remove from node_modules
        console.log(chalk.dim('  Removing npm installation...'));
        execSync(`npm uninstall ${fullName}`, {
          stdio: 'pipe',
          cwd: process.cwd(),
        });

        // 2. Remove from config.json triks array (keep trikhub version tracking)
        const configPath = join(process.cwd(), '.trikhub', 'config.json');
        if (existsSync(configPath)) {
          const configContent = await readFile(configPath, 'utf-8');
          const config = JSON.parse(configContent);
          // Remove from triks array
          config.triks = (config.triks || []).filter((t: string) => t !== fullName);
          // Remove from trikhub tracking (will be managed via triks.lock)
          if (config.trikhub) delete config.trikhub[fullName];
          await writeFile(configPath, JSON.stringify(config, null, 2));
        }

        // 3. Install via TrikHub registry
        console.log(chalk.dim(`  Installing ${fullName}@${latestVersion} from TrikHub registry...`));
        await installCommand(fullName, { version: latestVersion });

        console.log();
        console.log(
          chalk.green(`✓ Upgraded ${fullName} from v${currentVersion} → v${latestVersion}`)
        );
        console.log(chalk.dim(`  Now managed by TrikHub (installed to .trikhub/triks/)`));
      } catch (error) {
        console.error(chalk.red(`\nFailed to upgrade ${fullName}`));
        if (error instanceof Error) {
          console.error(chalk.dim(error.message));
        }
        process.exit(1);
      }
      return;
    }

    // For TrikHub registry triks, remove and reinstall
    const installPath = getTrikPath(fullName, ctx);
    rmSync(installPath, { recursive: true, force: true });
    removeFromLockfile(fullName, ctx);

    spinner.stop();

    // Reinstall with latest version
    // Note: installCommand will resolve config and should find the same context
    await installCommand(fullName, { version: latestVersion });

    console.log();
    console.log(
      chalk.green(`✓ Upgraded ${fullName} from v${currentVersion} → v${latestVersion}`)
    );
  } catch (error) {
    spinner.fail('Upgrade failed');
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}

/**
 * Upgrade all installed triks
 */
export async function upgradeAllCommand(options: UpgradeOptions): Promise<void> {
  const spinner = ora();

  try {
    // Get the current config context (local if available, otherwise global)
    const ctx = getConfigContext();

    // Get all installed triks in this scope
    const installedTriks = getInstalledTriks(ctx);

    if (installedTriks.length === 0) {
      console.log(chalk.yellow('No triks installed'));
      if (ctx.scope === 'local') {
        console.log(chalk.dim(`  (in ${ctx.trikhubDir})`));
      }
      return;
    }

    const scopeLabel = ctx.scope === 'local'
      ? ` (local: ${ctx.trikhubDir})`
      : '';

    console.log(chalk.cyan(`Checking ${installedTriks.length} installed trik(s) for updates...${scopeLabel}\n`));

    let upgraded = 0;
    let upToDate = 0;
    let failed = 0;

    for (const installed of installedTriks) {
      spinner.start(`Checking ${chalk.cyan(installed.fullName)}...`);

      try {
        const trikInfo = await registry.getTrik(installed.fullName);

        if (!trikInfo) {
          spinner.warn(`${installed.fullName} not found in registry`);
          failed++;
          continue;
        }

        const currentVersion = installed.version;
        const latestVersion = trikInfo.latestVersion;

        if (!options.force && semver.gte(currentVersion, latestVersion)) {
          spinner.succeed(
            `${installed.fullName} is up to date (v${currentVersion})`
          );
          upToDate++;
          continue;
        }

        spinner.text = `Upgrading ${installed.fullName} v${currentVersion} → v${latestVersion}...`;

        // Remove and reinstall
        const installPath = getTrikPath(installed.fullName, ctx);
        rmSync(installPath, { recursive: true, force: true });
        removeFromLockfile(installed.fullName, ctx);

        spinner.stop();
        await installCommand(installed.fullName, { version: latestVersion });
        upgraded++;
      } catch (error) {
        spinner.fail(`Failed to upgrade ${installed.fullName}`);
        if (error instanceof Error) {
          console.error(chalk.dim(`  ${error.message}`));
        }
        failed++;
      }
    }

    console.log();
    console.log(chalk.bold('Summary:'));
    if (upgraded > 0) console.log(chalk.green(`  ${upgraded} upgraded`));
    if (upToDate > 0) console.log(chalk.dim(`  ${upToDate} up to date`));
    if (failed > 0) console.log(chalk.red(`  ${failed} failed`));
  } catch (error) {
    spinner.fail('Upgrade failed');
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}
