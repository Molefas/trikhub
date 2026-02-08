#!/usr/bin/env node

/**
 * TrikHub CLI
 *
 * Command-line interface for managing AI triks.
 */

import { Command } from 'commander';
import { installCommand } from './commands/install.js';
import { listCommand } from './commands/list.js';
import { searchCommand } from './commands/search.js';
import { infoCommand } from './commands/info.js';
import { uninstallCommand } from './commands/uninstall.js';
import { loginCommand, logoutCommand, whoamiCommand } from './commands/login.js';
import { publishCommand } from './commands/publish.js';
import { upgradeCommand, upgradeAllCommand } from './commands/upgrade.js';
import { syncCommand } from './commands/sync.js';

const program = new Command();

program
  .name('trik')
  .description('TrikHub CLI - Teaching AI new triks')
  .version('0.1.0');

// Install command
program
  .command('install <trik>')
  .alias('i')
  .description('Install a trik (e.g., trik install @acme/article-search)')
  .option('-v, --version <version>', 'Install a specific version')
  .action(installCommand);

// Uninstall command
program
  .command('uninstall <trik>')
  .alias('rm')
  .alias('remove')
  .description('Uninstall a trik')
  .action(uninstallCommand);

// List command
program
  .command('list')
  .alias('ls')
  .description('List installed triks')
  .option('-j, --json', 'Output as JSON')
  .action(listCommand);

// Search command
program
  .command('search <query>')
  .alias('s')
  .description('Search for triks in the registry')
  .option('-j, --json', 'Output as JSON')
  .option('-l, --limit <number>', 'Limit results', '10')
  .action(searchCommand);

// Info command
program
  .command('info <trik>')
  .description('Show detailed information about a trik')
  .option('-j, --json', 'Output as JSON')
  .action(infoCommand);

// Login command
program
  .command('login')
  .description('Authenticate with GitHub')
  .action(loginCommand);

// Logout command
program
  .command('logout')
  .description('Remove saved authentication')
  .action(logoutCommand);

// Whoami command
program
  .command('whoami')
  .description('Show current authenticated user')
  .action(whoamiCommand);

// Publish command
program
  .command('publish')
  .description('Publish a trik to the registry')
  .option('-d, --directory <path>', 'Trik directory to publish', '.')
  .option('-t, --tag <version>', 'Version tag (default: from manifest)')
  .option('--skip-release', 'Skip creating GitHub release (for manual upload)')
  .action(publishCommand);

// Upgrade command
program
  .command('upgrade [trik]')
  .alias('up')
  .description('Upgrade an installed trik (or all triks if none specified)')
  .option('-f, --force', 'Force reinstall even if up to date')
  .action(async (trik: string | undefined, options: { force?: boolean }) => {
    if (trik) {
      await upgradeCommand(trik, options);
    } else {
      await upgradeAllCommand(options);
    }
  });

// Sync command (npm-based trik discovery)
program
  .command('sync')
  .description('Discover triks in node_modules and add to config')
  .option('-n, --dry-run', 'Show what would be synced without modifying config')
  .option('-j, --json', 'Output as JSON')
  .action(syncCommand);

// TODO: Add more commands
// program.command('init').description('Initialize a new trik project');
// program.command('outdated').description('Check for outdated triks');

program.parse();
