import Fastify, { type FastifyInstance } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUI from '@fastify/swagger-ui';
import { createRequire } from 'module';
import type { TrikGateway } from '@trikhub/gateway';
import type { ServerConfig } from './config.js';
import { healthRoutes } from './routes/health.js';
import { toolsRoutes } from './routes/tools.js';
import { executeRoutes } from './routes/execute.js';
import { contentRoutes } from './routes/content.js';
import { triksRoutes } from './routes/triks.js';

// Read version from package.json
const require = createRequire(import.meta.url);
const pkg = require('../package.json');

export async function createServer(config: ServerConfig, gateway: TrikGateway): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      level: config.logLevel,
    },
  });

  // Register OpenAPI documentation
  await fastify.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Trik Gateway API',
        description: 'HTTP API for executing triks with prompt injection protection',
        version: pkg.version,
      },
      servers: [
        {
          url: `http://localhost:${config.port}`,
          description: 'Local server',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            description: 'Bearer token authentication',
          },
        },
      },
      security: config.authToken ? [{ bearerAuth: [] }] : [],
      tags: [
        { name: 'health', description: 'Health check endpoints' },
        { name: 'tools', description: 'Tool discovery endpoints' },
        { name: 'execute', description: 'Trik execution endpoints' },
        { name: 'content', description: 'Passthrough content delivery' },
        { name: 'triks', description: 'Trik package management' },
      ],
    },
  });

  await fastify.register(fastifySwaggerUI, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  // Optional auth middleware
  if (config.authToken) {
    fastify.addHook('onRequest', async (request, reply) => {
      // Skip auth for health and docs endpoints
      if (request.url === '/api/v1/health' || request.url.startsWith('/docs')) return;

      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({
          success: false,
          code: 'UNAUTHORIZED',
          error: 'Missing or invalid authorization header',
        });
      }

      const token = authHeader.slice(7);
      if (token !== config.authToken) {
        return reply.status(403).send({
          success: false,
          code: 'FORBIDDEN',
          error: 'Invalid token',
        });
      }
    });
  }

  // Register routes
  await healthRoutes(fastify, gateway);
  await toolsRoutes(fastify, gateway);
  await executeRoutes(fastify, gateway);
  await contentRoutes(fastify, gateway);
  await triksRoutes(fastify, gateway, config.configPath, config.baseDir);

  return fastify;
}
