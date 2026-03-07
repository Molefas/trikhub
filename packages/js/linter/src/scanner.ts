import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SecurityTier = 'A' | 'B' | 'C' | 'D';

export type CapabilityCategory =
  | 'filesystem'
  | 'network'
  | 'process'
  | 'environment'
  | 'crypto'
  | 'dns'
  | 'workers'
  | 'storage'
  | 'trik_management'
  | 'dynamic_code';

export interface CapabilityMatch {
  category: CapabilityCategory;
  locations: { file: string; line: number }[];
}

export interface ScanResult {
  tier: SecurityTier;
  tierLabel: string;
  capabilities: CapabilityMatch[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Source file extensions to scan */
const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
]);

/** Directories to skip when walking the file tree */
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '__pycache__',
  '.venv',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
]);

// ---------------------------------------------------------------------------
// Capability regex patterns (matched per-line)
// ---------------------------------------------------------------------------

const CAPABILITY_PATTERNS: Record<CapabilityCategory, RegExp[]> = {
  filesystem: [
    /\b(?:require|import)\s*\(?\s*['"](?:node:)?fs(?:\/promises)?['"]/,
    /\bfrom\s+['"](?:node:)?fs(?:\/promises)?['"]/,
    /\bimport\s+(?:pathlib|shutil)\b/,
    /\bfrom\s+(?:pathlib|shutil)\s+import\b/,
    /\bimport\s+os\.path\b/,
    /\bfrom\s+os\.path\s+import\b/,
    /\bfrom\s+os\s+import\s+path\b/,
    // SQLite — direct DB access bypasses storage scoping
    /\b(?:require|import)\s*\(?\s*['"](?:node:)?sqlite['"]/,
    /\bfrom\s+['"](?:node:)?sqlite['"]/,
    /\bimport\s+sqlite3\b/,
    /\bfrom\s+sqlite3\s+import\b/,
    // better-sqlite3 / sql.js / other popular SQLite packages
    /\b(?:require|import)\s*\(?\s*['"]better-sqlite3['"]/,
    /\bfrom\s+['"]better-sqlite3['"]/,
    /\b(?:require|import)\s*\(?\s*['"]sql\.js['"]/,
    /\bfrom\s+['"]sql\.js['"]/,
  ],

  network: [
    /\b(?:require|import)\s*\(?\s*['"](?:node:)?(?:http|https|net)['"]/,
    /\bfrom\s+['"](?:node:)?(?:http|https|net)['"]/,
    /\bfetch\s*\(/,
    /\b(?:require|import)\s*\(?\s*['"]axios['"]/,
    /\bfrom\s+['"]axios['"]/,
    /\bimport\s+(?:requests|urllib|httpx|aiohttp)\b/,
    /\bfrom\s+(?:requests|urllib|httpx|aiohttp)[\s.]/,
  ],

  process: [
    /\b(?:require|import)\s*\(?\s*['"](?:node:)?child_process['"]/,
    /\bfrom\s+['"](?:node:)?child_process['"]/,
    /\beval\s*\(/,
    /\bnew\s+Function\s*\(/,
    /\bimport\s+subprocess\b/,
    /\bfrom\s+subprocess\s+import\b/,
    /\bos\.system\s*\(/,
    /(?<!\.\s*)exec\s*\(/,
  ],

  environment: [
    /\bprocess\.env\b/,
    /\bos\.environ\b/,
    /\b(?:require|import)\s*\(?\s*['"]dotenv['"]/,
    /\bfrom\s+['"]dotenv['"]/,
    /\bimport\s+dotenv\b/,
    /\bfrom\s+dotenv\s+import\b/,
  ],

  crypto: [
    /\b(?:require|import)\s*\(?\s*['"](?:node:)?(?:crypto|tls)['"]/,
    /\bfrom\s+['"](?:node:)?(?:crypto|tls)['"]/,
    /\bimport\s+(?:hashlib|ssl|cryptography)\b/,
    /\bfrom\s+(?:hashlib|ssl|cryptography)[\s.]/,
  ],

  dns: [
    /\b(?:require|import)\s*\(?\s*['"](?:node:)?(?:dns|dgram)['"]/,
    /\bfrom\s+['"](?:node:)?(?:dns|dgram)['"]/,
  ],

  workers: [
    /\b(?:require|import)\s*\(?\s*['"](?:node:)?(?:worker_threads|cluster)['"]/,
    /\bfrom\s+['"](?:node:)?(?:worker_threads|cluster)['"]/,
    /\bimport\s+(?:threading|multiprocessing)\b/,
    /\bfrom\s+(?:threading|multiprocessing)\s+import\b/,
  ],

  storage: [
    // context.storage.get/set/delete/list/getMany/setMany
    /\bcontext\.storage\b/,
    /\bself\.context\.storage\b/,
    /\bctx\.storage\b/,
  ],

  trik_management: [
    // context.registry.search/install/uninstall/upgrade/list/getInfo
    /\bcontext\.registry\b/,
    /\bself\.context\.registry\b/,
    /\bctx\.registry\b/,
  ],

  dynamic_code: [
    // Dynamic import with variable (not string literal)
    // Matches: import(variable) but NOT import('./literal') or import("literal")
    /\bimport\s*\(\s*(?!['"`])/,
    // Python __import__
    /\b__import__\s*\(/,
    // globalThis or window property access for dynamic require
    /\bglobalThis\s*\[\s*['"]require['"]\s*\]/,
  ],
};

// ---------------------------------------------------------------------------
// Tier labels
// ---------------------------------------------------------------------------

const TIER_LABELS: Record<SecurityTier, string> = {
  A: 'Sandboxed',
  B: 'Network',
  C: 'System',
  D: 'Unrestricted',
};

// ---------------------------------------------------------------------------
// Tier resolution
// ---------------------------------------------------------------------------

/**
 * Determine the security tier from the set of detected capability categories.
 *
 * Tier logic:
 *   A (Sandboxed)     — no capabilities detected
 *   B (Network)       — only network and/or crypto detected
 *   C (System)        — filesystem, environment, or dns detected
 *   D (Unrestricted)  — process, workers, or dynamic_code detected
 *
 * Note: storage and trik_management are gated at runtime and do not affect
 * the security tier independently.
 */
function resolveTier(categories: Set<CapabilityCategory>): SecurityTier {
  if (categories.size === 0) {
    return 'A';
  }

  // D: process, workers, or dynamic_code present
  if (
    categories.has('process') ||
    categories.has('workers') ||
    categories.has('dynamic_code')
  ) {
    return 'D';
  }

  // C: filesystem, environment, or dns present
  if (
    categories.has('filesystem') ||
    categories.has('environment') ||
    categories.has('dns')
  ) {
    return 'C';
  }

  // Remaining non-tier-affecting categories (storage, trik_management)
  // should not bump tier above what other categories determine
  const tierAffecting = new Set(
    [...categories].filter((c) => c !== 'storage' && c !== 'trik_management'),
  );

  if (tierAffecting.size === 0) return 'A';

  // If only network and/or crypto remain, tier is B
  for (const cat of tierAffecting) {
    if (cat !== 'network' && cat !== 'crypto') {
      return 'C'; // safety fallback — should not be reached
    }
  }

  return 'B';
}

// ---------------------------------------------------------------------------
// File walking
// ---------------------------------------------------------------------------

/**
 * Recursively collect source file paths under `dir`, skipping excluded dirs.
 */
async function walkSourceFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      // Permission error or missing dir — skip silently
      return;
    }

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          await walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = fullPath.slice(fullPath.lastIndexOf('.'));
        if (SOURCE_EXTENSIONS.has(ext)) {
          results.push(fullPath);
        }
      }
    }
  }

  await walk(dir);
  return results;
}

// ---------------------------------------------------------------------------
// Core scanner
// ---------------------------------------------------------------------------

/**
 * Scan all source files under `trikPath` for capability usage.
 *
 * Walks `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, and `.py` files,
 * matches regex patterns per line against capability categories, and returns
 * the resolved security tier together with all capability matches.
 */
export async function scanCapabilities(trikPath: string): Promise<ScanResult> {
  const files = await walkSourceFiles(trikPath);

  // category → { file, line }[]
  const matchMap = new Map<CapabilityCategory, { file: string; line: number }[]>();

  for (const filePath of files) {
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      continue; // unreadable file — skip
    }

    const lines = content.split('\n');
    const relPath = relative(trikPath, filePath);

    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      for (const [category, patterns] of Object.entries(CAPABILITY_PATTERNS) as [
        CapabilityCategory,
        RegExp[],
      ][]) {
        for (const pattern of patterns) {
          if (pattern.test(lineText)) {
            let locations = matchMap.get(category);
            if (!locations) {
              locations = [];
              matchMap.set(category, locations);
            }
            locations.push({ file: relPath, line: i + 1 });
            // One match per category per line is enough — break out of patterns
            break;
          }
        }
      }
    }
  }

  const capabilities: CapabilityMatch[] = [];
  for (const [category, locations] of matchMap) {
    capabilities.push({ category, locations });
  }

  const detectedCategories = new Set(matchMap.keys());
  const tier = resolveTier(detectedCategories);

  return {
    tier,
    tierLabel: TIER_LABELS[tier],
    capabilities,
  };
}

// ---------------------------------------------------------------------------
// Cross-check
// ---------------------------------------------------------------------------

/**
 * Maps scanner capability categories to manifest capability fields.
 */
const CATEGORY_TO_MANIFEST: Record<string, { field: string; path: (caps: Record<string, unknown>) => boolean }> = {
  filesystem: {
    field: 'filesystem',
    path: (caps) => !!(caps.filesystem as Record<string, unknown>)?.enabled,
  },
  process: {
    field: 'shell',
    path: (caps) => !!(caps.shell as Record<string, unknown>)?.enabled,
  },
  storage: {
    field: 'storage',
    path: (caps) => !!(caps.storage as Record<string, unknown>)?.enabled,
  },
  trik_management: {
    field: 'trikManagement',
    path: (caps) => !!(caps.trikManagement as Record<string, unknown>)?.enabled,
  },
};

export interface CrossCheckResult {
  type: 'error' | 'warning';
  /** The manifest capability field name (e.g., 'filesystem', 'shell') */
  capability?: string;
  /** The scanner category that triggered this (e.g., 'filesystem', 'process') */
  category: string;
  message: string;
  locations: { file: string; line: number }[];
}

/**
 * Cross-check scanner results against manifest declarations.
 *
 * Returns errors for undeclared capabilities and warnings for suspicious patterns.
 * An empty array means the manifest accurately declares all detected capabilities.
 */
export function crossCheckManifest(
  scan: ScanResult,
  manifest: Record<string, unknown>,
): CrossCheckResult[] {
  const results: CrossCheckResult[] = [];
  const caps = (manifest.capabilities ?? {}) as Record<string, unknown>;

  for (const cap of scan.capabilities) {
    const mapping = CATEGORY_TO_MANIFEST[cap.category];
    if (mapping) {
      if (!mapping.path(caps)) {
        results.push({
          type: 'error',
          capability: mapping.field,
          category: cap.category,
          message:
            `Source code uses ${cap.category} capabilities but manifest does not declare capabilities.${mapping.field}.enabled. ` +
            `Add "capabilities": { "${mapping.field}": { "enabled": true } } to your manifest.json.`,
          locations: cap.locations,
        });
      }
    } else if (cap.category === 'dynamic_code') {
      results.push({
        type: 'error',
        category: 'dynamic_code',
        message:
          `Source code uses dynamic code execution patterns (dynamic import, __import__, etc.) ` +
          `that bypass static analysis. These patterns are not allowed in published triks.`,
        locations: cap.locations,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format a `ScanResult` for human-readable console output.
 */
export function formatScanResult(result: ScanResult): string {
  const lines: string[] = [];

  lines.push(`Security Tier: ${result.tier} (${result.tierLabel})`);

  if (result.capabilities.length === 0) {
    lines.push('No capabilities detected.');
    return lines.join('\n');
  }

  lines.push('');
  lines.push('Detected capabilities:');

  for (const cap of result.capabilities) {
    lines.push(`  ${cap.category} (${cap.locations.length} occurrence${cap.locations.length === 1 ? '' : 's'})`);
    for (const loc of cap.locations) {
      lines.push(`    ${loc.file}:${loc.line}`);
    }
  }

  return lines.join('\n');
}
