import { HumanMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { TrikAgent, TrikContext, TrikResponse } from '@trikhub/manifest';
import { extractToolInfo } from './interceptor.js';

/**
 * Any agent with a LangGraph-compatible invoke method.
 * Works with createReactAgent, custom StateGraphs, or any object implementing invoke().
 */
export interface InvokableAgent {
  invoke(
    input: { messages: BaseMessage[] },
    config?: unknown
  ): Promise<{ messages: BaseMessage[] }>;
}

/**
 * Factory function that creates an agent from TrikContext.
 * Use this when your agent needs config values (e.g., API keys) at creation time.
 */
export type AgentFactory = (
  context: TrikContext
) => InvokableAgent | Promise<InvokableAgent>;

export interface WrapAgentOptions {
  // Reserved for future options (domain prompting, etc.)
}

function isInvokable(obj: unknown): obj is InvokableAgent {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'invoke' in obj &&
    typeof (obj as Record<string, unknown>).invoke === 'function'
  );
}

/**
 * Wrap a LangGraph agent (or factory) into a TrikAgent.
 *
 * Handles:
 * 1. Message history management across turns within a session
 * 2. Tool call extraction from LangGraph messages → ToolCallRecord[]
 * 3. transfer_back detection → sets transferBack flag
 *
 * @param agentOrFactory - A pre-built agent with invoke(), or a factory (context) => agent
 * @param options - Reserved for future use
 *
 * @example
 * // Pattern 1: Pre-built agent
 * const agent = createReactAgent({ llm, tools: [...myTools, transferBackTool] });
 * export default wrapAgent(agent);
 *
 * @example
 * // Pattern 2: Factory (when you need config at runtime)
 * export default wrapAgent(async (context) => {
 *   const llm = new ChatAnthropic({ apiKey: context.config.get("ANTHROPIC_API_KEY") });
 *   return createReactAgent({ llm, tools: [...myTools, transferBackTool] });
 * });
 */
export function wrapAgent(
  agentOrFactory: InvokableAgent | AgentFactory,
  _options?: WrapAgentOptions
): TrikAgent {
  let resolvedAgent: InvokableAgent | null = isInvokable(agentOrFactory)
    ? agentOrFactory
    : null;

  // Per-session message history
  const sessionMessages = new Map<string, BaseMessage[]>();

  return {
    async processMessage(
      message: string,
      context: TrikContext
    ): Promise<TrikResponse> {
      // Lazy init for factory pattern (created once, reused across sessions)
      if (!resolvedAgent) {
        resolvedAgent = await (agentOrFactory as AgentFactory)(context);
      }

      // Get or create session message history
      let messages = sessionMessages.get(context.sessionId);
      if (!messages) {
        messages = [];
        sessionMessages.set(context.sessionId, messages);
      }

      // Record where new messages start (for extracting this turn's tool calls)
      const startIndex = messages.length;

      // Add user message
      messages.push(new HumanMessage(message));

      // Invoke the LangGraph agent
      const result = await resolvedAgent.invoke({ messages });

      // Store the full updated message history
      sessionMessages.set(context.sessionId, result.messages);

      // Extract tool calls and transfer-back signal from new messages only
      const { toolCalls, transferBack, responseMessage } = extractToolInfo(
        result.messages,
        startIndex
      );

      return {
        message: responseMessage,
        transferBack,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    },
  };
}
