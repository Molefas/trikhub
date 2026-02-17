/**
 * Registry client for TrikHub
 *
 * Connects to the TrikHub registry API to search and fetch triks.
 */

import {
  TrikInfo,
  TrikVersion,
  TrikRuntime,
  SearchResult,
  DeviceAuthResponse,
  AuthResult,
  Publisher,
} from '../types.js';
import { loadConfig } from './storage.js';

/**
 * Registry URLs by environment
 */
const REGISTRY_URLS = {
  production: 'https://api.trikhub.com',
  development: 'http://localhost:3001',
} as const;

/**
 * Get the registry base URL based on environment
 * Priority: TRIKHUB_REGISTRY env var > NODE_ENV-based selection
 */
function getRegistryUrl(): string {
  // Allow explicit override via env var (useful for testing)
  if (process.env.TRIKHUB_REGISTRY) {
    return process.env.TRIKHUB_REGISTRY;
  }

  // Use NODE_ENV to determine environment
  const isDev = process.env.NODE_ENV === 'development';
  return isDev ? REGISTRY_URLS.development : REGISTRY_URLS.production;
}

/**
 * API response types (matches registry service)
 */
interface ApiTrikInfo {
  name: string; // Full name like "@demo/article-search"
  scope: string;
  shortName: string;
  description: string;
  categories: string[];
  keywords: string[];
  latestVersion: string;
  totalDownloads: number;
  githubStars: number;
  githubRepo: string;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ApiTrikVersion {
  version: string;
  manifest: unknown;
  gitTag: string;
  commitSha: string;
  publishedAt: string;
  downloads: number;
}

interface ApiTrikDetails extends ApiTrikInfo {
  versions: ApiTrikVersion[];
}

interface ApiSearchResult {
  triks: ApiTrikInfo[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * Convert API response to CLI TrikInfo type
 */
function apiToTrikInfo(api: ApiTrikInfo, versions: TrikVersion[] = []): TrikInfo {
  return {
    fullName: api.name,
    scope: api.scope,
    name: api.shortName,
    githubRepo: api.githubRepo,
    latestVersion: api.latestVersion,
    description: api.description,
    categories: api.categories as TrikInfo['categories'],
    keywords: api.keywords,
    downloads: api.totalDownloads,
    stars: api.githubStars,
    verified: api.verified,
    discussionsUrl: `https://github.com/${api.githubRepo}/discussions`,
    versions,
    createdAt: api.createdAt,
    updatedAt: api.updatedAt,
  };
}

/**
 * Extract runtime from manifest entry
 */
function extractRuntime(manifest: unknown): TrikRuntime | undefined {
  if (
    manifest &&
    typeof manifest === 'object' &&
    'entry' in manifest &&
    manifest.entry &&
    typeof manifest.entry === 'object' &&
    'runtime' in manifest.entry
  ) {
    const runtime = (manifest.entry as { runtime?: string }).runtime;
    if (runtime === 'node' || runtime === 'python') {
      return runtime;
    }
  }
  // Default to 'node' if not specified (matches gateway behavior)
  return 'node';
}

/**
 * Convert API version to CLI TrikVersion type
 */
function apiToTrikVersion(api: ApiTrikVersion): TrikVersion {
  return {
    version: api.version,
    gitTag: api.gitTag,
    commitSha: api.commitSha,
    publishedAt: api.publishedAt,
    downloads: api.downloads,
    runtime: extractRuntime(api.manifest),
  };
}

/**
 * Build a trik path from full name (e.g., "@Molefas/article-search" -> "@Molefas/article-search")
 * Used to construct API paths with scope and name as separate segments
 */
function trikPath(fullName: string): string {
  // fullName format: @scope/name
  // We need to return: @scope/name (scope and name as path segments)
  // The URL will be: /api/v1/triks/@scope/name
  return fullName;
}

/**
 * Registry client class
 */
export class RegistryClient {
  private _explicitBaseUrl?: string;
  private _explicitAuthToken?: string;

  constructor(baseUrl?: string, authToken?: string) {
    // Store explicit overrides if provided
    this._explicitBaseUrl = baseUrl;
    this._explicitAuthToken = authToken;
  }

  /**
   * Get the base URL (evaluated fresh each time to support --dev flag)
   */
  private get baseUrl(): string {
    return this._explicitBaseUrl ?? getRegistryUrl();
  }

  /**
   * Get the auth token
   */
  private get authToken(): string | undefined {
    if (this._explicitAuthToken) {
      return this._explicitAuthToken;
    }
    const config = loadConfig();
    return config.authToken;
  }

  /**
   * Make an API request
   */
  private async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    let response: Response;
    try {
      response = await fetch(url, { ...options, headers });
    } catch (error) {
      // Provide more helpful error message for connection failures
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to connect to registry at ${this.baseUrl}: ${errorMessage}`);
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Authentication failed. Please run `trik login`');
      }
      if (response.status === 404) {
        throw new Error(`Not found: ${path}`);
      }
      const body = await response.text();
      let message = `Registry API error: ${response.status} ${response.statusText}`;
      try {
        const json = JSON.parse(body);
        if (json.error) message = json.error;
      } catch {
        // Use default message
      }
      throw new Error(message);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Search for triks in the registry
   */
  async search(query: string, options: { page?: number; perPage?: number } = {}): Promise<SearchResult> {
    const { page = 1, perPage = 10 } = options;

    const params = new URLSearchParams({
      q: query,
      page: String(page),
      pageSize: String(perPage),
    });

    const result = await this.fetch<ApiSearchResult>(`/api/v1/triks?${params}`);

    return {
      total: result.total,
      page: result.page,
      perPage: result.pageSize,
      results: result.triks.map((t) => apiToTrikInfo(t)),
    };
  }

  /**
   * Get detailed information about a specific trik
   */
  async getTrik(fullName: string): Promise<TrikInfo | null> {
    try {
      // Use path directly - routes expect /api/v1/triks/:scope/:trikName
      const result = await this.fetch<ApiTrikDetails>(`/api/v1/triks/${trikPath(fullName)}`);

      const versions = result.versions.map((v) => apiToTrikVersion(v));
      return apiToTrikInfo(result, versions);
    } catch (error) {
      if (error instanceof Error && error.message.includes('Not found')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get a specific version of a trik
   */
  async getTrikVersion(fullName: string, version: string): Promise<TrikVersion | null> {
    const trik = await this.getTrik(fullName);
    if (!trik) return null;

    return trik.versions.find((v) => v.version === version) ?? null;
  }

  /**
   * Get the latest version of a trik
   */
  async getLatestVersion(fullName: string): Promise<TrikVersion | null> {
    const trik = await this.getTrik(fullName);
    if (!trik) return null;

    return trik.versions[0] ?? null;
  }

  /**
   * List all available triks (paginated)
   */
  async listTriks(options: { page?: number; perPage?: number } = {}): Promise<SearchResult> {
    const { page = 1, perPage = 10 } = options;

    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(perPage),
    });

    const result = await this.fetch<ApiSearchResult>(`/api/v1/triks?${params}`);

    return {
      total: result.total,
      page: result.page,
      perPage: result.pageSize,
      results: result.triks.map((t) => apiToTrikInfo(t)),
    };
  }

  /**
   * Report a download (for analytics)
   */
  async reportDownload(fullName: string, version: string): Promise<void> {
    try {
      // Use path directly - routes expect /api/v1/triks/:scope/:trikName/download
      await fetch(`${this.baseUrl}/api/v1/triks/${trikPath(fullName)}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version }),
      });
    } catch {
      // Silently fail analytics - don't break the install
    }
  }

  // ============================================
  // Authentication Methods
  // ============================================

  /**
   * Start device authorization flow
   * Returns device_code for polling and user_code for user to enter
   */
  async startDeviceAuth(): Promise<DeviceAuthResponse> {
    const response = await fetch(`${this.baseUrl}/auth/device`);

    if (!response.ok) {
      const body = await response.text();
      let message = `Failed to start authentication: ${response.status}`;
      try {
        const json = JSON.parse(body);
        if (json.error) message = json.error;
        if (json.message) message = json.message;
      } catch {
        // Use default message
      }
      throw new Error(message);
    }

    return response.json() as Promise<DeviceAuthResponse>;
  }

  /**
   * Poll for device authorization completion
   * Returns null if still pending, AuthResult when complete
   */
  async pollDeviceAuth(deviceCode: string): Promise<AuthResult | null> {
    const response = await fetch(`${this.baseUrl}/auth/device/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceCode }),
    });

    if (response.status === 202) {
      // Still pending
      return null;
    }

    if (!response.ok) {
      const body = await response.text();
      let message = `Authentication failed: ${response.status}`;
      try {
        const json = JSON.parse(body);
        if (json.error) message = json.error;
      } catch {
        // Use default message
      }
      throw new Error(message);
    }

    return response.json() as Promise<AuthResult>;
  }

  /**
   * Get the current authenticated user
   */
  async getCurrentUser(): Promise<Publisher> {
    if (!this.authToken) {
      throw new Error('Not authenticated. Please run `trik login`');
    }
    return this.fetch<Publisher>('/auth/me');
  }

  /**
   * Logout (invalidate session)
   */
  async logout(): Promise<void> {
    if (!this.authToken) {
      return;
    }
    await this.fetch('/auth/logout', { method: 'POST' });
  }

  // ============================================
  // Publishing Methods
  // ============================================

  /**
   * Register a new trik in the registry
   */
  async registerTrik(data: {
    githubRepo: string;
    name?: string; // Explicit trik name (from manifest.id)
    description?: string;
    categories?: string[];
    keywords?: string[];
  }): Promise<TrikInfo> {
    if (!this.authToken) {
      throw new Error('Not authenticated. Please run `trik login`');
    }

    return this.fetch<TrikInfo>('/api/v1/triks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Publish a new version of a trik
   */
  async publishVersion(
    fullName: string,
    data: {
      version: string;
      gitTag: string;
      commitSha: string;
      manifest: Record<string, unknown>;
    }
  ): Promise<TrikVersion> {
    if (!this.authToken) {
      throw new Error('Not authenticated. Please run `trik login`');
    }

    // Use path directly - routes expect /api/v1/triks/:scope/:trikName/versions
    const result = await this.fetch<ApiTrikVersion>(`/api/v1/triks/${trikPath(fullName)}/versions`, {
      method: 'POST',
      body: JSON.stringify(data),
    });

    return apiToTrikVersion(result);
  }
}

/**
 * Default registry client instance
 */
export const registry = new RegistryClient();
