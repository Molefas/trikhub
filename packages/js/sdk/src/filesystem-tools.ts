/**
 * Filesystem tool schemas and handlers for containerized triks.
 *
 * These tools are auto-injected by wrapAgent when a trik declares
 * capabilities.filesystem.enabled = true. All paths are resolved
 * relative to the workspace root (container mount point).
 *
 * Mirrors packages/python/trikhub/sdk/filesystem_tools.py
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync, statSync } from 'node:fs';
import { basename, join, resolve, relative } from 'node:path';
import { globSync } from 'node:fs';

// ============================================================================
// Path Safety
// ============================================================================

/**
 * Resolve a user-provided path safely within the workspace root.
 * Defense-in-depth — the container is the primary boundary.
 * @throws Error if the resolved path escapes the workspace root.
 */
function safePath(workspaceRoot: string, userPath: string): string {
  const resolved = resolve(workspaceRoot, userPath);
  const rel = relative(workspaceRoot, resolved);
  if (rel.startsWith('..') || resolve(resolved) !== resolved.replace(/\/$/, '')) {
    // re-check: just ensure resolved starts with workspaceRoot
  }
  if (!resolved.startsWith(resolve(workspaceRoot))) {
    throw new Error(`Path traversal denied: "${userPath}" resolves outside workspace`);
  }
  return resolved;
}

// ============================================================================
// Tool Schemas
// ============================================================================

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const filesystemToolSchemas: ToolSchema[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file. Returns the file content as a string.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to /workspace' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file with the given content. Creates parent directories if needed.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to /workspace' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Replace a specific string in a file with a new string. Fails if the old string is not found.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to /workspace' },
        old_string: { type: 'string', description: 'The exact string to find and replace' },
        new_string: { type: 'string', description: 'The string to replace it with' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'list_directory',
    description: 'List the contents of a directory. Returns file and directory names.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path relative to /workspace (default: ".")' },
      },
    },
  },
  {
    name: 'glob_files',
    description: 'Find files matching a glob pattern within the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g., "**/*.ts", "src/*.js")' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'grep_files',
    description: 'Search file contents for lines matching a regex pattern. Returns matching lines with file paths and line numbers.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression pattern to search for' },
        glob: { type: 'string', description: 'Optional glob pattern to filter files (default: "**/*")' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file from the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to /workspace' },
      },
      required: ['path'],
    },
  },
  {
    name: 'create_directory',
    description: 'Create a directory (and any parent directories) in the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path relative to /workspace' },
      },
      required: ['path'],
    },
  },
];

// ============================================================================
// Tool Handlers
// ============================================================================

export interface FilesystemHandlers {
  read_file: (input: { path: string }) => string;
  write_file: (input: { path: string; content: string }) => string;
  edit_file: (input: { path: string; old_string: string; new_string: string }) => string;
  list_directory: (input: { path?: string }) => string;
  glob_files: (input: { pattern: string }) => string;
  grep_files: (input: { pattern: string; glob?: string }) => string;
  delete_file: (input: { path: string }) => string;
  create_directory: (input: { path: string }) => string;
}

/**
 * Create filesystem tool handlers bound to a specific workspace root.
 */
export function createFilesystemHandlers(workspaceRoot: string): FilesystemHandlers {
  const root = resolve(workspaceRoot);

  // Ensure workspace exists
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
  }

  return {
    read_file({ path }) {
      const fullPath = safePath(root, path);
      if (!existsSync(fullPath)) {
        throw new Error(`File not found: ${path}`);
      }
      if (statSync(fullPath).isDirectory()) {
        throw new Error(`Path is a directory, not a file: ${path}`);
      }
      return readFileSync(fullPath, 'utf-8');
    },

    write_file({ path, content }) {
      const fullPath = safePath(root, path);
      const dir = join(fullPath, '..');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(fullPath, content, 'utf-8');
      return `File written: ${path}`;
    },

    edit_file({ path, old_string, new_string }) {
      const fullPath = safePath(root, path);
      if (!existsSync(fullPath)) {
        throw new Error(`File not found: ${path}`);
      }
      const content = readFileSync(fullPath, 'utf-8');
      if (!content.includes(old_string)) {
        throw new Error(`String not found in ${path}: "${old_string}"`);
      }
      const updated = content.replace(old_string, new_string);
      writeFileSync(fullPath, updated, 'utf-8');
      return `File edited: ${path}`;
    },

    list_directory({ path: dirPath }) {
      const targetPath = safePath(root, dirPath || '.');
      if (!existsSync(targetPath)) {
        throw new Error(`Directory not found: ${dirPath || '.'}`);
      }
      if (!statSync(targetPath).isDirectory()) {
        throw new Error(`Path is not a directory: ${dirPath}`);
      }
      const entries = readdirSync(targetPath, { withFileTypes: true });
      return entries
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .join('\n');
    },

    glob_files({ pattern }) {
      // Use Node.js built-in glob (Node 22+)
      const matches = globSync(pattern, { cwd: root });
      return (matches as string[]).sort().join('\n');
    },

    grep_files({ pattern, glob: fileGlob }) {
      const regex = new RegExp(pattern);
      const filePattern = fileGlob || '**/*';
      const files = globSync(filePattern, { cwd: root }) as string[];

      const results: string[] = [];
      for (const file of files) {
        const fullPath = join(root, file);
        try {
          const stat = statSync(fullPath);
          if (!stat.isFile()) continue;
          const content = readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              results.push(`${file}:${i + 1}:${lines[i]}`);
            }
          }
        } catch {
          // Skip files that can't be read (binary, permissions, etc.)
        }
      }
      return results.join('\n');
    },

    delete_file({ path }) {
      const fullPath = safePath(root, path);
      if (!existsSync(fullPath)) {
        throw new Error(`File not found: ${path}`);
      }
      unlinkSync(fullPath);
      return `File deleted: ${path}`;
    },

    create_directory({ path }) {
      const fullPath = safePath(root, path);
      mkdirSync(fullPath, { recursive: true });
      return `Directory created: ${path}`;
    },
  };
}
