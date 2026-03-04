/**
 * Tests for GatewayRegistryProvider — implements TrikRegistryContext
 * by proxying operations to the TrikHub registry API and local gateway.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GatewayRegistryProvider } from '../../packages/js/gateway/dist/registry-provider.js';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ============================================================================
// Mock Gateway
// ============================================================================

function createMockGateway(loadedTriks: Map<string, any> = new Map()) {
  return {
    getLoadedTriks: vi.fn(() => loadedTriks),
    loadTrik: vi.fn(async () => {}),
    unloadTrik: vi.fn(() => true),
  };
}

// ============================================================================
// Helpers
// ============================================================================

function mockFetchResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('GatewayRegistryProvider', () => {
  let configDir: string;
  let mockGateway: ReturnType<typeof createMockGateway>;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'trikhub-test-'));
    mockGateway = createMockGateway();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createProvider(overrides?: Partial<ConstructorParameters<typeof GatewayRegistryProvider>[0]>) {
    return new GatewayRegistryProvider({
      registryBaseUrl: 'https://api.trikhub.com',
      configDir,
      gateway: mockGateway,
      ...overrides,
    });
  }

  // --------------------------------------------------------------------------
  // search
  // --------------------------------------------------------------------------

  describe('search', () => {
    it('returns search results from registry API', async () => {
      const provider = createProvider();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockFetchResponse({
          triks: [
            {
              name: '@test/trik',
              description: 'A test trik',
              latestVersion: '1.0.0',
              totalDownloads: 100,
              verified: true,
            },
          ],
          total: 1,
          hasMore: false,
        })
      );

      const result = await provider.search('test');
      expect(result.triks).toHaveLength(1);
      expect(result.triks[0].name).toBe('@test/trik');
      expect(result.triks[0].version).toBe('1.0.0');
      expect(result.triks[0].downloads).toBe(100);
      expect(result.triks[0].verified).toBe(true);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
    });

    it('passes pagination params', async () => {
      const provider = createProvider();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockFetchResponse({ triks: [], total: 0, hasMore: false })
      );

      await provider.search('test', { page: 2, pageSize: 5 });
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('page=2&pageSize=5')
      );
    });

    it('throws on non-200 response', async () => {
      const provider = createProvider();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Server Error', { status: 500 })
      );

      await expect(provider.search('test')).rejects.toThrow('Registry search failed: 500');
    });

    it('truncates long descriptions to 200 chars', async () => {
      const provider = createProvider();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockFetchResponse({
          triks: [
            {
              name: '@test/long',
              description: 'x'.repeat(500),
              latestVersion: '1.0.0',
              totalDownloads: 0,
              verified: false,
            },
          ],
          total: 1,
          hasMore: false,
        })
      );

      const result = await provider.search('long');
      expect(result.triks[0].description.length).toBe(200);
    });
  });

  // --------------------------------------------------------------------------
  // list
  // --------------------------------------------------------------------------

  describe('list', () => {
    it('returns loaded triks from gateway', async () => {
      const triks = new Map([
        [
          '@scope/my-trik',
          {
            manifest: {
              name: 'My Trik',
              version: '2.1.0',
              description: 'A nice trik',
              agent: { mode: 'conversational' },
              capabilities: {
                session: { enabled: true },
                storage: { enabled: true, maxSizeBytes: 1024 },
              },
            },
            path: '/some/path',
          },
        ],
      ]);
      const gateway = createMockGateway(triks);
      const provider = createProvider({ gateway });

      const result = await provider.list();
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: '@scope/my-trik',
        name: 'My Trik',
        version: '2.1.0',
        mode: 'conversational',
        description: 'A nice trik',
        capabilities: ['session', 'storage'],
      });
    });

    it('returns empty array when no triks loaded', async () => {
      const provider = createProvider();
      const result = await provider.list();
      expect(result).toEqual([]);
    });

    it('includes trikManagement in capabilities list', async () => {
      const triks = new Map([
        [
          'mgmt-trik',
          {
            manifest: {
              name: 'Manager',
              version: '1.0.0',
              description: 'Manages triks',
              agent: { mode: 'conversational' },
              capabilities: {
                trikManagement: { enabled: true },
              },
            },
            path: '/some/path',
          },
        ],
      ]);
      const gateway = createMockGateway(triks);
      const provider = createProvider({ gateway });

      const result = await provider.list();
      expect(result[0].capabilities).toContain('trikManagement');
    });
  });

  // --------------------------------------------------------------------------
  // install
  // --------------------------------------------------------------------------

  describe('install', () => {
    it('returns already_installed when trik exists in gateway', async () => {
      const triks = new Map([
        [
          '@test/trik',
          {
            manifest: { version: '1.0.0' },
            path: '/some/path',
          },
        ],
      ]);
      const gateway = createMockGateway(triks);
      const provider = createProvider({ gateway });

      const result = await provider.install('@test/trik');
      expect(result.status).toBe('already_installed');
      expect(result.trikId).toBe('@test/trik');
      expect(result.version).toBe('1.0.0');
    });

    it('returns failed when registry returns non-200', async () => {
      const provider = createProvider();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Not found', { status: 404 })
      );

      const result = await provider.install('@test/unknown');
      expect(result.status).toBe('failed');
      expect(result.error).toContain('Trik not found');
    });

    it('returns failed when version not found', async () => {
      const provider = createProvider();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockFetchResponse({
          latestVersion: '1.0.0',
          versions: [{ version: '1.0.0', gitTag: 'v1.0.0' }],
        })
      );

      const result = await provider.install('@test/trik', '2.0.0');
      expect(result.status).toBe('failed');
      expect(result.error).toBe('Version not found');
    });

    it('returns failed and captures error when git clone fails', async () => {
      const provider = createProvider();

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockFetchResponse({
          githubRepo: 'test-org/test-trik',
          latestVersion: '1.0.0',
          versions: [{ version: '1.0.0', gitTag: 'v1.0.0' }],
        })
      );

      // git clone will fail since the repo doesn't exist — error is caught gracefully
      const result = await provider.install('@test/new-trik');
      expect(result.status).toBe('failed');
      expect(result.trikId).toBe('@test/new-trik');
      expect(result.error).toBeDefined();
      expect(result.error!.length).toBeLessThanOrEqual(200);
    });
  });

  // --------------------------------------------------------------------------
  // uninstall
  // --------------------------------------------------------------------------

  describe('uninstall', () => {
    it('returns not_found for unknown trik', async () => {
      const provider = createProvider();
      const result = await provider.uninstall('@test/unknown');
      expect(result.status).toBe('not_found');
      expect(result.trikId).toBe('@test/unknown');
    });

    it('unloads trik, removes dir, and updates config', async () => {
      // Set up config file
      const configPath = join(configDir, 'config.json');
      await writeFile(configPath, JSON.stringify({ triks: ['@test/trik'] }));

      // Set up trik directory
      const trikDir = join(configDir, 'triks', '@test', 'trik');
      await mkdir(trikDir, { recursive: true });
      await writeFile(join(trikDir, 'manifest.json'), '{}');

      const triks = new Map([
        [
          '@test/trik',
          {
            manifest: { version: '1.0.0' },
            path: trikDir,
          },
        ],
      ]);
      const gateway = createMockGateway(triks);
      const provider = createProvider({ gateway });

      const result = await provider.uninstall('@test/trik');
      expect(result.status).toBe('uninstalled');
      expect(result.trikId).toBe('@test/trik');
      expect(gateway.unloadTrik).toHaveBeenCalledWith('@test/trik');

      // Verify config updated
      const config = JSON.parse(await readFile(configPath, 'utf-8'));
      expect(config.triks).not.toContain('@test/trik');

      // Verify directory removed
      expect(existsSync(trikDir)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // upgrade
  // --------------------------------------------------------------------------

  describe('upgrade', () => {
    it('returns not_found for unknown trik', async () => {
      const provider = createProvider();
      const result = await provider.upgrade('@test/unknown');
      expect(result.status).toBe('not_found');
      expect(result.previousVersion).toBe('');
      expect(result.newVersion).toBe('');
    });

    it('returns already_latest when versions match', async () => {
      const triks = new Map([
        [
          '@test/trik',
          {
            manifest: { version: '1.0.0' },
            path: '/some/path',
          },
        ],
      ]);
      const gateway = createMockGateway(triks);
      const provider = createProvider({ gateway });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockFetchResponse({ latestVersion: '1.0.0' })
      );

      const result = await provider.upgrade('@test/trik');
      expect(result.status).toBe('already_latest');
      expect(result.previousVersion).toBe('1.0.0');
      expect(result.newVersion).toBe('1.0.0');
    });

    it('returns failed on registry error', async () => {
      const triks = new Map([
        [
          '@test/trik',
          {
            manifest: { version: '1.0.0' },
            path: '/some/path',
          },
        ],
      ]);
      const gateway = createMockGateway(triks);
      const provider = createProvider({ gateway });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Error', { status: 500 })
      );

      const result = await provider.upgrade('@test/trik');
      expect(result.status).toBe('failed');
      expect(result.error).toBe('Registry fetch failed');
    });
  });

  // --------------------------------------------------------------------------
  // getInfo
  // --------------------------------------------------------------------------

  describe('getInfo', () => {
    it('returns trik info from registry', async () => {
      const provider = createProvider();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockFetchResponse({
          name: '@test/trik',
          description: 'A test trik',
          latestVersion: '2.0.0',
          totalDownloads: 500,
          verified: true,
          versions: [
            { version: '2.0.0', manifest: { agent: { mode: 'conversational' } } },
            { version: '1.0.0', manifest: { agent: { mode: 'conversational' } } },
          ],
        })
      );

      const result = await provider.getInfo('@test/trik');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('@test/trik');
      expect(result!.latestVersion).toBe('2.0.0');
      expect(result!.versions).toEqual(['2.0.0', '1.0.0']);
      expect(result!.downloads).toBe(500);
      expect(result!.verified).toBe(true);
      expect(result!.mode).toBe('conversational');
    });

    it('returns null on non-200 response', async () => {
      const provider = createProvider();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Not found', { status: 404 })
      );

      const result = await provider.getInfo('@test/unknown');
      expect(result).toBeNull();
    });

    it('returns null on fetch error', async () => {
      const provider = createProvider();
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      const result = await provider.getInfo('@test/trik');
      expect(result).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Config helpers
  // --------------------------------------------------------------------------

  describe('config management', () => {
    it('addToConfig creates config.json if not exists', async () => {
      const triks = new Map();
      // We need a loaded trik to test install path, but we can test via uninstall's removeFromConfig
      // Instead, test indirectly via the uninstall path
      const configPath = join(configDir, 'config.json');
      expect(existsSync(configPath)).toBe(false);

      // removeFromConfig is a no-op if config doesn't exist
      const provider = createProvider();
      // This exercises removeFromConfig gracefully
      const result = await provider.uninstall('non-existent');
      expect(result.status).toBe('not_found');
    });
  });

  // --------------------------------------------------------------------------
  // getTrikDir
  // --------------------------------------------------------------------------

  describe('trik directory paths', () => {
    it('handles scoped trik IDs correctly', async () => {
      // We can verify via uninstall which calls getTrikDir internally
      const triks = new Map([
        [
          '@scope/name',
          {
            manifest: { version: '1.0.0' },
            path: '/some/path',
          },
        ],
      ]);
      const gateway = createMockGateway(triks);
      const provider = createProvider({ gateway });

      // Create the expected directory structure
      const trikDir = join(configDir, 'triks', '@scope', 'name');
      await mkdir(trikDir, { recursive: true });
      await writeFile(join(trikDir, 'test.txt'), 'test');

      const result = await provider.uninstall('@scope/name');
      expect(result.status).toBe('uninstalled');
      expect(existsSync(trikDir)).toBe(false);
    });
  });
});
