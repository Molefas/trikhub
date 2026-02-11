import type { FastifyInstance } from 'fastify';
import type { TrikGateway } from '@trikhub/gateway';
import { createRequire } from 'module';

// Read version from package.json
const require = createRequire(import.meta.url);
const pkg = require('../../package.json');

interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  uptime: number;
  triks: {
    loaded: number;
  };
}

const healthResponseSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok', 'degraded', 'error'] },
    version: { type: 'string' },
    uptime: { type: 'number', description: 'Uptime in seconds' },
    triks: {
      type: 'object',
      properties: {
        loaded: { type: 'number' },
      },
    },
  },
} as const;

export async function healthRoutes(fastify: FastifyInstance, gateway: TrikGateway): Promise<void> {
  const startTime = Date.now();

  fastify.get<{ Reply: HealthResponse }>(
    '/api/v1/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Health check',
        description: 'Returns server health status, version, uptime, and loaded trik count',
        response: {
          200: healthResponseSchema,
        },
      },
    },
    async () => {
      const loadedTriks = gateway.getLoadedTriks();

      return {
        status: 'ok',
        version: pkg.version,
        uptime: Math.floor((Date.now() - startTime) / 1000),
        triks: {
          loaded: loadedTriks.length,
        },
      };
    }
  );
}
