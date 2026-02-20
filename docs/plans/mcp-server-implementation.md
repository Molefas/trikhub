# TrikHub MCP Server - Implementation Plan

> Saved: 2026-02-20

## Context

TrikHub enables developers to create, publish, and use secure AI agent skills ("Triks"). The main barrier to adoption is the complexity of authoring triks:

- Complex manifest schema with security constraints (Type-Directed Privilege Separation)
- Multiple response modes (template/passthrough) with different requirements
- Security rules (no free-form strings in agentDataSchema)
- Build/test/publish workflow

An MCP server will let developers use their IDE's AI assistant (Claude Code, Copilot, etc.) to guide them through trik creation with context-aware assistance.

## Goals

1. **Create new triks** - Interactive scaffolding with proper manifest generation
2. **Modify existing triks** - Add actions, fix validation errors, update schemas
3. **Learn/explore** - Explain concepts, show examples, answer questions
4. **Validate** - Real-time feedback on manifest correctness

## Architecture

```text
┌─────────────────────────────────────────────────────────┐
│                    @trikhub/mcp                         │
│  (new standalone package)                               │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │   Tools     │  │  Resources  │  │    Prompts      │ │
│  │             │  │             │  │                 │ │
│  │ createTrik  │  │ docs://...  │  │ create-trik     │ │
│  │ addAction   │  │ schema://.. │  │ debug-manifest  │ │
│  │ validate    │  │ examples:// │  │                 │ │
│  │ diagnose    │  │             │  │                 │ │
│  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘ │
│         │                │                   │          │
│         └────────────────┼───────────────────┘          │
│                          │                              │
│  ┌───────────────────────▼──────────────────────────┐  │
│  │              Shared Core                          │  │
│  │  - @trikhub/manifest (types, validation)          │  │
│  │  - @trikhub/linter (security rules)               │  │
│  │  - Template generators (from CLI)                 │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Implementation Steps

### Phase 1: Package Setup ✅ COMPLETE

**Files created:**

- `packages/js/mcp/package.json` - Package with MCP SDK, @trikhub/manifest, @trikhub/linter
- `packages/js/mcp/src/index.ts` - MCP server with placeholder tools
- `packages/js/mcp/tsconfig.json` - TypeScript config extending base
- `packages/js/mcp/README.md` - Usage documentation

**Learnings:**

- MCP SDK uses `server.tool(name, description, zodSchema, callback)` pattern
- Tool callbacks must return `{ content: [{ type: 'text', text: '...' }] }`
- Resources use `server.resource(name, uri, metadata, callback)` - metadata excludes `name`
- Server logs to stderr to avoid interfering with MCP protocol on stdout
- SDK requires zod ^3.25.0 as peer dependency

### Phase 2: Core Tools Implementation ✅ COMPLETE

The tools are designed in layers: **exploration → design → scaffold → validate**

**Files created:**

- `src/tools/types.ts` - Shared type definitions
- `src/tools/analyze.ts` - Requirement analysis with keyword detection
- `src/tools/design.ts` - Action/schema design with security enforcement
- `src/tools/scaffold.ts` - Project generation (TS + Python, simple + LangGraph)
- `src/tools/validate.ts` - Manifest validation using @trikhub/manifest
- `src/tools/index.ts` - Exports

**Tools implemented:**

| Tool | Status | Notes |
|------|--------|-------|
| analyze_trik_requirements | ✅ | Detects actions, architecture, capabilities from description |
| design_action | ✅ | Creates action schemas with security warnings |
| design_schema | ✅ | Builds JSON Schema with agentData constraints |
| scaffold_trik | ✅ | Generates complete TS/Python projects |
| validate_manifest | ✅ | Full validation with security scoring |
| diagnose_error | ✅ | Error explanation with fix suggestions |

**Learnings:**

- Keyword detection works well for suggesting capabilities (storage, session, config)
- Security validation catches unconstrained strings in agentData
- Scaffold templates should include more action-specific code hints

#### Layer 1: Exploration Tools

**`analyze_trik_requirements`** - First tool called to understand what user wants

```typescript
input: {
  description: string,      // "I want a trik that monitors GitHub repos"
  constraints?: string      // "Must work with GitHub API, TypeScript"
}
output: {
  suggestedActions: Array<{
    name: string,
    purpose: string,
    complexity: "simple" | "moderate" | "complex"
  }>,
  recommendedArchitecture: "simple" | "langgraph",
  architectureReason: string,
  suggestedCapabilities: {
    storage: boolean,
    session: boolean,
    config: string[]        // e.g., ["GITHUB_TOKEN"]
  },
  clarifyingQuestions: string[]  // Questions LLM should ask user
}
```

#### Layer 2: Design Tools

**`design_action`** - Design a single action with proper schemas

```typescript
input: {
  actionName: string,
  purpose: string,
  responseMode: "template" | "passthrough",
  inputFields: Array<{ name: string, type: string, required: boolean }>,
  outputFields: Array<{
    name: string,
    type: string,
    isUserContent: boolean  // true = goes to userContent, false = agentData
  }>
}
output: {
  actionDefinition: ActionDefinition,  // Valid manifest action
  warnings: string[],                   // Security/design warnings
  suggestions: string[]                 // Improvements to consider
}
```

**`design_schema`** - Help design agentData/userContent schemas

```typescript
input: {
  fields: Array<{ name: string, type: string, values?: string[] }>,
  schemaType: "agentData" | "userContent" | "input"
}
output: {
  schema: JSONSchema,
  securityNotes: string[],  // "Field X needs enum constraint for agentData"
  valid: boolean
}
```

#### Layer 3: Scaffold Tools

**`scaffold_trik`** - Generate complete trik structure

```typescript
input: {
  name: string,
  displayName: string,
  description: string,
  language: "ts" | "py",
  category: TrikCategory,
  architecture: "simple" | "langgraph",
  actions: ActionDefinition[],
  capabilities: { storage?: boolean, session?: boolean, config?: ConfigRequirement[] }
}
output: {
  files: Array<{ path: string, content: string }>,
  nextSteps: string[],
  implementationNotes: Record<string, string>  // Per-action hints
}
```

**`add_action_to_trik`** - Add action to existing trik

```typescript
input: {
  trikPath: string,         // Path to trik directory
  action: ActionDefinition
}
output: {
  updatedManifest: string,
  newFiles: Array<{ path: string, content: string }>,
  warnings: string[]
}
```

#### Layer 4: Validation Tools

**`validate_manifest`** - Full validation with detailed feedback

```typescript
input: {
  manifest: TrikManifest | string,  // Object or file path
  strict?: boolean                   // Enable all warnings
}
output: {
  valid: boolean,
  errors: Array<{ path: string, message: string, fix?: string }>,
  warnings: Array<{ path: string, message: string, suggestion?: string }>,
  securityScore: number  // 0-100
}
```

**`diagnose_error`** - Explain errors and suggest fixes

```typescript
input: {
  error: string,                              // Error message
  context?: "publish" | "lint" | "runtime"    // Where error occurred
}
output: {
  explanation: string,
  rootCause: string,
  suggestedFix: string,
  relatedDocs: string[]  // Links to relevant documentation
}
```

#### Layer 5: Discovery Tools

**`search_registry`** - Find existing triks for reference

```typescript
input: {
  query?: string,
  category?: TrikCategory
}
output: {
  triks: Array<{ name: string, description: string, actions: string[] }>,
  totalCount: number
}
```

### Phase 3: Resources

Expose documentation and schemas as MCP resources:

1. **`trikhub://docs/manifest-schema`** - Full manifest JSON schema
2. **`trikhub://docs/security-model`** - Privilege separation explanation
3. **`trikhub://docs/response-modes`** - Template vs passthrough guide
4. **`trikhub://examples/{category}`** - Example triks by category
5. **`trikhub://schema/action`** - Action definition schema

### Phase 4: Prompts

Pre-built prompt templates:

1. **`create-trik`** - Guided trik creation conversation
2. **`debug-manifest`** - Debug why manifest is invalid
3. **`add-api-integration`** - Add an action that calls an external API

### Phase 5: CLI Integration & Distribution

- Add `trik mcp` command to CLI for easy startup
- Publish `@trikhub/mcp` to npm
- Document installation for Claude Code, VS Code, etc.

## Files to Modify

| File | Change |
| ---- | ------ |
| `packages/js/cli/src/templates/typescript.ts` | Extract shared template logic |
| `packages/js/cli/src/templates/python.ts` | Extract shared template logic |
| `packages/js/cli/package.json` | Add mcp command dependency |
| `pnpm-workspace.yaml` | Add mcp package to workspace |

## Files to Create

| File | Purpose |
| ---- | ------- |
| `packages/js/mcp/package.json` | Package definition |
| `packages/js/mcp/src/index.ts` | Server entry point |
| `packages/js/mcp/src/server.ts` | MCP server setup |
| `packages/js/mcp/src/tools/*.ts` | Individual tool implementations |
| `packages/js/mcp/src/resources/*.ts` | Resource handlers |
| `packages/js/mcp/src/prompts/*.ts` | Prompt templates |
| `packages/js/mcp/README.md` | Documentation |

## Verification

1. **Unit tests** - Test each tool with mock inputs
2. **Integration test** - Run MCP server locally, connect with Claude Code
3. **E2E test** - Create a complete trik using only MCP tools
4. **Manual verification:**

   ```bash
   # Start MCP server
   cd packages/js/mcp && npm run dev

   # In Claude Code settings, add:
   # "trikhub": { "command": "node", "args": ["path/to/mcp/dist/index.js"] }

   # Test with: "Create a trik that searches HackerNews"
   ```

## Open Questions

1. **Authentication** - Should MCP tools support `trik publish` or only local operations?
2. **File system access** - How to handle reading/writing files in sandboxed environments?
3. **Build execution** - Should MCP trigger `npm build` or just generate files?

## Timeline Estimate

- Phase 1 (Setup): 1-2 hours
- Phase 2 (Tools): 4-6 hours
- Phase 3 (Resources): 2-3 hours
- Phase 4 (Prompts): 1-2 hours
- Phase 5 (Integration): 2-3 hours

**Total: ~12-16 hours**
