# @trikhub/server

HTTP server for TrikHub - remote gateway for AI agent handoff routing.

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

2. Check available endpoints:
   - Health: http://localhost:3000/api/v1/health
   - API Docs: http://localhost:3000/docs
   - Handoff Tools: http://localhost:3000/api/v1/tools
   - Loaded Triks: http://localhost:3000/api/v1/triks

3. Send a message through the gateway:

```bash
curl -X POST http://localhost:3000/api/v1/message \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello", "sessionId": "session-1"}'
```

## Configuration

All configuration is done via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Server host |
| `SKILLS_DIR` | - | Directory containing local triks (optional) |
| `CONFIG_PATH` | - | Path to `.trikhub/config.json` for npm-installed triks |
| `AUTH_TOKEN` | - | Bearer token for authentication (optional) |
| `LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `ALLOWED_SKILLS` | - | Comma-separated allowlist of trik IDs |

## API Endpoints

### Message Routing

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/message` | POST | Route a user message through the handoff gateway |
| `/api/v1/back` | POST | Force transfer-back from current handoff |
| `/api/v1/session` | GET | Get current handoff state |

### Tools & Triks

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/tools` | GET | List handoff tool definitions |
| `/api/v1/triks` | GET | List loaded triks with v2 info |
| `/api/v1/triks/install` | POST | Install a trik package |
| `/api/v1/triks/:name` | DELETE | Uninstall a trik |
| `/api/v1/triks/reload` | POST | Hot-reload all triks |

### System

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/health` | GET | Health check |
| `/docs` | GET | Swagger UI documentation |

### Send a Message

```bash
curl -X POST http://localhost:3000/api/v1/message \
  -H "Content-Type: application/json" \
  -d '{"message": "Search for articles about AI", "sessionId": "s1"}'
```

**Response (no active handoff):**

```json
{
  "target": "main",
  "handoffTools": [
    {
      "name": "talk_to_content-hoarder",
      "description": "Search, create, and manage articles...",
      "inputSchema": { "type": "object", "properties": { "context": { "type": "string" } } }
    }
  ]
}
```

**Response (active handoff):**

```json
{
  "target": "trik",
  "trikId": "content-hoarder",
  "response": {
    "message": "I found 3 articles about AI.",
    "transferBack": false
  },
  "sessionId": "hs-abc123"
}
```

### Force Transfer Back

```bash
curl -X POST http://localhost:3000/api/v1/back \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "s1"}'
```

### Get Session State

```bash
curl http://localhost:3000/api/v1/session
```

```json
{
  "activeHandoff": {
    "trikId": "content-hoarder",
    "sessionId": "hs-abc123",
    "turnCount": 3
  }
}
```

### List Handoff Tools

```bash
curl http://localhost:3000/api/v1/tools
```

```json
{
  "handoffTools": [
    {
      "name": "talk_to_content-hoarder",
      "description": "Search, create, revise, and publish articles...",
      "inputSchema": { ... }
    }
  ]
}
```

### List Loaded Triks

```bash
curl http://localhost:3000/api/v1/triks
```

```json
{
  "triks": [
    {
      "name": "content-hoarder",
      "version": "0.1.0",
      "description": "Article curation and publishing agent",
      "mode": "conversational",
      "domain": ["content curation", "article writing"],
      "tools": ["searchArticles", "createArticle", "reviseArticle"]
    }
  ]
}
```

### Install a Trik

```bash
curl -X POST http://localhost:3000/api/v1/triks/install \
  -H "Content-Type: application/json" \
  -d '{"package": "@molefas/content-hoarder"}'
```

## Docker Usage

### Basic Usage

```bash
docker run -p 3000:3000 -v trik-data:/data trikhub/server
```

### With Authentication

```bash
docker run -p 3000:3000 \
  -v trik-data:/data \
  -e AUTH_TOKEN=your-secret-token \
  trikhub/server
```

### Runtime Trik Installation

```bash
# Via CLI
docker exec trik-server trik install @molefas/content-hoarder

# Via API
curl -X POST http://localhost:3000/api/v1/triks/install \
  -H "Content-Type: application/json" \
  -d '{"package": "@molefas/content-hoarder"}'
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

## Trik Loading

The server loads triks from two sources:

### 1. Local Directory (`SKILLS_DIR`)

Triks are directories containing a `manifest.json` and implementation:

```
skills/
├── my-trik/
│   ├── manifest.json
│   └── dist/agent.js
└── @scope/another-trik/
    ├── manifest.json
    └── dist/agent.js
```

### 2. npm Packages (`CONFIG_PATH`)

Triks installed via `trik install` or the API are tracked in a config file:

```json
{
  "triks": ["@molefas/content-hoarder", "@acme/web-scraper"]
}
```

Set `CONFIG_PATH` to enable npm-based trik loading:

```bash
CONFIG_PATH=./.trikhub/config.json trik-server
```

## See Also

- [@trikhub/gateway](../gateway) - Core gateway library with handoff routing
- [@trikhub/manifest](../manifest) - Manifest types and validation
- [@trikhub/cli](../cli) - CLI for installing and managing triks
- [@trikhub/sdk](../sdk) - SDK for building triks

## License

MIT
