import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/** The name of the transfer-back tool, used for detection in message history */
export const TRANSFER_BACK_TOOL_NAME = 'transfer_back';

/**
 * A LangChain tool that signals a transfer back to the main agent.
 * Include this in your agent's tool set so the LLM can decide when to hand back.
 */
export const transferBackTool = tool(
  async (_input) => {
    return 'Transferring back to main agent.';
  },
  {
    name: TRANSFER_BACK_TOOL_NAME,
    description:
      "Transfer the conversation back to the main agent. Use when the user's request is outside your domain or when they're done with your capabilities.",
    schema: z.object({
      reason: z
        .string()
        .optional()
        .describe('Brief reason for transferring back'),
    }),
  }
);
