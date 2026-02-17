import { z, type ZodTypeAny } from 'zod';
import type { JSONSchema } from '@trikhub/manifest';

export function jsonSchemaToZod(schema: JSONSchema, path: string = 'root'): ZodTypeAny {
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
          // OpenAI structured outputs require optional fields to also be nullable
          shape[key] = propZod.nullable().optional();
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
