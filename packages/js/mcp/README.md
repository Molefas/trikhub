# @trikhub/mcp

An MCP (Model Context Protocol) server for AI-assisted trik authoring. Use your IDE's AI assistant (Claude Code, VS Code Copilot, etc.) to create, validate, and manage TrikHub triks.

## Features

- **Guided trik creation** - Describe what you want, get a complete v2 trik scaffold with agent, tools, and system prompt
- **Manifest validation** - Real-time feedback on log schema constraints and schema correctness
- **Tool design** - Interactive tool declaration design with logTemplate and logSchema
- **Error diagnosis** - Understand and fix validation/publish/runtime errors with context-aware guidance
- **Documentation access** - v2 manifest schema reference

## Installation

```bash
# Via npm
npm install -g @trikhub/mcp

# Or via trik CLI
trik mcp
```

## Usage with Claude Code

Add to your Claude Code MCP settings (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "trikhub": {
      "command": "npx",
      "args": ["-y", "@trikhub/mcp"]
    }
  }
}
```

Or if you have `@trikhub/mcp` installed globally:

```json
{
  "mcpServers": {
    "trikhub": {
      "command": "trikhub-mcp"
    }
  }
}
```

Then restart Claude Code. You can now ask:
- "Create a trik that searches HackerNews"
- "Validate my manifest.json"
- "Why is my trik failing to publish?"

## Usage with VS Code

Add to your VS Code MCP extension settings:

```json
{
  "mcp.servers": {
    "trikhub": {
      "command": "npx",
      "args": ["-y", "@trikhub/mcp"]
    }
  }
}
```

## Quick Start via CLI

Run `trik mcp` to see configuration instructions and available tools:

```bash
trik mcp          # Show setup instructions
trik mcp --stdio  # Start server in stdio mode
```

## Available Tools

| Tool | Description |
|------|-------------|
| `analyze_trik_requirements` | Analyze description and suggest agent mode, domain tags, and tools |
| `design_tool` | Design a tool declaration with logTemplate and logSchema |
| `design_log_schema` | Create constrained logSchema for log template placeholders |
| `scaffold_trik` | Generate complete v2 trik project structure |
| `validate_manifest` | Validate v2 manifest for errors and warnings |
| `diagnose_error` | Explain and fix v2 errors with context-aware guidance |

## Available Resources

| Resource | Description |
|----------|-------------|
| `trikhub://docs/manifest-schema` | v2 manifest schema reference with examples |

## Development

```bash
# Clone the repo
git clone https://github.com/Molefas/trikhub.git
cd trikhub/packages/js/mcp

# Install dependencies
pnpm install

# Build
pnpm build

# Run in development mode
pnpm dev
```

## How It Works

The MCP server provides structured tools that guide you through trik creation:

1. **Exploration** - `analyze_trik_requirements` understands your intent and suggests agent mode, domain tags, and tools
2. **Design** - `design_tool` and `design_log_schema` create valid tool declarations with constrained log schemas
3. **Scaffold** - `scaffold_trik` generates the complete v2 project (manifest, agent.ts with wrapAgent(), system prompt, tool files)
4. **Validate** - `validate_manifest` checks correctness and reports errors and warnings
5. **Diagnose** - `diagnose_error` explains errors with context-specific fix suggestions

The LLM orchestrates these tools through natural conversation, asking clarifying questions and iterating on designs.

## Related Packages

- [@trikhub/cli](../cli) - Command-line tool for trik management
- [@trikhub/gateway](../gateway) - Handoff routing and agent orchestration
- [@trikhub/manifest](../manifest) - v2 manifest types and validation
- [@trikhub/sdk](../sdk) - wrapAgent() and tool interception for trik agents
- [@trikhub/linter](../linter) - Static analysis for trik quality

## License

MIT
