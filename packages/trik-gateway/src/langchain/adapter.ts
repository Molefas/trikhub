import { tool, type DynamicStructuredTool } from '@langchain/core/tools';
import { z, type ZodTypeAny } from 'zod';
import type { TrikGateway, ToolDefinition } from '../gateway.js';
import type { PassthroughContent } from '@trikhub/manifest';
import { jsonSchemaToZod } from './schema-converter.js';

export interface LangChainAdapterOptions {
  /** Get session ID for a trik (for multi-turn conversations) */
  getSessionId?: (trikId: string) => string | undefined;
  /** Store session ID for a trik */
  setSessionId?: (trikId: string, sessionId: string) => void;
  /** Callback when passthrough content is delivered */
  onPassthrough?: (content: PassthroughContent) => void;
  /** Enable debug logging */
  debug?: boolean;
}

function fillTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    String(data[key] ?? `{{${key}}}`)
  );
}

function toToolName(gatewayName: string): string {
  return gatewayName
    .replace(/\//g, '_')
    .replace(/-/g, '_')
    .replace(/:/g, '__');
}

export function parseToolName(toolName: string): { trikId: string; actionName: string } {
  const parts = toolName.split('__');
  if (parts.length !== 2) {
    throw new Error(`Invalid tool name format: ${toolName}`);
  }

  return {
    trikId: parts[0],
    actionName: parts[1],
  };
}

function createToolFromDefinition(
  toolDef: ToolDefinition,
  gateway: TrikGateway,
  options: LangChainAdapterOptions
): DynamicStructuredTool {
  const { getSessionId, setSessionId, onPassthrough, debug } = options;
  const langChainName = toToolName(toolDef.name);

  const [trikIdPart, actionName] = toolDef.name.split(':');
  const trikId = trikIdPart;

  const zodSchema = jsonSchemaToZod(toolDef.inputSchema) as z.ZodObject<Record<string, ZodTypeAny>>;

  return tool(
    async (input: Record<string, unknown>) => {
      if (debug) {
        console.log(`[Tool] ${toolDef.name}: ${JSON.stringify(input)}`);
      }

      const sessionId = getSessionId?.(trikId);
      const result = await gateway.execute<Record<string, unknown>>(
        trikId,
        actionName,
        input,
        { sessionId }
      );

      if (!result.success) {
        return JSON.stringify({
          success: false,
          error: 'error' in result ? result.error : 'Unknown error',
        });
      }

      if ('sessionId' in result && result.sessionId) {
        setSessionId?.(trikId, result.sessionId);
        if (debug) {
          console.log(`[Tool] Session tracked: ${result.sessionId}`);
        }
      }

      if (result.responseMode === 'passthrough') {
        const delivery = gateway.deliverContent(result.userContentRef);

        if (!delivery) {
          return JSON.stringify({
            success: false,
            error: 'Content not found or expired',
          });
        }

        if (debug) {
          console.log(`[Tool] Auto-delivered passthrough content: ${delivery.receipt.contentType}`);
        }

        if (onPassthrough) {
          onPassthrough(delivery.content);
        }

        return JSON.stringify({
          success: true,
          response: 'Content delivered.',
          _directOutput: delivery.content.content,
        });
      }

      const response = result.templateText
        ? fillTemplate(result.templateText, result.agentData as Record<string, unknown>)
        : JSON.stringify(result.agentData);

      if (debug) {
        console.log(`[Tool] Auto-filled template response: ${response}`);
      }

      return JSON.stringify({
        success: true,
        response,
      });
    },
    {
      name: langChainName,
      description: toolDef.description,
      schema: zodSchema,
    }
  );
}

export function createLangChainTools(
  gateway: TrikGateway,
  options: LangChainAdapterOptions = {}
): DynamicStructuredTool[] {
  const { debug } = options;
  const toolDefs = gateway.getToolDefinitions();

  if (debug) {
    console.log(`[LangChainAdapter] Creating ${toolDefs.length} tools from gateway:`);
    for (const def of toolDefs) {
      console.log(`  - ${def.name} (${def.responseMode})`);
    }
  }

  return toolDefs.map((def) => createToolFromDefinition(def, gateway, options));
}

export function getToolNameMap(gateway: TrikGateway): Map<string, string> {
  const toolDefs = gateway.getToolDefinitions();
  const map = new Map<string, string>();

  for (const def of toolDefs) {
    const langChainName = toToolName(def.name);
    map.set(langChainName, def.name);
  }

  return map;
}
