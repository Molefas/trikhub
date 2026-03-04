/**
 * Tests for TrikGateway — TDPS log value validation, error sanitization,
 * and config validation warnings.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TrikGateway } from '../../packages/js/gateway/dist/gateway.js';
import { InMemoryConfigStore } from '../../packages/js/gateway/dist/config-store.js';
import { InMemoryStorageProvider } from '../../packages/js/gateway/dist/storage-provider.js';
import { InMemorySessionStorage } from '../../packages/js/gateway/dist/session-storage.js';
import { GatewayRegistryProvider } from '../../packages/js/gateway/dist/registry-provider.js';

// Access private methods via prototype for testing
const gateway = new TrikGateway();

// Helper to call private validateLogValue
function validateLogValue(value: unknown, fieldSchema: Record<string, unknown>): string | null {
  return (gateway as any).validateLogValue(value, fieldSchema);
}

// Helper to call private buildToolLogSummary
function buildToolLogSummary(
  call: { tool: string; input: Record<string, unknown>; output: Record<string, unknown> },
  toolDecl?: Record<string, unknown>,
): string {
  return (gateway as any).buildToolLogSummary(call, toolDecl);
}

// Helper to call private sanitizeErrorMessage
function sanitizeErrorMessage(msg: string, maxLength?: number): string {
  return (gateway as any).sanitizeErrorMessage(msg, maxLength);
}

// ============================================================================
// Gap 1: validateLogValue
// ============================================================================

describe('validateLogValue', () => {
  it('accepts valid integers', () => {
    expect(validateLogValue(42, { type: 'integer' })).toBe('42');
  });

  it('rejects non-integer for integer schema', () => {
    expect(validateLogValue('hello', { type: 'integer' })).toBeNull();
    expect(validateLogValue(3.14, { type: 'integer' })).toBeNull();
  });

  it('accepts valid numbers', () => {
    expect(validateLogValue(3.14, { type: 'number' })).toBe('3.14');
    expect(validateLogValue(42, { type: 'number' })).toBe('42');
  });

  it('rejects non-number for number schema', () => {
    expect(validateLogValue('hello', { type: 'number' })).toBeNull();
  });

  it('accepts valid booleans', () => {
    expect(validateLogValue(true, { type: 'boolean' })).toBe('true');
    expect(validateLogValue(false, { type: 'boolean' })).toBe('false');
  });

  it('rejects non-boolean for boolean schema', () => {
    expect(validateLogValue('true', { type: 'boolean' })).toBeNull();
  });

  it('accepts enum values', () => {
    expect(validateLogValue('success', { enum: ['success', 'failure'] })).toBe('success');
  });

  it('rejects non-enum values', () => {
    expect(validateLogValue('unknown', { enum: ['success', 'failure'] })).toBeNull();
  });

  it('truncates strings at maxLength', () => {
    const result = validateLogValue('a'.repeat(500), { type: 'string', maxLength: 100 });
    expect(result).toBe('a'.repeat(100));
  });

  it('accepts strings within maxLength', () => {
    expect(validateLogValue('short', { type: 'string', maxLength: 100 })).toBe('short');
  });

  it('accepts strings matching pattern', () => {
    expect(validateLogValue('abc123', { type: 'string', pattern: '^[a-z0-9]+$' })).toBe('abc123');
  });

  it('rejects strings not matching pattern', () => {
    expect(validateLogValue('ABC!!!', { type: 'string', pattern: '^[a-z0-9]+$' })).toBeNull();
  });

  it('accepts strings with format', () => {
    expect(validateLogValue('2025-01-01', { type: 'string', format: 'date' })).toBe('2025-01-01');
  });

  it('rejects unconstrained strings', () => {
    expect(validateLogValue('anything', { type: 'string' })).toBeNull();
  });

  it('rejects unknown types', () => {
    expect(validateLogValue({}, { type: 'object' })).toBeNull();
    expect(validateLogValue([], { type: 'array' })).toBeNull();
  });

  it('returns null for null/undefined values', () => {
    expect(validateLogValue(null, { type: 'string', maxLength: 100 })).toBeNull();
    expect(validateLogValue(undefined, { type: 'string', maxLength: 100 })).toBeNull();
  });

  it('rejects string value for integer schema', () => {
    expect(validateLogValue('42', { type: 'integer' })).toBeNull();
  });
});

// ============================================================================
// Gap 1: buildToolLogSummary
// ============================================================================

describe('buildToolLogSummary', () => {
  it('returns generic message when no logTemplate', () => {
    const result = buildToolLogSummary(
      { tool: 'search', input: {}, output: {} },
      { description: 'Search' },
    );
    expect(result).toBe('Called search');
  });

  it('returns generic message when no toolDecl', () => {
    const result = buildToolLogSummary(
      { tool: 'search', input: {}, output: {} },
      undefined,
    );
    expect(result).toBe('Called search');
  });

  it('fills validated placeholders from logSchema', () => {
    const result = buildToolLogSummary(
      { tool: 'search', input: {}, output: { query: 'test', count: 5 } },
      {
        description: 'Search',
        logTemplate: 'Searched for "{{query}}" — {{count}} results',
        logSchema: {
          query: { type: 'string', maxLength: 200 },
          count: { type: 'integer' },
        },
      },
    );
    expect(result).toBe('Searched for "test" — 5 results');
  });

  it('uses literal placeholder for missing logSchema field', () => {
    const result = buildToolLogSummary(
      { tool: 'search', input: {}, output: { query: 'test' } },
      {
        description: 'Search',
        logTemplate: 'Searched for "{{query}}" — {{count}} results',
        logSchema: {
          query: { type: 'string', maxLength: 200 },
          // count not in logSchema
        },
      },
    );
    expect(result).toBe('Searched for "test" — {{count}} results');
  });

  it('uses literal placeholder for non-conforming values', () => {
    const result = buildToolLogSummary(
      { tool: 'search', input: {}, output: { status: 'INJECTION_ATTEMPT' } },
      {
        description: 'Search',
        logTemplate: 'Status: {{status}}',
        logSchema: {
          status: { type: 'string', enum: ['success', 'failure'] },
        },
      },
    );
    expect(result).toBe('Status: {{status}}');
  });

  it('truncates long strings to maxLength', () => {
    const longValue = 'x'.repeat(500);
    const result = buildToolLogSummary(
      { tool: 'log', input: {}, output: { msg: longValue } },
      {
        description: 'Log',
        logTemplate: 'Message: {{msg}}',
        logSchema: {
          msg: { type: 'string', maxLength: 100 },
        },
      },
    );
    expect(result).toBe('Message: ' + 'x'.repeat(100));
  });

  it('uses literal placeholder when logSchema is missing entirely', () => {
    const result = buildToolLogSummary(
      { tool: 'search', input: {}, output: { query: 'test' } },
      {
        description: 'Search',
        logTemplate: 'Searched for "{{query}}"',
        // no logSchema at all
      },
    );
    expect(result).toBe('Searched for "{{query}}"');
  });
});

// ============================================================================
// Gap 2: sanitizeErrorMessage
// ============================================================================

describe('sanitizeErrorMessage', () => {
  it('passes through short clean messages', () => {
    expect(sanitizeErrorMessage('Something failed')).toBe('Something failed');
  });

  it('truncates long messages', () => {
    const longMsg = 'x'.repeat(500);
    const result = sanitizeErrorMessage(longMsg);
    expect(result.length).toBe(203); // 200 + "..."
    expect(result.endsWith('...')).toBe(true);
  });

  it('truncates at custom maxLength', () => {
    const result = sanitizeErrorMessage('abcdefghij', 5);
    expect(result).toBe('abcde...');
  });

  it('strips control characters but keeps newlines and tabs', () => {
    const msg = 'hello\x00world\x01\nline2\ttab';
    const result = sanitizeErrorMessage(msg);
    expect(result).toBe('helloworld\nline2\ttab');
  });
});

// ============================================================================
// Config validation warning on loadTrik
// ============================================================================

describe('loadTrik config validation warning', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Create a temporary trik directory with a valid tool-mode manifest
   * and a minimal entry module.
   */
  async function createTempTrik(options: {
    id: string;
    configRequired?: Array<{ key: string; description: string }>;
  }): Promise<string> {
    const trikDir = await mkdtemp(join(tmpdir(), 'trik-test-'));

    const manifest = {
      schemaVersion: 2,
      id: options.id,
      name: `Test Trik ${options.id}`,
      description: 'A test trik for config validation',
      version: '1.0.0',
      agent: {
        mode: 'tool',
        domain: ['testing'],
      },
      tools: {
        testTool: {
          description: 'A test tool',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
            },
          },
          outputSchema: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['ok', 'error'] },
            },
          },
          outputTemplate: 'Status: {{status}}',
        },
      },
      entry: {
        module: 'index.mjs',
        export: 'agent',
      },
      ...(options.configRequired
        ? { config: { required: options.configRequired } }
        : {}),
    };

    await writeFile(
      join(trikDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
    );

    // Create a minimal entry module that exports an executeTool function
    const entryCode = `
      export const agent = {
        async executeTool(toolName, input, context) {
          return { output: { status: 'ok' } };
        }
      };
    `;
    await writeFile(join(trikDir, 'index.mjs'), entryCode);

    return trikDir;
  }

  it('warns when required config keys are missing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const configStore = new InMemoryConfigStore();
    const gw = new TrikGateway({
      configStore,
      storageProvider: new InMemoryStorageProvider(),
      sessionStorage: new InMemorySessionStorage(),
    });
    await gw.initialize();

    const trikDir = await createTempTrik({
      id: 'test-config-warn',
      configRequired: [
        { key: 'API_KEY', description: 'The API key' },
        { key: 'API_SECRET', description: 'The API secret' },
      ],
    });

    await gw.loadTrik(trikDir);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('trik "local/test-config-warn" is missing required config: API_KEY, API_SECRET'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('.trikhub/secrets.json'),
    );
  });

  it('does not warn when all required config keys are present', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const configStore = new InMemoryConfigStore({
      'test-config-present': { API_KEY: 'key123', API_SECRET: 'secret456' },
    });
    const gw = new TrikGateway({
      configStore,
      storageProvider: new InMemoryStorageProvider(),
      sessionStorage: new InMemorySessionStorage(),
    });
    await gw.initialize();

    const trikDir = await createTempTrik({
      id: 'test-config-present',
      configRequired: [
        { key: 'API_KEY', description: 'The API key' },
        { key: 'API_SECRET', description: 'The API secret' },
      ],
    });

    await gw.loadTrik(trikDir);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not warn when validateConfig is false', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const configStore = new InMemoryConfigStore();
    const gw = new TrikGateway({
      configStore,
      storageProvider: new InMemoryStorageProvider(),
      sessionStorage: new InMemorySessionStorage(),
      validateConfig: false,
    });
    await gw.initialize();

    const trikDir = await createTempTrik({
      id: 'test-config-skip',
      configRequired: [
        { key: 'API_KEY', description: 'The API key' },
      ],
    });

    await gw.loadTrik(trikDir);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns only about missing keys when some config is present', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const configStore = new InMemoryConfigStore({
      'test-partial': { API_KEY: 'key123' },
    });
    const gw = new TrikGateway({
      configStore,
      storageProvider: new InMemoryStorageProvider(),
      sessionStorage: new InMemorySessionStorage(),
    });
    await gw.initialize();

    const trikDir = await createTempTrik({
      id: 'test-partial',
      configRequired: [
        { key: 'API_KEY', description: 'The API key' },
        { key: 'API_SECRET', description: 'The API secret' },
      ],
    });

    await gw.loadTrik(trikDir);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('missing required config: API_SECRET'),
    );
    const warnMsg = warnSpy.mock.calls[0][0] as string;
    expect(warnMsg).not.toContain('API_KEY');
  });

  it('does not warn when trik has no required config', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const configStore = new InMemoryConfigStore();
    const gw = new TrikGateway({
      configStore,
      storageProvider: new InMemoryStorageProvider(),
      sessionStorage: new InMemorySessionStorage(),
    });
    await gw.initialize();

    const trikDir = await createTempTrik({
      id: 'test-no-config',
    });

    await gw.loadTrik(trikDir);

    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Registry injection into TrikContext
// ============================================================================

describe('registry injection into TrikContext', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Create a temporary trik directory with optional capabilities.
   */
  async function createTrikWithCapabilities(options: {
    id: string;
    mode?: 'tool' | 'conversational';
    capabilities?: Record<string, unknown>;
  }): Promise<string> {
    const trikDir = await mkdtemp(join(tmpdir(), 'trik-registry-test-'));

    const manifest: Record<string, unknown> = {
      schemaVersion: 2,
      id: options.id,
      name: `Test Trik ${options.id}`,
      description: 'A test trik for registry injection',
      version: '1.0.0',
      agent: {
        mode: options.mode ?? 'tool',
        domain: ['testing'],
        ...(options.mode === 'conversational'
          ? { handoffDescription: `Talk to ${options.id}`, systemPrompt: `You are ${options.id}.` }
          : {}),
      },
      tools: options.mode === 'conversational' ? undefined : {
        testTool: {
          description: 'A test tool',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
          outputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['ok', 'error'] } } },
          outputTemplate: 'Status: {{status}}',
        },
      },
      entry: { module: 'index.mjs', export: 'agent' },
    };

    if (options.capabilities) {
      manifest.capabilities = options.capabilities;
    }

    await writeFile(join(trikDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    const entryCode = options.mode === 'conversational'
      ? `export const agent = {
          async processMessage(message, context) {
            return { message: 'hello', toolCalls: [] };
          }
        };`
      : `export const agent = {
          async executeTool(toolName, input, context) {
            return { output: { status: 'ok' } };
          }
        };`;
    await writeFile(join(trikDir, 'index.mjs'), entryCode);

    return trikDir;
  }

  it('injects registry context when trikManagement is enabled', async () => {
    const gw = new TrikGateway({
      configStore: new InMemoryConfigStore(),
      storageProvider: new InMemoryStorageProvider(),
      sessionStorage: new InMemorySessionStorage(),
    });
    await gw.initialize();

    const trikDir = await createTrikWithCapabilities({
      id: 'test-mgmt-trik',
      mode: 'tool',
      capabilities: { trikManagement: { enabled: true } },
    });

    await gw.loadTrik(trikDir);

    // Access private buildTrikContext to verify injection
    const loaded = (gw as any).triks.get('local/test-mgmt-trik');
    expect(loaded).toBeDefined();

    const ctx = (gw as any).buildTrikContext('test-session', loaded);
    expect(ctx.registry).toBeDefined();
    expect(ctx.registry).toBeInstanceOf(GatewayRegistryProvider);
    expect(ctx.capabilities).toBeDefined();
    expect(ctx.capabilities.trikManagement.enabled).toBe(true);
  });

  it('does not inject registry context when trikManagement is not declared', async () => {
    const gw = new TrikGateway({
      configStore: new InMemoryConfigStore(),
      storageProvider: new InMemoryStorageProvider(),
      sessionStorage: new InMemorySessionStorage(),
    });
    await gw.initialize();

    const trikDir = await createTrikWithCapabilities({
      id: 'test-no-mgmt-trik',
      mode: 'tool',
    });

    await gw.loadTrik(trikDir);

    const loaded = (gw as any).triks.get('local/test-no-mgmt-trik');
    const ctx = (gw as any).buildTrikContext('test-session', loaded);
    expect(ctx.registry).toBeUndefined();
  });

  it('exposes registry provider via getRegistryProvider', () => {
    const gw = new TrikGateway({
      configStore: new InMemoryConfigStore(),
      storageProvider: new InMemoryStorageProvider(),
      sessionStorage: new InMemorySessionStorage(),
    });

    const provider = gw.getRegistryProvider();
    expect(provider).toBeInstanceOf(GatewayRegistryProvider);
  });
});
