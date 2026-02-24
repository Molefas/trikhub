/**
 * JSON Schema → Zod schema converter.
 *
 * Converts JSON Schema objects (from manifest inputSchema/outputSchema)
 * into Zod schemas for use with LangChain DynamicStructuredTool.
 */

import { z } from 'zod';
import type { JSONSchema } from '@trikhub/manifest';

/**
 * Convert a JSON Schema definition to a Zod schema.
 *
 * Supports: string (maxLength, enum, pattern, format), number, integer,
 * boolean, object with properties + required, and description passthrough.
 *
 * Throws on unsupported constructs ($ref, oneOf, anyOf, allOf, arrays, etc.).
 */
export function jsonSchemaToZod(schema: JSONSchema): z.ZodTypeAny {
  // Enum at top level (applies to any type)
  if (schema.enum) {
    if (schema.enum.length === 0) {
      throw new Error('jsonSchemaToZod: empty enum is not supported');
    }
    const values = schema.enum.map((v) => String(v));
    let zodEnum = z.enum(values as [string, ...string[]]);
    if (schema.description) {
      zodEnum = zodEnum.describe(schema.description);
    }
    return zodEnum;
  }

  const type = schema.type;

  if (type === 'string') {
    return buildStringSchema(schema);
  }

  if (type === 'number' || type === 'integer') {
    return buildNumberSchema(schema);
  }

  if (type === 'boolean') {
    let zodBool: z.ZodTypeAny = z.boolean();
    if (schema.description) {
      zodBool = zodBool.describe(schema.description);
    }
    return zodBool;
  }

  if (type === 'object') {
    return buildObjectSchema(schema);
  }

  // Unsupported constructs
  if (schema.$ref) {
    throw new Error('jsonSchemaToZod: $ref is not supported');
  }
  if (type === 'array') {
    throw new Error('jsonSchemaToZod: array type is not supported');
  }
  if (Array.isArray(type)) {
    throw new Error('jsonSchemaToZod: union types are not supported');
  }

  throw new Error(`jsonSchemaToZod: unsupported schema type "${type ?? 'undefined'}"`);
}

function buildStringSchema(schema: JSONSchema): z.ZodTypeAny {
  let zodStr = z.string();

  if (schema.maxLength !== undefined) {
    zodStr = zodStr.max(schema.maxLength);
  }

  if (schema.minLength !== undefined) {
    zodStr = zodStr.min(schema.minLength);
  }

  if (schema.pattern) {
    zodStr = zodStr.regex(new RegExp(schema.pattern));
  }

  // Format → basic string with description hint (Zod doesn't have native format)
  // We add the format info to the description for LLM guidance
  let desc = schema.description ?? '';
  if (schema.format) {
    const formatHint = `(format: ${schema.format})`;
    desc = desc ? `${desc} ${formatHint}` : formatHint;
  }

  let result: z.ZodTypeAny = zodStr;
  if (desc) {
    result = result.describe(desc);
  }
  return result;
}

function buildNumberSchema(schema: JSONSchema): z.ZodTypeAny {
  const isInteger = schema.type === 'integer';
  let zodNum = isInteger ? z.number().int() : z.number();

  if (schema.minimum !== undefined) {
    zodNum = zodNum.min(schema.minimum);
  }

  if (schema.maximum !== undefined) {
    zodNum = zodNum.max(schema.maximum);
  }

  let result: z.ZodTypeAny = zodNum;
  if (schema.description) {
    result = result.describe(schema.description);
  }
  return result;
}

function buildObjectSchema(schema: JSONSchema): z.ZodTypeAny {
  const properties = schema.properties;
  if (!properties) {
    // Object with no properties — use record
    let zodRecord: z.ZodTypeAny = z.record(z.unknown());
    if (schema.description) {
      zodRecord = zodRecord.describe(schema.description);
    }
    return zodRecord;
  }

  const requiredSet = new Set(schema.required ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, propSchema] of Object.entries(properties)) {
    let field = jsonSchemaToZod(propSchema);
    if (!requiredSet.has(key)) {
      field = field.optional();
    }
    shape[key] = field;
  }

  let zodObj: z.ZodTypeAny = z.object(shape);
  if (schema.description) {
    zodObj = zodObj.describe(schema.description);
  }
  return zodObj;
}
