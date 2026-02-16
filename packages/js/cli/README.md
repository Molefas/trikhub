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

1. **Tries npm registry first** - If the package is published to npm, installs via your package manager (npm/pnpm/yarn)
2. **Falls back to TrikHub registry** - For GitHub-only packages, downloads the tarball from GitHub Releases
3. Adds the dependency to `package.json` (npm packages use version, TrikHub packages use tarball URL)
4. Extracts to `node_modules/`
5. **Validates** the trik (manifest structure, security rules)
6. Registers the trik in `.trikhub/config.json`

This hybrid approach means triks work like regular npm packages while supporting GitHub-only distributions.

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

### `trik sync`

Discover trik packages in `node_modules` and register them in `.trikhub/config.json`.

```bash
# Scan node_modules and add triks to config
trik sync

# Preview what would be synced
trik sync --dry-run

# Output as JSON
trik sync --json
```

This is useful when you manually add a trik to `package.json` and run `npm install`. The sync command will detect the trik and register it.

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

1. Validate your trik structure (manifest.json, trikhub.json, package.json, dist/)
2. Create an **npm-compatible tarball** with files inside a `package/` directory
3. Compute SHA-256 hash for integrity verification
4. Create a GitHub Release with the tarball attached
5. Register the trik with the TrikHub registry

The tarball format is compatible with npm, so users can install directly via the tarball URL.

### Required Files

```
your-trik/
├── package.json       # npm package definition (required)
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

### TrikHub Registry Packages

For packages not published to npm (GitHub-only), the CLI:

1. Downloads the tarball from GitHub Releases
2. Extracts to `node_modules/`
3. Adds the tarball URL to `package.json`

```json
{
  "dependencies": {
    "@acme/article-search": "https://github.com/acme/article-search/releases/download/v1.0.0/article-search-1.0.0.tar.gz"
  }
}
```

This means `npm install` works natively - npm fetches from the tarball URL.

## File Locations

| Path | Description |
|------|-------------|
| `~/.trikhub/config.json` | Global CLI configuration (auth tokens, registry URL) |
| `./.trikhub/config.json` | Project trik registry (list of trik package names) |
| `./package.json` | Trik dependencies (managed by npm) |
| `./node_modules/` | Installed triks (managed by npm) |

## Validation

Every installed trik is validated to ensure security:

- **Manifest structure** - Required fields, valid schemas
- **Privilege separation** - No unconstrained strings in `agentDataSchema`
- **Entry point** - Compiled code exists at specified path
- **Response mode compliance** - Template mode has templates, passthrough has userContentSchema

Triks that fail validation are rejected to prevent prompt injection vulnerabilities.

## Configuration

### Registry URL

The registry URL is determined by environment:

| Environment | Registry URL |
| ----------- | ------------ |
| Production (default) | `https://api.trikhub.com` |
| Development (`--dev` flag) | `http://localhost:3001` |

Use the `--dev` flag for local development:

```bash
trik --dev search article
trik --dev install @scope/name
```

Alternatively, set `NODE_ENV=development`:

```bash
export NODE_ENV=development
trik search article
```

You can also override the registry URL with an environment variable:

```bash
export TRIKHUB_REGISTRY=http://localhost:3000
```

### Global Config File (`~/.trikhub/config.json`)

Stores authentication and CLI settings:

```json
{
  "analytics": true,
  "authToken": "...",
  "authExpiresAt": "2026-03-09T11:24:12.401Z",
  "publisherUsername": "your-github-username"
}
```

| Field | Description |
| ----- | ----------- |
| `analytics` | Whether to send anonymous download analytics |
| `authToken` | Authentication token (set by `trik login`) |
| `authExpiresAt` | Token expiration timestamp |
| `publisherUsername` | Authenticated GitHub username |

### Project Config File (`.trikhub/config.json`)

Tracks which npm packages are triks:

```json
{
  "triks": ["@acme/article-search", "@acme/web-scraper"],
  "trikhub": {
    "@acme/article-search": "1.0.0"
  }
}
```

| Field | Description |
| ----- | ----------- |
| `triks` | List of npm package names that are triks |
| `trikhub` | Packages installed from TrikHub registry (version tracking) |

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
