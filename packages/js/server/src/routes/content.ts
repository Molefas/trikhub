import type { FastifyInstance } from 'fastify';
import type { TrikGateway, PassthroughContent, PassthroughDeliveryReceipt } from '@trikhub/gateway';

interface ContentParams {
  ref: string;
}

interface ContentSuccessResponse {
  success: true;
  content: PassthroughContent;
  receipt: PassthroughDeliveryReceipt;
}

interface ContentErrorResponse {
  success: false;
  code: string;
  error: string;
}

type ContentResponse = ContentSuccessResponse | ContentErrorResponse;

const contentParamsSchema = {
  type: 'object',
  required: ['ref'],
  properties: {
    ref: { type: 'string', description: 'Content reference ID from execute response' },
  },
} as const;

const contentSuccessResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', const: true },
    content: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The actual content to display to user' },
        contentType: { type: 'string', description: 'MIME type of the content' },
        metadata: { type: 'object', description: 'Additional metadata about the content' },
      },
    },
    receipt: {
      type: 'object',
      properties: {
        delivered: { type: 'boolean' },
        contentType: { type: 'string' },
        metadata: { type: 'object' },
      },
    },
  },
} as const;

const contentErrorResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', const: false },
    code: { type: 'string' },
    error: { type: 'string' },
  },
} as const;

export async function contentRoutes(fastify: FastifyInstance, gateway: TrikGateway): Promise<void> {
  fastify.get<{ Params: ContentParams; Reply: ContentResponse }>(
    '/api/v1/content/:ref',
    {
      schema: {
        tags: ['content'],
        summary: 'Fetch passthrough content',
        description: 'Retrieves passthrough content by reference. Content is one-time delivery and will be deleted after retrieval.',
        params: contentParamsSchema,
        response: {
          200: contentSuccessResponseSchema,
          404: contentErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { ref } = request.params;

      const result = gateway.deliverContent(ref);

      if (!result) {
        return reply.status(404).send({
          success: false,
          code: 'CONTENT_NOT_FOUND',
          error: 'Content reference not found or expired',
        });
      }

      return {
        success: true,
        content: result.content,
        receipt: result.receipt,
      };
    }
  );
}
