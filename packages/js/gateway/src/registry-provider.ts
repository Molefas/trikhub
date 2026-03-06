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
import { join, resolve } from 'node:path';
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

      const trikRuntime = targetVersion.runtime ?? 'node';
      const isSameRuntime = trikRuntime === 'node';
      const projectRoot = this.getProjectRoot();
      const hasPackageJson = existsSync(join(projectRoot, 'package.json'));
      const needsContainer = this.needsContainerization(targetVersion.manifest);

      // Containerized triks (filesystem/shell) always go to .trikhub/triks/
      // so the Docker mount gets a self-contained directory with node_modules.
      // Non-containerized same-runtime triks use package.json + node_modules.
      const usePackageManager = isSameRuntime && hasPackageJson && !needsContainer;

      if (usePackageManager) {
        await this.installViaPackageManager(trikId, trikInfo.githubRepo, targetVersion.gitTag);
      } else {
        this.downloadToTriksDir(trikId, trikInfo.githubRepo, targetVersion.gitTag);
      }

      this.addToConfig(trikId, trikRuntime);
      await this.gateway.loadTrik(
        usePackageManager
          ? join(projectRoot, 'node_modules', ...trikId.split('/'))
          : this.getTrikDir(trikId)
      );

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

      // Check if trik lives in node_modules (same-runtime) or .trikhub/triks/ (cross-language)
      const projectRoot = this.getProjectRoot();
      const nmPath = join(projectRoot, 'node_modules', ...trikId.split('/'));
      const trikDir = this.getTrikDir(trikId);

      if (existsSync(nmPath)) {
        // Same-runtime: remove from package.json and node_modules
        rmSync(nmPath, { recursive: true, force: true });
        this.removeFromPackageJson(trikId);
      }

      if (existsSync(trikDir)) {
        // Cross-language: remove from .trikhub/triks/
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

  /**
   * Install a same-runtime JS trik via git URL in package.json.
   * Mirrors the CLI's installFromTrikhub behavior.
   */
  private async installViaPackageManager(
    trikId: string,
    githubRepo: string,
    gitTag: string
  ): Promise<void> {
    const projectRoot = this.getProjectRoot();
    const packageJsonPath = join(projectRoot, 'package.json');
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

    if (!pkg.dependencies) {
      pkg.dependencies = {};
    }
    pkg.dependencies[trikId] = `github:${githubRepo}#${gitTag}`;
    writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');

    // Remove existing from node_modules to force fresh install
    const nmPath = join(projectRoot, 'node_modules', ...trikId.split('/'));
    if (existsSync(nmPath)) {
      rmSync(nmPath, { recursive: true, force: true });
    }

    const pm = this.detectPackageManager();
    const installCmd = pm === 'pnpm'
      ? `pnpm install`
      : pm === 'yarn'
        ? `yarn install`
        : `npm install`;
    execSync(installCmd, { cwd: projectRoot, stdio: 'pipe' });
  }

  /**
   * Download a cross-language trik to .trikhub/triks/.
   */
  private downloadToTriksDir(
    trikId: string,
    githubRepo: string,
    gitTag: string
  ): void {
    const trikDir = this.getTrikDir(trikId);
    mkdirSync(trikDir, { recursive: true });

    const gitUrl = `https://github.com/${githubRepo}.git`;
    execSync(
      `git clone --depth 1 --branch ${gitTag} ${gitUrl} ${trikDir}`,
      { stdio: 'pipe' }
    );

    // Remove .git to save space
    const gitDir = join(trikDir, '.git');
    if (existsSync(gitDir)) {
      rmSync(gitDir, { recursive: true, force: true });
    }

    // Install dependencies
    if (existsSync(join(trikDir, 'package.json'))) {
      const cmd = existsSync(join(trikDir, 'pnpm-lock.yaml'))
        ? 'pnpm install --frozen-lockfile --prod'
        : existsSync(join(trikDir, 'yarn.lock'))
          ? 'yarn install --production --frozen-lockfile'
          : 'npm install --production';
      execSync(cmd, { cwd: trikDir, stdio: 'pipe' });
    } else if (existsSync(join(trikDir, 'requirements.txt'))) {
      execSync('pip install -r requirements.txt', { cwd: trikDir, stdio: 'pipe' });
    }

    // Write identity file for trusted scoped name
    const identityPath = join(trikDir, '.trikhub-identity.json');
    const identity = {
      scopedName: trikId,
      installedAt: new Date().toISOString(),
    };
    writeFileSync(identityPath, JSON.stringify(identity, null, 2));
  }

  /**
   * Check if a manifest declares filesystem or shell capabilities,
   * which require containerized (Docker) execution.
   */
  private needsContainerization(manifest?: any): boolean {
    const caps = manifest?.capabilities;
    return !!(caps?.filesystem?.enabled || caps?.shell?.enabled);
  }

  /**
   * Get the project root directory (parent of configDir/.trikhub).
   */
  private getProjectRoot(): string {
    return resolve(this.configDir, '..');
  }

  /**
   * Detect which package manager is used in the project.
   */
  private detectPackageManager(): 'npm' | 'pnpm' | 'yarn' {
    const root = this.getProjectRoot();
    if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
    if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
    return 'npm';
  }

  private getTrikDir(trikId: string): string {
    if (trikId.startsWith('@')) {
      const [scope, name] = trikId.split('/');
      return join(this.configDir, 'triks', scope, name);
    }
    return join(this.configDir, 'triks', trikId);
  }

  private addToConfig(trikId: string, runtime?: string): void {
    const configPath = join(this.configDir, 'config.json');
    const config = existsSync(configPath)
      ? JSON.parse(readFileSync(configPath, 'utf-8'))
      : { triks: [] };

    if (!config.triks.includes(trikId)) {
      config.triks.push(trikId);
    }

    if (runtime) {
      if (!config.runtimes) config.runtimes = {};
      config.runtimes[trikId] = runtime;
    }

    writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  private removeFromPackageJson(trikId: string): void {
    const packageJsonPath = join(this.getProjectRoot(), 'package.json');
    if (!existsSync(packageJsonPath)) return;

    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      if (pkg.dependencies?.[trikId]) {
        delete pkg.dependencies[trikId];
        writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
      }
    } catch {
      // package.json parsing failed — skip
    }
  }

  private removeFromConfig(trikId: string): void {
    const configPath = join(this.configDir, 'config.json');
    if (!existsSync(configPath)) return;

    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.triks = (config.triks ?? []).filter((t: string) => t !== trikId);

    // Clean up version and runtime tracking
    if (config.trikhub) {
      delete config.trikhub[trikId];
    }
    if (config.runtimes) {
      delete config.runtimes[trikId];
    }

    writeFileSync(configPath, JSON.stringify(config, null, 2));
  }
}
