/**
 * CLI Runner helpers for E2E tests
 *
 * Provides utilities to execute the Node.js and Python CLIs
 * and capture their output for assertions.
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Path to the JS CLI entry point (relative to repo root)
const JS_CLI_PATH = join(__dirname, '../../../packages/js/cli/dist/cli.js');

// Path to the Python CLI - configurable via env var for CI/different systems
const PY_CLI_PATH = process.env.TRIKHUB_PY_CLI || 'trik';

export interface CLIResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a CLI command and capture output
 */
function runCli(
  command: string,
  args: string[],
  cwd: string,
  timeout: number = 60000
): Promise<CLIResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      shell: true,
      env: {
        ...process.env,
        // Ensure npm doesn't prompt for input
        npm_config_yes: 'true',
        // Disable color output for easier parsing
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`CLI command timed out after ${timeout}ms`));
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Run the Node.js CLI (trik command via node)
 *
 * @param args - Arguments to pass to the CLI (e.g., ['install', '@scope/name'])
 * @param cwd - Working directory to run the command in
 * @param timeout - Timeout in milliseconds (default: 60s)
 */
export async function runJsCli(
  args: string[],
  cwd: string,
  timeout: number = 60000
): Promise<CLIResult> {
  return runCli('node', [JS_CLI_PATH, ...args], cwd, timeout);
}

/**
 * Run the Python CLI (trik command via Python)
 *
 * @param args - Arguments to pass to the CLI (e.g., ['install', '@scope/name'])
 * @param cwd - Working directory to run the command in
 * @param timeout - Timeout in milliseconds (default: 120s for pip operations)
 */
export async function runPyCli(
  args: string[],
  cwd: string,
  timeout: number = 120000
): Promise<CLIResult> {
  return runCli(PY_CLI_PATH, args, cwd, timeout);
}

/**
 * Check if the Python CLI is available
 */
export async function isPyCliAvailable(): Promise<boolean> {
  try {
    const result = await runCli(PY_CLI_PATH, ['--version'], process.cwd(), 5000);
    return result.code === 0;
  } catch {
    return false;
  }
}

/**
 * Check if the JS CLI is built and available
 */
export async function isJsCliAvailable(): Promise<boolean> {
  try {
    const result = await runJsCli(['--version'], process.cwd(), 5000);
    return result.code === 0;
  } catch {
    return false;
  }
}
