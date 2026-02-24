import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { BaseMessage } from '@langchain/core/messages';
import { AIMessage, ToolMessage, HumanMessage } from '@langchain/core/messages';
import {
  TrikGateway,
  type TrikGatewayConfig,
  type LoadFromConfigOptions,
  type HandoffToolDefinition,
} from '../gateway.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Any agent with a LangGraph-compatible invoke method.
 */
export interface InvokableAgent {
  invoke(
    input: { messages: BaseMessage[] },
    config?: unknown
  ): Promise<{ messages: BaseMessage[] }>;
}

/**
 * Options for enhance().
 */
export interface EnhanceOptions {
  /** Gateway configuration (config store, storage provider, etc.) */
  gateway?: TrikGatewayConfig;
  /** Config file loading options */
  config?: LoadFromConfigOptions;
  /** Pre-built TrikGateway instance (skips creating a new one) */
  gatewayInstance?: TrikGateway;
}

/**
 * Response from the enhanced agent.
 */
export interface EnhancedResponse {
  /** The message to show the user */
  message: string;
  /** Where the response came from: "main" or a trik ID */
  source: string;
}

/**
 * An enhanced agent with handoff routing.
 */
export interface EnhancedAgent {
  /** Process a user message through the routing layer */
  processMessage(message: string, sessionId?: string): Promise<EnhancedResponse>;
  /** Access the underlying gateway */
  gateway: TrikGateway;
  /** Get the list of loaded trik IDs */
  getLoadedTriks(): string[];
}

// ============================================================================
// Handoff Tool Prefix
// ============================================================================

const HANDOFF_TOOL_PREFIX = 'talk_to_';

// ============================================================================
// enhance()
// ============================================================================

/**
 * Wrap a LangGraph agent with handoff routing to triks.
 *
 * This is the main public API for host app developers. It:
 * 1. Creates a TrikGateway and loads triks
 * 2. Generates handoff tools (one per loaded trik) and adds them to the agent
 * 3. Returns an EnhancedAgent that handles the full routing lifecycle
 *
 * @example
 * ```typescript
 * import { createReactAgent } from '@langchain/langgraph/prebuilt';
 * import { enhance } from '@trikhub/gateway/langchain';
 *
 * const myAgent = createReactAgent({ model, tools: myTools });
 * const app = await enhance(myAgent, {
 *   gateway: { triksDirectory: '~/.trikhub/triks' },
 * });
 *
 * const response = await app.processMessage("find me AI articles");
 * // response.message - what to show the user
 * // response.source  - "main" or trik ID
 * ```
 */
export async function enhance(
  agent: InvokableAgent,
  options: EnhanceOptions = {}
): Promise<EnhancedAgent> {
  // Set up gateway
  const gateway = options.gatewayInstance ?? new TrikGateway(options.gateway);
  await gateway.initialize();

  // Load triks from config
  await gateway.loadTriksFromConfig(options.config);

  // Per-session message history for the main agent
  const mainMessages = new Map<string, BaseMessage[]>();

  // Build the handoff tools as LangChain DynamicStructuredTools
  const handoffTools = buildHandoffTools(gateway.getHandoffTools());

  return {
    gateway,

    getLoadedTriks(): string[] {
      return gateway.getLoadedTriks();
    },

    async processMessage(
      message: string,
      sessionId: string = 'default'
    ): Promise<EnhancedResponse> {
      // Route through gateway first
      const route = await gateway.routeMessage(message, sessionId);

      switch (route.target) {
        case 'trik': {
          // Active handoff — trik responded normally
          return {
            message: route.response.message,
            source: route.trikId,
          };
        }

        case 'transfer_back':
        case 'force_back': {
          // Transfer-back — feed summary to main agent so it can respond
          return await invokeMainWithSummary(
            agent,
            mainMessages,
            sessionId,
            route.summary,
            handoffTools
          );
        }

        case 'main': {
          // No active handoff — run main agent
          return await invokeMainAgent(
            agent,
            gateway,
            mainMessages,
            sessionId,
            message,
            handoffTools
          );
        }
      }
    },
  };
}

// ============================================================================
// Main Agent Invocation
// ============================================================================

/**
 * Invoke the main agent with the user's message.
 * If the agent calls a talk_to_X handoff tool, intercept it and start a handoff.
 */
async function invokeMainAgent(
  agent: InvokableAgent,
  gateway: TrikGateway,
  mainMessages: Map<string, BaseMessage[]>,
  sessionId: string,
  message: string,
  handoffTools: DynamicStructuredTool[]
): Promise<EnhancedResponse> {
  // Get or create session message history
  let messages = mainMessages.get(sessionId);
  if (!messages) {
    messages = [];
    mainMessages.set(sessionId, messages);
  }

  // Add user message
  messages.push(new HumanMessage(message));

  // Invoke agent — we need to inject handoff tools into the agent
  // The agent should already have been created with bindTools including handoff tools,
  // but since we can't modify a compiled graph's tools, we add tool definitions
  // and handle tool calls ourselves.
  const result = await agent.invoke({ messages });
  const newMessages = result.messages;

  // Check for handoff tool calls in the response
  const handoffCall = findHandoffToolCall(newMessages, messages.length - 1);

  if (handoffCall) {
    // Intercept the handoff tool call — don't let the agent see the tool result
    // Instead, start a handoff session and route the first message to the trik
    const trikId = handoffCall.toolName.slice(HANDOFF_TOOL_PREFIX.length);
    const context = handoffCall.context;

    const handoffResult = await gateway.startHandoff(trikId, context, sessionId);

    if (handoffResult.target === 'transfer_back') {
      // Trik transferred back immediately — feed summary to main agent
      // Update main messages with what happened
      mainMessages.set(sessionId, newMessages);
      return await invokeMainWithSummary(
        agent,
        mainMessages,
        sessionId,
        handoffResult.summary,
        handoffTools
      );
    }

    // Trik responded — save main agent state and return trik response
    mainMessages.set(sessionId, newMessages);
    return {
      message: handoffResult.response.message,
      source: handoffResult.trikId,
    };
  }

  // No handoff — normal main agent response
  mainMessages.set(sessionId, newMessages);

  // Extract the last AI message text
  const responseText = extractLastAIMessage(newMessages);
  return {
    message: responseText,
    source: 'main',
  };
}

/**
 * Feed a transfer-back summary into the main agent as a system-level context message,
 * so it can craft a response for the user.
 */
async function invokeMainWithSummary(
  agent: InvokableAgent,
  mainMessages: Map<string, BaseMessage[]>,
  sessionId: string,
  summary: string,
  _handoffTools: DynamicStructuredTool[]
): Promise<EnhancedResponse> {
  let messages = mainMessages.get(sessionId);
  if (!messages) {
    messages = [];
    mainMessages.set(sessionId, messages);
  }

  // Add the transfer-back summary as a tool result message
  // This lets the main agent see what the trik accomplished
  messages.push(new HumanMessage(
    `[Trik handoff completed]\n\n${summary}\n\nPlease summarize the result for the user.`
  ));

  const result = await agent.invoke({ messages });
  mainMessages.set(sessionId, result.messages);

  const responseText = extractLastAIMessage(result.messages);
  return {
    message: responseText,
    source: 'main',
  };
}

// ============================================================================
// Handoff Tool Building
// ============================================================================

/**
 * Convert gateway HandoffToolDefinitions into LangChain DynamicStructuredTools.
 * These tools don't actually execute — they're intercepted by enhance().
 */
function buildHandoffTools(definitions: HandoffToolDefinition[]): DynamicStructuredTool[] {
  return definitions.map((def) =>
    new DynamicStructuredTool({
      name: def.name,
      description: def.description,
      schema: z.object({
        context: z.string().describe('Context about what the user needs from this agent'),
      }),
      func: async ({ context }) => {
        // This is a placeholder — the actual handoff is intercepted by enhance()
        // If this ever executes, it means the interception failed
        return `Handoff initiated with context: ${context}`;
      },
    })
  );
}

/**
 * Get handoff tools as an array for binding to agents.
 * Call this after enhance() to get the tools that should be added to your agent.
 */
export function getHandoffToolsForAgent(gateway: TrikGateway): DynamicStructuredTool[] {
  return buildHandoffTools(gateway.getHandoffTools());
}

// ============================================================================
// Message Parsing Helpers
// ============================================================================

interface HandoffToolCall {
  toolName: string;
  context: string;
  toolCallId: string;
}

/**
 * Find a handoff tool call (talk_to_X) in new messages.
 */
function findHandoffToolCall(
  messages: BaseMessage[],
  startIndex: number
): HandoffToolCall | null {
  for (let i = startIndex; i < messages.length; i++) {
    const msg = messages[i];
    if (!(msg instanceof AIMessage)) continue;

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        if (tc.name.startsWith(HANDOFF_TOOL_PREFIX)) {
          return {
            toolName: tc.name,
            context: (tc.args as Record<string, string>).context ?? '',
            toolCallId: tc.id ?? '',
          };
        }
      }
    }
  }
  return null;
}

/**
 * Extract the text content from the last AI message in a message list.
 */
function extractLastAIMessage(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg instanceof AIMessage) {
      const content = msg.content;
      if (typeof content === 'string' && content.length > 0) {
        return content;
      }
    }
  }
  return '';
}
