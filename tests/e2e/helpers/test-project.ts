/**
 * Test Project helpers for E2E tests
 *
 * Provides utilities to create isolated test projects by copying
 * the example projects to temporary directories.
 */

import { mkdtemp, cp, rm, readdir, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Paths to example projects (relative to repo root)
const REPO_ROOT = join(__dirname, '../../..');
const JS_EXAMPLE_DIR = join(REPO_ROOT, 'examples/js/local-playground');
const PY_EXAMPLE_DIR = join(REPO_ROOT, 'examples/python/local-playground');

export interface TestProject {
  /** Path to the test project directory */
  path: string;
  /** Cleanup function to remove the test project */
  cleanup: () => Promise<void>;
}

/**
 * Copy a directory recursively, excluding certain patterns
 */
async function copyDirectory(
  src: string,
  dest: string,
  exclude: string[] = ['node_modules', '__pycache__', '.git', 'dist', '*.tgz']
): Promise<void> {
  await mkdir(dest, { recursive: true });

  const entries = await readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    // Check exclusion patterns
    const shouldExclude = exclude.some((pattern) => {
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace('*', '.*') + '$');
        return regex.test(entry.name);
      }
      return entry.name === pattern;
    });

    if (shouldExclude) {
      continue;
    }

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath, exclude);
    } else {
      const content = await readFile(srcPath);
      await writeFile(destPath, content);
    }
  }
}

/**
 * Create an isolated JS test project by copying the example
 *
 * Creates a fresh copy in a temp directory with:
 * - package.json (dependencies intact)
 * - tsconfig.json
 * - src/ files
 * - Clean .trikhub/ directory (no existing triks)
 *
 * node_modules is NOT copied - run npm install if needed
 */
export async function createJsTestProject(): Promise<TestProject> {
  const prefix = join(tmpdir(), 'trikhub-e2e-js-');
  const tempDir = await mkdtemp(prefix);

  try {
    // Copy example project excluding heavy directories
    await copyDirectory(JS_EXAMPLE_DIR, tempDir, [
      'node_modules',
      'dist',
      '.trikhub',
      '*.tgz',
    ]);

    // Create clean .trikhub directory with empty config
    const trikhubDir = join(tempDir, '.trikhub');
    await mkdir(trikhubDir, { recursive: true });
    await writeFile(
      join(trikhubDir, 'config.json'),
      JSON.stringify({ triks: [] }, null, 2) + '\n'
    );

    // Create empty secrets.json
    await writeFile(
      join(trikhubDir, 'secrets.json'),
      JSON.stringify({}, null, 2) + '\n'
    );

    return {
      path: tempDir,
      cleanup: async () => {
        try {
          await rm(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      },
    };
  } catch (error) {
    // Cleanup on error
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Create an isolated Python test project by copying the example
 *
 * Creates a fresh copy in a temp directory with:
 * - Python source files
 * - requirements.txt
 * - Clean .trikhub/ directory (no existing triks)
 *
 * Virtual environment is NOT copied
 */
export async function createPyTestProject(): Promise<TestProject> {
  const prefix = join(tmpdir(), 'trikhub-e2e-py-');
  const tempDir = await mkdtemp(prefix);

  try {
    // Copy example project excluding heavy directories
    await copyDirectory(PY_EXAMPLE_DIR, tempDir, [
      '__pycache__',
      'venv',
      '.venv',
      '*.pyc',
      '.trikhub',
    ]);

    // Create clean .trikhub directory with empty config
    const trikhubDir = join(tempDir, '.trikhub');
    await mkdir(trikhubDir, { recursive: true });
    await writeFile(
      join(trikhubDir, 'config.json'),
      JSON.stringify({ triks: [], trikhub: {}, runtimes: {} }, null, 2) + '\n'
    );

    // Create empty secrets.json
    await writeFile(
      join(trikhubDir, 'secrets.json'),
      JSON.stringify({}, null, 2) + '\n'
    );

    return {
      path: tempDir,
      cleanup: async () => {
        try {
          await rm(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      },
    };
  } catch (error) {
    // Cleanup on error
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Check if a test project has the expected structure
 */
export async function validateTestProject(
  projectPath: string,
  type: 'js' | 'python'
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  // Check .trikhub directory exists
  if (!existsSync(join(projectPath, '.trikhub'))) {
    errors.push('.trikhub directory not found');
  }

  // Check config.json exists
  if (!existsSync(join(projectPath, '.trikhub', 'config.json'))) {
    errors.push('.trikhub/config.json not found');
  }

  if (type === 'js') {
    // Check package.json exists
    if (!existsSync(join(projectPath, 'package.json'))) {
      errors.push('package.json not found');
    }
  } else {
    // Check for Python project indicators
    const hasPyFiles = existsSync(join(projectPath, 'agent.py')) ||
                       existsSync(join(projectPath, 'requirements.txt'));
    if (!hasPyFiles) {
      errors.push('No Python project files found');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
