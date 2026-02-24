#!/usr/bin/env node
/**
 * TrikHub MCP Server — v2
 *
 * An MCP server that helps developers create, validate, and manage Triks
 * through AI-assisted authoring in IDEs like Claude Code and VS Code.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  analyzeTrikRequirements,
  designTool,
  designLogSchema,
  scaffoldTrik,
  validateTrikManifest,
  diagnoseErrorTool,
} from './tools/index.js';

// Create the MCP server
const server = new McpServer({
  name: 'trikhub',
  version: '0.2.0',
});

// ============================================================================
// Tool 1: analyze_trik_requirements
// ============================================================================

server.tool(
  'analyze_trik_requirements',
  'Analyze a user description and suggest trik architecture, actions, and capabilities. Call this first to understand what to build.',
  {
    description: z.string().describe('What the user wants the trik to do'),
    constraints: z.string().optional().describe('Any specific requirements (API, language, etc)'),
  },
  async ({ description, constraints }) => {
    const result = analyzeTrikRequirements(description, constraints);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

// ============================================================================
// Tool 2: design_tool
// ============================================================================

server.tool(
  'design_tool',
  'Design a single trik tool with proper log template and log schema. Enforces security rules for log values.',
  {
    toolName: z.string().describe('Name of the tool (e.g., "searchArticles")'),
    purpose: z.string().describe('What the tool does'),
    logFields: z
      .array(
        z.object({
          name: z.string().describe('Field name'),
          type: z
            .enum(['string', 'number', 'integer', 'boolean'])
            .describe('Field type'),
          maxLength: z.number().optional().describe('Max length for strings'),
          values: z
            .array(z.string())
            .optional()
            .describe('For enums: list of allowed values'),
          description: z.string().optional().describe('Field description'),
        }),
      )
      .optional()
      .describe('Log fields for structured logging'),
  },
  async ({ toolName, purpose, logFields }) => {
    const result = designTool(toolName, purpose, logFields);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

// ============================================================================
// Tool 3: design_log_schema
// ============================================================================

server.tool(
  'design_log_schema',
  'Create a logSchema for log template placeholders. Enforces constrained types for security.',
  {
    fields: z
      .array(
        z.object({
          name: z.string().describe('Field name'),
          type: z
            .enum(['string', 'number', 'integer', 'boolean', 'array', 'object'])
            .describe('Field type'),
          maxLength: z.number().optional().describe('Max length for strings'),
          values: z
            .array(z.string())
            .optional()
            .describe('For enums: list of allowed values'),
          description: z.string().optional().describe('Field description'),
        }),
      )
      .describe('Fields to include in the logSchema'),
  },
  async ({ fields }) => {
    const result = designLogSchema(fields);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

// ============================================================================
// Tool 4: scaffold_trik
// ============================================================================

server.tool(
  'scaffold_trik',
  'Generate a complete trik project structure with manifest, code, and config files.',
  {
    name: z.string().describe('Trik name (lowercase, alphanumeric + dashes)'),
    displayName: z.string().describe('Human-readable name'),
    description: z.string().describe('Short description of what the trik does'),
    language: z.enum(['ts', 'py']).describe('TypeScript or Python'),
    category: z
      .enum([
        'utilities', 'productivity', 'developer', 'data', 'search',
        'content', 'communication', 'finance', 'entertainment', 'education', 'other',
      ])
      .describe('Category for the trik'),
    mode: z
      .enum(['conversational', 'tool'])
      .describe('Agent mode: conversational (LLM agent) or tool (export native tools)'),
    handoffDescription: z
      .string()
      .describe('Description used for handoff routing (10-500 chars)'),
    domain: z
      .array(z.string())
      .describe('Domain tags for routing (e.g., ["content curation", "RSS feeds"])'),
    tools: z
      .array(
        z.object({
          name: z.string(),
          description: z.string(),
          logTemplate: z.string().optional(),
          logSchema: z.record(z.unknown()).optional(),
        }),
      )
      .optional()
      .describe('Tool definitions'),
    capabilities: z
      .object({
        storage: z.boolean().optional(),
        session: z.boolean().optional(),
        config: z
          .array(z.object({ key: z.string(), description: z.string() }))
          .optional(),
      })
      .optional()
      .describe('Required capabilities'),
  },
  async (input) => {
    const result = scaffoldTrik(input);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

// ============================================================================
// Tool 5: validate_manifest
// ============================================================================

server.tool(
  'validate_manifest',
  'Validate a trik manifest against schema and security rules. Returns errors, warnings, and quality score.',
  {
    manifest: z.string().describe('The manifest.json content as a string'),
    strict: z.boolean().optional().describe('Enable additional warnings'),
  },
  async ({ manifest, strict }) => {
    const result = validateTrikManifest(manifest, strict);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

// ============================================================================
// Tool 6: diagnose_error
// ============================================================================

server.tool(
  'diagnose_error',
  'Explain an error message and suggest how to fix it.',
  {
    error: z.string().describe('The error message to diagnose'),
    context: z
      .enum(['publish', 'lint', 'runtime'])
      .optional()
      .describe('Where the error occurred'),
  },
  async ({ error, context }) => {
    const result = diagnoseErrorTool(error, context);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

// ============================================================================
// Resources
// ============================================================================

server.resource(
  'manifest-schema',
  'trikhub://docs/manifest-schema',
  { mimeType: 'text/markdown' },
  async () => ({
    contents: [
      {
        uri: 'trikhub://docs/manifest-schema',
        mimeType: 'text/markdown',
        text: MANIFEST_SCHEMA_DOC,
      },
    ],
  }),
);

const MANIFEST_SCHEMA_DOC = `# TrikHub v2 Manifest Schema

## Required Fields

| Field | Type | Description |
|-------|------|-------------|
| schemaVersion | \`2\` | Must be 2 |
| id | string | Lowercase alphanumeric + dashes, starts with letter |
| name | string | Human-readable display name |
| description | string | What the trik does |
| version | string | Semantic version |
| agent | AgentDefinition | How this trik operates as an agent |
| entry | EntryPoint | Module entry point |

## Agent Definition

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| mode | "conversational" \\| "tool" | Yes | How the agent operates |
| handoffDescription | string (10-500 chars) | Yes | Routing description |
| systemPrompt | string | No* | Inline system prompt |
| systemPromptFile | string | No* | Path to .md file |
| model | ModelPreferences | No | LLM preferences |
| domain | string[] | Yes | Expertise tags (min 1) |

*Conversational mode requires one of systemPrompt or systemPromptFile (not both).

## Tool Declaration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| description | string | Yes | What the tool does |
| logTemplate | string | No | Template with {{placeholders}} |
| logSchema | Record<string, JSONSchema> | No | Types for placeholders |

### Log Schema Constraints

String fields in logSchema MUST be constrained:
- \`enum\`: list of allowed values
- \`maxLength\`: maximum character count
- \`pattern\`: regex pattern
- \`format\`: "id", "date", "date-time", "uuid", "email", "url"

Integer, number, and boolean fields are always safe.

## Example

\`\`\`json
{
  "schemaVersion": 2,
  "id": "my-trik",
  "name": "My Trik",
  "description": "Does something useful",
  "version": "1.0.0",
  "agent": {
    "mode": "conversational",
    "handoffDescription": "Handles specific tasks with multi-turn conversations",
    "systemPromptFile": "./src/prompts/system.md",
    "model": { "capabilities": ["tool_use"] },
    "domain": ["specific-domain"]
  },
  "tools": {
    "doThing": {
      "description": "Does the thing",
      "logTemplate": "Did thing: {{result}}",
      "logSchema": { "result": { "type": "string", "maxLength": 100 } }
    }
  },
  "capabilities": {
    "session": { "enabled": true },
    "storage": { "enabled": true }
  },
  "limits": { "maxTurnTimeMs": 30000 },
  "entry": { "module": "./dist/agent.js", "export": "default" }
}
\`\`\`
`;

// ============================================================================
// Start server
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('TrikHub MCP server started (v2)');
}

main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
