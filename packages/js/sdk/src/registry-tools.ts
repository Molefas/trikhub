/**
 * LangChain tool wrappers for trik registry management.
 *
 * When a trik declares trikManagement capability, these tools are
 * created and can be added to the LangGraph agent's tool list.
 * The tools delegate to the TrikRegistryContext provided by the gateway.
 *
 * Usage:
 *   import { getRegistryTools } from '@trikhub/sdk';
 *
 *   export default wrapAgent(async (context) => {
 *     const llm = new ChatAnthropic({ ... });
 *     const tools = [...myTools, transferBackTool, ...getRegistryTools(context)];
 *     return createReactAgent({ llm, tools });
 *   });
 *
 * Mirrors packages/python/trikhub/sdk/registry_tools.py
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { TrikContext, TrikCapabilities } from '@trikhub/manifest';

/** The set of tool names that are registry-injected (used for output filtering) */
export const REGISTRY_TOOL_NAMES = new Set([
  'search_triks',
  'list_installed_triks',
  'install_trik',
  'uninstall_trik',
  'upgrade_trik',
  'get_trik_info',
]);

/** System prompt appendix for registry tools */
export const REGISTRY_SYSTEM_PROMPT = `
## Trik Management Tools
You have access to trik management tools for the TrikHub registry.
- Use search_triks to find triks matching a search query
- Use list_installed_triks to see all currently installed triks
- Use install_trik to install a trik from the registry
- Use uninstall_trik to remove an installed trik
- Use upgrade_trik to upgrade an installed trik to a newer version
- Use get_trik_info to get detailed information about a trik
`.trim();

/**
 * Get LangChain tools for trik registry management based on the trik's capabilities.
 *
 * Returns an empty array if no registry context is available.
 * Include the returned tools in your LangGraph agent's tool list.
 *
 * @param context - The TrikContext (must have registry populated by the gateway)
 * @returns Array of LangChain StructuredTool instances
 *
 * @example
 * export default wrapAgent(async (context) => {
 *   const llm = new ChatAnthropic({ apiKey: context.config.get("ANTHROPIC_API_KEY") });
 *   const tools = [...myTools, transferBackTool, ...getRegistryTools(context)];
 *   return createReactAgent({ llm, tools });
 * });
 */
export function getRegistryTools(
  context: TrikContext
): StructuredToolInterface[] {
  if (!context.registry) return [];

  const registry = context.registry;

  return [
    tool(
      async (input) => {
        const result = await registry.search(input.query, {
          page: input.page,
          pageSize: input.pageSize,
        });
        return JSON.stringify(result);
      },
      {
        name: 'search_triks',
        description: 'Search the TrikHub registry for triks matching a query',
        schema: z.object({
          query: z.string().describe('Search query'),
          page: z.number().optional().describe('Page number (default 1)'),
          pageSize: z.number().optional().describe('Results per page (default 10)'),
        }),
      }
    ),
    tool(
      async () => {
        const result = await registry.list();
        return JSON.stringify(result);
      },
      {
        name: 'list_installed_triks',
        description: 'List all currently installed triks with their capabilities',
        schema: z.object({}),
      }
    ),
    tool(
      async (input) => {
        const result = await registry.install(input.trikId, input.version);
        return JSON.stringify(result);
      },
      {
        name: 'install_trik',
        description: 'Install a trik from the TrikHub registry',
        schema: z.object({
          trikId: z.string().describe('Full trik ID (e.g. @scope/name)'),
          version: z.string().optional().describe('Specific version to install (default: latest)'),
        }),
      }
    ),
    tool(
      async (input) => {
        const result = await registry.uninstall(input.trikId);
        return JSON.stringify(result);
      },
      {
        name: 'uninstall_trik',
        description: 'Uninstall a trik',
        schema: z.object({
          trikId: z.string().describe('Full trik ID to uninstall'),
        }),
      }
    ),
    tool(
      async (input) => {
        const result = await registry.upgrade(input.trikId, input.version);
        return JSON.stringify(result);
      },
      {
        name: 'upgrade_trik',
        description: 'Upgrade an installed trik to a newer version',
        schema: z.object({
          trikId: z.string().describe('Full trik ID to upgrade'),
          version: z.string().optional().describe('Target version (default: latest)'),
        }),
      }
    ),
    tool(
      async (input) => {
        const result = await registry.getInfo(input.trikId);
        return JSON.stringify(result);
      },
      {
        name: 'get_trik_info',
        description: 'Get detailed information about a trik from the registry',
        schema: z.object({
          trikId: z.string().describe('Full trik ID to look up'),
        }),
      }
    ),
  ];
}

/**
 * Get the set of registry tool names that are active for the given capabilities.
 * Used internally by wrapAgent to filter these from ToolCallRecord output.
 */
export function getActiveRegistryToolNames(
  capabilities?: TrikCapabilities
): Set<string> {
  if (!capabilities?.trikManagement?.enabled) return new Set();
  return new Set(REGISTRY_TOOL_NAMES);
}
