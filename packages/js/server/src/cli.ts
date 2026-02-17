#!/usr/bin/env node
import { createRequire } from 'node:module';
import { loadConfig } from './config.js';
import { SkillLoader } from './services/skill-loader.js';
import { createServer } from './server.js';
import type { FastifyInstance } from 'fastify';

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
  POST /api/v1/execute     Execute a skill action
  GET  /api/v1/content/:ref  Retrieve passthrough content
  GET  /docs               Swagger UI documentation
`);
}

function printVersion(): void {
  console.log(`trik-server v${pkg.version}`);
}

let server: FastifyInstance | null = null;
let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  if (server) {
    server.log.info({ signal }, 'Received shutdown signal, closing server...');
    try {
      await server.close();
      server.log.info('Server closed gracefully');
    } catch (err) {
      server.log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  }
  process.exit(0);
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

  const config = loadConfig();

  // Initialize skill loader
  const skillLoader = new SkillLoader({
    skillsDirectory: config.skillsDirectory,
    configPath: config.configPath,
    lintBeforeLoad: config.lintOnLoad,
    lintWarningsAsErrors: config.lintWarningsAsErrors,
    allowedSkills: config.allowedSkills,
  });

  // Create server first so we can use its logger
  const gateway = skillLoader.getGateway();
  server = await createServer(config, gateway);
  const log = server.log;

  log.info(
    {
      skillsDirectory: config.skillsDirectory,
      configPath: config.configPath || '(none)',
      lintOnLoad: config.lintOnLoad,
      auth: config.authToken ? 'enabled' : 'disabled',
    },
    'Starting trik-server'
  );

  // Load skills at startup
  log.info('Discovering skills...');
  const loadResult = await skillLoader.discoverAndLoad();

  log.info({ loaded: loadResult.loaded, failed: loadResult.failed }, 'Skills discovery complete');
  for (const skill of loadResult.skills) {
    if (skill.status === 'loaded') {
      log.info({ skillId: skill.skillId }, 'Skill loaded');
    } else {
      log.warn({ skillId: skill.skillId, path: skill.path, error: skill.error }, 'Skill failed to load');
    }
  }

  // Register shutdown handlers
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Start listening
  await server.listen({ port: config.port, host: config.host });
  log.info({ url: `http://${config.host}:${config.port}` }, 'Server listening');
}

main().catch((err) => {
  if (server) {
    server.log.fatal({ err }, 'Fatal error');
  } else {
    console.error('[trik-server] Fatal error:', err);
  }
  process.exit(1);
});
