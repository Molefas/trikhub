import { tool, type DynamicStructuredTool } from '@langchain/core/tools';
import { z, type ZodTypeAny } from 'zod';
import type { SkillGateway, ToolDefinition, JSONSchema } from '@saaas-poc/skill-gateway';

export interface CreateToolsOptions {
  gateway: SkillGateway;
  getSessionId?: (skillId: string) => string | undefined;
  setSessionId?: (skillId: string, sessionId: string) => void;
  debug?: boolean;
}

function jsonSchemaToZod(schema: JSONSchema, path: string = 'root'): ZodTypeAny {
  if (!schema.type && !schema.$ref) {
    return z.unknown();
  }

  if (schema.type === 'string') {
    let zodSchema = z.string();

    if (schema.description) {
      zodSchema = zodSchema.describe(schema.description);
    }

    if (schema.minLength !== undefined) {
      zodSchema = zodSchema.min(schema.minLength);
    }
    if (schema.maxLength !== undefined) {
      zodSchema = zodSchema.max(schema.maxLength);
    }
    if (schema.pattern !== undefined) {
      zodSchema = zodSchema.regex(new RegExp(schema.pattern));
    }

    if (schema.enum && schema.enum.length > 0) {
      return z.enum(schema.enum as [string, ...string[]]).describe(schema.description || '');
    }

    return zodSchema;
  }

  if (schema.type === 'number' || schema.type === 'integer') {
    let zodSchema = schema.type === 'integer' ? z.number().int() : z.number();

    if (schema.description) {
      zodSchema = zodSchema.describe(schema.description);
    }
    if (schema.minimum !== undefined) {
      zodSchema = zodSchema.min(schema.minimum);
    }
    if (schema.maximum !== undefined) {
      zodSchema = zodSchema.max(schema.maximum);
    }

    return zodSchema;
  }

  if (schema.type === 'boolean') {
    let zodSchema = z.boolean();
    if (schema.description) {
      zodSchema = zodSchema.describe(schema.description);
    }
    return zodSchema;
  }

  if (schema.type === 'array') {
    const itemSchema = schema.items ? jsonSchemaToZod(schema.items, `${path}.items`) : z.unknown();
    let zodSchema = z.array(itemSchema);
    if (schema.description) {
      zodSchema = zodSchema.describe(schema.description);
    }
    return zodSchema;
  }

  if (schema.type === 'object') {
    const shape: Record<string, ZodTypeAny> = {};

    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        const propZod = jsonSchemaToZod(propSchema as JSONSchema, `${path}.${key}`);

        if (!schema.required?.includes(key)) {
          shape[key] = propZod.optional();
        } else {
          shape[key] = propZod;
        }
      }
    }

    let zodSchema = z.object(shape);
    if (schema.description) {
      zodSchema = zodSchema.describe(schema.description);
    }
    return zodSchema;
  }

  return z.unknown();
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

export function parseToolName(toolName: string): { skillId: string; actionName: string } {
  const parts = toolName.split('__');
  if (parts.length !== 2) {
    throw new Error(`Invalid tool name format: ${toolName}`);
  }

  return {
    skillId: parts[0],
    actionName: parts[1],
  };
}

function createToolFromDefinition(
  toolDef: ToolDefinition,
  options: CreateToolsOptions
): DynamicStructuredTool {
  const { gateway, getSessionId, setSessionId, debug } = options;
  const langChainName = toToolName(toolDef.name);

  const [skillIdPart, actionName] = toolDef.name.split(':');
  const skillId = skillIdPart;

  const zodSchema = jsonSchemaToZod(toolDef.inputSchema) as z.ZodObject<Record<string, ZodTypeAny>>;

  return tool(
    async (input: Record<string, unknown>) => {
      if (debug) {
        console.log(`[Tool] ${toolDef.name}: ${JSON.stringify(input)}`);
      }

      const sessionId = getSessionId?.(skillId);
      const result = await gateway.execute<Record<string, unknown>>(
        skillId,
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
        setSessionId?.(skillId, result.sessionId);
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

export function createToolsFromGateway(options: CreateToolsOptions): DynamicStructuredTool[] {
  const { gateway, debug } = options;
  const toolDefs = gateway.getToolDefinitions();

  if (debug) {
    console.log(`[ToolAdapter] Creating ${toolDefs.length} tools from gateway:`);
    for (const def of toolDefs) {
      console.log(`  - ${def.name} (${def.responseMode})`);
    }
  }

  return toolDefs.map((def) => createToolFromDefinition(def, options));
}

export function getToolNameMap(gateway: SkillGateway): Map<string, string> {
  const toolDefs = gateway.getToolDefinitions();
  const map = new Map<string, string>();

  for (const def of toolDefs) {
    const langChainName = toToolName(def.name);
    map.set(langChainName, def.name);
  }

  return map;
}
