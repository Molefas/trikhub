/**
 * Tests for the capability scanner (scanner.ts).
 *
 * Each test creates a temp directory with source files, calls scanCapabilities(),
 * and asserts the resulting tier and capabilities.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Dynamic import against built output
const { scanCapabilities, formatScanResult, crossCheckManifest } = await import(
  '../../packages/js/linter/dist/scanner.js'
) as typeof import('../../packages/js/linter/src/scanner.js');

const testDir = join(tmpdir(), `scanner-test-${Date.now()}`);

/** Helper to create a temp trik directory with the given files */
async function makeTrik(
  name: string,
  files: Record<string, string>,
): Promise<string> {
  const dir = join(testDir, name);
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(dir, relPath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content);
  }
  return dir;
}

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. Detects filesystem usage in JS files
// ---------------------------------------------------------------------------
describe('filesystem detection', () => {
  it('detects filesystem usage in JS files', async () => {
    const dir = await makeTrik('fs-js', {
      'src/index.ts': `import fs from 'node:fs';\nconsole.log('hello');`,
    });

    const result = await scanCapabilities(dir);

    const fsCap = result.capabilities.find((c) => c.category === 'filesystem');
    expect(fsCap).toBeDefined();
    expect(fsCap!.locations.length).toBeGreaterThan(0);
  });

  it('detects fs/promises import', async () => {
    const dir = await makeTrik('fs-promises', {
      'src/reader.js': `import { readFile } from 'fs/promises';`,
    });

    const result = await scanCapabilities(dir);

    const fsCap = result.capabilities.find((c) => c.category === 'filesystem');
    expect(fsCap).toBeDefined();
  });

  it('detects Python pathlib import', async () => {
    const dir = await makeTrik('fs-py-pathlib', {
      'src/main.py': `import pathlib\npath = pathlib.Path('.')`,
    });

    const result = await scanCapabilities(dir);

    const fsCap = result.capabilities.find((c) => c.category === 'filesystem');
    expect(fsCap).toBeDefined();
  });

  it('detects node:sqlite import', async () => {
    const dir = await makeTrik('fs-sqlite-node', {
      'src/index.ts': `import { DatabaseSync } from 'node:sqlite';`,
    });

    const result = await scanCapabilities(dir);

    const fsCap = result.capabilities.find((c) => c.category === 'filesystem');
    expect(fsCap).toBeDefined();
  });

  it('detects Python sqlite3 import', async () => {
    const dir = await makeTrik('fs-sqlite3-py', {
      'src/db.py': `import sqlite3\nconn = sqlite3.connect('test.db')`,
    });

    const result = await scanCapabilities(dir);

    const fsCap = result.capabilities.find((c) => c.category === 'filesystem');
    expect(fsCap).toBeDefined();
  });

  it('detects better-sqlite3 import', async () => {
    const dir = await makeTrik('fs-better-sqlite3', {
      'src/db.ts': `import Database from 'better-sqlite3';`,
    });

    const result = await scanCapabilities(dir);

    const fsCap = result.capabilities.find((c) => c.category === 'filesystem');
    expect(fsCap).toBeDefined();
  });

  it('detects sql.js import', async () => {
    const dir = await makeTrik('fs-sqljs', {
      'src/db.ts': `import initSqlJs from 'sql.js';`,
    });

    const result = await scanCapabilities(dir);

    const fsCap = result.capabilities.find((c) => c.category === 'filesystem');
    expect(fsCap).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Detects network usage in Python files
// ---------------------------------------------------------------------------
describe('network detection', () => {
  it('detects network usage in Python files', async () => {
    const dir = await makeTrik('net-py', {
      'src/client.py': `import requests\nresponse = requests.get('https://example.com')`,
    });

    const result = await scanCapabilities(dir);

    const netCap = result.capabilities.find((c) => c.category === 'network');
    expect(netCap).toBeDefined();
    expect(netCap!.locations.length).toBeGreaterThan(0);
  });

  it('detects fetch() usage', async () => {
    const dir = await makeTrik('net-fetch', {
      'src/api.ts': `const data = await fetch('https://api.example.com');`,
    });

    const result = await scanCapabilities(dir);

    const netCap = result.capabilities.find((c) => c.category === 'network');
    expect(netCap).toBeDefined();
  });

  it('detects axios import', async () => {
    const dir = await makeTrik('net-axios', {
      'src/http.js': `import axios from 'axios';`,
    });

    const result = await scanCapabilities(dir);

    const netCap = result.capabilities.find((c) => c.category === 'network');
    expect(netCap).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Detects process execution
// ---------------------------------------------------------------------------
describe('process detection', () => {
  it('detects child_process import', async () => {
    const dir = await makeTrik('proc-cp', {
      'src/exec.ts': `import { exec } from 'node:child_process';`,
    });

    const result = await scanCapabilities(dir);

    const procCap = result.capabilities.find((c) => c.category === 'process');
    expect(procCap).toBeDefined();
  });

  it('detects eval() usage', async () => {
    const dir = await makeTrik('proc-eval', {
      'src/danger.js': `const result = eval('1 + 2');`,
    });

    const result = await scanCapabilities(dir);

    const procCap = result.capabilities.find((c) => c.category === 'process');
    expect(procCap).toBeDefined();
  });

  it('detects new Function()', async () => {
    const dir = await makeTrik('proc-function', {
      'src/dynamic.ts': `const fn = new Function('return 42');`,
    });

    const result = await scanCapabilities(dir);

    const procCap = result.capabilities.find((c) => c.category === 'process');
    expect(procCap).toBeDefined();
  });

  it('detects Python subprocess import', async () => {
    const dir = await makeTrik('proc-subprocess', {
      'src/run.py': `import subprocess\nsubprocess.run(['ls'])`,
    });

    const result = await scanCapabilities(dir);

    const procCap = result.capabilities.find((c) => c.category === 'process');
    expect(procCap).toBeDefined();
  });

  it('detects os.system() usage in Python', async () => {
    const dir = await makeTrik('proc-ossystem', {
      'src/shell.py': `import os\nos.system('ls -la')`,
    });

    const result = await scanCapabilities(dir);

    const procCap = result.capabilities.find((c) => c.category === 'process');
    expect(procCap).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Detects environment access
// ---------------------------------------------------------------------------
describe('environment detection', () => {
  it('detects process.env access', async () => {
    const dir = await makeTrik('env-processenv', {
      'src/config.ts': `const key = process.env.API_KEY;`,
    });

    const result = await scanCapabilities(dir);

    const envCap = result.capabilities.find((c) => c.category === 'environment');
    expect(envCap).toBeDefined();
  });

  it('detects dotenv import', async () => {
    const dir = await makeTrik('env-dotenv', {
      'src/config.js': `import dotenv from 'dotenv';`,
    });

    const result = await scanCapabilities(dir);

    const envCap = result.capabilities.find((c) => c.category === 'environment');
    expect(envCap).toBeDefined();
  });

  it('detects os.environ in Python', async () => {
    const dir = await makeTrik('env-python', {
      'src/env.py': `import os\napi_key = os.environ["API_KEY"]`,
    });

    const result = await scanCapabilities(dir);

    const envCap = result.capabilities.find((c) => c.category === 'environment');
    expect(envCap).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 5. Returns tier A for clean trik
// ---------------------------------------------------------------------------
describe('tier assignment', () => {
  it('returns tier A for clean trik', async () => {
    const dir = await makeTrik('clean', {
      'src/index.ts': `export function greet(name: string) { return "Hello " + name; }`,
    });

    const result = await scanCapabilities(dir);

    expect(result.tier).toBe('A');
    expect(result.tierLabel).toBe('Sandboxed');
    expect(result.capabilities).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // 6. Returns tier B for network-only trik
  // ---------------------------------------------------------------------------
  it('returns tier B for network-only trik', async () => {
    const dir = await makeTrik('network-only', {
      'src/api.ts': `const data = await fetch('https://example.com');`,
    });

    const result = await scanCapabilities(dir);

    expect(result.tier).toBe('B');
    expect(result.tierLabel).toBe('Network');
  });

  it('returns tier B for network + crypto trik', async () => {
    const dir = await makeTrik('net-crypto', {
      'src/api.ts': `const data = await fetch('https://example.com');`,
      'src/hash.ts': `import crypto from 'node:crypto';`,
    });

    const result = await scanCapabilities(dir);

    expect(result.tier).toBe('B');
    expect(result.tierLabel).toBe('Network');
  });

  it('returns tier B for crypto-only trik', async () => {
    const dir = await makeTrik('crypto-only', {
      'src/hash.ts': `import crypto from 'node:crypto';`,
    });

    const result = await scanCapabilities(dir);

    expect(result.tier).toBe('B');
  });

  // ---------------------------------------------------------------------------
  // 7. Returns tier C for filesystem + network trik
  // ---------------------------------------------------------------------------
  it('returns tier C for filesystem + network trik', async () => {
    const dir = await makeTrik('fs-net', {
      'src/reader.ts': `import fs from 'node:fs';`,
      'src/api.ts': `const data = await fetch('https://example.com');`,
    });

    const result = await scanCapabilities(dir);

    expect(result.tier).toBe('C');
    expect(result.tierLabel).toBe('System');
    expect(result.capabilities.length).toBeGreaterThanOrEqual(2);
  });

  it('returns tier C for environment access', async () => {
    const dir = await makeTrik('env-only', {
      'src/config.ts': `const key = process.env.API_KEY;`,
    });

    const result = await scanCapabilities(dir);

    expect(result.tier).toBe('C');
  });

  it('returns tier C for dns access', async () => {
    const dir = await makeTrik('dns-only', {
      'src/lookup.ts': `import dns from 'node:dns';`,
    });

    const result = await scanCapabilities(dir);

    expect(result.tier).toBe('C');
  });

  // ---------------------------------------------------------------------------
  // 8. Returns tier D for process execution trik
  // ---------------------------------------------------------------------------
  it('returns tier D for process execution trik', async () => {
    const dir = await makeTrik('proc-exec', {
      'src/index.ts': `import { exec } from 'node:child_process';\nexec('echo hello');`,
    });

    const result = await scanCapabilities(dir);

    expect(result.tier).toBe('D');
    expect(result.tierLabel).toBe('Unrestricted');
  });

  it('returns tier D for workers usage', async () => {
    const dir = await makeTrik('workers', {
      'src/worker.ts': `import { Worker } from 'node:worker_threads';`,
    });

    const result = await scanCapabilities(dir);

    expect(result.tier).toBe('D');
  });

  it('returns tier D when process is mixed with other capabilities', async () => {
    const dir = await makeTrik('mixed-proc', {
      'src/index.ts': `import fs from 'node:fs';\nimport { exec } from 'node:child_process';`,
      'src/api.ts': `const data = await fetch('https://example.com');`,
    });

    const result = await scanCapabilities(dir);

    expect(result.tier).toBe('D');
  });
});

// ---------------------------------------------------------------------------
// 9. Skips node_modules and dist directories
// ---------------------------------------------------------------------------
describe('directory exclusion', () => {
  it('skips node_modules and dist directories', async () => {
    const dir = await makeTrik('excludes', {
      'src/index.ts': `export const clean = true;`,
      'node_modules/evil/index.js': `import fs from 'node:fs';`,
      'dist/bundle.js': `import { exec } from 'node:child_process';`,
    });

    const result = await scanCapabilities(dir);

    expect(result.tier).toBe('A');
    expect(result.capabilities).toHaveLength(0);
  });

  it('skips Python cache directories', async () => {
    const dir = await makeTrik('py-excludes', {
      'src/main.py': `print("clean")`,
      '__pycache__/cached.py': `import subprocess`,
      '.venv/lib/deps.py': `import requests`,
    });

    const result = await scanCapabilities(dir);

    expect(result.tier).toBe('A');
    expect(result.capabilities).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 10. Includes file and line references in capabilities
// ---------------------------------------------------------------------------
describe('location tracking', () => {
  it('includes file and line references in capabilities', async () => {
    const dir = await makeTrik('locations', {
      'src/index.ts': [
        'const a = 1;',
        'const b = 2;',
        "import fs from 'node:fs';",
        'const c = 3;',
        'const d = process.env.KEY;',
      ].join('\n'),
    });

    const result = await scanCapabilities(dir);

    // Filesystem match should be on line 3
    const fsCap = result.capabilities.find((c) => c.category === 'filesystem');
    expect(fsCap).toBeDefined();
    expect(fsCap!.locations).toContainEqual({
      file: 'src/index.ts',
      line: 3,
    });

    // Environment match should be on line 5
    const envCap = result.capabilities.find((c) => c.category === 'environment');
    expect(envCap).toBeDefined();
    expect(envCap!.locations).toContainEqual({
      file: 'src/index.ts',
      line: 5,
    });
  });

  it('tracks multiple files and lines', async () => {
    const dir = await makeTrik('multi-loc', {
      'src/a.ts': `import fs from 'node:fs';`,
      'src/b.ts': `import { readFile } from 'node:fs/promises';`,
    });

    const result = await scanCapabilities(dir);

    const fsCap = result.capabilities.find((c) => c.category === 'filesystem');
    expect(fsCap).toBeDefined();
    expect(fsCap!.locations).toHaveLength(2);

    const files = fsCap!.locations.map((l) => l.file).sort();
    expect(files).toContain('src/a.ts');
    expect(files).toContain('src/b.ts');
  });
});

// ── SDK context detection ──────────────────────────────────────────────

describe('SDK context detection', () => {
  it('detects context.storage usage in JS', async () => {
    const dir = await makeTrik('ctx-storage-js', {
      'src/index.ts': `
        export default {
          async processMessage(message, context) {
            const val = await context.storage.get('key');
            return { message: val, transferBack: false };
          }
        };
      `,
    });
    const result = await scanCapabilities(dir);
    const cap = result.capabilities.find((c) => c.category === 'storage');
    expect(cap).toBeDefined();
  });

  it('detects context.storage usage in Python', async () => {
    const dir = await makeTrik('ctx-storage-py', {
      'agent.py': `
async def process_message(self, message, context):
    val = await context.storage.get("key")
    return {"message": str(val), "transferBack": False}
      `,
    });
    const result = await scanCapabilities(dir);
    const cap = result.capabilities.find((c) => c.category === 'storage');
    expect(cap).toBeDefined();
  });

  it('detects context.registry usage in JS', async () => {
    const dir = await makeTrik('ctx-registry-js', {
      'src/index.ts': `
        export default {
          async processMessage(message, context) {
            const results = await context.registry.search('test');
            return { message: 'done', transferBack: false };
          }
        };
      `,
    });
    const result = await scanCapabilities(dir);
    const cap = result.capabilities.find((c) => c.category === 'trik_management');
    expect(cap).toBeDefined();
  });

  it('detects context.registry usage in Python', async () => {
    const dir = await makeTrik('ctx-registry-py', {
      'agent.py': `
async def process_message(self, message, context):
    results = await context.registry.search("test")
    return {"message": "done", "transferBack": False}
      `,
    });
    const result = await scanCapabilities(dir);
    const cap = result.capabilities.find((c) => c.category === 'trik_management');
    expect(cap).toBeDefined();
  });
});

describe('suspicious pattern detection', () => {
  it('detects dynamic import()', async () => {
    const dir = await makeTrik('dynamic-import', {
      'src/index.ts': `const mod = await import(someVar);`,
    });
    const result = await scanCapabilities(dir);
    const cap = result.capabilities.find((c) => c.category === 'dynamic_code');
    expect(cap).toBeDefined();
  });

  it('detects __import__ in Python', async () => {
    const dir = await makeTrik('dunder-import', {
      'agent.py': `mod = __import__("os")`,
    });
    const result = await scanCapabilities(dir);
    const cap = result.capabilities.find((c) => c.category === 'dynamic_code');
    expect(cap).toBeDefined();
  });

  it('does not flag static import() with string literal', async () => {
    const dir = await makeTrik('static-import', {
      'src/index.ts': `const mod = await import('./local-module');`,
    });
    const result = await scanCapabilities(dir);
    const cap = result.capabilities.find((c) => c.category === 'dynamic_code');
    expect(cap).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// crossCheckManifest
// ---------------------------------------------------------------------------
describe('crossCheckManifest', () => {
  it('returns error when filesystem detected but not declared', async () => {
    const dir = await makeTrik('xcheck-fs-undeclared', {
      'src/index.ts': `import fs from 'node:fs';`,
    });
    const scan = await scanCapabilities(dir);
    const manifest = { capabilities: {} };
    const errors = crossCheckManifest(scan, manifest);
    expect(errors).toContainEqual(
      expect.objectContaining({
        type: 'error',
        capability: 'filesystem',
      })
    );
  });

  it('returns no errors when filesystem detected and declared', async () => {
    const dir = await makeTrik('xcheck-fs-declared', {
      'src/index.ts': `import fs from 'node:fs';`,
    });
    const scan = await scanCapabilities(dir);
    const manifest = { capabilities: { filesystem: { enabled: true } } };
    const errors = crossCheckManifest(scan, manifest);
    expect(errors).toEqual([]);
  });

  it('returns error when process detected but shell not declared', async () => {
    const dir = await makeTrik('xcheck-shell-undeclared', {
      'src/index.ts': `import { exec } from 'node:child_process';`,
    });
    const scan = await scanCapabilities(dir);
    const manifest = { capabilities: {} };
    const errors = crossCheckManifest(scan, manifest);
    expect(errors).toContainEqual(
      expect.objectContaining({
        type: 'error',
        capability: 'shell',
      })
    );
  });

  it('returns error when storage usage detected but not declared', async () => {
    const dir = await makeTrik('xcheck-storage-undeclared', {
      'src/index.ts': `const val = await context.storage.get('key');`,
    });
    const scan = await scanCapabilities(dir);
    const manifest = { capabilities: {} };
    const errors = crossCheckManifest(scan, manifest);
    expect(errors).toContainEqual(
      expect.objectContaining({
        type: 'error',
        capability: 'storage',
      })
    );
  });

  it('returns error when registry usage detected but trikManagement not declared', async () => {
    const dir = await makeTrik('xcheck-registry-undeclared', {
      'src/index.ts': `const r = await context.registry.search('q');`,
    });
    const scan = await scanCapabilities(dir);
    const manifest = { capabilities: {} };
    const errors = crossCheckManifest(scan, manifest);
    expect(errors).toContainEqual(
      expect.objectContaining({
        type: 'error',
        capability: 'trikManagement',
      })
    );
  });

  it('returns error for dynamic_code patterns', async () => {
    const dir = await makeTrik('xcheck-dynamic', {
      'src/index.ts': `const mod = await import(someVar);`,
    });
    const scan = await scanCapabilities(dir);
    const manifest = { capabilities: {} };
    const errors = crossCheckManifest(scan, manifest);
    expect(errors).toContainEqual(
      expect.objectContaining({
        type: 'error',
        category: 'dynamic_code',
      })
    );
  });
});

// ---------------------------------------------------------------------------
// formatScanResult
// ---------------------------------------------------------------------------
describe('formatScanResult', () => {
  it('formats clean result', async () => {
    const dir = await makeTrik('fmt-clean', {
      'src/index.ts': `export const x = 1;`,
    });

    const result = await scanCapabilities(dir);
    const output = formatScanResult(result);

    expect(output).toContain('Security Tier: A (Sandboxed)');
    expect(output).toContain('No capabilities detected.');
  });

  it('formats result with capabilities', async () => {
    const dir = await makeTrik('fmt-caps', {
      'src/index.ts': `import fs from 'node:fs';\nconst data = await fetch('https://example.com');`,
    });

    const result = await scanCapabilities(dir);
    const output = formatScanResult(result);

    expect(output).toContain('Security Tier: C (System)');
    expect(output).toContain('Detected capabilities:');
    expect(output).toContain('filesystem');
    expect(output).toContain('network');
  });
});
