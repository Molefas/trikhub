/**
 * Tests for wrapAgent auto-injection of workspace tools.
 *
 * Phase 3: Verifies that wrapAgent correctly:
 * - Prepends workspace system prompt when capabilities are present
 * - Filters workspace tool calls from ToolCallRecord output
 * - Works unchanged when no capabilities are present (regression)
 */

import { describe, it, expect } from 'vitest';
import type { TrikContext, TrikCapabilities } from '../../packages/js/manifest/dist/types.js';
import { wrapAgent } from '../../packages/js/sdk/dist/wrap-agent.js';
import { getActiveWorkspaceToolNames } from '../../packages/js/sdk/dist/workspace-tools.js';

// ============================================================================
// Helpers — mock LangChain messages without importing @langchain/core
// ============================================================================

/**
 * Create a minimal mock message that matches LangChain's BaseMessage interface.
 * wrapAgent internally uses HumanMessage/SystemMessage constructors, so we only
 * need mocks for the AI responses our mock agents return.
 */
function mockAIMessage(content: string, toolCalls?: Array<{ name: string; args: Record<string, unknown>; id: string }>) {
  return {
    content,
    _getType: () => 'ai',
    tool_calls: toolCalls ?? [],
  };
}

function makeContext(
  sessionId = 'sess-1',
  capabilities?: TrikCapabilities
): TrikContext {
  return {
    sessionId,
    config: { get: () => undefined, has: () => false, keys: () => [] },
    storage: {
      get: async () => null,
      set: async () => {},
      delete: async () => false,
      list: async () => [],
      getMany: async () => new Map(),
      setMany: async () => {},
    },
    capabilities,
  };
}

const filesystemCaps: TrikCapabilities = {
  filesystem: { enabled: true },
};

const filesystemAndShellCaps: TrikCapabilities = {
  filesystem: { enabled: true },
  shell: { enabled: true, timeoutMs: 5000 },
};

/**
 * Get the message type using LangGraph's _getType() convention.
 */
function getMessageType(msg: unknown): string {
  const m = msg as { _getType?: () => string };
  if (typeof m._getType === 'function') return m._getType();
  return 'unknown';
}

function getMessageContent(msg: unknown): string {
  const m = msg as { content: unknown };
  return typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
}

/**
 * Create a mock agent that captures all messages sent to it.
 * Returns mock AI messages in response.
 */
function createCapturingMockAgent(responseContent: string = 'OK') {
  const capturedMessages: unknown[][] = [];

  const agent = {
    async invoke(input: { messages: unknown[] }) {
      capturedMessages.push([...input.messages]);
      return {
        messages: [
          ...input.messages,
          mockAIMessage(responseContent),
        ],
      };
    },
  };

  return { agent, capturedMessages };
}

/**
 * Create a mock agent that returns AI messages with tool calls.
 */
function createToolCallingMockAgent(
  toolCalls: Array<{ name: string; args: Record<string, unknown>; id: string }>
) {
  return {
    async invoke(input: { messages: unknown[] }) {
      return {
        messages: [
          ...input.messages,
          mockAIMessage('Used some tools.', toolCalls),
        ],
      };
    },
  };
}

// ============================================================================
// Tests: Regression (no capabilities)
// ============================================================================

describe('wrapAgent without capabilities (regression)', () => {
  it('works unchanged when no capabilities are present', async () => {
    const { agent } = createCapturingMockAgent('Hello!');
    const wrapped = wrapAgent(agent);
    const ctx = makeContext('sess-1');

    const result = await wrapped.processMessage!('Hi', ctx);

    expect(result.message).toBe('Hello!');
    expect(result.transferBack).toBe(false);
    expect(result.toolCalls).toBeUndefined();
  });

  it('does not prepend system prompt without capabilities', async () => {
    const { agent, capturedMessages } = createCapturingMockAgent();
    const wrapped = wrapAgent(agent);
    const ctx = makeContext('sess-1');

    await wrapped.processMessage!('Hello', ctx);

    // Should only have the HumanMessage, no SystemMessage
    expect(capturedMessages[0].length).toBe(1);
    expect(getMessageType(capturedMessages[0][0])).toBe('human');
  });

  it('does not filter tool calls without capabilities', async () => {
    const agent = createToolCallingMockAgent([
      { name: 'read_file', args: { path: 'test.txt' }, id: 'tc1' },
      { name: 'custom_tool', args: { q: 'test' }, id: 'tc2' },
    ]);
    const wrapped = wrapAgent(agent);
    const ctx = makeContext('sess-1');

    const result = await wrapped.processMessage!('Do something', ctx);

    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls!.length).toBe(2);
    expect(result.toolCalls!.map((tc) => tc.tool)).toEqual(['read_file', 'custom_tool']);
  });
});

// ============================================================================
// Tests: No system prompt injection (SystemMessage removed to avoid API errors)
// ============================================================================

describe('wrapAgent does NOT inject system prompts', () => {
  it('does not inject system prompt when filesystem capability is present', async () => {
    const { agent, capturedMessages } = createCapturingMockAgent();
    const wrapped = wrapAgent(agent);
    const ctx = makeContext('sess-1', filesystemCaps);

    await wrapped.processMessage!('Hello', ctx);

    const messages = capturedMessages[0];
    expect(messages.length).toBe(1); // Only HumanMessage
    expect(getMessageType(messages[0])).toBe('human');
  });

  it('does not inject system prompt for filesystem+shell capabilities', async () => {
    const { agent, capturedMessages } = createCapturingMockAgent();
    const wrapped = wrapAgent(agent);
    const ctx = makeContext('sess-1', filesystemAndShellCaps);

    await wrapped.processMessage!('Hello', ctx);

    const messages = capturedMessages[0];
    expect(messages.length).toBe(1); // Only HumanMessage
    expect(getMessageType(messages[0])).toBe('human');
  });

  it('no system messages across multiple turns', async () => {
    const { agent, capturedMessages } = createCapturingMockAgent();
    const wrapped = wrapAgent(agent);
    const ctx = makeContext('sess-1', filesystemCaps);

    await wrapped.processMessage!('First', ctx);
    await wrapped.processMessage!('Second', ctx);

    const allSystemMessages = capturedMessages.flatMap(
      (msgs) => msgs.filter((m) => getMessageType(m) === 'system')
    );
    expect(allSystemMessages.length).toBe(0);
  });

  it('no system messages across different sessions', async () => {
    const { agent, capturedMessages } = createCapturingMockAgent();
    const wrapped = wrapAgent(agent);

    await wrapped.processMessage!('Hello', makeContext('sess-a', filesystemCaps));
    await wrapped.processMessage!('Hello', makeContext('sess-b', filesystemCaps));

    expect(getMessageType(capturedMessages[0][0])).toBe('human');
    expect(getMessageType(capturedMessages[1][0])).toBe('human');
  });
});

// ============================================================================
// Tests: Tool call filtering
// ============================================================================

describe('wrapAgent workspace tool call filtering', () => {
  it('filters filesystem tool calls from output when capabilities are present', async () => {
    const agent = createToolCallingMockAgent([
      { name: 'read_file', args: { path: 'test.txt' }, id: 'tc1' },
      { name: 'custom_tool', args: { q: 'test' }, id: 'tc2' },
    ]);
    const wrapped = wrapAgent(agent);
    const ctx = makeContext('sess-1', filesystemCaps);

    const result = await wrapped.processMessage!('Do something', ctx);

    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls!.length).toBe(1);
    expect(result.toolCalls![0].tool).toBe('custom_tool');
  });

  it('filters all workspace tool names when filesystem+shell enabled', async () => {
    const agent = createToolCallingMockAgent([
      { name: 'read_file', args: { path: 'test.txt' }, id: 'tc1' },
      { name: 'write_file', args: { path: 'out.txt', content: 'hi' }, id: 'tc2' },
      { name: 'execute_command', args: { command: 'ls' }, id: 'tc3' },
      { name: 'custom_tool', args: {}, id: 'tc4' },
    ]);
    const wrapped = wrapAgent(agent);
    const ctx = makeContext('sess-1', filesystemAndShellCaps);

    const result = await wrapped.processMessage!('Do things', ctx);

    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls!.length).toBe(1);
    expect(result.toolCalls![0].tool).toBe('custom_tool');
  });

  it('returns undefined toolCalls when all tool calls are workspace tools', async () => {
    const agent = createToolCallingMockAgent([
      { name: 'read_file', args: { path: 'test.txt' }, id: 'tc1' },
      { name: 'write_file', args: { path: 'out.txt', content: 'hi' }, id: 'tc2' },
    ]);
    const wrapped = wrapAgent(agent);
    const ctx = makeContext('sess-1', filesystemCaps);

    const result = await wrapped.processMessage!('Do things', ctx);

    expect(result.toolCalls).toBeUndefined();
  });

  it('does not filter execute_command when only filesystem capability is enabled', async () => {
    const agent = createToolCallingMockAgent([
      { name: 'read_file', args: { path: 'test.txt' }, id: 'tc1' },
      { name: 'execute_command', args: { command: 'ls' }, id: 'tc2' },
    ]);
    const wrapped = wrapAgent(agent);
    const ctx = makeContext('sess-1', { filesystem: { enabled: true } });

    const result = await wrapped.processMessage!('Do things', ctx);

    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls!.length).toBe(1);
    expect(result.toolCalls![0].tool).toBe('execute_command');
  });
});

// ============================================================================
// Tests: getWorkspaceTools
// ============================================================================

describe('getWorkspaceTools', () => {
  it('returns empty array when no capabilities', async () => {
    const { getWorkspaceTools } = await import('../../packages/js/sdk/dist/workspace-tools.js');
    const ctx = makeContext('sess-1');
    const tools = getWorkspaceTools(ctx);
    expect(tools).toEqual([]);
  });

  it('returns 8 filesystem tools when filesystem enabled', async () => {
    const { getWorkspaceTools } = await import('../../packages/js/sdk/dist/workspace-tools.js');
    const ctx = makeContext('sess-1', filesystemCaps);
    const tools = getWorkspaceTools(ctx, '/tmp/test-workspace-phase3');
    expect(tools.length).toBe(8);

    const names = tools.map((t: { name: string }) => t.name);
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).toContain('edit_file');
    expect(names).toContain('list_directory');
    expect(names).toContain('glob_files');
    expect(names).toContain('grep_files');
    expect(names).toContain('delete_file');
    expect(names).toContain('create_directory');
  });

  it('returns 9 tools when filesystem+shell enabled', async () => {
    const { getWorkspaceTools } = await import('../../packages/js/sdk/dist/workspace-tools.js');
    const ctx = makeContext('sess-1', filesystemAndShellCaps);
    const tools = getWorkspaceTools(ctx, '/tmp/test-workspace-phase3');
    expect(tools.length).toBe(9);

    const names = tools.map((t: { name: string }) => t.name);
    expect(names).toContain('execute_command');
  });
});

// ============================================================================
// Tests: getActiveWorkspaceToolNames
// ============================================================================

describe('getActiveWorkspaceToolNames', () => {
  it('returns empty set for no capabilities', () => {
    const names = getActiveWorkspaceToolNames();
    expect(names.size).toBe(0);
  });

  it('returns 8 names for filesystem only', () => {
    const names = getActiveWorkspaceToolNames(filesystemCaps);
    expect(names.size).toBe(8);
    expect(names.has('read_file')).toBe(true);
    expect(names.has('execute_command')).toBe(false);
  });

  it('returns 9 names for filesystem+shell', () => {
    const names = getActiveWorkspaceToolNames(filesystemAndShellCaps);
    expect(names.size).toBe(9);
    expect(names.has('execute_command')).toBe(true);
  });
});
