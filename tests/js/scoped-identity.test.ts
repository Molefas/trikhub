/**
 * Tests for scoped identity resolution and resource isolation.
 *
 * Validates that:
 * - resolveScopedName reads .trikhub-identity.json when present
 * - Falls back to local/<manifest.id> for dev triks
 * - toToolName converts scoped names to tool-safe identifiers
 * - loadTrik rejects duplicate scoped names
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { TrikGateway } from '../../packages/js/gateway/dist/gateway.js';

// Access private methods via prototype
const gateway = new TrikGateway();

function resolveScopedName(trikPath: string, manifest: { id: string }): string {
  return (gateway as any).resolveScopedName(trikPath, manifest);
}

function toToolName(scopedName: string): string {
  return (gateway as any).toToolName(scopedName);
}

// ============================================================================
// resolveScopedName
// ============================================================================

describe('resolveScopedName', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'trikhub-scoped-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns scopedName from .trikhub-identity.json when present', async () => {
    const identity = { scopedName: '@alice/weather', installedAt: '2026-01-01T00:00:00Z' };
    await writeFile(join(tempDir, '.trikhub-identity.json'), JSON.stringify(identity));

    const result = resolveScopedName(tempDir, { id: 'weather' });
    expect(result).toBe('@alice/weather');
  });

  it('returns local/<manifest.id> when no identity file', () => {
    const result = resolveScopedName(tempDir, { id: 'weather' });
    expect(result).toBe('local/weather');
  });

  it('returns local/<manifest.id> when identity file is malformed JSON', async () => {
    await writeFile(join(tempDir, '.trikhub-identity.json'), 'not valid json');

    const result = resolveScopedName(tempDir, { id: 'weather' });
    expect(result).toBe('local/weather');
  });

  it('returns local/<manifest.id> when identity file has no scopedName field', async () => {
    await writeFile(join(tempDir, '.trikhub-identity.json'), JSON.stringify({ other: 'field' }));

    const result = resolveScopedName(tempDir, { id: 'weather' });
    expect(result).toBe('local/weather');
  });

  it('returns local/<manifest.id> when scopedName is not a string', async () => {
    await writeFile(join(tempDir, '.trikhub-identity.json'), JSON.stringify({ scopedName: 42 }));

    const result = resolveScopedName(tempDir, { id: 'weather' });
    expect(result).toBe('local/weather');
  });
});

// ============================================================================
// toToolName
// ============================================================================

describe('toToolName', () => {
  it('converts @alice/weather to alice__weather', () => {
    expect(toToolName('@alice/weather')).toBe('alice__weather');
  });

  it('converts local/weather to local__weather', () => {
    expect(toToolName('local/weather')).toBe('local__weather');
  });

  it('converts @org/my-trik to org__my-trik', () => {
    expect(toToolName('@org/my-trik')).toBe('org__my-trik');
  });

  it('handles names without @ prefix', () => {
    expect(toToolName('simple/name')).toBe('simple__name');
  });
});

// ============================================================================
// loadTrik with scopedName — duplicate detection
// ============================================================================

describe('loadTrik duplicate detection', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'trikhub-dup-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('throws on duplicate scopedName', async () => {
    const gw = new TrikGateway();

    // Create two triks with the same identity file
    const trikDir1 = join(tempDir, 'trik1');
    const trikDir2 = join(tempDir, 'trik2');
    await mkdir(trikDir1, { recursive: true });
    await mkdir(trikDir2, { recursive: true });

    const manifest = {
      schemaVersion: 2,
      id: 'weather',
      name: 'Weather Trik',
      version: '1.0.0',
      description: 'A weather trik',
      agent: { mode: 'tool', domain: ['test'] },
      tools: {
        getWeather: {
          description: 'Get weather',
          inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
          outputSchema: { type: 'object', properties: { temp: { type: 'number' } } },
          outputTemplate: 'Temperature: {{temp}}',
        },
      },
      entry: { module: './index.js', export: 'default' },
    };

    await writeFile(join(trikDir1, 'manifest.json'), JSON.stringify(manifest));
    const entryCode = 'export default { executeTool: async () => ({ content: [] }) };';
    await writeFile(join(trikDir1, 'index.js'), entryCode);
    await writeFile(join(trikDir2, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(trikDir2, 'index.js'), entryCode);

    // Both have the same scoped identity
    const identity = { scopedName: '@alice/weather', installedAt: '2026-01-01T00:00:00Z' };
    await writeFile(join(trikDir1, '.trikhub-identity.json'), JSON.stringify(identity));
    await writeFile(join(trikDir2, '.trikhub-identity.json'), JSON.stringify(identity));

    // First load should succeed
    await gw.loadTrik(trikDir1);

    // Second load should throw duplicate error
    await expect(gw.loadTrik(trikDir2)).rejects.toThrow(/Duplicate trik identity/);
  });
});
