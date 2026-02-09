/**
 * TrikHub Types
 *
 * Core type definitions for the TrikHub ecosystem.
 */

/**
 * trikhub.json - Registry metadata for a trik
 * This file lives alongside manifest.json in a trik repository
 */
export interface TrikHubMetadata {
  /** Human-readable display name */
  displayName: string;

  /** Short description (max 160 chars, for search results) */
  shortDescription: string;

  /** Categories for browsing/filtering */
  categories: TrikCategory[];

  /** Keywords for search */
  keywords: string[];

  /** Author information */
  author: {
    name: string;
    github: string;
    email?: string;
  };

  /** GitHub repository URL */
  repository: string;

  /** Optional homepage/docs URL */
  homepage?: string;

  /** Optional funding URL (GitHub Sponsors, etc.) */
  funding?: string;

  /** Optional icon URL (should be square, min 128x128) */
  icon?: string;
}

/**
 * Predefined categories for triks
 */
export type TrikCategory =
  | 'search'
  | 'content'
  | 'productivity'
  | 'communication'
  | 'data'
  | 'developer'
  | 'finance'
  | 'entertainment'
  | 'education'
  | 'utilities'
  | 'other';

/**
 * Trik information returned from the registry
 */
export interface TrikInfo {
  /** Scoped name (e.g., "@acme/article-search") */
  fullName: string;

  /** Scope (e.g., "@acme") */
  scope: string;

  /** Name without scope (e.g., "article-search") */
  name: string;

  /** GitHub repository (e.g., "acme/trikhub-article-search") */
  githubRepo: string;

  /** Latest version */
  latestVersion: string;

  /** Description from trikhub.json */
  description: string;

  /** Categories */
  categories: TrikCategory[];

  /** Keywords */
  keywords: string[];

  /** Total download count */
  downloads: number;

  /** GitHub stars (cached) */
  stars: number;

  /** Whether the publisher is verified */
  verified: boolean;

  /** GitHub Discussions URL */
  discussionsUrl?: string;

  /** Available versions */
  versions: TrikVersion[];

  /** Timestamps */
  createdAt: string;
  updatedAt: string;
}

/**
 * Version information for a trik
 */
export interface TrikVersion {
  /** Semantic version (e.g., "1.2.3") */
  version: string;

  /** Git tag (e.g., "v1.2.3") */
  gitTag: string;

  /** Git commit SHA for immutability verification */
  commitSha: string;

  /** When this version was published */
  publishedAt: string;

  /** Download count for this version */
  downloads: number;
}

/**
 * Installed trik entry in the lockfile
 */
export interface InstalledTrik {
  /** Scoped name */
  fullName: string;

  /** Installed version */
  version: string;

  /** GitHub repo it was installed from */
  githubRepo: string;

  /** Git tag used */
  gitTag: string;

  /** When it was installed */
  installedAt: string;

  /** Commit SHA for integrity verification */
  commitSha: string;
}

/**
 * Lockfile structure (~/.trikhub/triks.lock)
 */
export interface TrikLockfile {
  /** Lockfile format version */
  lockfileVersion: 1;

  /** Map of installed triks by full name */
  triks: Record<string, InstalledTrik>;
}

/**
 * CLI configuration (~/.trikhub/config.json)
 */
export interface TrikConfig {
  /** Directory where triks are installed */
  triksDirectory: string;

  /** Whether to send anonymous analytics */
  analytics: boolean;

  /** Authentication token for registry API */
  authToken?: string;

  /** When the auth token expires */
  authExpiresAt?: string;

  /** Username of the authenticated publisher */
  publisherUsername?: string;
}

/**
 * Publisher information from the registry
 */
export interface Publisher {
  id: number;
  username: string;
  displayName: string;
  avatarUrl: string;
  verified: boolean;
  createdAt: string;
}

/**
 * Device authorization response from registry
 */
export interface DeviceAuthResponse {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  interval: number;
}

/**
 * Auth result after successful device flow
 */
export interface AuthResult {
  accessToken: string;
  expiresAt: string;
  publisher: Publisher;
}

/**
 * Search results from the registry
 */
export interface SearchResult {
  /** Total number of results */
  total: number;

  /** Current page */
  page: number;

  /** Results per page */
  perPage: number;

  /** The trik results */
  results: TrikInfo[];
}

/**
 * Parse a scoped trik name into its parts
 * @example parseTrikName("@acme/article-search") => { scope: "@acme", name: "article-search", fullName: "@acme/article-search" }
 * @example parseTrikName("@acme/article-search@1.2.3") => { scope: "@acme", name: "article-search", fullName: "@acme/article-search", version: "1.2.3" }
 */
export function parseTrikName(input: string): {
  scope: string;
  name: string;
  fullName: string;
  version?: string;
} {
  // Match @scope/name or @scope/name@version
  const match = input.match(/^(@[^/]+)\/([^@]+)(?:@(.+))?$/);

  if (!match) {
    throw new Error(
      `Invalid trik name: "${input}". Expected format: @scope/name or @scope/name@version`
    );
  }

  const [, rawScope, rawName, version] = match;

  // Normalize to lowercase for consistency
  const scope = rawScope.toLowerCase();
  const name = rawName.toLowerCase();

  return {
    scope,
    name,
    fullName: `${scope}/${name}`,
    version,
  };
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: TrikConfig = {
  triksDirectory: '~/.trikhub/triks',
  analytics: true,
};
