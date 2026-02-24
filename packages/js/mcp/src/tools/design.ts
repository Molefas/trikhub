/**
 * Design tools — v2 implementation.
 *
 * design_tool: Design an internal tool declaration with logTemplate + logSchema.
 * design_log_schema: Design a logSchema for log template placeholders.
 */

import type { JSONSchema } from '@trikhub/manifest';
import type { DesignToolResult, DesignLogSchemaResult } from './types.js';

// ============================================================================
// Constrained type helpers
// ============================================================================

/** Allowed safe formats for string fields in logSchema */
const SAFE_FORMATS = ['id', 'date', 'date-time', 'uuid', 'email', 'url'];

/**
 * Check if a JSONSchema type is constrained (safe for log context).
 */
function isConstrained(schema: JSONSchema): boolean {
  const type = schema.type;

  // Non-string primitives are always safe
  if (type === 'integer' || type === 'number' || type === 'boolean') {
    return true;
  }

  // Enums are always safe
  if (schema.enum) {
    return true;
  }

  // Strings must have constraints
  if (type === 'string') {
    return !!(schema.enum || schema.format || schema.pattern || schema.maxLength);
  }

  return false;
}

/**
 * Build a JSONSchema for a log field definition.
 */
function buildLogFieldSchema(field: {
  name: string;
  type: string;
  maxLength?: number;
  values?: string[];
  description?: string;
}): { schema: JSONSchema; warning?: string } {
  const schema: JSONSchema = { type: field.type };

  if (field.description) {
    schema.description = field.description;
  }

  // Handle enums
  if (field.values && field.values.length > 0) {
    schema.enum = field.values;
    return { schema };
  }

  // Auto-constrain strings
  if (field.type === 'string') {
    if (field.maxLength) {
      schema.maxLength = field.maxLength;
    } else {
      // Auto-add a sensible default maxLength
      schema.maxLength = 200;
      return {
        schema,
        warning: `Field "${field.name}": auto-constrained with maxLength=200. Consider adding enum, pattern, or a specific maxLength.`,
      };
    }
  }

  return { schema };
}

// ============================================================================
// design_tool
// ============================================================================

export function designTool(
  toolName: string,
  purpose: string,
  logFields?: Array<{
    name: string;
    type: string;
    maxLength?: number;
    values?: string[];
    description?: string;
  }>,
): DesignToolResult {
  const warnings: string[] = [];
  const suggestions: string[] = [];

  // Build the tool declaration
  const description = purpose.endsWith('.') ? purpose : `${purpose}.`;

  let logTemplate: string | undefined;
  let logSchema: Record<string, JSONSchema> | undefined;

  if (logFields && logFields.length > 0) {
    // Build logTemplate from field names
    const placeholders = logFields.map((f) => `{{${f.name}}}`);

    // Generate a readable template
    const action = toolName.replace(/([A-Z])/g, ' $1').trim().toLowerCase();
    logTemplate = `${action.charAt(0).toUpperCase() + action.slice(1)}: ${placeholders.join(', ')}`;

    // Build logSchema
    logSchema = {};
    for (const field of logFields) {
      const { schema, warning } = buildLogFieldSchema(field);
      logSchema[field.name] = schema;
      if (warning) {
        warnings.push(warning);
      }

      // Validate constrained
      if (!isConstrained(schema)) {
        warnings.push(
          `Field "${field.name}": unconstrained string in logSchema. Add enum, format, pattern, or maxLength.`,
        );
      }
    }
  } else {
    suggestions.push(
      'Consider adding logFields to generate a logTemplate. This provides structured logging in the main agent\'s context.',
    );
  }

  // Validate tool name
  if (toolName.includes(' ') || toolName.includes('-')) {
    warnings.push('Tool name should be camelCase (e.g., "searchArticles" not "search-articles").');
  }

  return {
    toolDeclaration: {
      description,
      logTemplate,
      logSchema,
    },
    warnings,
    suggestions,
  };
}

// ============================================================================
// design_log_schema
// ============================================================================

export function designLogSchema(
  fields: Array<{
    name: string;
    type: string;
    maxLength?: number;
    values?: string[];
    description?: string;
  }>,
): DesignLogSchemaResult {
  const warnings: string[] = [];
  const logSchema: Record<string, JSONSchema> = {};

  for (const field of fields) {
    const { schema, warning } = buildLogFieldSchema(field);
    logSchema[field.name] = schema;
    if (warning) {
      warnings.push(warning);
    }

    if (!isConstrained(schema)) {
      warnings.push(
        `Field "${field.name}": unconstrained string — add enum, format (${SAFE_FORMATS.join(', ')}), pattern, or maxLength.`,
      );
    }
  }

  // Check for unsupported types
  for (const field of fields) {
    if (field.type === 'array' || field.type === 'object') {
      warnings.push(
        `Field "${field.name}": ${field.type} types are not supported in logSchema. Use primitive types (string, integer, number, boolean).`,
      );
    }
  }

  return { logSchema, warnings };
}
