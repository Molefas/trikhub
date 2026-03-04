/**
 * Tests for registry tools (getRegistryTools, getActiveRegistryToolNames).
 *
 * Phase 4: Verifies that registry tools correctly:
 * - Return empty array when no registry context
 * - Return 6 tools when registry context is present
 * - Have correct tool names matching REGISTRY_TOOL_NAMES
 * - Work with getActiveRegistryToolNames for capability-based filtering
 *
 * Also tests wrapAgent integration:
 * - Filters registry tool calls from output when trikManagement enabled
 * - Prepends registry system prompt on first message
 */

import { describe, it, expect } from 'vitest';
import type { TrikContext, TrikCapabilities, TrikRegistryContext } from '../../packages/js/manifest/dist/types.js';
import { wrapAgent } from '../../packages/js/sdk/dist/wrap-agent.js';
import {
  getRegistryTools,
  getActiveRegistryToolNames,
  REGISTRY_TOOL_NAMES,
} from '../../packages/js/sdk/dist/registry-tools.js';

// ============================================================================
// Helpers
// ============================================================================

function makeContext(
  sessionId = 'sess-1',
  capabilities?: TrikCapabilities,
  registry?: TrikRegistryContext
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
    registry,
  };
}

function createMockRegistry(): TrikRegistryContext {
  return {
    search: async () => ({ triks: [], total: 0, hasMore: false }),
    list: async () => [],
    install: async (trikId: string) => ({
      status: 'installed' as const,
      trikId,
      version: '1.0.0',
    }),
    uninstall: async (trikId: string) => ({
      status: 'uninstalled' as const,
      trikId,
    }),
    upgrade: async (trikId: string) => ({
      status: 'upgraded' as const,
      trikId,
      previousVersion: '1.0.0',
      newVersion: '2.0.0',
    }),
    getInfo: async () => null,
  };
}

const trikManagementCaps: TrikCapabilities = {
  trikManagement: { enabled: true },
};

function mockAIMessage(
  content: string,
  toolCalls?: Array<{ name: string; args: Record<string, unknown>; id: string }>
) {
  return {
    content,
    _getType: () => 'ai',
    tool_calls: toolCalls ?? [],
  };
}

function getMessageType(msg: unknown): string {
  const m = msg as { _getType?: () => string };
  if (typeof m._getType === 'function') return m._getType();
  return 'unknown';
}

function createCapturingMockAgent(responseContent: string = 'OK') {
  const capturedMessages: unknown[][] = [];
  const agent = {
    async invoke(input: { messages: unknown[] }) {
      capturedMessages.push([...input.messages]);
      return {
        messages: [...input.messages, mockAIMessage(responseContent)],
      };
    },
  };
  return { agent, capturedMessages };
}

function createToolCallingMockAgent(
  toolCalls: Array<{ name: string; args: Record<string, unknown>; id: string }>
) {
  return {
    async invoke(input: { messages: unknown[] }) {
      return {
        messages: [...input.messages, mockAIMessage('Used some tools.', toolCalls)],
      };
    },
  };
}

// ============================================================================
// Tests: getRegistryTools
// ============================================================================

describe('getRegistryTools', () => {
  it('returns empty array when no registry context', () => {
    const ctx = makeContext('sess-1');
    const tools = getRegistryTools(ctx);
    expect(tools).toEqual([]);
  });

  it('returns empty array when registry is undefined', () => {
    const ctx = makeContext('sess-1', trikManagementCaps);
    const tools = getRegistryTools(ctx);
    expect(tools).toEqual([]);
  });

  it('returns 6 tools when registry context is present', () => {
    const registry = createMockRegistry();
    const ctx = makeContext('sess-1', trikManagementCaps, registry);
    const tools = getRegistryTools(ctx);
    expect(tools).toHaveLength(6);
  });

  it('returns tools with correct names', () => {
    const registry = createMockRegistry();
    const ctx = makeContext('sess-1', trikManagementCaps, registry);
    const tools = getRegistryTools(ctx);
    const names = tools.map((t: { name: string }) => t.name);
    expect(names).toEqual([
      'search_triks',
      'list_installed_triks',
      'install_trik',
      'uninstall_trik',
      'upgrade_trik',
      'get_trik_info',
    ]);
  });

  it('tool names match REGISTRY_TOOL_NAMES constant', () => {
    const registry = createMockRegistry();
    const ctx = makeContext('sess-1', trikManagementCaps, registry);
    const tools = getRegistryTools(ctx);
    const toolNames = new Set(tools.map((t: { name: string }) => t.name));
    expect(toolNames).toEqual(REGISTRY_TOOL_NAMES);
  });
});

// ============================================================================
// Tests: getActiveRegistryToolNames
// ============================================================================

describe('getActiveRegistryToolNames', () => {
  it('returns empty set for no capabilities', () => {
    const names = getActiveRegistryToolNames();
    expect(names.size).toBe(0);
  });

  it('returns empty set for undefined capabilities', () => {
    const names = getActiveRegistryToolNames(undefined);
    expect(names.size).toBe(0);
  });

  it('returns empty set when trikManagement is not declared', () => {
    const names = getActiveRegistryToolNames({
      filesystem: { enabled: true },
    });
    expect(names.size).toBe(0);
  });

  it('returns empty set when trikManagement.enabled is false', () => {
    const names = getActiveRegistryToolNames({
      trikManagement: { enabled: false },
    });
    expect(names.size).toBe(0);
  });

  it('returns all 6 registry tool names when trikManagement enabled', () => {
    const names = getActiveRegistryToolNames(trikManagementCaps);
    expect(names.size).toBe(6);
    expect(names).toEqual(REGISTRY_TOOL_NAMES);
  });
});

// ============================================================================
// Tests: wrapAgent does NOT inject registry system prompt
// ============================================================================

describe('wrapAgent does NOT inject registry system prompt', () => {
  it('does not inject system prompt when trikManagement enabled', async () => {
    const { agent, capturedMessages } = createCapturingMockAgent();
    const wrapped = wrapAgent(agent);
    const registry = createMockRegistry();
    const ctx = makeContext('sess-1', trikManagementCaps, registry);

    await wrapped.processMessage!('Hello', ctx);

    const messages = capturedMessages[0];
    expect(messages.length).toBe(1); // Only HumanMessage
    expect(getMessageType(messages[0])).toBe('human');
  });

  it('does not inject system prompts even when both capabilities enabled', async () => {
    const { agent, capturedMessages } = createCapturingMockAgent();
    const wrapped = wrapAgent(agent);
    const registry = createMockRegistry();
    const ctx = makeContext('sess-1', {
      filesystem: { enabled: true },
      trikManagement: { enabled: true },
    }, registry);

    await wrapped.processMessage!('Hello', ctx);

    const messages = capturedMessages[0];
    expect(messages.length).toBe(1); // Only HumanMessage
    expect(getMessageType(messages[0])).toBe('human');
  });

  it('does not inject system prompt when no capabilities', async () => {
    const { agent, capturedMessages } = createCapturingMockAgent();
    const wrapped = wrapAgent(agent);
    const ctx = makeContext('sess-1');

    await wrapped.processMessage!('Hello', ctx);

    const messages = capturedMessages[0];
    expect(messages.length).toBe(1); // Only HumanMessage
    expect(getMessageType(messages[0])).toBe('human');
  });
});

// ============================================================================
// Tests: wrapAgent registry tool call filtering
// ============================================================================

describe('wrapAgent registry tool call filtering', () => {
  it('filters registry tool calls from output when trikManagement enabled', async () => {
    const agent = createToolCallingMockAgent([
      { name: 'search_triks', args: { query: 'test' }, id: 'tc1' },
      { name: 'custom_tool', args: {}, id: 'tc2' },
    ]);
    const wrapped = wrapAgent(agent);
    const registry = createMockRegistry();
    const ctx = makeContext('sess-1', trikManagementCaps, registry);

    const result = await wrapped.processMessage!('Find triks', ctx);

    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls!.length).toBe(1);
    expect(result.toolCalls![0].tool).toBe('custom_tool');
  });

  it('filters all 6 registry tool names', async () => {
    const agent = createToolCallingMockAgent([
      { name: 'search_triks', args: { query: 'test' }, id: 'tc1' },
      { name: 'list_installed_triks', args: {}, id: 'tc2' },
      { name: 'install_trik', args: { trikId: '@test/trik' }, id: 'tc3' },
      { name: 'uninstall_trik', args: { trikId: '@test/trik' }, id: 'tc4' },
      { name: 'upgrade_trik', args: { trikId: '@test/trik' }, id: 'tc5' },
      { name: 'get_trik_info', args: { trikId: '@test/trik' }, id: 'tc6' },
      { name: 'custom_tool', args: {}, id: 'tc7' },
    ]);
    const wrapped = wrapAgent(agent);
    const registry = createMockRegistry();
    const ctx = makeContext('sess-1', trikManagementCaps, registry);

    const result = await wrapped.processMessage!('Manage triks', ctx);

    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls!.length).toBe(1);
    expect(result.toolCalls![0].tool).toBe('custom_tool');
  });

  it('returns undefined toolCalls when all calls are registry tools', async () => {
    const agent = createToolCallingMockAgent([
      { name: 'search_triks', args: { query: 'test' }, id: 'tc1' },
      { name: 'install_trik', args: { trikId: '@test/trik' }, id: 'tc2' },
    ]);
    const wrapped = wrapAgent(agent);
    const registry = createMockRegistry();
    const ctx = makeContext('sess-1', trikManagementCaps, registry);

    const result = await wrapped.processMessage!('Install triks', ctx);

    expect(result.toolCalls).toBeUndefined();
  });

  it('does not filter registry tool names without trikManagement capability', async () => {
    const agent = createToolCallingMockAgent([
      { name: 'search_triks', args: { query: 'test' }, id: 'tc1' },
      { name: 'custom_tool', args: {}, id: 'tc2' },
    ]);
    const wrapped = wrapAgent(agent);
    const ctx = makeContext('sess-1');

    const result = await wrapped.processMessage!('Find triks', ctx);

    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls!.length).toBe(2);
    expect(result.toolCalls!.map((tc) => tc.tool)).toEqual(['search_triks', 'custom_tool']);
  });

  it('filters both workspace and registry tools when both capabilities enabled', async () => {
    const agent = createToolCallingMockAgent([
      { name: 'read_file', args: { path: 'test.txt' }, id: 'tc1' },
      { name: 'search_triks', args: { query: 'test' }, id: 'tc2' },
      { name: 'custom_tool', args: {}, id: 'tc3' },
    ]);
    const wrapped = wrapAgent(agent);
    const registry = createMockRegistry();
    const ctx = makeContext('sess-1', {
      filesystem: { enabled: true },
      trikManagement: { enabled: true },
    }, registry);

    const result = await wrapped.processMessage!('Do things', ctx);

    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls!.length).toBe(1);
    expect(result.toolCalls![0].tool).toBe('custom_tool');
  });
});
