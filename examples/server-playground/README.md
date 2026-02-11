# TrikHub Server Playground

Run a **Python AI agent** that connects to TrikHub triks via **HTTP API**.

## What You'll Learn

- How to run `trik-server` as a standalone HTTP gateway
- How to connect any language (Python, Go, etc.) to TrikHub
- How template responses keep agents safe from prompt injection
- How passthrough content is delivered directly to users

## Architecture

```
┌─────────────────────┐         HTTP          ┌─────────────────────┐
│   Python Agent      │ ◄──────────────────►  │   trik-server        │
│   (LangGraph)       │       localhost:3002  │   (Node.js)         │
│                     │                       │                     │
│  • Built-in tools   │                       │  • article-search   │
│  • Refund workflow  │                       │    (trik)           │
└─────────────────────┘                       └─────────────────────┘
```

**Why HTTP?** Works with any language. Python, Go, Rust - anything that can make HTTP requests can use TrikHub triks.

## Prerequisites

- Node.js 18+ and pnpm
- Python 3.10+
- OpenAI API key

## Quick Start

### Terminal 1: Start the Server

From the monorepo root:

```bash
pnpm install
pnpm build
```

Start trik-server:

```bash
cd examples/server-playground/server
./start.sh
```

You should see:

```
{"level":30,"msg":"Server listening at http://0.0.0.0:3002"}
```

Verify it's running:

```bash
curl http://localhost:3002/api/v1/health
# {"status":"ok","uptime":5.123}
```

### Terminal 2: Run the Python Agent

```bash
cd examples/server-playground/agent
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

# Create virtual environment (recommended)
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the agent
python cli.py
```

You should see:

```
TrikHub Server Playground
Connected to gateway at http://localhost:3002
Type your message (or 'quit' to exit)
────────────────────────────────────

You:
```

## Try It Out

### Article Search (uses the trik)

```
You: search for articles about AI
Agent: I found 3 articles about AI.

You: list them
--- Direct Content (article-list) ---
1. **The Future of AI in Healthcare** - AI is transforming...
2. **Understanding Machine Learning** - A beginner's guide...
3. **AI Ethics and Society** - Exploring the implications...
--- End ---

You: show me the healthcare one
--- Direct Content (article) ---
# The Future of AI in Healthcare
AI is revolutionizing medical diagnosis and treatment planning...
--- End ---
```

### Built-in Tools

```
You: I want a refund for order 123
Agent: I'll need a bit more detail. What's the reason for your refund request?

You: the product arrived damaged
Agent: Refund approved for order 123. Reason: product arrived damaged.
```

## How It Works

### Template Mode (Safe for Agent)

```
Agent calls:    POST /api/v1/execute {"tool": "article-search:search", "input": {"topic": "AI"}}
Server returns: {"responseMode": "template", "agentData": {"template": "success", "count": 3}}
Agent sees:     "I found 3 articles about AI."
```

### Passthrough Mode (Direct to User)

```
Agent calls:    POST /api/v1/execute {"tool": "article-search:details", ...}
Server returns: {"responseMode": "passthrough", "ref": "abc123"}
Agent fetches:  GET /api/v1/content/abc123
You see:        The full article content
```

The Python client handles this automatically - passthrough content is stored and displayed directly.

## Project Structure

```
server-playground/
├── server/
│   ├── start.sh              # Starts trik-server on port 3002
│   └── skills/
│       └── article-search/   # Pre-built trik
│           ├── manifest.json
│           └── graph.js
├── agent/
│   ├── cli.py                # Interactive REPL
│   ├── agent.py              # LangGraph workflow
│   ├── tools.py              # Built-in tools + HTTP tool loader
│   ├── trik_client.py        # HTTP client for trik-server
│   └── requirements.txt
```

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/health` | GET | Health check |
| `/api/v1/tools` | GET | List available tools |
| `/api/v1/execute` | POST | Execute a trik action |
| `/api/v1/content/:ref` | GET | Retrieve passthrough content |
| `/docs` | GET | Swagger UI documentation |

## Troubleshooting

**"Connection refused" on localhost:3002**

→ Make sure the server is running in Terminal 1

**"ModuleNotFoundError: No module named 'langchain'"**

→ Activate your venv and run `pip install -r requirements.txt`

**"OPENAI_API_KEY is not set"**

→ Create `.env` file in the `agent/` directory with your key

**Server shows "No skills loaded"**

→ Check that `server/skills/article-search/` exists with manifest.json

## Next Steps

- [Build your own trik](../../README.md#building-a-trik)
- [Try the local playground](../local-playground) - Same concepts, pure TypeScript
- [Run trik-server in Docker](../../packages/trik-server/README.md#docker-usage)
