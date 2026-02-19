#!/usr/bin/env node
/**
 * CLI entry point for trik-server
 *
 * This is a thin wrapper around TrikServer that:
 * - Parses command line arguments
 * - Loads configuration from environment variables
 * - Starts the server with signal handlers
 */

import { createRequire } from 'node:module';
import { TrikServer } from './trik-server.js';
import { loadConfig } from './config.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

function printHelp(): void {
  console.log(`
trik-server v${pkg.version} - HTTP server for TrikHub skill execution

Usage: trik-server [options]

Options:
  --help, -h           Show this help message
  --version, -v        Show version number

Environment Variables:
  PORT                 Server port (default: 3000)
  HOST                 Server host (default: 0.0.0.0)
  SKILLS_DIR           Directory containing skills (default: ./skills)
  CONFIG_PATH          Path to .trikhub/config.json for npm-based skills
  BASE_DIR             Base directory for resolving node_modules (default: dirname of CONFIG_PATH)
  AUTH_TOKEN           Bearer token for authentication (optional)
  LOG_LEVEL            Log level: debug, info, warn, error (default: info)
  LINT_ON_LOAD         Lint skills before loading: true/false (default: true)
  LINT_WARNINGS_AS_ERRORS  Treat lint warnings as errors (default: false)
  ALLOWED_SKILLS       Comma-separated list of allowed skill IDs (optional)

Examples:
  # Start with default settings
  trik-server

  # Start with custom port and skills directory
  PORT=8080 SKILLS_DIR=/path/to/skills trik-server

  # Start with authentication
  AUTH_TOKEN=my-secret-token trik-server

API Endpoints:
  GET  /api/v1/health      Health check
  GET  /api/v1/tools       List available tools
  GET  /api/v1/triks       List installed triks
  POST /api/v1/execute     Execute a skill action
  GET  /api/v1/content/:ref  Retrieve passthrough content
  GET  /docs               Swagger UI documentation
`);
}

function printVersion(): void {
  console.log(`trik-server v${pkg.version}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    printVersion();
    process.exit(0);
  }

  // Load config from environment variables
  const config = loadConfig();

  // Create server with config
  const server = new TrikServer({
    port: config.port,
    host: config.host,
    configPath: config.configPath,
    baseDir: config.baseDir,
    skillsDirectory: config.skillsDirectory,
    authToken: config.authToken,
    logLevel: config.logLevel,
    lintOnLoad: config.lintOnLoad,
    lintWarningsAsErrors: config.lintWarningsAsErrors,
    allowedSkills: config.allowedSkills,
  });

  // Register signal handlers for graceful shutdown
  server.registerSignalHandlers();

  // Initialize and start
  await server.run();
}

main().catch((err) => {
  console.error('[trik-server] Fatal error:', err);
  process.exit(1);
});
