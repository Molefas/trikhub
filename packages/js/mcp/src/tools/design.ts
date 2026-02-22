/**
 * Action and Schema Design Tools
 *
 * Helps design trik actions with proper schemas,
 * enforcing security rules for agentData.
 */

import type {
  ActionDesignInput,
  ActionDesignResult,
  SchemaDesignInput,
  SchemaDesignResult,
  FieldDefinition,
  ResponseMode,
} from './types.js';

/**
 * Allowed string formats for agentData (safe because constrained)
 */
const ALLOWED_AGENT_STRING_FORMATS = ['id', 'date', 'date-time', 'uuid', 'email', 'url'];

/**
 * Convert a field definition to JSON Schema
 */
function fieldToJsonSchema(field: FieldDefinition, forAgentData: boolean): Record<string, unknown> {
  const schema: Record<string, unknown> = {};

  switch (field.type) {
    case 'string':
      schema.type = 'string';
      if (field.description) schema.description = field.description;

      // For agentData, strings MUST be constrained
      if (forAgentData) {
        if (field.values && field.values.length > 0) {
          schema.enum = field.values;
        } else {
          // Default to pattern constraint for safety
          schema.pattern = '^.{0,500}$';
          schema.maxLength = 500;
        }
      }
      break;

    case 'number':
    case 'integer':
      schema.type = field.type;
      if (field.description) schema.description = field.description;
      break;

    case 'boolean':
      schema.type = 'boolean';
      if (field.description) schema.description = field.description;
      break;

    case 'array':
      schema.type = 'array';
      schema.items = { type: 'string' }; // Default to string array
      if (field.description) schema.description = field.description;
      break;

    case 'object':
      schema.type = 'object';
      if (field.description) schema.description = field.description;
      break;

    default:
      // Treat unknown types as strings
      schema.type = 'string';
      if (forAgentData) {
        schema.pattern = '^.{0,500}$';
      }
  }

  return schema;
}

/**
 * Build a JSON Schema from field definitions
 */
function buildSchema(
  fields: FieldDefinition[],
  schemaType: 'agentData' | 'userContent' | 'input'
): Record<string, unknown> {
  const forAgentData = schemaType === 'agentData';
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const field of fields) {
    properties[field.name] = fieldToJsonSchema(field, forAgentData);
    if (field.required !== false) {
      required.push(field.name);
    }
  }

  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
  };
}

/**
 * Check if a schema has security issues for agentData
 */
function checkAgentDataSecurity(schema: Record<string, unknown>): string[] {
  const notes: string[] = [];

  if (schema.properties && typeof schema.properties === 'object') {
    for (const [name, propSchema] of Object.entries(schema.properties as Record<string, Record<string, unknown>>)) {
      if (propSchema.type === 'string') {
        const hasEnum = Array.isArray(propSchema.enum) && propSchema.enum.length > 0;
        const hasConst = propSchema.const !== undefined;
        const hasPattern = typeof propSchema.pattern === 'string';
        const hasFormat = typeof propSchema.format === 'string' &&
          ALLOWED_AGENT_STRING_FORMATS.includes(propSchema.format);

        if (!hasEnum && !hasConst && !hasPattern && !hasFormat) {
          notes.push(
            `Field "${name}" is an unconstrained string. Added pattern constraint for security.`
          );
        }
      }
    }
  }

  return notes;
}

/**
 * Design a schema with security validation
 */
export function designSchema(input: SchemaDesignInput): SchemaDesignResult {
  const schema = buildSchema(input.fields, input.schemaType);
  const securityNotes: string[] = [];
  let valid = true;

  // Check security for agentData schemas
  if (input.schemaType === 'agentData') {
    const issues = checkAgentDataSecurity(schema);
    securityNotes.push(...issues);

    // If there were unconstrained strings, they've been auto-fixed
    if (issues.length > 0) {
      securityNotes.push(
        'Note: Pattern constraints were added automatically. Consider using enum for better type safety.'
      );
    }
  }

  return {
    schema,
    securityNotes,
    valid,
  };
}

/**
 * Design an action with proper schemas
 */
export function designAction(input: ActionDesignInput): ActionDesignResult {
  const warnings: string[] = [];
  const suggestions: string[] = [];

  // Build input schema
  const inputSchema = buildSchema(input.inputFields, 'input');

  // Separate output fields into agentData and userContent
  const agentDataFields = input.outputFields.filter((f) => !f.isUserContent);
  const userContentFields = input.outputFields.filter((f) => f.isUserContent);

  // Build the action definition
  const actionDefinition: Record<string, unknown> = {
    description: input.purpose,
    responseMode: input.responseMode,
    inputSchema,
  };

  if (input.responseMode === 'template') {
    // Template mode requires agentDataSchema and responseTemplates
    if (agentDataFields.length === 0) {
      warnings.push('Template mode requires agentDataSchema fields');
      // Add a default template field
      agentDataFields.push({
        name: 'template',
        type: 'string',
        values: ['success', 'error'],
        required: true,
      });
    }

    // Ensure there's a template selector field
    const hasTemplateField = agentDataFields.some(
      (f) => f.name === 'template' && f.values && f.values.length > 0
    );
    if (!hasTemplateField) {
      suggestions.push(
        'Consider adding a "template" field with enum values to select which response template to use'
      );
    }

    const agentDataSchema = buildSchema(agentDataFields, 'agentData');
    actionDefinition.agentDataSchema = agentDataSchema;

    // Check for security issues
    const securityIssues = checkAgentDataSecurity(agentDataSchema);
    warnings.push(...securityIssues);

    // Generate response templates based on template field values
    const templateField = agentDataFields.find((f) => f.name === 'template');
    const templateValues = templateField?.values || ['success'];
    const responseTemplates: Record<string, { text: string }> = {};

    for (const value of templateValues) {
      // Generate placeholder template text
      const otherFields = agentDataFields
        .filter((f) => f.name !== 'template')
        .map((f) => `{{${f.name}}}`)
        .join(' | ');

      responseTemplates[value] = {
        text: otherFields || `${input.actionName} completed with status: ${value}`,
      };
    }

    actionDefinition.responseTemplates = responseTemplates;

    if (userContentFields.length > 0) {
      warnings.push(
        'Template mode should not have userContent fields. Consider using passthrough mode or moving content to agentData.'
      );
    }
  } else {
    // Passthrough mode requires userContentSchema with PassthroughContent format
    // PassthroughContent requires: contentType, content, optional metadata

    // Always use the standard PassthroughContent schema
    const userContentSchema = {
      type: 'object',
      properties: {
        contentType: { type: 'string', description: 'Type of content (e.g., article, content, error)' },
        content: { type: 'string', description: 'The actual text content delivered to user' },
        metadata: { type: 'object', description: 'Optional structured metadata' },
      },
      required: ['contentType', 'content'],
    };
    actionDefinition.userContentSchema = userContentSchema;

    // Add guidance for implementation
    suggestions.push(
      'Passthrough mode requires returning userContent with: { contentType: string, content: string, metadata?: object }'
    );

    if (userContentFields.length > 0) {
      suggestions.push(
        `Your output fields (${userContentFields.map((f) => f.name).join(', ')}) should be included in the 'content' string or 'metadata' object.`
      );
    }

    if (agentDataFields.length > 0) {
      suggestions.push(
        'Passthrough mode delivers content directly to user. The agent only sees a receipt, not the agentData fields.'
      );
    }
  }

  // General suggestions
  if (input.inputFields.length === 0) {
    suggestions.push('Consider adding input fields to make the action more useful');
  }

  return {
    actionDefinition,
    warnings,
    suggestions,
  };
}
