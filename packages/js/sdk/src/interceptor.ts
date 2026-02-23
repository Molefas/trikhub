import { AIMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { ToolCallRecord } from '@trikhub/manifest';
import { TRANSFER_BACK_TOOL_NAME } from './transfer-back.js';

/**
 * Result of extracting tool call information from LangGraph messages.
 */
export interface ExtractedToolInfo {
  /** Tool calls made by the agent (excluding transfer_back) */
  toolCalls: ToolCallRecord[];
  /** Whether the agent called transfer_back */
  transferBack: boolean;
  /** The agent's final text response */
  responseMessage: string;
}

/**
 * Extract tool call records and transfer-back signal from LangGraph message history.
 *
 * Parses messages starting from `startIndex` to find:
 * 1. AIMessage tool_calls → matched with ToolMessage results → ToolCallRecord[]
 * 2. Whether transfer_back was called → transferBack flag
 * 3. The last AIMessage text content → responseMessage
 *
 * @param messages - Full message history from agent.invoke()
 * @param startIndex - Index to start scanning from (skip previously processed messages)
 */
export function extractToolInfo(
  messages: BaseMessage[],
  startIndex: number
): ExtractedToolInfo {
  const toolCalls: ToolCallRecord[] = [];
  let transferBack = false;
  let responseMessage = '';

  // Build a map of tool_call_id -> ToolMessage content for result matching
  const toolResults = new Map<string, string>();
  for (let i = startIndex; i < messages.length; i++) {
    const msg = messages[i];
    if (msg instanceof ToolMessage) {
      const content =
        typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content);
      toolResults.set(msg.tool_call_id, content);
    }
  }

  // Extract tool calls from AI messages and capture the final response
  for (let i = startIndex; i < messages.length; i++) {
    const msg = messages[i];
    if (!(msg instanceof AIMessage)) continue;

    // Process tool calls if present
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        if (tc.name === TRANSFER_BACK_TOOL_NAME) {
          transferBack = true;
          continue;
        }

        // Match tool call with its result
        const resultContent = tc.id ? toolResults.get(tc.id) : undefined;
        let output: Record<string, unknown>;
        if (resultContent) {
          try {
            const parsed: unknown = JSON.parse(resultContent);
            output =
              typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
                ? (parsed as Record<string, unknown>)
                : { result: resultContent };
          } catch {
            output = { result: resultContent };
          }
        } else {
          output = {};
        }

        toolCalls.push({
          tool: tc.name,
          input: tc.args ?? {},
          output,
        });
      }
    }

    // Capture text content from AI messages (last one wins)
    const content = msg.content;
    if (typeof content === 'string' && content.length > 0) {
      responseMessage = content;
    }
  }

  return { toolCalls, transferBack, responseMessage };
}
