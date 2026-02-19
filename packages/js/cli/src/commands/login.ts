/**
 * trik login command
 *
 * Authenticates with the TrikHub registry using GitHub's device flow.
 */

import chalk from 'chalk';
import ora from 'ora';
import { RegistryClient } from '../lib/registry.js';
import { loadConfig, saveConfig } from '../lib/storage.js';

export async function loginCommand(): Promise<void> {
  const spinner = ora();
  const config = loadConfig();
  const registry = new RegistryClient();

  // Check if already logged in and token is still valid
  if (config.authToken && config.authExpiresAt) {
    const expiresAt = new Date(config.authExpiresAt);
    if (expiresAt > new Date()) {
      // Verify token actually works with the server
      try {
        const user = await registry.getCurrentUser();
        console.log(chalk.yellow(`Already logged in as ${chalk.cyan('@' + user.username)}`));
        console.log(chalk.dim('Use `trik logout` to sign out first'));
        return;
      } catch {
        // Token invalid server-side, clear it and proceed with login
        console.log(chalk.dim('Previous session expired, starting new login...'));
        delete config.authToken;
        delete config.authExpiresAt;
        delete config.publisherUsername;
        saveConfig(config);
      }
    }
  }

  try {
    // Start device flow
    spinner.start('Initializing authentication...');
    const deviceAuth = await registry.startDeviceAuth();
    spinner.stop();

    // Display instructions to user
    console.log();
    console.log(chalk.bold('  To authenticate, please:'));
    console.log();
    console.log(`  1. Visit: ${chalk.cyan(deviceAuth.verificationUrl)}`);
    console.log(`  2. Enter code: ${chalk.yellow.bold(deviceAuth.userCode)}`);
    console.log();
    console.log(chalk.dim(`  This code expires in ${Math.floor(deviceAuth.expiresIn / 60)} minutes`));
    console.log();

    // Poll for authorization
    spinner.start('Waiting for authorization...');

    const pollInterval = (deviceAuth.interval || 5) * 1000; // Convert to ms
    const maxAttempts = Math.ceil(deviceAuth.expiresIn / (pollInterval / 1000));

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await sleep(pollInterval);

      try {
        const result = await registry.pollDeviceAuth(deviceAuth.deviceCode);

        if (result) {
          // Authorization complete - save credentials
          config.authToken = result.accessToken;
          config.authExpiresAt = result.expiresAt;
          config.publisherUsername = result.publisher.username;
          saveConfig(config);

          spinner.succeed(`Authenticated as ${chalk.green(result.publisher.displayName)} (${chalk.cyan('@' + result.publisher.username)})`);
          console.log();
          console.log(chalk.dim('You can now publish triks with `trik publish`'));
          return;
        }
        // Still pending, continue polling
      } catch (error) {
        if (error instanceof Error) {
          if (error.message.includes('expired')) {
            spinner.fail('Authorization expired');
            console.log(chalk.dim('Please run `trik login` again'));
            process.exit(1);
          }
          if (error.message.includes('denied') || error.message.includes('access_denied')) {
            spinner.fail('Authorization denied');
            process.exit(1);
          }
        }
        throw error;
      }
    }

    spinner.fail('Authorization timeout');
    console.log(chalk.dim('Please run `trik login` again'));
    process.exit(1);
  } catch (error) {
    spinner.fail('Authentication failed');
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}

/**
 * trik logout command
 *
 * Removes saved authentication credentials.
 */
export async function logoutCommand(): Promise<void> {
  const config = loadConfig();

  if (!config.authToken) {
    console.log(chalk.yellow('Not logged in'));
    return;
  }

  const username = config.publisherUsername;

  // Try to invalidate session on server
  try {
    const registry = new RegistryClient();
    await registry.logout();
  } catch {
    // Ignore errors - we'll clear local credentials anyway
  }

  // Clear local credentials
  delete config.authToken;
  delete config.authExpiresAt;
  delete config.publisherUsername;
  saveConfig(config);

  console.log(chalk.green(`Logged out${username ? ` from @${username}` : ''}`));
}

/**
 * trik whoami command
 *
 * Shows the current authenticated user.
 */
export async function whoamiCommand(): Promise<void> {
  const config = loadConfig();

  if (!config.authToken) {
    console.log(chalk.yellow('Not logged in'));
    console.log(chalk.dim('Run `trik login` to authenticate'));
    return;
  }

  // Check if token is expired
  if (config.authExpiresAt && new Date(config.authExpiresAt) < new Date()) {
    console.log(chalk.yellow('Session expired'));
    console.log(chalk.dim('Run `trik login` to re-authenticate'));
    return;
  }

  const spinner = ora('Fetching user info...').start();

  try {
    const registry = new RegistryClient();
    const user = await registry.getCurrentUser();

    spinner.stop();
    console.log();
    console.log(`  ${chalk.bold(user.displayName)}`);
    console.log(`  ${chalk.cyan('@' + user.username)}`);
    if (user.verified) {
      console.log(`  ${chalk.green('✓')} Verified publisher`);
    }
    console.log();
  } catch (error) {
    spinner.fail('Failed to fetch user info');
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
