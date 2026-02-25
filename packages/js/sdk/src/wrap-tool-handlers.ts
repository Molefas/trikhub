/**
 * wrapToolHandlers — creates a TrikAgent for tool-mode triks.
 *
 * Tool-mode triks export native tools to the main agent (no handoff, no session).
 * Each handler receives the validated input and returns structured output.
 */

import type { TrikAgent, TrikContext, ToolExecutionResult } from '@trikhub/manifest';

/**
 * A single tool handler function.
 * Receives validated input and trik context, returns structured output.
 */
export type ToolHandler = (
  input: Record<string, unknown>,
  context: TrikContext,
) => Promise<Record<string, unknown>> | Record<string, unknown>;

/**
 * Wrap a map of tool handlers into a TrikAgent.
 *
 * @example
 * ```typescript
 * import { wrapToolHandlers } from '@trikhub/sdk';
 *
 * export default wrapToolHandlers({
 *   getWeather: async (input, context) => {
 *     const { city } = input as { city: string };
 *     return { temperature: 22, unit: 'celsius', condition: 'sunny' };
 *   },
 * });
 * ```
 */
export function wrapToolHandlers(
  handlers: Record<string, ToolHandler>,
): TrikAgent {
  return {
    async executeTool(
      toolName: string,
      input: Record<string, unknown>,
      context: TrikContext,
    ): Promise<ToolExecutionResult> {
      const handler = handlers[toolName];
      if (!handler) {
        throw new Error(
          `Unknown tool "${toolName}". Available tools: ${Object.keys(handlers).join(', ')}`,
        );
      }

      const output = await handler(input, context);
      return { output };
    },
  };
}
