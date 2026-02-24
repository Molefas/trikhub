import type { FastifyInstance } from 'fastify';
import type { TrikGateway } from '@trikhub/gateway';

export async function toolsRoutes(fastify: FastifyInstance, gateway: TrikGateway): Promise<void> {
  // GET /api/v1/tools — List handoff tool definitions
  fastify.get(
    '/api/v1/tools',
    {
      schema: {
        tags: ['tools'],
        summary: 'List handoff tools',
        description: 'Returns handoff tool definitions for all loaded triks.',
        response: {
          200: {
            type: 'object',
            properties: {
              handoffTools: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    description: { type: 'string' },
                    inputSchema: { type: 'object' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async () => {
      const handoffTools = gateway.getHandoffTools();
      return { handoffTools };
    }
  );
}
