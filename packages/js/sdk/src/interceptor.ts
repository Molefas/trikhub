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

// ============================================================================
// Duck-typed message checks (avoids instanceof failures across packages)
// ============================================================================

function isToolMessage(msg: BaseMessage): boolean {
  return msg._getType() === 'tool';
}

function isAIMessage(msg: BaseMessage): boolean {
  return msg._getType() === 'ai';
}

/**
 * Extract tool call records and transfer-back signal from LangGraph message history.
 *
 * Uses duck typing (_getType()) instead of instanceof to handle cases where
 * the trik's @langchain/core is a different package instance than the SDK's.
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
    if (isToolMessage(msg)) {
      const toolCallId = (msg as unknown as { tool_call_id: string }).tool_call_id;
      const content =
        typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content);
      toolResults.set(toolCallId, content);
    }
  }

  // Extract tool calls from AI messages and capture the final response
  for (let i = startIndex; i < messages.length; i++) {
    const msg = messages[i];
    if (!isAIMessage(msg)) continue;

    // Process tool calls if present
    const toolCallsArr = (msg as unknown as { tool_calls?: Array<{ id?: string; name: string; args?: Record<string, unknown> }> }).tool_calls;
    if (toolCallsArr && toolCallsArr.length > 0) {
      for (const tc of toolCallsArr) {
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
    const text = extractTextContent(msg.content);
    if (text.length > 0) {
      responseMessage = text;
    }
  }

  return { toolCalls, transferBack, responseMessage };
}

/**
 * Extract text from message content, handling both string and array-of-blocks formats.
 */
function extractTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter(
        (block): block is { type: 'text'; text: string } =>
          typeof block === 'object' &&
          block !== null &&
          block.type === 'text' &&
          typeof block.text === 'string'
      )
      .map((block) => block.text)
      .join('');
  }
  return '';
}
