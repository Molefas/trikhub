import { HumanMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { Serialized } from '@langchain/core/load/serializable';
import type { TrikAgent, TrikContext, TrikResponse, TrikProgressEvent } from '@trikhub/manifest';
import { extractToolInfo } from './interceptor.js';
import { getActiveWorkspaceToolNames } from './workspace-tools.js';
import { getActiveRegistryToolNames } from './registry-tools.js';

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
 * LangGraph callback handler that bridges tool execution events
 * to the TrikContext.onProgress callback.
 */
class ProgressCallbackHandler extends BaseCallbackHandler {
  name = 'TrikProgressHandler';
  private activeTools = new Map<string, string>();

  constructor(private onProgress: (event: TrikProgressEvent) => void) {
    super();
  }

  handleToolStart(
    tool: Serialized,
    _input: string,
    runId: string,
    _parentRunId?: string,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
    runName?: string,
  ): void {
    const toolName = runName || ('id' in tool ? tool.id[tool.id.length - 1] : 'unknown');
    this.activeTools.set(runId, toolName);
    this.onProgress({ type: 'tool_start', toolName });
  }

  handleToolEnd(output: unknown, runId: string): void {
    const toolName = this.activeTools.get(runId) || '';
    this.activeTools.delete(runId);
    this.onProgress({ type: 'tool_end', toolName });
  }

  handleToolError(_err: Error, runId: string): void {
    const toolName = this.activeTools.get(runId) || '';
    this.activeTools.delete(runId);
    this.onProgress({ type: 'tool_error', toolName });
  }
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

      // Determine which internal tools are active (for output filtering)
      const workspaceToolNames = getActiveWorkspaceToolNames(context.capabilities);
      const registryToolNames = getActiveRegistryToolNames(context.capabilities);

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

      // Invoke the LangGraph agent (with progress callbacks if available)
      const config = context.onProgress
        ? { callbacks: [new ProgressCallbackHandler(context.onProgress)] }
        : undefined;
      const result = await resolvedAgent.invoke({ messages }, config);

      // Store the full updated message history
      sessionMessages.set(context.sessionId, result.messages);

      // Extract tool calls and transfer-back signal from new messages only
      const { toolCalls, transferBack, responseMessage } = extractToolInfo(
        result.messages,
        startIndex
      );

      // Filter out internal tool calls from the output (workspace + registry)
      const internalToolNames = new Set([...workspaceToolNames, ...registryToolNames]);
      const filteredToolCalls = internalToolNames.size > 0
        ? toolCalls.filter((tc) => !internalToolNames.has(tc.tool))
        : toolCalls;

      return {
        message: responseMessage,
        transferBack,
        toolCalls: filteredToolCalls.length > 0 ? filteredToolCalls : undefined,
      };
    },
  };
}
