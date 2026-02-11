# @trikhub/server

HTTP server for TrikHub - remote gateway for AI agents.

## Installation

### Global CLI

```bash
npm install -g @trikhub/server
trik-server
```

### As a dependency

```bash
npm install @trikhub/server
```

### Docker

```bash
# Pull and run
docker run -p 3000:3000 -v trik-data:/data trikhub/server

# Or use docker-compose
docker-compose up
```

## Quick Start

1. Run the server:

```bash
trik-server
```

1. Install a trik via API:

```bash
curl -X POST http://localhost:3000/api/v1/triks/install \
  -H "Content-Type: application/json" \
  -d '{"package": "@molefas/article-search"}'
```

1. Access the API:
   - Health: http://localhost:3000/api/v1/health
   - API Docs: http://localhost:3000/docs
   - Tools: http://localhost:3000/api/v1/tools

## Configuration

All configuration is done via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Server host |
| `SKILLS_DIR` | `./skills` | Directory containing local skills |
| `CONFIG_PATH` | - | Path to `.trikhub/config.json` for npm-installed skills |
| `AUTH_TOKEN` | - | Bearer token for authentication (optional) |
| `LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `LINT_ON_LOAD` | `true` | Validate skills before loading |
| `LINT_WARNINGS_AS_ERRORS` | `false` | Treat lint warnings as errors |
| `ALLOWED_SKILLS` | - | Comma-separated allowlist of skill IDs |

## API Endpoints

### Core Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/health` | GET | Health check |
| `/api/v1/tools` | GET | List available tools |
| `/api/v1/execute` | POST | Execute a skill action |
| `/api/v1/content/:ref` | GET | Retrieve passthrough content |
| `/docs` | GET | Swagger UI documentation |

### Trik Management Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/triks` | GET | List installed triks |
| `/api/v1/triks/install` | POST | Install a trik package |
| `/api/v1/triks/:name` | DELETE | Uninstall a trik |
| `/api/v1/triks/reload` | POST | Hot-reload all skills |

### Execute a Skill

```bash
curl -X POST http://localhost:3000/api/v1/execute \
  -H "Content-Type: application/json" \
  -d '{"tool": "my-skill:action", "input": {"param": "value"}}'
```

### Install a Trik

```bash
curl -X POST http://localhost:3000/api/v1/triks/install \
  -H "Content-Type: application/json" \
  -d '{"package": "@molefas/article-search"}'
```

### List Installed Triks

```bash
curl http://localhost:3000/api/v1/triks
```

## Docker Usage

The Docker image includes the `trik` CLI for runtime package management.

### Basic Usage

```bash
docker run -p 3000:3000 -v trik-data:/data trikhub/server
```

### With Local Skills (Read-Only)

```bash
docker run -p 3000:3000 \
  -v ./skills:/data/skills:ro \
  trikhub/server
```

### With Authentication

```bash
docker run -p 3000:3000 \
  -v trik-data:/data \
  -e AUTH_TOKEN=your-secret-token \
  trikhub/server
```

### Runtime Trik Installation

Install triks at runtime via CLI:

```bash
docker exec trik-server trik install @molefas/article-search
```

Or via API:

```bash
curl -X POST http://localhost:3000/api/v1/triks/install \
  -H "Content-Type: application/json" \
  -d '{"package": "@molefas/article-search"}'
```

### Using docker-compose

```yaml
services:
  trik-server:
    image: trikhub/server
    ports:
      - "3000:3000"
    volumes:
      - trik-data:/data
    environment:
      - LOG_LEVEL=info

volumes:
  trik-data:
```

### Building from Source

```bash
# From monorepo root
docker build -f packages/trik-server/Dockerfile -t trikhub/server .
```

## Skill Loading

The server loads skills from two sources:

### 1. Local Directory (`SKILLS_DIR`)

Skills are directories containing a `manifest.json` and implementation:

```
skills/
├── my-skill/
│   ├── manifest.json
│   └── graph.js
└── @scope/another-skill/
    ├── manifest.json
    └── graph.js
```

### 2. npm Packages (`CONFIG_PATH`)

Skills installed via `trik install` or the API are tracked in a config file:

```json
{
  "triks": ["@molefas/article-search", "my-other-skill"]
}
```

Set `CONFIG_PATH` to enable npm-based skill loading:

```bash
CONFIG_PATH=./.trikhub/config.json trik-server
```

## See Also

- [@trikhub/manifest](../trik-manifest) - Manifest schema documentation
- [@trikhub/gateway](../trik-gateway) - Core gateway library
- [@trikhub/cli](../trik-cli) - CLI for installing triks

## License

MIT
