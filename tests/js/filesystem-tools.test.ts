/**
 * Tests for filesystem tool handlers.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFilesystemHandlers, type FilesystemHandlers } from '../../packages/js/sdk/src/filesystem-tools.js';

let workspace: string;
let handlers: FilesystemHandlers;

beforeEach(() => {
  workspace = join(tmpdir(), `trikhub-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(workspace, { recursive: true });
  handlers = createFilesystemHandlers(workspace);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

// ============================================================================
// read_file
// ============================================================================

describe('read_file', () => {
  it('reads an existing file', () => {
    writeFileSync(join(workspace, 'hello.txt'), 'Hello, world!');
    expect(handlers.read_file({ path: 'hello.txt' })).toBe('Hello, world!');
  });

  it('throws for missing file', () => {
    expect(() => handlers.read_file({ path: 'missing.txt' })).toThrow('File not found');
  });

  it('throws for directory', () => {
    mkdirSync(join(workspace, 'somedir'));
    expect(() => handlers.read_file({ path: 'somedir' })).toThrow('directory');
  });
});

// ============================================================================
// write_file
// ============================================================================

describe('write_file', () => {
  it('creates a new file', () => {
    const result = handlers.write_file({ path: 'new.txt', content: 'content' });
    expect(result).toContain('File written');
    expect(readFileSync(join(workspace, 'new.txt'), 'utf-8')).toBe('content');
  });

  it('overwrites an existing file', () => {
    writeFileSync(join(workspace, 'existing.txt'), 'old');
    handlers.write_file({ path: 'existing.txt', content: 'new' });
    expect(readFileSync(join(workspace, 'existing.txt'), 'utf-8')).toBe('new');
  });

  it('creates parent directories', () => {
    handlers.write_file({ path: 'deep/nested/file.txt', content: 'deep' });
    expect(readFileSync(join(workspace, 'deep/nested/file.txt'), 'utf-8')).toBe('deep');
  });
});

// ============================================================================
// edit_file
// ============================================================================

describe('edit_file', () => {
  it('replaces a string in a file', () => {
    writeFileSync(join(workspace, 'edit.txt'), 'Hello, world!');
    handlers.edit_file({ path: 'edit.txt', old_string: 'world', new_string: 'cosmos' });
    expect(readFileSync(join(workspace, 'edit.txt'), 'utf-8')).toBe('Hello, cosmos!');
  });

  it('throws when string not found', () => {
    writeFileSync(join(workspace, 'edit.txt'), 'Hello, world!');
    expect(() =>
      handlers.edit_file({ path: 'edit.txt', old_string: 'xyz', new_string: 'abc' })
    ).toThrow('String not found');
  });

  it('throws for missing file', () => {
    expect(() =>
      handlers.edit_file({ path: 'missing.txt', old_string: 'a', new_string: 'b' })
    ).toThrow('File not found');
  });
});

// ============================================================================
// list_directory
// ============================================================================

describe('list_directory', () => {
  it('lists directory contents', () => {
    writeFileSync(join(workspace, 'file.txt'), '');
    mkdirSync(join(workspace, 'subdir'));
    const result = handlers.list_directory({ path: '.' });
    expect(result).toContain('file.txt');
    expect(result).toContain('subdir/');
  });

  it('lists empty directory', () => {
    mkdirSync(join(workspace, 'empty'));
    expect(handlers.list_directory({ path: 'empty' })).toBe('');
  });

  it('defaults to workspace root', () => {
    writeFileSync(join(workspace, 'root.txt'), '');
    const result = handlers.list_directory({});
    expect(result).toContain('root.txt');
  });
});

// ============================================================================
// glob_files
// ============================================================================

describe('glob_files', () => {
  it('matches files by pattern', () => {
    writeFileSync(join(workspace, 'a.ts'), '');
    writeFileSync(join(workspace, 'b.ts'), '');
    writeFileSync(join(workspace, 'c.js'), '');
    const result = handlers.glob_files({ pattern: '*.ts' });
    expect(result).toContain('a.ts');
    expect(result).toContain('b.ts');
    expect(result).not.toContain('c.js');
  });

  it('matches nested files with **', () => {
    mkdirSync(join(workspace, 'src'), { recursive: true });
    writeFileSync(join(workspace, 'src/index.ts'), '');
    const result = handlers.glob_files({ pattern: '**/*.ts' });
    expect(result).toContain('src/index.ts');
  });
});

// ============================================================================
// grep_files
// ============================================================================

describe('grep_files', () => {
  it('finds matching lines', () => {
    writeFileSync(join(workspace, 'code.ts'), 'const x = 1;\nconst y = 2;\nconst x = 3;\n');
    const result = handlers.grep_files({ pattern: 'const x' });
    expect(result).toContain('code.ts:1:const x = 1;');
    expect(result).toContain('code.ts:3:const x = 3;');
  });

  it('returns empty string for no matches', () => {
    writeFileSync(join(workspace, 'code.ts'), 'hello\n');
    expect(handlers.grep_files({ pattern: 'xyz' })).toBe('');
  });

  it('filters by glob pattern', () => {
    writeFileSync(join(workspace, 'a.ts'), 'match\n');
    writeFileSync(join(workspace, 'b.js'), 'match\n');
    const result = handlers.grep_files({ pattern: 'match', glob: '*.ts' });
    expect(result).toContain('a.ts');
    expect(result).not.toContain('b.js');
  });
});

// ============================================================================
// delete_file
// ============================================================================

describe('delete_file', () => {
  it('deletes a file', () => {
    writeFileSync(join(workspace, 'doomed.txt'), '');
    handlers.delete_file({ path: 'doomed.txt' });
    expect(existsSync(join(workspace, 'doomed.txt'))).toBe(false);
  });

  it('throws for missing file', () => {
    expect(() => handlers.delete_file({ path: 'missing.txt' })).toThrow('File not found');
  });
});

// ============================================================================
// create_directory
// ============================================================================

describe('create_directory', () => {
  it('creates a directory', () => {
    handlers.create_directory({ path: 'newdir' });
    expect(existsSync(join(workspace, 'newdir'))).toBe(true);
  });

  it('creates nested directories', () => {
    handlers.create_directory({ path: 'a/b/c' });
    expect(existsSync(join(workspace, 'a/b/c'))).toBe(true);
  });
});

// ============================================================================
// Path traversal protection
// ============================================================================

describe('path traversal protection', () => {
  it('rejects ../../../etc/passwd', () => {
    expect(() => handlers.read_file({ path: '../../../etc/passwd' })).toThrow('traversal');
  });

  it('rejects absolute paths outside workspace', () => {
    expect(() => handlers.read_file({ path: '/etc/passwd' })).toThrow('traversal');
  });

  it('allows paths that look suspicious but resolve inside workspace', () => {
    writeFileSync(join(workspace, 'safe.txt'), 'ok');
    // ./safe.txt resolves inside workspace
    expect(handlers.read_file({ path: './safe.txt' })).toBe('ok');
  });
});
