/**
 * Tests for shell tool handlers.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createShellHandlers, type ShellHandlers } from '../../packages/js/sdk/src/shell-tools.js';

let workspace: string;
let handlers: ShellHandlers;

beforeEach(() => {
  workspace = join(tmpdir(), `trikhub-shell-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(workspace, { recursive: true });
  handlers = createShellHandlers(workspace);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

// ============================================================================
// execute_command
// ============================================================================

describe('execute_command', () => {
  it('runs a command and captures stdout', () => {
    const result = handlers.execute_command({ command: 'echo hello' });
    expect(result.stdout.trim()).toBe('hello');
    expect(result.exitCode).toBe(0);
  });

  it('captures stderr', () => {
    const result = handlers.execute_command({ command: 'echo error >&2' });
    expect(result.stderr.trim()).toBe('error');
    expect(result.exitCode).toBe(0);
  });

  it('returns non-zero exit code', () => {
    const result = handlers.execute_command({ command: 'exit 42' });
    expect(result.exitCode).toBe(42);
  });

  it('respects cwd option', () => {
    mkdirSync(join(workspace, 'subdir'));
    writeFileSync(join(workspace, 'subdir', 'test.txt'), 'content');
    const result = handlers.execute_command({ command: 'ls', cwd: 'subdir' });
    expect(result.stdout.trim()).toBe('test.txt');
  });

  it('respects env option', () => {
    const result = handlers.execute_command({
      command: 'echo $MY_VAR',
      env: { MY_VAR: 'custom_value' },
    });
    expect(result.stdout.trim()).toBe('custom_value');
  });

  it('enforces timeout', () => {
    const result = handlers.execute_command({
      command: 'sleep 10',
      timeoutMs: 100,
    });
    expect(result.exitCode).toBe(124);
    expect(result.stderr).toContain('timed out');
  });

  it('rejects cwd traversal', () => {
    expect(() =>
      handlers.execute_command({ command: 'echo hi', cwd: '../../..' })
    ).toThrow('traversal');
  });

  it('throws for non-existent cwd', () => {
    expect(() =>
      handlers.execute_command({ command: 'echo hi', cwd: 'nonexistent' })
    ).toThrow('not found');
  });
});

// ============================================================================
// Background mode
// ============================================================================

describe('background mode', () => {
  it('returns pid and exitCode 0 for background process', () => {
    const result = handlers.execute_command({ command: 'sleep 1', background: true });
    expect(result.exitCode).toBe(0);
    expect(result.pid).toBeDefined();
    expect(typeof result.pid).toBe('number');
    expect(result.stdout).toContain('Background process started with PID');
  });

  it('rejects cwd traversal in background mode', () => {
    expect(() =>
      handlers.execute_command({ command: 'echo hi', cwd: '../../..', background: true })
    ).toThrow('traversal');
  });

  it('returns immediately without waiting for process', () => {
    const start = Date.now();
    const result = handlers.execute_command({ command: 'sleep 30', background: true });
    const elapsed = Date.now() - start;

    expect(result.exitCode).toBe(0);
    expect(result.pid).toBeDefined();
    // Should return almost immediately (well under 1s), not wait for sleep 30
    expect(elapsed).toBeLessThan(5000);
  });
});

// ============================================================================
// Default timeout
// ============================================================================

describe('shell defaults', () => {
  it('uses custom default timeout', () => {
    const customHandlers = createShellHandlers(workspace, { timeoutMs: 100 });
    const result = customHandlers.execute_command({ command: 'sleep 10' });
    expect(result.exitCode).toBe(124);
  });
});
