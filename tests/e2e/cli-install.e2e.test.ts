/**
 * E2E Tests for TrikHub CLI Install/Uninstall
 *
 * Tests the complete install/uninstall workflow for both:
 * - Node.js CLI (@trikhub/cli)
 * - Python CLI (trikhub)
 *
 * Tests cover:
 * - Same-runtime installation (JS trik in JS project, Python trik in Python project)
 * - Cross-runtime installation (JS trik in Python project, Python trik in JS project)
 * - Uninstallation and cleanup
 *
 * Test triks (permanently published):
 * - @molefas/trik-article-search (JavaScript)
 * - @molefas/trik-article-search-py (Python)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import {
  runJsCli,
  runPyCli,
  createJsTestProject,
  createPyTestProject,
  TestProject,
  assertTrikInConfig,
  assertTrikNotInConfig,
  assertTrikInTriksDir,
  assertTrikNotInTriksDir,
  assertTrikInPackageJson,
  assertTrikHasNodeModules,
  readTriksConfig,
} from './helpers/index.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Test trik names (permanently published)
const JS_TRIK = '@molefas/trik-article-search';
const PY_TRIK = '@molefas/trik-article-search-py';

// Check CLI availability synchronously at module load time
const JS_CLI_PATH = join(__dirname, '../../packages/js/cli/dist/cli.js');
const JS_CLI_AVAILABLE = existsSync(JS_CLI_PATH);

const PY_CLI_PATH = process.env.TRIKHUB_PY_CLI || 'trik';
let PY_CLI_AVAILABLE = false;
try {
  execSync(`${PY_CLI_PATH} --version`, { stdio: 'ignore' });
  PY_CLI_AVAILABLE = true;
} catch {
  PY_CLI_AVAILABLE = false;
}

// =============================================================================
// Node.js CLI Tests
// =============================================================================

describe.runIf(JS_CLI_AVAILABLE)('E2E: Node.js CLI Install/Uninstall', () => {
  let testProject: TestProject;

  beforeAll(async () => {
    // Create isolated test project
    testProject = await createJsTestProject();
  }, 30000);

  afterAll(async () => {
    if (testProject) {
      await testProject.cleanup();
    }
  });

  describe('Same-runtime: JS trik in JS project', () => {
    it('should install JS trik', async () => {
      const result = await runJsCli(['install', JS_TRIK], testProject.path, 120000);

      // Should succeed
      expect(result.code).toBe(0);

      // Should show success message
      expect(result.stdout + result.stderr).toMatch(/installed|success|registered/i);
    }, 120000);

    it('should register trik in .trikhub/config.json', async () => {
      await assertTrikInConfig(testProject.path, JS_TRIK);
    });

    it('should add trik to package.json', async () => {
      await assertTrikInPackageJson(testProject.path, JS_TRIK);
    });

    it('should uninstall JS trik', async () => {
      const result = await runJsCli(['uninstall', JS_TRIK], testProject.path, 60000);

      // Should succeed
      expect(result.code).toBe(0);
    }, 60000);

    it('should remove trik from .trikhub/config.json after uninstall', async () => {
      await assertTrikNotInConfig(testProject.path, JS_TRIK);
    });
  });

  describe('Cross-runtime: Python trik in JS project', () => {
    it('should install Python trik to .trikhub/triks/', async () => {
      const result = await runJsCli(['install', PY_TRIK], testProject.path, 120000);

      // Should succeed
      expect(result.code).toBe(0);

      // Should indicate cross-language installation
      expect(result.stdout + result.stderr).toMatch(/cross-language|\.trikhub\/triks/i);
    }, 120000);

    it('should register trik with python runtime', async () => {
      await assertTrikInConfig(testProject.path, PY_TRIK, 'python');
    });

    it('should download trik to .trikhub/triks/', async () => {
      await assertTrikInTriksDir(testProject.path, PY_TRIK);
    });

    it('should uninstall cross-language trik', async () => {
      const result = await runJsCli(['uninstall', PY_TRIK], testProject.path, 60000);

      // Should succeed
      expect(result.code).toBe(0);
    }, 60000);

    it('should remove trik from config after uninstall', async () => {
      await assertTrikNotInConfig(testProject.path, PY_TRIK);
    });

    it('should remove directory from .trikhub/triks/', async () => {
      await assertTrikNotInTriksDir(testProject.path, PY_TRIK);
    });
  });
});

// =============================================================================
// Python CLI Tests
// =============================================================================

describe.runIf(PY_CLI_AVAILABLE)('E2E: Python CLI Install/Uninstall', () => {
  let testProject: TestProject;

  beforeAll(async () => {
    // Create isolated test project
    testProject = await createPyTestProject();
  }, 30000);

  afterAll(async () => {
    if (testProject) {
      await testProject.cleanup();
    }
  });

  describe('Same-runtime: Python trik in Python project', () => {
    it('should install Python trik', async () => {
      const result = await runPyCli(['install', PY_TRIK], testProject.path, 180000);

      // Should succeed
      expect(result.code).toBe(0);

      // Should show success message
      expect(result.stdout + result.stderr).toMatch(/installed|success/i);
    }, 180000);

    it('should register trik in .trikhub/config.json', async () => {
      await assertTrikInConfig(testProject.path, PY_TRIK, 'python');
    });

    it('should uninstall Python trik', async () => {
      const result = await runPyCli(['uninstall', PY_TRIK], testProject.path, 60000);

      // Should succeed
      expect(result.code).toBe(0);
    }, 60000);

    it('should remove trik from config after uninstall', async () => {
      await assertTrikNotInConfig(testProject.path, PY_TRIK);
    });
  });

  describe('Cross-runtime: JS trik in Python project', () => {
    it('should install JS trik to .trikhub/triks/', async () => {
      const result = await runPyCli(['install', JS_TRIK], testProject.path, 180000);

      // Should succeed
      expect(result.code).toBe(0);

      // Should indicate cross-language installation
      expect(result.stdout + result.stderr).toMatch(/cross-language|\.trikhub\/triks/i);
    }, 180000);

    it('should register trik with node runtime', async () => {
      await assertTrikInConfig(testProject.path, JS_TRIK, 'node');
    });

    it('should download trik to .trikhub/triks/', async () => {
      await assertTrikInTriksDir(testProject.path, JS_TRIK);
    });

    it('should install npm dependencies for JS trik', async () => {
      // JS triks in Python projects should have node_modules after npm install
      await assertTrikHasNodeModules(testProject.path, JS_TRIK);
    });

    it('should uninstall cross-language trik', async () => {
      const result = await runPyCli(['uninstall', JS_TRIK], testProject.path, 60000);

      // Should succeed
      expect(result.code).toBe(0);
    }, 60000);

    it('should remove trik from config after uninstall', async () => {
      await assertTrikNotInConfig(testProject.path, JS_TRIK);
    });

    it('should cleanup .trikhub/triks/ directory', async () => {
      await assertTrikNotInTriksDir(testProject.path, JS_TRIK);
    });
  });
});

// =============================================================================
// Integration Tests (both CLIs interoperating)
// =============================================================================

describe.runIf(JS_CLI_AVAILABLE && PY_CLI_AVAILABLE)('E2E: CLI Interoperability', () => {
  let jsProject: TestProject;
  let pyProject: TestProject;

  beforeAll(async () => {
    jsProject = await createJsTestProject();
    pyProject = await createPyTestProject();
  }, 30000);

  afterAll(async () => {
    if (jsProject) await jsProject.cleanup();
    if (pyProject) await pyProject.cleanup();
  });

  it(
    'both CLIs should produce compatible config.json format',
    async () => {
      // Install a trik with JS CLI
      await runJsCli(['install', JS_TRIK], jsProject.path, 120000);
      const jsConfig = await readTriksConfig(jsProject.path);

      // Install a trik with Python CLI
      await runPyCli(['install', JS_TRIK], pyProject.path, 180000);
      const pyConfig = await readTriksConfig(pyProject.path);

      // Both should have the same structure
      expect(jsConfig.triks).toContain(JS_TRIK);
      expect(pyConfig.triks).toContain(JS_TRIK);

      // Both should track runtime
      expect(pyConfig.runtimes?.[JS_TRIK]).toBe('node');

      // Cleanup
      await runJsCli(['uninstall', JS_TRIK], jsProject.path, 60000);
      await runPyCli(['uninstall', JS_TRIK], pyProject.path, 60000);
    },
    300000
  );
});

// Log CLI availability for debugging
if (!JS_CLI_AVAILABLE) {
  console.warn('JS CLI not available - skipping Node.js CLI tests');
  console.warn(`Expected CLI at: ${JS_CLI_PATH}`);
  console.warn('Run "pnpm build" to build the CLI');
}

if (!PY_CLI_AVAILABLE) {
  console.warn('Python CLI not available - skipping Python CLI tests');
  console.warn('Install trikhub Python package or set TRIKHUB_PY_CLI env var');
}
