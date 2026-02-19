#!/usr/bin/env node

/**
 * TrikHub CLI
 *
 * Command-line interface for managing AI triks.
 */

import { Command } from 'commander';
import { createRequire } from 'module';
import { installCommand } from './commands/install.js';
import { listCommand } from './commands/list.js';
import { searchCommand } from './commands/search.js';
import { infoCommand } from './commands/info.js';
import { uninstallCommand } from './commands/uninstall.js';
import { loginCommand, logoutCommand, whoamiCommand } from './commands/login.js';
import { publishCommand } from './commands/publish.js';
import { unpublishCommand } from './commands/unpublish.js';
import { upgradeCommand, upgradeAllCommand } from './commands/upgrade.js';
import { syncCommand } from './commands/sync.js';
import { initCommand } from './commands/init.js';
import { lintCommand } from './commands/lint.js';

// Read version from package.json
const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const program = new Command();

program
  .name('trik')
  .description('TrikHub CLI - Teaching AI new triks')
  .version(pkg.version)
  .option('--dev', 'Use development registry (localhost:3001)')
  .hook('preAction', () => {
    // Set NODE_ENV before any command runs if --dev flag is passed
    if (program.opts().dev) {
      process.env.NODE_ENV = 'development';
    }
  });

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
  .action(publishCommand);

// Unpublish command
program
  .command('unpublish <trik>')
  .description('Permanently remove a trik from the registry')
  .action(unpublishCommand);

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

// Init command
program
  .command('init <language>')
  .description('Initialize a new trik project (ts or py)')
  .action(initCommand);

// Lint command
program
  .command('lint <path>')
  .description('Validate a trik for security and correctness')
  .option('--warnings-as-errors', 'Treat warnings as errors')
  .option('--skip <rule>', 'Skip a specific rule (can be repeated)', (val, prev: string[]) => [...prev, val], [])
  .action(lintCommand);

// TODO: Add more commands
// program.command('outdated').description('Check for outdated triks');

program.parse();
