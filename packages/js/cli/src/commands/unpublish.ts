/**
 * trik unpublish command
 *
 * Permanently removes a trik from the TrikHub registry.
 */

import { createInterface } from 'node:readline';
import chalk from 'chalk';
import ora from 'ora';
import { parseTrikName } from '../types.js';
import { RegistryClient } from '../lib/registry.js';
import { loadConfig } from '../lib/storage.js';

export async function unpublishCommand(trikInput: string): Promise<void> {
  const spinner = ora();
  const config = loadConfig();

  // Check if logged in
  if (!config.authToken) {
    console.log(chalk.red('Not logged in'));
    console.log(chalk.dim('Run `trik login` to authenticate first'));
    process.exit(1);
  }

  // Check if token is expired
  if (config.authExpiresAt && new Date(config.authExpiresAt) < new Date()) {
    console.log(chalk.red('Session expired'));
    console.log(chalk.dim('Run `trik login` to re-authenticate'));
    process.exit(1);
  }

  try {
    // Parse the trik name
    const { fullName } = parseTrikName(trikInput);

    // Check if trik exists
    spinner.start(`Checking ${chalk.cyan(fullName)}...`);
    const registry = new RegistryClient();
    const trik = await registry.getTrik(fullName);

    if (!trik) {
      spinner.fail(`Trik not found: ${chalk.cyan(fullName)}`);
      process.exit(1);
    }

    spinner.succeed(`Found ${chalk.cyan(fullName)}`);

    // Show warning and request confirmation
    console.log();
    console.log(chalk.red.bold('  WARNING: This will permanently delete this trik and ALL its versions.'));
    console.log(chalk.red('  This action cannot be undone.'));
    console.log();

    // Require user to type the full name to confirm
    const answer = await promptForConfirmation(fullName);

    if (answer !== fullName) {
      console.log(chalk.yellow('\nUnpublish cancelled - trik name did not match'));
      process.exit(1);
    }

    // Delete the trik
    spinner.start(`Unpublishing ${chalk.cyan(fullName)}...`);

    await registry.deleteTrik(fullName);

    spinner.succeed(`Successfully unpublished ${chalk.cyan(fullName)}`);
    console.log();
  } catch (error) {
    spinner.fail('Unpublish failed');
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}

/**
 * Prompt user to type the trik name for confirmation
 */
function promptForConfirmation(fullName: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(`  To confirm, type the trik name (${chalk.cyan(fullName)}): `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
