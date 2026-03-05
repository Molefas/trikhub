import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { BaseMessage } from '@langchain/core/messages';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import {
  TrikGateway,
  type TrikGatewayConfig,
  type LoadFromConfigOptions,
  type HandoffToolDefinition,
} from '../gateway.js';
import { jsonSchemaToZod } from './schema-converter.js';

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
  /** Enable debug logging for handoff events */
  debug?: boolean;
  /** Enable verbose logging — dumps full message history on each agent invocation */
  verbose?: boolean;
  /**
   * Factory to create the main agent with trik tools included.
   * Called on startup and whenever triks are loaded/unloaded at runtime.
   * Receives the current trik tools (handoff + exposed) as DynamicStructuredTools.
   *
   * When provided, enhance() owns agent lifecycle — the agent passed as first arg is ignored.
   *
   * @example
   * ```typescript
   * const app = await enhance(null, {
   *   gatewayInstance: gateway,
   *   createAgent: (trikTools) => createReactAgent({
   *     llm: model,
   *     tools: [...myTools, ...trikTools],
   *     messageModifier: systemPrompt,
   *   }),
   * });
   * ```
   */
  createAgent?: (trikTools: DynamicStructuredTool[]) => InvokableAgent;
}

/**
 * Response from the enhanced agent.
 */
export interface EnhancedResponse {
  /** The message to show the user */
  message: string;
  /** Where the response came from: "main", a trik ID, or "system" */
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
// Event-Based Debug Logging
// ============================================================================

function subscribeDebugLogging(gateway: TrikGateway, verbose: boolean): void {
  gateway.on('handoff:start', ({ trikId, trikName }) => {
    console.log(`\x1b[36m[trikhub]\x1b[0m Handoff → ${trikName} (${trikId})`);
  });

  gateway.on('handoff:container_start', ({ trikName }) => {
    console.log(`\x1b[36m[trikhub]\x1b[0m Starting container for ${trikName}...`);
  });

  gateway.on('handoff:thinking', ({ trikName }) => {
    console.log(`\x1b[36m[trikhub]\x1b[0m ${trikName} is thinking...`);
  });

  gateway.on('handoff:message', ({ trikName, direction }) => {
    if (verbose) {
      console.log(`\x1b[35m[trikhub:verbose]\x1b[0m Message ${direction === 'to_trik' ? '→' : '←'} ${trikName}`);
    }
  });

  gateway.on('handoff:transfer_back', ({ trikName, reason }) => {
    console.log(`\x1b[36m[trikhub]\x1b[0m Transfer back from ${trikName} (${reason})`);
  });

  gateway.on('handoff:summary', ({ trikName }) => {
    if (verbose) {
      console.log(`\x1b[35m[trikhub:verbose]\x1b[0m Summary built for ${trikName}`);
    }
  });

  gateway.on('handoff:error', ({ trikName, error }) => {
    console.log(`\x1b[36m[trikhub]\x1b[0m Error in ${trikName}: ${error}`);
  });
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
 * **Recommended usage** — pass `createAgent` to get dynamic tool refresh when triks
 * are installed/uninstalled at runtime:
 *
 * @example
 * ```typescript
 * import { createReactAgent } from '@langchain/langgraph/prebuilt';
 * import { enhance } from '@trikhub/gateway/langchain';
 *
 * const gateway = new TrikGateway();
 * await gateway.initialize();
 * await gateway.loadTriksFromConfig();
 *
 * const app = await enhance(null, {
 *   gatewayInstance: gateway,
 *   createAgent: (trikTools) => createReactAgent({
 *     llm: model,
 *     tools: [...myTools, ...trikTools],
 *     messageModifier: systemPrompt,
 *   }),
 * });
 *
 * const response = await app.processMessage("find me AI articles");
 * ```
 */
export async function enhance(
  agent: InvokableAgent | null,
  options: EnhanceOptions = {}
): Promise<EnhancedAgent> {
  // Set up gateway
  const gateway = options.gatewayInstance ?? new TrikGateway(options.gateway);
  await gateway.initialize();

  if (options.debug || options.verbose) {
    subscribeDebugLogging(gateway, options.verbose ?? false);
  }

  // Load triks from config (skip if a pre-built gateway was provided — caller already loaded triks)
  if (!options.gatewayInstance) {
    await gateway.loadTriksFromConfig(options.config);
  }

  // Mutable agent reference — updated when triks change (if createAgent is provided)
  let currentAgent: InvokableAgent;

  if (options.createAgent) {
    // Factory mode: enhance() owns agent lifecycle
    const rebuildAgent = () => {
      const trikTools = [
        ...buildHandoffTools(gateway.getHandoffTools()),
        ...buildExposedTools(gateway),
      ];
      currentAgent = options.createAgent!(trikTools);
    };

    // Build initial agent with current tools
    rebuildAgent();

    // Rebuild automatically when triks change
    gateway.on('trik:loaded', () => rebuildAgent());
    gateway.on('trik:unloaded', () => rebuildAgent());
  } else if (agent) {
    // Legacy mode: caller manages agent, no dynamic refresh
    currentAgent = agent;
  } else {
    throw new Error('enhance() requires either a createAgent factory or a pre-built agent');
  }

  // Per-session message history for the main agent
  const mainMessages = new Map<string, BaseMessage[]>();

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
          return {
            message: route.response.message,
            source: route.trikId,
          };
        }

        case 'transfer_back': {
          injectSummaryIntoHistory(mainMessages, sessionId, route.summary);
          // If the trik provided a farewell message, show it; otherwise show a system message
          if (route.message.trim()) {
            return {
              message: route.message,
              source: route.trikId,
            };
          }
          return {
            message: '[Returned to main agent]',
            source: 'system',
          };
        }

        case 'force_back': {
          injectSummaryIntoHistory(mainMessages, sessionId, route.summary);
          return {
            message: '[Returned to main agent]',
            source: 'system',
          };
        }

        case 'main': {
          return await invokeMainAgent(
            currentAgent,
            gateway,
            mainMessages,
            sessionId,
            message,
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
): Promise<EnhancedResponse> {
  // Get or create session message history
  let messages = mainMessages.get(sessionId);
  if (!messages) {
    messages = [];
    mainMessages.set(sessionId, messages);
  }

  // Add user message
  messages.push(new HumanMessage(message));

  // Invoke agent
  const result = await agent.invoke({ messages });
  const newMessages = result.messages;

  // Check for handoff tool calls in the response
  const handoffCall = findHandoffToolCall(newMessages, messages.length - 1);

  if (handoffCall) {
    const trikId = handoffCall.toolName.slice(HANDOFF_TOOL_PREFIX.length);
    const context = handoffCall.context;

    const handoffResult = await gateway.startHandoff(trikId, context, sessionId);

    if (handoffResult.target === 'transfer_back') {
      mainMessages.set(sessionId, newMessages);
      injectSummaryIntoHistory(mainMessages, sessionId, handoffResult.summary);
      return {
        message: handoffResult.message,
        source: handoffResult.trikId,
      };
    }

    mainMessages.set(sessionId, newMessages);
    return {
      message: handoffResult.response.message,
      source: handoffResult.trikId,
    };
  }

  // No handoff — normal main agent response
  mainMessages.set(sessionId, newMessages);

  const responseText = extractLastAIMessage(newMessages);
  return {
    message: responseText,
    source: 'main',
  };
}

/**
 * Inject a handoff session summary into the main agent's message history
 * so it has context for future turns, without invoking the main agent.
 */
function injectSummaryIntoHistory(
  mainMessages: Map<string, BaseMessage[]>,
  sessionId: string,
  summary: string,
): void {
  let messages = mainMessages.get(sessionId);
  if (!messages) {
    messages = [];
    mainMessages.set(sessionId, messages);
  }

  messages.push(new HumanMessage(
    `[System: Trik handoff completed. Session summary:\n${summary}]`
  ));
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
// Exposed Tool Building (tool-mode triks)
// ============================================================================

/**
 * Convert gateway ExposedToolDefinitions into LangChain DynamicStructuredTools.
 * These tools call gateway.executeExposedTool() which returns a template-filled string.
 */
function buildExposedTools(gateway: TrikGateway): DynamicStructuredTool[] {
  const definitions = gateway.getExposedTools();

  return definitions.map((def) =>
    new DynamicStructuredTool({
      name: def.toolName,
      description: def.description,
      schema: jsonSchemaToZod(def.inputSchema) as z.ZodObject<z.ZodRawShape>,
      func: async (input: Record<string, unknown>) => {
        return await gateway.executeExposedTool(def.trikId, def.toolName, input);
      },
    })
  );
}

/**
 * Get exposed tools from tool-mode triks as an array for binding to agents.
 * These appear as native tools on the main agent (no handoff, no session).
 */
export function getExposedToolsForAgent(gateway: TrikGateway): DynamicStructuredTool[] {
  return buildExposedTools(gateway);
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
 * Check if a message is an AI message using duck typing.
 * Avoids instanceof failures when multiple copies of @langchain/core exist.
 */
function isAIMessage(msg: BaseMessage): boolean {
  return msg._getType() === 'ai';
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
    if (!isAIMessage(msg)) continue;

    const toolCalls = (msg as AIMessage).tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      for (const tc of toolCalls) {
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
 * Extract text from message content, handling both string and array-of-blocks formats.
 */
function extractTextContent(content: string | Array<Record<string, unknown>>): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((block): block is { type: 'text'; text: string } =>
        typeof block === 'object' && block !== null && block.type === 'text' && typeof block.text === 'string'
      )
      .map((block) => block.text)
      .join('');
  }
  return '';
}

/**
 * Extract the text content from the last AI message in a message list.
 * Uses duck typing to avoid instanceof issues with duplicate @langchain/core packages.
 */
function extractLastAIMessage(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!isAIMessage(msg)) continue;

    const text = extractTextContent(msg.content as string | Array<Record<string, unknown>>);
    if (text.length > 0) return text;
  }
  return '';
}
