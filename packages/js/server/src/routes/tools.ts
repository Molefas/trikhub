import type { FastifyInstance } from 'fastify';
import type { TrikGateway, ToolDefinition, TrikInfo } from '@trikhub/gateway';

interface ToolsResponse {
  tools: ToolDefinition[];
  triks: TrikInfo[];
}

const toolDefinitionSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Tool name in format trikId:actionName' },
    description: { type: 'string' },
    inputSchema: { type: 'object', additionalProperties: true, description: 'JSON Schema for tool input' },
    responseMode: { type: 'string', enum: ['template', 'passthrough'] },
  },
} as const;

const trikInfoSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    sessionEnabled: { type: 'boolean' },
    tools: { type: 'array', items: toolDefinitionSchema },
  },
} as const;

const toolsResponseSchema = {
  type: 'object',
  properties: {
    tools: { type: 'array', items: toolDefinitionSchema },
    triks: { type: 'array', items: trikInfoSchema },
  },
} as const;

export async function toolsRoutes(fastify: FastifyInstance, gateway: TrikGateway): Promise<void> {
  fastify.get<{ Reply: ToolsResponse }>(
    '/api/v1/tools',
    {
      schema: {
        tags: ['tools'],
        summary: 'List available tools',
        description: 'Returns all available tools and triks loaded in the gateway',
        response: {
          200: toolsResponseSchema,
        },
      },
    },
    async () => {
      const tools = gateway.getToolDefinitions();
      const triks = gateway.getAvailableTriks();

      return { tools, triks };
    }
  );
}
