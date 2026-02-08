/**
 * trik search command
 *
 * Searches the registry for triks.
 */

import chalk from 'chalk';
import ora from 'ora';
import { registry } from '../lib/registry.js';
import { isTrikInstalled } from '../lib/storage.js';

interface SearchOptions {
  json?: boolean;
  limit?: string;
}

export async function searchCommand(
  query: string,
  options: SearchOptions
): Promise<void> {
  const spinner = ora(`Searching for "${query}"...`).start();

  try {
    const limit = parseInt(options.limit ?? '10', 10);
    const results = await registry.search(query, { perPage: limit });

    spinner.stop();

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.total === 0) {
      console.log(chalk.yellow(`\nNo triks found for "${query}"\n`));
      console.log(chalk.dim('Try a different search term or browse all triks at https://trikhub.com'));
      return;
    }

    console.log(
      chalk.bold(`\nFound ${results.total} trik${results.total === 1 ? '' : 's'}:\n`)
    );

    for (const trik of results.results) {
      const installed = isTrikInstalled(trik.fullName);
      const installedBadge = installed ? chalk.green(' [installed]') : '';
      const verifiedBadge = trik.verified ? chalk.blue(' ✓') : '';

      console.log(
        `  ${chalk.cyan(trik.fullName)}${verifiedBadge}${installedBadge}`
      );
      console.log(`  ${chalk.dim(trik.description)}`);
      console.log(
        chalk.dim(
          `  v${trik.latestVersion} · ⬇ ${formatNumber(trik.downloads)} · ⭐ ${trik.stars}`
        )
      );
      console.log();
    }

    if (results.total > results.results.length) {
      console.log(
        chalk.dim(
          `Showing ${results.results.length} of ${results.total} results. Use --limit to see more.`
        )
      );
    }

    console.log(chalk.dim(`\nInstall with: trik install @scope/name`));
  } catch (error) {
    spinner.fail('Search failed');
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
