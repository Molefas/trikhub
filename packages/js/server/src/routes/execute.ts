import type { FastifyInstance } from 'fastify';
import type { TrikGateway, GatewayResultWithSession } from '@trikhub/gateway';

interface ExecuteBody {
  tool: string;
  input: unknown;
  sessionId?: string;
}

// Extended response that includes the resolved template as 'response'
type ExecuteResponse = GatewayResultWithSession & {
  response?: string;
};

const executeBodySchema = {
  type: 'object',
  required: ['tool', 'input'],
  properties: {
    tool: { type: 'string', minLength: 1, description: 'Tool name in format trikId:actionName' },
    input: { type: 'object', description: 'Tool input matching the tool\'s inputSchema' },
    sessionId: { type: 'string', description: 'Optional session ID for multi-turn interactions' },
  },
} as const;

const executeSuccessResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', const: true },
    responseMode: { type: 'string', enum: ['template', 'passthrough'] },
    sessionId: { type: 'string' },
    response: { type: 'string', description: 'Resolved template text (template mode only)' },
    agentData: { type: 'object', description: 'Structured data for the agent (template mode)' },
    templateText: { type: 'string', description: 'Raw template text before resolution' },
    userContentRef: { type: 'string', description: 'Content reference ID (passthrough mode)' },
    contentType: { type: 'string', description: 'Content MIME type (passthrough mode)' },
  },
} as const;

const executeErrorResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', const: false },
    code: { type: 'string', enum: ['TRIK_NOT_FOUND', 'INVALID_INPUT', 'TIMEOUT', 'CLARIFICATION_NEEDED', 'INVALID_OUTPUT', 'EXECUTION_ERROR'] },
    error: { type: 'string' },
  },
} as const;

export async function executeRoutes(fastify: FastifyInstance, gateway: TrikGateway): Promise<void> {
  fastify.post<{ Body: ExecuteBody; Reply: ExecuteResponse }>(
    '/api/v1/execute',
    {
      schema: {
        tags: ['execute'],
        summary: 'Execute a trik action',
        description: 'Executes a trik action with the given input. Returns either template data or a passthrough content reference.',
        body: executeBodySchema,
        response: {
          200: executeSuccessResponseSchema,
          400: executeErrorResponseSchema,
          404: executeErrorResponseSchema,
          408: executeErrorResponseSchema,
          422: executeErrorResponseSchema,
          500: executeErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { tool, input, sessionId } = request.body;

      // Parse tool name: "trikId:actionName" or just "trikId" (uses default action)
      const colonIndex = tool.indexOf(':');
      const trikId = colonIndex > 0 ? tool.slice(0, colonIndex) : tool;
      const actionName = colonIndex > 0 ? tool.slice(colonIndex + 1) : 'default';

      const result = await gateway.execute(trikId, actionName, input, { sessionId });

      // Map error codes to HTTP status codes
      if (!result.success) {
        const statusMap: Record<string, number> = {
          TRIK_NOT_FOUND: 404,
          INVALID_INPUT: 400,
          TIMEOUT: 408,
          CLARIFICATION_NEEDED: 422,
          INVALID_OUTPUT: 500,
          EXECUTION_ERROR: 500,
        };
        const status = statusMap[result.code] || 500;
        return reply.status(status).send(result);
      }

      // For template mode, resolve the template and include as 'response'
      if (result.responseMode === 'template' && result.templateText) {
        const agentData = (result.agentData as Record<string, unknown>) || {};
        const templates = gateway.getActionTemplates(trikId, actionName);
        const templateId = agentData.template as string | undefined;
        const template = templateId && templates?.[templateId];

        const response = template
          ? gateway.resolveTemplate(template, agentData)
          : result.templateText;

        return { ...result, response };
      }

      return result;
    }
  );
}
