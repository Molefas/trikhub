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
  'Analyze a user description and suggest trik architecture, agent mode, tools, and capabilities. Call this first to understand what to build.',
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
      .optional()
      .describe('Description used for handoff routing (10-500 chars). Required for conversational mode, omit for tool mode.'),
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
          outputTemplate: z.string().optional().describe('Template for tool output sent to main LLM. Placeholders: {{field}}. Required for tool-mode.'),
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
  'Validate a trik manifest against schema and security rules. Returns errors and warnings.',
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
| entry | EntryDefinition | Module entry point |

## Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| tools | Record<string, ToolDeclaration> | Internal tools the agent uses |
| capabilities | { session?, storage? } | Session and storage capabilities |
| limits | { maxTurnTimeMs } | Resource limits |
| config | { required?, optional? } | Configuration requirements (API keys, tokens) |
| author | string | Author name |
| repository | string | Repository URL |
| license | string | License identifier |

## Agent Definition

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| mode | "conversational" \\| "tool" | Yes | How the agent operates |
| handoffDescription | string (10-500 chars) | Conversational only | Routing description for the handoff tool |
| systemPrompt | string | Conversational only* | Inline system prompt |
| systemPromptFile | string | Conversational only* | Path to .md file |
| model | ModelPreferences | No | LLM preferences |
| domain | string[] | Yes | Expertise tags (min 1) |

*Conversational mode requires one of systemPrompt or systemPromptFile (not both).
Tool-mode triks should NOT have handoffDescription or systemPrompt.

### Model Preferences

| Field | Type | Description |
|-------|------|-------------|
| provider | string | Provider hint: "anthropic", "openai", "any" |
| capabilities | string[] | Required model capabilities, e.g. ["tool_use"] |
| temperature | number | Temperature for generation (0.0-2.0) |

## Tool Declaration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| description | string | Yes | What the tool does |
| logTemplate | string | Conversational only | Template with {{placeholders}} for log entries |
| logSchema | Record<string, JSONSchema> | Conversational only | Types for log placeholders |
| inputSchema | JSONSchema | Tool-mode only | JSON Schema for tool input |
| outputSchema | JSONSchema | Tool-mode only | JSON Schema for tool output (agent-safe types) |
| outputTemplate | string | Tool-mode only | Template with {{placeholders}} for output sent to LLM |

## Entry Definition

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| module | string | Yes | Path to compiled module (relative to trik directory) |
| export | string | Yes | Export name ("default" for TypeScript, "agent" for Python) |
| runtime | "node" \\| "python" | No | Runtime environment (defaults to "node") |

## Capabilities

### Session

| Field | Type | Description |
|-------|------|-------------|
| enabled | boolean | Whether session state is enabled |
| maxDurationMs | number | Maximum session duration in ms (default: 30 minutes) |

### Storage

| Field | Type | Description |
|-------|------|-------------|
| enabled | boolean | Whether persistent storage is enabled |
| maxSizeBytes | number | Maximum storage size in bytes (default: 100MB) |
| persistent | boolean | Whether storage persists across sessions (default: true) |

## Configuration

Triks can declare required and optional configuration values (typically API keys):

\`\`\`json
"config": {
  "required": [{ "key": "API_KEY", "description": "API key for the service" }],
  "optional": [{ "key": "MODEL", "description": "Model name", "default": "gpt-4" }]
}
\`\`\`

## Security Constraints

### Log Schema (conversational mode)

String fields in logSchema MUST be constrained:
- \`enum\`: list of allowed values
- \`maxLength\`: maximum character count
- \`pattern\`: regex pattern
- \`format\`: "id", "date", "date-time", "uuid", "email", "url"

### Output Schema (tool mode — stricter)

String fields in outputSchema must be **agent-safe**:
- \`enum\`: list of allowed values
- \`pattern\`: regex pattern
- \`format\`: "id", "date", "date-time", "uuid", "email", "url"
- **NOT** \`maxLength\` alone (still free-form text, rejected)

If your tool returns user-provided content (titles, free text), use conversational mode instead.

Integer, number, and boolean fields are always safe.

## Examples

### Conversational Mode

\`\`\`json
{
  "schemaVersion": 2,
  "id": "my-assistant",
  "name": "My Assistant",
  "description": "A conversational assistant for specific tasks",
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
  "config": {
    "optional": [{ "key": "ANTHROPIC_API_KEY", "description": "Anthropic API key" }]
  },
  "limits": { "maxTurnTimeMs": 30000 },
  "entry": { "module": "./dist/index.js", "export": "default" }
}
\`\`\`

#### Python Conversational Example

\`\`\`json
{
  "schemaVersion": 2,
  "id": "my-assistant",
  "name": "My Assistant",
  "description": "A conversational assistant for specific tasks",
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
  "entry": { "module": "./src/agent.py", "export": "agent", "runtime": "python" }
}
\`\`\`

### Tool Mode

\`\`\`json
{
  "schemaVersion": 2,
  "id": "my-tool",
  "name": "My Tool",
  "description": "A tool that returns structured data to the main agent",
  "version": "1.0.0",
  "agent": {
    "mode": "tool",
    "domain": ["utilities"]
  },
  "tools": {
    "lookup": {
      "description": "Look up a value by ID",
      "inputSchema": {
        "type": "object",
        "properties": { "id": { "type": "string", "format": "uuid" } },
        "required": ["id"]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "status": { "type": "string", "enum": ["found", "not_found"] },
          "category": { "type": "string", "enum": ["A", "B", "C"] }
        },
        "required": ["status"]
      },
      "outputTemplate": "Lookup {{status}}: category={{category}}"
    }
  },
  "entry": { "module": "./dist/index.js", "export": "default" }
}
\`\`\`

#### Python Tool Mode Example

\`\`\`json
{
  "schemaVersion": 2,
  "id": "my-tool",
  "name": "My Tool",
  "description": "A tool that returns structured data to the main agent",
  "version": "1.0.0",
  "agent": {
    "mode": "tool",
    "domain": ["utilities"]
  },
  "tools": {
    "lookup": {
      "description": "Look up a value by ID",
      "inputSchema": {
        "type": "object",
        "properties": { "id": { "type": "string", "format": "uuid" } },
        "required": ["id"]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "status": { "type": "string", "enum": ["found", "not_found"] },
          "category": { "type": "string", "enum": ["A", "B", "C"] }
        },
        "required": ["status"]
      },
      "outputTemplate": "Lookup {{status}}: category={{category}}"
    }
  },
  "entry": { "module": "./src/tools.py", "export": "agent", "runtime": "python" }
}
\`\`\`

## Runtime Patterns

### wrapAgent Factory Pattern

\`wrapAgent\` accepts either a pre-built agent OR a factory function \`(context: TrikContext) => InvokableAgent\`.
The factory runs once on first use; the resolved agent is reused across sessions. Use the factory when
tools require runtime access to \`context.config\` or \`context.storage\`.

**TypeScript:**
\`\`\`typescript
import { wrapAgent, transferBackTool, TrikContext } from '@trikhub/sdk';
import { ChatAnthropic } from '@langchain/anthropic';
import { createReactAgent } from '@langchain/langgraph/prebuilt';

export default wrapAgent((context: TrikContext) => {
  const model = new ChatAnthropic({
    modelName: 'claude-sonnet-4-6',
    anthropicApiKey: context.config.get('ANTHROPIC_API_KEY'),
  });
  return createReactAgent({ llm: model, tools: [transferBackTool] });
});
\`\`\`

**Python:**
\`\`\`python
from trikhub.sdk import wrap_agent, transfer_back_tool, TrikContext
from langchain_anthropic import ChatAnthropic
from langgraph.prebuilt import create_react_agent

default = wrap_agent(lambda context: create_react_agent(
    model=ChatAnthropic(model="claude-sonnet-4-6",
                        api_key=context.config.get("ANTHROPIC_API_KEY")),
    tools=[transfer_back_tool],
))
\`\`\`

### transferBackTool

Every conversational agent must include \`transferBackTool\` in its tool set so the LLM can hand control
back to the main agent when the user's request is outside its domain.

- **TS import:** \`import { transferBackTool } from '@trikhub/sdk'\`
- **PY import:** \`from trikhub.sdk import transfer_back_tool\`
- Accepts an optional \`reason\` parameter (string)
- When the LLM invokes this tool, the gateway triggers a handoff-back to the main agent

### System Prompt Loading

The \`systemPromptFile\` field in the manifest resolves relative to the manifest directory. In your code,
load the prompt file yourself relative to your entry point:

**TypeScript:**
\`\`\`typescript
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const systemPrompt = readFileSync(join(__dirname, '../src/prompts/system.md'), 'utf-8');

// Then pass to createReactAgent:
createReactAgent({ llm: model, tools, messageModifier: systemPrompt });
\`\`\`

**Python:**
\`\`\`python
from pathlib import Path

_SYSTEM_PROMPT = (Path(__file__).parent / "prompts" / "system.md").read_text()

# Then pass to create_react_agent:
create_react_agent(model=model, tools=tools, prompt=_SYSTEM_PROMPT)
\`\`\`

## Runtime Context API

Both conversational and tool-mode agents receive a \`TrikContext\` with three fields:
\`{ sessionId, config, storage }\`.

### Config Access

Configuration values are set by the user in \`~/.trikhub/secrets.json\` or \`.trikhub/secrets.json\`,
declared in the manifest's \`config.required\` / \`config.optional\` blocks, and injected by the gateway.

- \`context.config.get('KEY')\` → \`string | undefined\`
- \`context.config.has('KEY')\` → \`boolean\`
- \`context.config.keys()\` → \`string[]\`

### Storage API

Persistent key-value storage. Requires \`capabilities.storage.enabled: true\` in the manifest.

- \`get(key)\` → value or null
- \`set(key, value, ttl?)\` → void (TTL in milliseconds)
- \`delete(key)\` → boolean
- \`list(prefix?)\` → string[]
- \`getMany(keys)\` → Map
- \`setMany(entries)\` → void

All methods are async.

### Storage Details

- **Location:** \`~/.trikhub/storage/storage.db\` (SQLite, WAL mode)
- **Isolation:** Per-trik isolation by \`trik_id\` — triks cannot read each other's data
- **Default quota:** 100MB (\`maxSizeBytes\` in manifest capabilities)
- **Key length limit:** 256 characters
- **Value size limit:** 10MB per value

## Distribution & Testing

### How Triks Are Distributed

Triks are **NOT** npm or PyPI packages. They are distributed through the TrikHub registry.

- **Install a published trik:** \`trik install @scope/name\`
- **For development:** reference local paths in \`.trikhub/config.json\`
- \`npm install\` / \`pip install -e .\` installs your trik's **own dependencies** (LangChain, Zod, etc.),
  not the trik itself. You never \`npm publish\` or \`pip install\` a trik.

### Testing Without Publishing

You do not need to publish a trik to test it. Three options:

1. **Run standalone** — Triks are LangGraph codebases. Import and invoke your agent directly
   in a test script (see \`test.py\` / \`npm run dev\`).

2. **Use the local playground** — Add your trik's path to \`.trikhub/config.json\` in
   \`examples/js/local-playground\` or \`examples/python/local-playground\`, then run \`npm run dev\`.

3. **Scaffold a test agent** — Run \`trik create-agent ts\` or \`trik create-agent py\` to generate
   a minimal agent project with a gateway. Add your local trik path to its \`.trikhub/config.json\`.

No publishing required at any stage of development.

### Integrating a Trik Into an Existing Agent

To consume a trik (published or local) in your own agent, use \`enhance()\` from the LangChain adapter:

**1. Register the trik in \`.trikhub/config.json\`:**
\`\`\`json
{
  "triks": [
    { "id": "@scope/my-trik", "path": "/absolute/path/to/my-trik" }
  ]
}
\`\`\`

For published triks, use just the ID string: \`"@scope/my-trik"\`.

**2. Integrate with enhance() (TypeScript):**
\`\`\`typescript
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { ChatAnthropic } from '@langchain/anthropic';
import { enhance } from '@trikhub/gateway/langchain';

const model = new ChatAnthropic({ model: 'claude-sonnet-4-6' });
const agent = createReactAgent({ llm: model, tools: myTools });

// enhance() loads triks from .trikhub/config.json and wraps your agent
const app = await enhance(agent);

const response = await app.processMessage('Hello');
console.log(response.message);  // What to show the user
console.log(response.source);   // "main" or trik ID
\`\`\`

**Python:**
\`\`\`python
from langgraph.prebuilt import create_react_agent
from langchain_anthropic import ChatAnthropic
from trikhub.langchain import enhance

model = ChatAnthropic(model="claude-sonnet-4-6")
agent = create_react_agent(model=model, tools=my_tools)

app = await enhance(agent)

response = await app.process_message("Hello")
print(response.message)
print(response.source)
\`\`\`

\`enhance()\` creates a gateway, loads triks, generates handoff tools (\`talk_to_X\`) for conversational
triks and exposes tool-mode tools directly, then wraps the agent with routing. For more control
(custom gateway config, manual tool setup), use the Gateway API directly with \`TrikGateway\`.
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
