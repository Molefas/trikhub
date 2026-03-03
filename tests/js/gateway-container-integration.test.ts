/**
 * Phase 5 Integration Tests — Gateway containerized trik routing.
 *
 * Tests that the gateway correctly detects filesystem/shell capabilities
 * and marks triks as containerized for Docker-based execution.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TrikGateway } from '../../packages/js/gateway/dist/gateway.js';
import { InMemoryConfigStore } from '../../packages/js/gateway/dist/config-store.js';
import { InMemoryStorageProvider } from '../../packages/js/gateway/dist/storage-provider.js';
import { InMemorySessionStorage } from '../../packages/js/gateway/dist/session-storage.js';

// ============================================================================
// Test helpers
// ============================================================================

async function createTrikDir(
  baseDir: string,
  trikId: string,
  options: {
    mode?: string;
    runtime?: string;
    capabilities?: Record<string, unknown>;
  } = {}
): Promise<string> {
  const {
    mode = 'conversational',
    runtime = 'node',
    capabilities,
  } = options;

  const trikDir = join(baseDir, trikId);
  await mkdir(trikDir, { recursive: true });
  await mkdir(join(trikDir, 'dist'), { recursive: true });

  const manifest: Record<string, unknown> = {
    schemaVersion: 2,
    id: trikId,
    name: trikId,
    description: `Test trik ${trikId}`,
    version: '0.1.0',
    agent: {
      mode,
      domain: ['test'],
      ...(mode === 'conversational' ? {
        handoffDescription: `Talk to ${trikId}`,
        systemPrompt: `You are ${trikId}.`,
      } : {}),
    },
    entry: {
      module: './dist/index.js',
      export: 'agent',
      runtime,
    },
  };

  if (capabilities) {
    manifest.capabilities = capabilities;
  }

  await writeFile(join(trikDir, 'manifest.json'), JSON.stringify(manifest));

  // Write a simple agent module
  const agentCode = mode === 'conversational'
    ? `export const agent = {
        processMessage: async (msg, ctx) => ({
          message: 'Response: ' + msg,
          transferBack: false,
        }),
      };`
    : `export const agent = {
        executeTool: async (name, input, ctx) => ({
          output: { result: 'ok' },
        }),
      };`;

  await writeFile(join(trikDir, 'dist', 'index.js'), agentCode);

  return trikDir;
}

function createGateway() {
  return new TrikGateway({
    configStore: new InMemoryConfigStore(),
    storageProvider: new InMemoryStorageProvider(),
    sessionStorage: new InMemorySessionStorage(),
    validateConfig: false,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('Gateway containerized trik detection', () => {
  let tempDir: string;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks trik with filesystem capability as containerized', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'trik-test-'));
    const trikPath = await createTrikDir(tempDir, 'fs-trik', {
      capabilities: {
        filesystem: { enabled: true },
      },
    });

    const gateway = createGateway();
    await gateway.initialize();

    // loadTrik should detect containerization and NOT try to dynamic import
    // (it creates a container proxy instead)
    const manifest = await gateway.loadTrik(trikPath);

    expect(manifest.id).toBe('fs-trik');
    expect(gateway.isLoaded('fs-trik')).toBe(true);

    // Access internal state to verify containerized flag
    const loadedTrik = (gateway as any).triks.get('fs-trik');
    expect(loadedTrik.containerized).toBe(true);
  });

  it('marks trik with filesystem + shell capabilities as containerized', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'trik-test-'));
    const trikPath = await createTrikDir(tempDir, 'builder-trik', {
      capabilities: {
        filesystem: { enabled: true },
        shell: { enabled: true },
      },
    });

    const gateway = createGateway();
    await gateway.initialize();

    const manifest = await gateway.loadTrik(trikPath);
    expect(manifest.id).toBe('builder-trik');

    const loadedTrik = (gateway as any).triks.get('builder-trik');
    expect(loadedTrik.containerized).toBe(true);
  });

  it('does not mark trik without capabilities as containerized', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'trik-test-'));
    const trikPath = await createTrikDir(tempDir, 'normal-trik');

    const gateway = createGateway();
    await gateway.initialize();

    const manifest = await gateway.loadTrik(trikPath);
    expect(manifest.id).toBe('normal-trik');

    const loadedTrik = (gateway as any).triks.get('normal-trik');
    expect(loadedTrik.containerized).toBe(false);
  });

  it('does not mark trik with session/storage only as containerized', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'trik-test-'));
    const trikPath = await createTrikDir(tempDir, 'session-trik', {
      capabilities: {
        session: { enabled: true },
        storage: { enabled: true },
      },
    });

    const gateway = createGateway();
    await gateway.initialize();

    const manifest = await gateway.loadTrik(trikPath);
    const loadedTrik = (gateway as any).triks.get('session-trik');
    expect(loadedTrik.containerized).toBe(false);
  });

  it('does not mark trik with filesystem.enabled=false as containerized', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'trik-test-'));
    const trikPath = await createTrikDir(tempDir, 'disabled-fs-trik', {
      capabilities: {
        filesystem: { enabled: false },
      },
    });

    const gateway = createGateway();
    await gateway.initialize();

    const manifest = await gateway.loadTrik(trikPath);
    const loadedTrik = (gateway as any).triks.get('disabled-fs-trik');
    expect(loadedTrik.containerized).toBe(false);
  });

  it('python trik with filesystem is also containerized', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'trik-test-'));
    const trikPath = await createTrikDir(tempDir, 'py-builder', {
      runtime: 'python',
      capabilities: {
        filesystem: { enabled: true },
        shell: { enabled: true },
      },
    });

    const gateway = createGateway();
    await gateway.initialize();

    const manifest = await gateway.loadTrik(trikPath);
    const loadedTrik = (gateway as any).triks.get('py-builder');
    expect(loadedTrik.containerized).toBe(true);
    // Python containerized triks should NOT trigger NodeWorker
    expect((gateway as any).pythonWorker).toBeNull();
  });
});

describe('Gateway buildTrikContext with capabilities', () => {
  it('includes capabilities in context for containerized triks', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'trik-test-'));
    const trikPath = await createTrikDir(tempDir, 'ctx-trik', {
      capabilities: {
        filesystem: { enabled: true, maxSizeBytes: 1024000 },
        shell: { enabled: true, timeoutMs: 5000 },
      },
    });

    const gateway = createGateway();
    await gateway.initialize();
    await gateway.loadTrik(trikPath);

    const loadedTrik = (gateway as any).triks.get('ctx-trik');
    const context = (gateway as any).buildTrikContext('test-session', loadedTrik);

    expect(context.capabilities).toBeDefined();
    expect(context.capabilities.filesystem.enabled).toBe(true);
    expect(context.capabilities.shell.enabled).toBe(true);
  });

  it('does not include capabilities for non-containerized triks', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'trik-test-'));
    const trikPath = await createTrikDir(tempDir, 'plain-trik');

    const gateway = createGateway();
    await gateway.initialize();
    await gateway.loadTrik(trikPath);

    const loadedTrik = (gateway as any).triks.get('plain-trik');
    const context = (gateway as any).buildTrikContext('test-session', loadedTrik);

    expect(context.capabilities).toBeUndefined();
  });
});

describe('Gateway needsContainerization', () => {
  it('returns true for filesystem.enabled', () => {
    const result = (TrikGateway as any).needsContainerization({
      capabilities: { filesystem: { enabled: true } },
    });
    expect(result).toBe(true);
  });

  it('returns true for shell.enabled', () => {
    const result = (TrikGateway as any).needsContainerization({
      capabilities: { shell: { enabled: true } },
    });
    expect(result).toBe(true);
  });

  it('returns false for no capabilities', () => {
    const result = (TrikGateway as any).needsContainerization({});
    expect(result).toBe(false);
  });

  it('returns false for disabled capabilities', () => {
    const result = (TrikGateway as any).needsContainerization({
      capabilities: { filesystem: { enabled: false } },
    });
    expect(result).toBe(false);
  });
});

describe('Gateway shutdown stops containers', () => {
  it('shutdown stops container manager', async () => {
    const gateway = createGateway();
    await gateway.initialize();

    // Trigger container manager creation
    (gateway as any).ensureContainerManager();
    expect((gateway as any).containerManager).not.toBeNull();

    // Mock stopAll
    const stopAllMock = vi.fn().mockResolvedValue(undefined);
    (gateway as any).containerManager.stopAll = stopAllMock;

    await gateway.shutdown();
    expect(stopAllMock).toHaveBeenCalled();
    expect((gateway as any).containerManager).toBeNull();
  });

  it('shutdown works when no container manager', async () => {
    const gateway = createGateway();
    await gateway.initialize();
    await gateway.shutdown(); // Should not throw
  });
});
