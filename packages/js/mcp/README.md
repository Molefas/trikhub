# @trikhub/mcp

An MCP (Model Context Protocol) server for AI-assisted trik authoring. Use your IDE's AI assistant (Claude Code, VS Code Copilot, etc.) to create, validate, and manage TrikHub triks.

## Features

- **Guided trik creation** - Describe what you want, get a complete trik scaffold
- **Manifest validation** - Real-time feedback on security rules and schema correctness
- **Action design** - Interactive schema design with security warnings
- **Error diagnosis** - Understand and fix validation/publish errors
- **Documentation access** - Schema references and examples at your fingertips

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
| `analyze_trik_requirements` | Analyze description and suggest architecture |
| `design_action` | Design action with proper schemas |
| `design_schema` | Create agentData/userContent schemas |
| `scaffold_trik` | Generate complete trik structure |
| `validate_manifest` | Validate manifest against rules |
| `diagnose_error` | Explain and fix errors |

## Available Resources

| Resource | Description |
|----------|-------------|
| `trikhub://docs/manifest-schema` | Manifest JSON Schema reference |
| `trikhub://docs/security-model` | Type-Directed Privilege Separation guide |
| `trikhub://docs/response-modes` | Template vs passthrough explanation |
| `trikhub://examples/all` | Example trik patterns for common use cases |

## Available Prompts

| Prompt | Description |
|--------|-------------|
| `create-trik` | Guided trik creation conversation |
| `debug-manifest` | Debug invalid manifests |
| `add-api-integration` | Add external API action |

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

1. **Exploration** - `analyze_trik_requirements` understands your intent
2. **Design** - `design_action` creates valid action schemas
3. **Scaffold** - `scaffold_trik` generates the complete project
4. **Validate** - `validate_manifest` ensures security compliance

The LLM orchestrates these tools through natural conversation, asking clarifying questions and iterating on designs.

## Related Packages

- [@trikhub/cli](../cli) - Command-line tool for trik management
- [@trikhub/gateway](../gateway) - Secure trik execution gateway
- [@trikhub/manifest](../manifest) - Manifest types and validation
- [@trikhub/linter](../linter) - Static analysis for trik security

## License

MIT
