# TrikHub CLI

The official command-line tool for [TrikHub](https://trikhub.com) - install and manage AI skills (triks) for your applications.

## Installation

```bash
npm install -g @trikhub/cli
```

## Quick Start

```bash
# Search for triks
trik search article

# Install a trik
trik install @acme/article-search

# List installed triks
trik list

# Get trik info
trik info @acme/article-search

# Upgrade a trik
trik upgrade @acme/article-search

# Uninstall a trik
trik uninstall @acme/article-search
```

## Commands

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
1. Resolves configuration (see [Local vs Global Configuration](#local-vs-global-configuration))
2. Fetches trik metadata from the registry
3. Downloads the tarball from GitHub Releases
4. Extracts to the configured triks directory
5. **Validates** the trik (manifest structure, security rules)
6. Updates the lockfile

If validation fails, the trik is removed and installation aborts.

### `trik search <query>`

Search for triks in the registry.

```bash
trik search article
trik search "web scraping"
```

### `trik list`

List all installed triks.

```bash
trik list
trik list --json  # Output as JSON
```

### `trik info <name>`

Show detailed information about a trik.

```bash
trik info @acme/article-search
trik info @acme/article-search --json  # Output as JSON
```

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

## Authentication

### `trik login`

Authenticate with TrikHub using your GitHub account.

```bash
trik login
```

This starts a device authorization flow:
1. Opens a browser to GitHub
2. Displays a code to enter
3. After authorization, your session is saved locally

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

## Publishing

### `trik publish`

Publish a trik to the TrikHub registry.

```bash
# From inside your trik directory
trik publish

# Or specify a directory
trik publish --directory /path/to/my-trik

# Publish a specific version
trik publish --tag 1.2.0

# Skip GitHub release creation (create it manually)
trik publish --skip-release
```

**Prerequisites:**

- Logged in with `trik login`
- GitHub CLI (`gh`) installed and authenticated
- Write access to the GitHub repository

### Publishing Flow

The CLI will:

1. Validate your trik structure (manifest.json, trikhub.json, dist/)
2. Create a tarball with required files
3. Compute SHA-256 hash for integrity verification
4. Create a GitHub Release with the tarball attached
5. Register the trik with the TrikHub registry

### Required Files

```
your-trik/
├── manifest.json      # Trik manifest (required)
├── trikhub.json       # Registry metadata (required)
├── dist/
│   └── graph.js       # Compiled entry point (required)
└── README.md          # Documentation (recommended)
```

### Manifest Requirements

Your `manifest.json` must pass validation:

- Use `enum`, `const`, or `pattern` to constrain strings in `agentDataSchema`
- Template mode requires `responseTemplates`
- Passthrough mode requires `userContentSchema`

See the [SAAAS SDK documentation](https://github.com/trikhub/saaas-sdk) for manifest schema details.

## Trik Names

Triks use scoped names similar to npm:

```
@scope/trik-name
@scope/trik-name@version
```

- **Scope**: Maps to a GitHub user or organization (e.g., `@acme`)
- **Name**: The trik name (e.g., `article-search`)
- **Version**: Optional semver version (e.g., `1.2.3`)

**Note:** All trik names are normalized to lowercase. `@Acme/Article-Search` becomes `@acme/article-search`.

## Local vs Global Configuration

The CLI supports both **local** (project-level) and **global** (user-level) configurations. This allows you to have project-specific trik installations or share triks across all projects.

### Configuration Resolution

When you run a command like `trik install`, the CLI resolves configuration in this order:

1. **Local config**: Checks for `.trikhub/config.json` in the current directory
2. **Global config**: Falls back to `~/.trikhub/config.json` in your home directory
3. **Setup prompt**: If neither exists, prompts you to choose where to set up

```
$ trik install @acme/article-search

No TrikHub configuration found.
Triks need a place to be installed.

? Where would you like to set up TrikHub?
❯ Global (~/.trikhub)      - Available to all projects
  Local (./.trikhub)       - Project-specific configuration
```

### Global Configuration (Default)

Triks are installed in your home directory and available to all projects:

```
~/.trikhub/
├── config.json      # CLI configuration
├── triks.lock       # Lockfile tracking installed versions
└── triks/           # Installed triks
    └── @scope/trik-name/
```

### Local Configuration

Triks are installed in the current project directory. Useful for:

- Project-specific trik versions
- Sharing trik configurations with your team (commit `.trikhub/` to git)
- Isolated environments

```
./your-project/
└── .trikhub/
    ├── config.json      # Project-specific configuration
    ├── triks.lock       # Project lockfile
    └── triks/           # Project-specific triks
        └── @scope/trik-name/
```

### Switching Between Scopes

The CLI automatically detects which scope to use based on the presence of `.trikhub/config.json` in the current directory:

```bash
# In a project with local config
$ trik list
Installed triks (2) (local: /path/to/project/.trikhub):
  ● @acme/article-search v1.0.0

# In a directory without local config (uses global)
$ cd ~
$ trik list
Installed triks (5) (global):
  ● @acme/other-trik v2.0.0
```

### Initializing a Local Config

If you have a global config but want to set up a local one for a project:

```bash
$ trik install @scope/some-trik
# When prompted "Use global configuration?", select "No"
# This will initialize a local .trikhub/ directory
```

## File Locations

### Global (Default)

| Path | Description |
|------|-------------|
| `~/.trikhub/config.json` | CLI configuration |
| `~/.trikhub/triks.lock` | Lockfile tracking installed versions |
| `~/.trikhub/triks/` | Installed triks directory |

### Local (Project-Level)

| Path | Description |
|------|-------------|
| `./.trikhub/config.json` | Project-specific configuration |
| `./.trikhub/triks.lock` | Project lockfile |
| `./.trikhub/triks/` | Project-specific triks |

## Validation

Every installed trik is validated to ensure security:

- **Manifest structure** - Required fields, valid schemas
- **Privilege separation** - No unconstrained strings in `agentDataSchema`
- **Entry point** - Compiled code exists at specified path
- **Response mode compliance** - Template mode has templates, passthrough has userContentSchema

Triks that fail validation are rejected to prevent prompt injection vulnerabilities.

## Configuration

### Registry URL

By default, the CLI connects to `https://api.trikhub.com`. For development, you can override this:

```bash
# Environment variable (highest priority)
export TRIKHUB_REGISTRY=http://localhost:3000

# Or edit your config.json (local or global)
{
  "registry": "http://localhost:3000"
}
```

### Config File

The `config.json` file (either local `.trikhub/config.json` or global `~/.trikhub/config.json`) stores:

```json
{
  "registry": "https://api.trikhub.com",
  "triksDirectory": ".trikhub/triks",
  "analytics": true,
  "authToken": "...",
  "authExpiresAt": "2026-03-09T11:24:12.401Z",
  "publisherUsername": "your-github-username"
}
```

| Field | Description |
| ----- | ----------- |
| `registry` | TrikHub registry URL |
| `triksDirectory` | Where triks are installed (relative to config location for local) |
| `analytics` | Whether to send anonymous download analytics |
| `authToken` | Authentication token (set by `trik login`) |
| `authExpiresAt` | Token expiration timestamp |
| `publisherUsername` | Authenticated GitHub username |

## Development

```bash
# Clone the repo
git clone https://github.com/trikhub/cli
cd cli

# Install dependencies
pnpm install

# Build
pnpm build

# Run locally
node dist/cli.js --help

# With local registry
TRIKHUB_REGISTRY=http://localhost:3000 node dist/cli.js search article
```

## Related Projects

- **[@trikhub/registry](https://github.com/trikhub/registry)** - The TrikHub registry service
- **[SAAAS SDK](https://github.com/trikhub/saaas-sdk)** - SDK for building AI skills
- **[trikhub.com](https://trikhub.com)** - Web interface for browsing triks

## License

MIT
