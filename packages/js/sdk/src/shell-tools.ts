/**
 * Shell tool schema and handler for containerized triks.
 *
 * Auto-injected by wrapAgent when a trik declares
 * capabilities.shell.enabled = true. Commands execute inside
 * the container, scoped by container isolation.
 *
 * Mirrors packages/python/trikhub/sdk/shell_tools.py
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';

// ============================================================================
// Types
// ============================================================================

export interface ShellDefaults {
  /** Default timeout per command in ms (default: 30000) */
  timeoutMs?: number;
  /** Max concurrent processes (default: 3) — reserved for future async support */
  maxConcurrent?: number;
}

export interface ExecuteCommandInput {
  /** Shell command to execute */
  command: string;
  /** Working directory relative to workspace (default: workspace root) */
  cwd?: string;
  /** Timeout in ms (overrides default) */
  timeoutMs?: number;
  /** Additional environment variables */
  env?: Record<string, string>;
}

export interface ExecuteCommandOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ============================================================================
// Tool Schema
// ============================================================================

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const shellToolSchemas: ToolSchema[] = [
  {
    name: 'execute_command',
    description:
      'Run a shell command in the workspace. Returns stdout, stderr, and exit code.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        cwd: {
          type: 'string',
          description: 'Working directory relative to /workspace (default: /workspace)',
        },
        timeoutMs: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 30000)',
        },
        env: {
          type: 'object',
          description: 'Additional environment variables',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['command'],
    },
  },
];

// ============================================================================
// Tool Handler
// ============================================================================

export interface ShellHandlers {
  execute_command: (input: ExecuteCommandInput) => ExecuteCommandOutput;
}

/**
 * Create shell tool handlers bound to a specific workspace root.
 */
export function createShellHandlers(
  workspaceRoot: string,
  defaults: ShellDefaults = {}
): ShellHandlers {
  const root = resolve(workspaceRoot);
  const defaultTimeout = defaults.timeoutMs ?? 30_000;

  return {
    execute_command({ command, cwd, timeoutMs, env }) {
      // Resolve cwd within workspace
      let execCwd = root;
      if (cwd) {
        execCwd = resolve(root, cwd);
        const rel = relative(root, execCwd);
        if (rel.startsWith('..') || !execCwd.startsWith(root)) {
          throw new Error(`cwd traversal denied: "${cwd}" resolves outside workspace`);
        }
        if (!existsSync(execCwd)) {
          throw new Error(`Working directory not found: ${cwd}`);
        }
      }

      const timeout = timeoutMs ?? defaultTimeout;

      const result = spawnSync(command, {
        cwd: execCwd,
        timeout,
        env: { ...process.env, ...env },
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 10 * 1024 * 1024, // 10MB
        shell: true,
      });

      // Timeout
      if (result.signal === 'SIGTERM') {
        return {
          stdout: result.stdout ?? '',
          stderr: `Command timed out after ${timeout}ms`,
          exitCode: 124,
        };
      }

      return {
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        exitCode: result.status ?? 1,
      };
    },
  };
}
