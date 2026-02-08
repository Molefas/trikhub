/**
 * trik upgrade command
 *
 * Upgrades an installed trik to the latest version.
 */

import { rmSync } from 'node:fs';
import chalk from 'chalk';
import ora from 'ora';
import * as semver from 'semver';
import { parseTrikName } from '../types.js';
import { registry } from '../lib/registry.js';
import { getConfigContext } from '../lib/config.js';
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

    // Check if installed in this scope
    if (!isTrikInstalled(fullName, ctx)) {
      console.log(chalk.red(`${fullName} is not installed`));
      if (ctx.scope === 'local') {
        console.log(chalk.dim(`  (checked in ${ctx.trikhubDir})`));
      }
      console.log(chalk.dim(`Use 'trik install ${fullName}' to install it`));
      process.exit(1);
    }

    const installed = getInstalledTrik(fullName, ctx);
    if (!installed) {
      console.log(chalk.red(`Could not find installation info for ${fullName}`));
      process.exit(1);
    }

    // Fetch latest version from registry
    spinner.start(`Checking for updates to ${chalk.cyan(fullName)}...`);
    const trikInfo = await registry.getTrik(fullName);

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

    // Remove current installation
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
