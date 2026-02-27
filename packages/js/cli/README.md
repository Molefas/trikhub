# TrikHub CLI

The official command-line tool for [TrikHub](https://trikhub.com) - install and manage AI agent triks for your applications.

## Installation

```bash
npm install -g @trikhub/cli
```

## Quick Start

```bash
# Create a new trik
trik init ts   # TypeScript
trik init py   # Python

# Search for triks
trik search article

# Install a trik
trik install @acme/article-search

# List installed triks
trik list

# Get trik info
trik info @acme/article-search

# Validate a trik
trik lint .

# Upgrade a trik
trik upgrade @acme/article-search

# Uninstall a trik
trik uninstall @acme/article-search
```

## Commands

### `trik init <language>`

Create a new trik project with v2 handoff architecture boilerplate.

```bash
# Create a TypeScript trik
trik init ts
```

The interactive wizard will prompt for:

- **Trik name** - lowercase, alphanumeric + dashes (e.g., `my-trik`)
- **Display name** - Human-readable name
- **Description** - Short description
- **Author name** - Your name (saved for future use)
- **GitHub username** - Your GitHub handle (saved for future use)
- **Category** - utilities, productivity, developer, etc.
- **Storage** - Enable persistent key-value storage
- **Configuration** - Enable environment variables (API keys, etc.)
- **Agent mode** - `conversational` (LLM-powered, multi-turn) or `tool` (export native tools)
- **Handoff description** - What the trik does (used to generate the handoff tool)
- **Domain tags** - Expertise areas for routing (e.g., "content curation, article writing")
- **Location** - Where to create the project

#### Generated Structure

**TypeScript:**

```text
my-trik/
├── manifest.json        # v2 trik manifest with agent block
├── trikhub.json         # Registry metadata
├── package.json
├── tsconfig.json
├── src/
│   ├── agent.ts         # Agent entry point using wrapAgent()
│   ├── tools/
│   │   └── example.ts   # Example tool with zod schema
│   └── prompts/
│       └── system.md    # System prompt (conversational mode)
├── README.md
└── .gitignore
```

**Python:**

```text
my-trik/
├── manifest.json
├── trikhub.json
├── pyproject.toml
├── src/
│   └── my_trik/
│       ├── __init__.py
│       ├── main.py
│       └── prompts/
│           └── system.md    # System prompt (conversational mode)
├── README.md
└── .gitignore
```

#### Testing Your Trik

```bash
# TypeScript
cd my-trik
npm install
npm run build
trik lint .   # Validate manifest and quality score

# Python
cd my-trik
python -m venv .venv && source .venv/bin/activate
pip install -e .
trik lint .
```

### `trik lint <path>`

Validate a trik's manifest and source files. Shows errors, warnings, and a quality score.

```bash
trik lint .
trik lint /path/to/my-trik

# Treat warnings as errors
trik lint . --warnings-as-errors

# Skip specific rules
trik lint . --skip manifest-completeness
```

The quality score (0-100) evaluates:
- Handoff description quality
- Domain tag specificity
- System prompt presence (conversational mode)
- Tool log template coverage
- Log schema constraint safety

**TDPS linter rules:**
- `tdps-agent-safe-output` — outputSchema must use agent-safe types
- `tdps-constrained-log` — logSchema strings must be constrained
- `tdps-log-template` — logTemplate placeholders must match logSchema
- `tdps-output-template` — outputTemplate placeholders must match outputSchema

### `trik install <name>`

Install a trik from the registry.

```bash
# Install latest version
trik install @scope/trik-name

# Install specific version
trik install @scope/trik-name@1.2.3

# Or use --version flag
trik install @scope/trik-name --version 1.2.3
```

The install process:

1. **Checks TrikHub registry first** - The primary source for triks
2. **Same-language triks**: adds git URL to `package.json` and installs via npm/pnpm/yarn
3. **Cross-language triks**: downloads to `.trikhub/triks/`
4. **Falls back to npm** - If not found on TrikHub, tries npm as fallback
5. **Validates** the trik (manifest structure, security rules)
6. Registers the trik in `.trikhub/config.json`

### `trik search <query>`

Search for triks in the registry.

```bash
trik search article
trik search "web scraping"
```

### `trik list`

List all installed triks with their agent mode.

```bash
trik list
trik list --json  # Output as JSON
```

Output shows each trik's name, version, description, and agent mode (`[conversational]` or `[tool]`).

### `trik info <name>`

Show detailed information about a trik, including v2 agent info for locally installed triks.

```bash
trik info @acme/article-search
trik info @acme/article-search --json  # Output as JSON
```

For installed triks, displays:
- **Agent mode** - conversational or tool
- **Domain tags** - areas of expertise
- **Tools** - declared tool names
- **Quality score** - manifest quality (0-100)

### `trik uninstall <name>`

Remove an installed trik.

```bash
trik uninstall @acme/article-search
```

### `trik upgrade [name]`

Upgrade installed triks to their latest versions.

```bash
# Upgrade all triks
trik upgrade

# Upgrade specific trik
trik upgrade @acme/article-search

# Force reinstall even if up to date
trik upgrade --force
```

### `trik sync`

Discover trik packages in `node_modules` and register them in `.trikhub/config.json`.

```bash
# Scan node_modules and add triks to config
trik sync

# Preview what would be synced
trik sync --dry-run
```

### `trik publish`

Publish a trik to the TrikHub registry.

```bash
# From inside your trik directory
trik publish

# Or specify a directory
trik publish --directory /path/to/my-trik

# Publish a specific version tag
trik publish --tag 1.2.0
```

**Prerequisites:**

- Logged in with `trik login`
- Git tag pushed to remote matching the manifest version
- `dist/` directory committed (TypeScript triks only; Python triks don't need a build step)

**Publishing flow:**

1. Validate trik structure (manifest.json, trikhub.json)
2. Verify git tag exists on remote
3. Check `dist/` is committed
4. Register with the TrikHub registry

### Required Files

**TypeScript:**
```
your-trik/
├── manifest.json      # v2 trik manifest (required)
├── trikhub.json       # Registry metadata (required)
├── package.json       # npm package definition (required)
└── dist/
    └── agent.js       # Compiled entry point (required)
```

**Python:**
```
your-trik/
├── manifest.json      # v2 trik manifest (required)
├── trikhub.json       # Registry metadata (required)
├── pyproject.toml     # Python package definition (required)
└── src/
    └── your_trik/
        └── main.py    # Entry point (required)
```

### Manifest Requirements

Your `manifest.json` must pass v2 validation:

- `schemaVersion: 2` required
- `agent` block with `mode` and `domain` required
- Conversational mode requires `handoffDescription` and `systemPrompt`/`systemPromptFile`
- Log schema strings must be constrained (enum, format, pattern, or maxLength)

## Authentication

### `trik login`

Authenticate with TrikHub using your GitHub account.

```bash
trik login
```

### `trik logout`

Remove saved authentication.

```bash
trik logout
```

### `trik whoami`

Show the currently authenticated user.

```bash
trik whoami
```

## Trik Names

Triks use scoped names similar to npm:

```
@scope/trik-name
@scope/trik-name@version
```

- **Scope**: Maps to a GitHub user or organization (e.g., `@acme`)
- **Name**: The trik name (e.g., `article-search`)
- **Version**: Optional semver version (e.g., `1.2.3`)

All trik names are normalized to lowercase.

## How Triks Work with npm

Triks are installed as regular npm packages in your project's `node_modules/`. The CLI tracks which packages are triks in `.trikhub/config.json`.

### Project Structure

```
./your-project/
├── package.json           # Trik dependencies listed here
├── node_modules/
│   └── @scope/trik-name/  # Trik installed like any npm package
└── .trikhub/
    └── config.json        # Lists which packages are triks
```

### The Config File

`.trikhub/config.json` tracks which npm packages are triks:

```json
{
  "triks": ["@acme/article-search", "@acme/web-scraper"]
}
```

This file is used by the TrikHub Gateway to know which packages to load as triks.

## File Locations

| Path | Description |
|------|-------------|
| `~/.trikhub/config.json` | Global CLI configuration (auth tokens, registry URL) |
| `./.trikhub/config.json` | Project trik registry (list of trik package names) |
| `./package.json` | Trik dependencies (managed by npm) |
| `./node_modules/` | Installed triks (managed by npm) |

## Configuration

### Registry URL

| Environment | Registry URL |
| ----------- | ------------ |
| Production (default) | `https://api.trikhub.com` |
| Development (`--dev` flag) | `http://localhost:3001` |

```bash
trik --dev search article
trik --dev install @scope/name
```

Override with environment variable:

```bash
export TRIKHUB_REGISTRY=http://localhost:3000
```

## See Also

- [@trikhub/gateway](../gateway) - Core gateway library with handoff routing
- [@trikhub/server](../server) - HTTP server for remote gateway
- [@trikhub/manifest](../manifest) - Manifest types and validation
- [@trikhub/sdk](../sdk) - SDK for building triks (`wrapAgent()`, `transferBackTool`)

## License

MIT
