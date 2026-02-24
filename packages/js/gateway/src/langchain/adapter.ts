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
  /** Enable debug logging for handoff events */
  debug?: boolean;
  /** Enable verbose logging — dumps full message history on each agent invocation */
  verbose?: boolean;
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
// Debug & Verbose Loggers
// ============================================================================

type LogFn = (...args: unknown[]) => void;

function createDebugLogger(enabled: boolean): LogFn {
  if (!enabled) return (..._args: unknown[]) => {};
  return (...args: unknown[]) => {
    console.log('\x1b[36m[trikhub]\x1b[0m', ...args);
  };
}

function createVerboseLogger(enabled: boolean): LogFn {
  if (!enabled) return (..._args: unknown[]) => {};
  return (...args: unknown[]) => {
    console.log('\x1b[35m[trikhub:verbose]\x1b[0m', ...args);
  };
}

/**
 * Dump a message list in a human-readable format.
 */
function dumpMessages(verbose: LogFn, label: string, messages: BaseMessage[]): void {
  verbose(`--- ${label} (${messages.length} messages) ---`);
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const type = msg._getType();
    const text = extractTextContent(msg.content as string | Array<Record<string, unknown>>);
    const truncated = text.length > 200 ? text.slice(0, 200) + '...' : text;

    // Show tool calls if present
    const toolCalls = (msg as AIMessage).tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      const calls = toolCalls.map((tc: { name: string }) => tc.name).join(', ');
      verbose(`  [${i}] ${type}: "${truncated}" [tool_calls: ${calls}]`);
    } else {
      verbose(`  [${i}] ${type}: "${truncated}"`);
    }
  }
  verbose(`--- end ${label} ---`);
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
  const debug = createDebugLogger(options.debug ?? options.verbose ?? false);
  const verbose = createVerboseLogger(options.verbose ?? false);

  // Set up gateway
  const gateway = options.gatewayInstance ?? new TrikGateway(options.gateway);
  await gateway.initialize();

  // Load triks from config (skip if a pre-built gateway was provided — caller already loaded triks)
  if (!options.gatewayInstance) {
    await gateway.loadTriksFromConfig(options.config);
  }

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
          debug(`Routed to trik: ${route.trikId} (turn in progress)`);
          return {
            message: route.response.message,
            source: route.trikId,
          };
        }

        case 'transfer_back': {
          debug(`Transfer back from: ${route.trikId}`);
          debug(`Transfer-back summary:\n${route.summary}`);
          injectSummaryIntoHistory(mainMessages, sessionId, route.summary, debug);
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
          debug(`Force /back from: ${route.trikId}`);
          debug(`Force-back summary:\n${route.summary}`);
          injectSummaryIntoHistory(mainMessages, sessionId, route.summary, debug);
          return {
            message: '[Returned to main agent]',
            source: 'system',
          };
        }

        case 'main': {
          debug('Routing to main agent');
          return await invokeMainAgent(
            agent,
            gateway,
            mainMessages,
            sessionId,
            message,
            handoffTools,
            debug,
            verbose
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
  handoffTools: DynamicStructuredTool[],
  debug: LogFn,
  verbose: LogFn
): Promise<EnhancedResponse> {
  // Get or create session message history
  let messages = mainMessages.get(sessionId);
  if (!messages) {
    messages = [];
    mainMessages.set(sessionId, messages);
  }

  // Add user message
  messages.push(new HumanMessage(message));

  verbose(`Main agent input (session: ${sessionId})`);
  dumpMessages(verbose, 'main agent messages', messages);

  // Invoke agent
  const result = await agent.invoke({ messages });
  const newMessages = result.messages;

  verbose('Main agent output');
  dumpMessages(verbose, 'main agent result', newMessages);

  // Check for handoff tool calls in the response
  const handoffCall = findHandoffToolCall(newMessages, messages.length - 1);

  if (handoffCall) {
    const trikId = handoffCall.toolName.slice(HANDOFF_TOOL_PREFIX.length);
    const context = handoffCall.context;

    debug(`Handoff detected → ${trikId} (context: "${context.slice(0, 80)}${context.length > 80 ? '...' : ''}")`);

    const handoffResult = await gateway.startHandoff(trikId, context, sessionId);

    if (handoffResult.target === 'transfer_back') {
      debug(`Immediate transfer back from: ${trikId}`);
      debug(`Transfer-back summary:\n${handoffResult.summary}`);
      mainMessages.set(sessionId, newMessages);
      injectSummaryIntoHistory(mainMessages, sessionId, handoffResult.summary, debug);
      return {
        message: handoffResult.message,
        source: handoffResult.trikId,
      };
    }

    debug(`Handoff active → ${trikId}`);
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
  debug: LogFn
): void {
  let messages = mainMessages.get(sessionId);
  if (!messages) {
    messages = [];
    mainMessages.set(sessionId, messages);
  }

  messages.push(new HumanMessage(
    `[System: Trik handoff completed. Session summary:\n${summary}]`
  ));

  debug('Injected transfer-back summary into main agent history');
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
