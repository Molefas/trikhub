/**
 * Gateway Registry Provider — implements TrikRegistryContext.
 *
 * Provides search, install, uninstall, upgrade, list, and getInfo operations
 * by proxying to the TrikHub registry API and the local gateway.
 *
 * Mirrors packages/python/trikhub/gateway/registry_provider.py.
 */

import { execSync } from 'node:child_process';
import { existsSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  TrikRegistryContext,
  TrikSearchResult,
  InstalledTrikInfo,
  TrikInstallResult,
  TrikUninstallResult,
  TrikUpgradeResult,
  TrikDetailInfo,
  TrikManifest,
} from '@trikhub/manifest';

export interface RegistryProviderGateway {
  getLoadedTriks(): Map<string, { manifest: TrikManifest; path: string }>;
  loadTrik(path: string): Promise<TrikManifest>;
  unloadTrik(id: string): boolean;
}

export interface RegistryProviderConfig {
  registryBaseUrl?: string;
  configDir: string;
  gateway: RegistryProviderGateway;
}

export class GatewayRegistryProvider implements TrikRegistryContext {
  private baseUrl: string;
  private configDir: string;
  private gateway: RegistryProviderGateway;

  constructor(config: RegistryProviderConfig) {
    this.baseUrl = config.registryBaseUrl ?? 'https://api.trikhub.com';
    this.configDir = config.configDir;
    this.gateway = config.gateway;
  }

  async search(
    query: string,
    options?: { page?: number; pageSize?: number }
  ): Promise<TrikSearchResult> {
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 10;
    const url = `${this.baseUrl}/api/v1/triks?q=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Registry search failed: ${res.status}`);
    }

    const data: any = await res.json();
    return {
      triks: (data.triks ?? []).map((t: any) => ({
        name: t.name,
        description: (t.description ?? '').slice(0, 200),
        version: t.latestVersion ?? '0.0.0',
        downloads: t.totalDownloads ?? 0,
        verified: t.verified ?? false,
      })),
      total: data.total ?? 0,
      hasMore: data.hasMore ?? false,
    };
  }

  async list(): Promise<InstalledTrikInfo[]> {
    const triks = this.gateway.getLoadedTriks();
    const result: InstalledTrikInfo[] = [];

    for (const [id, loaded] of triks) {
      const m = loaded.manifest;
      const caps: string[] = [];
      if (m.capabilities?.session?.enabled) caps.push('session');
      if (m.capabilities?.storage?.enabled) caps.push('storage');
      if (m.capabilities?.filesystem?.enabled) caps.push('filesystem');
      if (m.capabilities?.shell?.enabled) caps.push('shell');
      if (m.capabilities?.trikManagement?.enabled) caps.push('trikManagement');

      result.push({
        id,
        name: m.name ?? id,
        version: m.version ?? '0.0.0',
        mode: m.agent?.mode ?? 'tool',
        description: (m.description ?? '').slice(0, 200),
        capabilities: caps,
      });
    }

    return result;
  }

  async install(trikId: string, version?: string): Promise<TrikInstallResult> {
    if (this.gateway.getLoadedTriks().has(trikId)) {
      const existing = this.gateway.getLoadedTriks().get(trikId)!;
      return {
        status: 'already_installed',
        trikId,
        version: existing.manifest.version ?? '0.0.0',
      };
    }

    try {
      const res = await fetch(
        `${this.baseUrl}/api/v1/triks/${encodeURIComponent(trikId)}`
      );
      if (!res.ok) {
        return {
          status: 'failed',
          trikId,
          version: '',
          error: `Trik not found: ${trikId}`,
        };
      }

      const trikInfo: any = await res.json();

      const targetVersion = version
        ? trikInfo.versions?.find((v: any) => v.version === version)
        : trikInfo.versions?.find(
            (v: any) => v.version === trikInfo.latestVersion
          );

      if (!targetVersion) {
        return {
          status: 'failed',
          trikId,
          version: version ?? '',
          error: 'Version not found',
        };
      }

      const trikDir = this.getTrikDir(trikId);
      mkdirSync(trikDir, { recursive: true });

      const gitUrl = `https://github.com/${trikInfo.githubRepo}.git`;
      execSync(
        `git clone --depth 1 --branch ${targetVersion.gitTag} ${gitUrl} ${trikDir}`,
        { stdio: 'pipe' }
      );

      // Remove .git to save space
      const gitDir = join(trikDir, '.git');
      if (existsSync(gitDir)) {
        rmSync(gitDir, { recursive: true, force: true });
      }

      this.addToConfig(trikId);
      await this.gateway.loadTrik(trikDir);

      return {
        status: 'installed',
        trikId,
        version: targetVersion.version,
      };
    } catch (err: any) {
      return {
        status: 'failed',
        trikId,
        version: version ?? '',
        error: (err.message ?? 'Unknown error').slice(0, 200),
      };
    }
  }

  async uninstall(trikId: string): Promise<TrikUninstallResult> {
    if (!this.gateway.getLoadedTriks().has(trikId)) {
      return { status: 'not_found', trikId };
    }

    try {
      this.gateway.unloadTrik(trikId);

      const trikDir = this.getTrikDir(trikId);
      if (existsSync(trikDir)) {
        rmSync(trikDir, { recursive: true, force: true });
      }

      this.removeFromConfig(trikId);

      return { status: 'uninstalled', trikId };
    } catch (err: any) {
      return {
        status: 'failed',
        trikId,
        error: (err.message ?? 'Unknown error').slice(0, 200),
      };
    }
  }

  async upgrade(
    trikId: string,
    version?: string
  ): Promise<TrikUpgradeResult> {
    const loaded = this.gateway.getLoadedTriks().get(trikId);
    if (!loaded) {
      return {
        status: 'not_found',
        trikId,
        previousVersion: '',
        newVersion: '',
      };
    }

    const previousVersion = loaded.manifest.version ?? '0.0.0';

    try {
      const res = await fetch(
        `${this.baseUrl}/api/v1/triks/${encodeURIComponent(trikId)}`
      );
      if (!res.ok) {
        return {
          status: 'failed',
          trikId,
          previousVersion,
          newVersion: '',
          error: 'Registry fetch failed',
        };
      }

      const trikInfo: any = await res.json();
      const targetVersion = version ?? trikInfo.latestVersion;

      if (targetVersion === previousVersion) {
        return {
          status: 'already_latest',
          trikId,
          previousVersion,
          newVersion: previousVersion,
        };
      }

      // Uninstall then reinstall
      await this.uninstall(trikId);
      const installResult = await this.install(trikId, targetVersion);

      if (installResult.status === 'failed') {
        return {
          status: 'failed',
          trikId,
          previousVersion,
          newVersion: targetVersion,
          error: installResult.error,
        };
      }

      return {
        status: 'upgraded',
        trikId,
        previousVersion,
        newVersion: targetVersion,
      };
    } catch (err: any) {
      return {
        status: 'failed',
        trikId,
        previousVersion,
        newVersion: version ?? '',
        error: (err.message ?? 'Unknown error').slice(0, 200),
      };
    }
  }

  async getInfo(trikId: string): Promise<TrikDetailInfo | null> {
    try {
      const res = await fetch(
        `${this.baseUrl}/api/v1/triks/${encodeURIComponent(trikId)}`
      );
      if (!res.ok) return null;

      const data: any = await res.json();
      return {
        name: data.name,
        description: (data.description ?? '').slice(0, 200),
        latestVersion: data.latestVersion ?? '0.0.0',
        versions: (data.versions ?? []).map((v: any) => v.version),
        downloads: data.totalDownloads ?? 0,
        verified: data.verified ?? false,
        mode: data.versions?.[0]?.manifest?.agent?.mode ?? 'tool',
      };
    } catch {
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private getTrikDir(trikId: string): string {
    if (trikId.startsWith('@')) {
      const [scope, name] = trikId.split('/');
      return join(this.configDir, 'triks', scope, name);
    }
    return join(this.configDir, 'triks', trikId);
  }

  private addToConfig(trikId: string): void {
    const configPath = join(this.configDir, 'config.json');
    const config = existsSync(configPath)
      ? JSON.parse(readFileSync(configPath, 'utf-8'))
      : { triks: [] };

    if (!config.triks.includes(trikId)) {
      config.triks.push(trikId);
    }
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  private removeFromConfig(trikId: string): void {
    const configPath = join(this.configDir, 'config.json');
    if (!existsSync(configPath)) return;

    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.triks = (config.triks ?? []).filter((t: string) => t !== trikId);
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  }
}
