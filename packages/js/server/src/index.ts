import { loadConfig } from './config.js';
import { SkillLoader } from './services/skill-loader.js';
import { createServer } from './server.js';
import type { FastifyInstance } from 'fastify';

let server: FastifyInstance | null = null;
let isShuttingDown = false;

async function shutdown(signal: string) {
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

async function main() {
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

  // Load secrets from .trikhub/secrets.json
  const configStore = gateway.getConfigStore();
  await configStore.load();

  // Log which triks have secrets configured
  const configuredTriks = configStore.getConfiguredTriks();
  console.log('[Secrets] Loaded secrets for triks:', configuredTriks.length > 0 ? configuredTriks : 'none');

  server = await createServer(config, gateway);
  const log = server.log;

  log.info(
    {
      skillsDirectory: config.skillsDirectory,
      configPath: config.configPath,
      lintOnLoad: config.lintOnLoad,
      auth: config.authToken ? 'enabled' : 'disabled',
    },
    'Starting skill-server'
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
    console.error('[skill-server] Fatal error:', err);
  }
  process.exit(1);
});
