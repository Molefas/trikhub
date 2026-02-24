import type { FastifyInstance } from 'fastify';
import type { TrikGateway } from '@trikhub/gateway';

interface MessageRequest {
  message: string;
  sessionId: string;
}

interface BackRequest {
  sessionId: string;
}

export async function messageRoutes(fastify: FastifyInstance, gateway: TrikGateway): Promise<void> {
  // POST /api/v1/message — Route a user message through the gateway
  fastify.post<{ Body: MessageRequest }>(
    '/api/v1/message',
    {
      schema: {
        tags: ['messages'],
        summary: 'Send a message',
        description: 'Routes a user message through the handoff gateway. Returns the route result.',
        body: {
          type: 'object',
          required: ['message', 'sessionId'],
          properties: {
            message: { type: 'string', description: 'The user message to route' },
            sessionId: { type: 'string', description: 'Session identifier' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              target: { type: 'string', enum: ['main', 'trik', 'transfer_back', 'force_back'] },
              trikId: { type: 'string' },
              response: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  transferBack: { type: 'boolean' },
                },
              },
              summary: { type: 'string' },
              sessionId: { type: 'string' },
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
    async (request, reply) => {
      const { message, sessionId } = request.body;

      try {
        // Check if this is a handoff initiation (talk_to_ prefix from main agent)
        if (message.startsWith('talk_to_')) {
          const trikId = message.replace('talk_to_', '').split(' ')[0];
          const context = message.slice(message.indexOf(' ') + 1) || 'User wants to interact';
          const result = await gateway.startHandoff(trikId, context, sessionId);
          return result;
        }

        const result = await gateway.routeMessage(message, sessionId);
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return reply.status(500).send({
          target: 'main',
          error: errorMessage,
        });
      }
    }
  );

  // POST /api/v1/back — Force transfer-back
  fastify.post<{ Body: BackRequest }>(
    '/api/v1/back',
    {
      schema: {
        tags: ['messages'],
        summary: 'Force transfer back',
        description: 'Forces a transfer-back from the current handoff, if any.',
        body: {
          type: 'object',
          required: ['sessionId'],
          properties: {
            sessionId: { type: 'string', description: 'Session identifier' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              target: { type: 'string' },
              trikId: { type: 'string' },
              summary: { type: 'string' },
              sessionId: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request) => {
      const { sessionId } = request.body;
      const activeHandoff = gateway.getActiveHandoff();

      if (!activeHandoff) {
        return { target: 'none', message: 'No active handoff' };
      }

      const result = await gateway.routeMessage('/back', sessionId);
      return result;
    }
  );

  // GET /api/v1/session — Get current handoff state
  fastify.get(
    '/api/v1/session',
    {
      schema: {
        tags: ['messages'],
        summary: 'Get session state',
        description: 'Returns the current active handoff state, if any.',
        response: {
          200: {
            type: 'object',
            properties: {
              activeHandoff: {
                type: ['object', 'null'],
                properties: {
                  trikId: { type: 'string' },
                  sessionId: { type: 'string' },
                  turnCount: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
    async () => {
      const activeHandoff = gateway.getActiveHandoff();
      return { activeHandoff };
    }
  );
}
