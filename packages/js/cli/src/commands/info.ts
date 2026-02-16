/**
 * trik info command
 *
 * Shows detailed information about a trik.
 */

import chalk from 'chalk';
import ora from 'ora';
import { parseTrikName } from '../types.js';
import { registry } from '../lib/registry.js';
import { isTrikInstalled, getInstalledTrik, getTrikPath } from '../lib/storage.js';

interface InfoOptions {
  json?: boolean;
}

export async function infoCommand(
  trikInput: string,
  options: InfoOptions
): Promise<void> {
  const spinner = ora('Fetching trik info...').start();

  try {
    const { fullName } = parseTrikName(trikInput);

    const trik = await registry.getTrik(fullName);

    spinner.stop();

    if (!trik) {
      console.log(chalk.red(`\nTrik ${fullName} not found in registry\n`));
      process.exit(1);
    }

    if (options.json) {
      console.log(JSON.stringify(trik, null, 2));
      return;
    }

    const installed = getInstalledTrik(fullName);
    const isInstalled = isTrikInstalled(fullName);

    // Header
    console.log();
    console.log(
      chalk.bold.cyan(trik.fullName) +
        (trik.verified ? chalk.blue(' ✓ Verified') : '')
    );
    console.log(chalk.dim(trik.description));
    console.log();

    // Install status
    if (isInstalled && installed) {
      console.log(
        chalk.green(`✓ Installed`) +
          chalk.dim(` (v${installed.version})`)
      );
      console.log(chalk.dim(`  Path: ${getTrikPath(fullName)}`));
      console.log();
    }

    // Stats
    console.log(chalk.bold('Stats'));
    console.log(`  Latest version: ${chalk.cyan(trik.latestVersion)}`);
    console.log(`  Downloads: ${formatNumber(trik.downloads)}`);
    console.log(`  Stars: ${trik.stars}`);
    console.log();

    // Categories & Keywords
    console.log(chalk.bold('Categories'));
    console.log(`  ${trik.categories.join(', ')}`);
    console.log();

    if (trik.keywords.length > 0) {
      console.log(chalk.bold('Keywords'));
      console.log(`  ${trik.keywords.join(', ')}`);
      console.log();
    }

    // Links
    console.log(chalk.bold('Links'));
    console.log(`  GitHub: https://github.com/${trik.githubRepo}`);
    if (trik.discussionsUrl) {
      console.log(`  Discussions: ${trik.discussionsUrl}`);
    }
    console.log();

    // Versions
    console.log(chalk.bold('Versions'));
    const versionsToShow = trik.versions.slice(0, 5);
    for (const version of versionsToShow) {
      const date = new Date(version.publishedAt).toLocaleDateString();
      const current = version.version === trik.latestVersion ? chalk.green(' (latest)') : '';
      console.log(
        `  ${chalk.cyan(version.version)}${current} - ${chalk.dim(date)} - ${formatNumber(version.downloads)} downloads`
      );
    }
    if (trik.versions.length > 5) {
      console.log(chalk.dim(`  ... and ${trik.versions.length - 5} more versions`));
    }
    console.log();

    // Install command
    if (!isInstalled) {
      console.log(chalk.bold('Install'));
      console.log(`  ${chalk.cyan(`trik install ${trik.fullName}`)}`);
      console.log();
    }
  } catch (error) {
    spinner.fail('Failed to fetch trik info');
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}

/**
 * Format a number with K/M suffixes
 */
function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toString();
}
