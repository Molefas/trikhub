/**
 * LangChain tool wrappers for workspace filesystem and shell tools.
 *
 * When a trik declares filesystem/shell capabilities, these tools are
 * created and can be added to the LangGraph agent's tool list.
 * The handlers delegate to the underlying filesystem-tools and shell-tools
 * implementations which use native fs/os/shell APIs inside the container.
 *
 * Usage:
 *   import { getWorkspaceTools } from '@trikhub/sdk';
 *
 *   export default wrapAgent(async (context) => {
 *     const llm = new ChatAnthropic({ ... });
 *     const tools = [...myTools, transferBackTool, ...getWorkspaceTools(context)];
 *     return createReactAgent({ llm, tools });
 *   });
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { TrikContext, TrikCapabilities } from '@trikhub/manifest';
import { createFilesystemHandlers } from './filesystem-tools.js';
import { createShellHandlers } from './shell-tools.js';

/** The set of tool names that are workspace-injected (used for output filtering) */
export const WORKSPACE_TOOL_NAMES = new Set([
  'read_file',
  'write_file',
  'edit_file',
  'list_directory',
  'glob_files',
  'grep_files',
  'delete_file',
  'create_directory',
  'execute_command',
]);

/** System prompt appendix for workspace tools */
export const WORKSPACE_SYSTEM_PROMPT = `
## Workspace Tools
You have access to a sandboxed workspace at /workspace.
- Use read_file, write_file, edit_file to manipulate files
- Use list_directory, glob_files, grep_files to explore
- Use execute_command to run shell commands
- All file paths are relative to /workspace
- You cannot access files outside /workspace
`.trim();

/**
 * Create LangChain tools for filesystem operations.
 */
function createFilesystemLangChainTools(workspaceRoot: string) {
  const handlers = createFilesystemHandlers(workspaceRoot);

  return [
    tool(
      async (input) => handlers.read_file(input),
      {
        name: 'read_file',
        description: 'Read the contents of a file. Returns the file content as a string.',
        schema: z.object({
          path: z.string().describe('File path relative to /workspace'),
        }),
      }
    ),
    tool(
      async (input) => handlers.write_file(input),
      {
        name: 'write_file',
        description: 'Create or overwrite a file with the given content. Creates parent directories if needed.',
        schema: z.object({
          path: z.string().describe('File path relative to /workspace'),
          content: z.string().describe('Content to write'),
        }),
      }
    ),
    tool(
      async (input) => handlers.edit_file(input),
      {
        name: 'edit_file',
        description: 'Replace a specific string in a file with a new string. Fails if the old string is not found.',
        schema: z.object({
          path: z.string().describe('File path relative to /workspace'),
          old_string: z.string().describe('The exact string to find and replace'),
          new_string: z.string().describe('The string to replace it with'),
        }),
      }
    ),
    tool(
      async (input) => handlers.list_directory({ path: input.path }),
      {
        name: 'list_directory',
        description: 'List the contents of a directory. Returns file and directory names.',
        schema: z.object({
          path: z.string().optional().describe('Directory path relative to /workspace (default: ".")'),
        }),
      }
    ),
    tool(
      async (input) => handlers.glob_files(input),
      {
        name: 'glob_files',
        description: 'Find files matching a glob pattern within the workspace.',
        schema: z.object({
          pattern: z.string().describe('Glob pattern (e.g., "**/*.ts", "src/*.js")'),
        }),
      }
    ),
    tool(
      async (input) => handlers.grep_files(input),
      {
        name: 'grep_files',
        description: 'Search file contents for lines matching a regex pattern. Returns matching lines with file paths and line numbers.',
        schema: z.object({
          pattern: z.string().describe('Regular expression pattern to search for'),
          glob: z.string().optional().describe('Optional glob pattern to filter files (default: "**/*")'),
        }),
      }
    ),
    tool(
      async (input) => handlers.delete_file(input),
      {
        name: 'delete_file',
        description: 'Delete a file from the workspace.',
        schema: z.object({
          path: z.string().describe('File path relative to /workspace'),
        }),
      }
    ),
    tool(
      async (input) => handlers.create_directory(input),
      {
        name: 'create_directory',
        description: 'Create a directory (and any parent directories) in the workspace.',
        schema: z.object({
          path: z.string().describe('Directory path relative to /workspace'),
        }),
      }
    ),
  ];
}

/**
 * Create LangChain tools for shell command execution.
 */
function createShellLangChainTools(
  workspaceRoot: string,
  capabilities: TrikCapabilities
) {
  const shellCaps = capabilities.shell;
  const handlers = createShellHandlers(workspaceRoot, {
    timeoutMs: shellCaps?.timeoutMs,
    maxConcurrent: shellCaps?.maxConcurrent,
  });

  return [
    tool(
      async (input) => {
        const result = handlers.execute_command(input);
        return JSON.stringify(result);
      },
      {
        name: 'execute_command',
        description: 'Run a shell command in the workspace. Returns stdout, stderr, and exit code. Use background=true for long-running processes like dev servers.',
        schema: z.object({
          command: z.string().describe('Shell command to execute'),
          cwd: z.string().optional().describe('Working directory relative to /workspace (default: /workspace)'),
          timeoutMs: z.number().optional().describe('Timeout in milliseconds (default: 30000)'),
          env: z.record(z.string()).optional().describe('Additional environment variables'),
          background: z.boolean().optional().describe('Run in background — returns immediately with PID. Use for dev servers and long-running processes.'),
        }),
      }
    ),
  ];
}

/**
 * Get LangChain tools for workspace operations based on the trik's capabilities.
 *
 * Returns an empty array if no filesystem/shell capabilities are enabled.
 * Include the returned tools in your LangGraph agent's tool list.
 *
 * @param context - The TrikContext (must have capabilities populated by the gateway)
 * @param workspaceRoot - Override the workspace root directory (default: /workspace)
 * @returns Array of LangChain StructuredTool instances
 *
 * @example
 * export default wrapAgent(async (context) => {
 *   const llm = new ChatAnthropic({ apiKey: context.config.get("ANTHROPIC_API_KEY") });
 *   const tools = [...myTools, transferBackTool, ...getWorkspaceTools(context)];
 *   return createReactAgent({ llm, tools });
 * });
 */
export function getWorkspaceTools(
  context: TrikContext,
  workspaceRoot: string = '/workspace'
): StructuredToolInterface[] {
  const caps = context.capabilities;
  if (!caps) return [];

  const tools: StructuredToolInterface[] = [];

  if (caps.filesystem?.enabled) {
    tools.push(...createFilesystemLangChainTools(workspaceRoot));
  }

  if (caps.shell?.enabled) {
    tools.push(...createShellLangChainTools(workspaceRoot, caps));
  }

  return tools;
}

/**
 * Get the set of workspace tool names that are active for the given capabilities.
 * Used internally by wrapAgent to filter these from ToolCallRecord output.
 */
export function getActiveWorkspaceToolNames(
  capabilities?: TrikCapabilities
): Set<string> {
  if (!capabilities) return new Set();

  const names = new Set<string>();

  if (capabilities.filesystem?.enabled) {
    names.add('read_file');
    names.add('write_file');
    names.add('edit_file');
    names.add('list_directory');
    names.add('glob_files');
    names.add('grep_files');
    names.add('delete_file');
    names.add('create_directory');
  }

  if (capabilities.shell?.enabled) {
    names.add('execute_command');
  }

  return names;
}
