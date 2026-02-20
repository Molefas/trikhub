# TrikHub Server Playground

Run a **Python AI agent** that connects to TrikHub triks via **HTTP API**.

## What You'll Learn

- How to run `trik-server` as a standalone HTTP gateway
- How to install triks via npm packages or local directories
- How to connect any language (Python, Go, etc.) to TrikHub
- How template responses keep agents safe from prompt injection
- How passthrough content is delivered directly to users

## Architecture

```
┌─────────────────────┐         HTTP          ┌─────────────────────┐
│   Python Agent      │ ◄──────────────────►  │   trik-server       │
│   (LangGraph)       │       localhost:3000  │   (Node.js)         │
│                     │                       │                     │
│  • Built-in tools   │                       │  • Loads triks from │
│  • Multi-provider   │                       │    npm packages or  │
│    LLM support      │                       │    local directory  │
└─────────────────────┘                       └─────────────────────┘
```

**Why HTTP?** Works with any language. Python, Go, Rust - anything that can make HTTP requests can use TrikHub triks.

## Prerequisites

- Node.js 18+ and pnpm
- Python 3.10+
- API key for at least one LLM provider (OpenAI, Anthropic, or Google)

## Quick Start

There are two ways to set up the server:

- **Option A**: Use the pre-built local trik (quickest for demo)
- **Option B**: Install triks via npm (production-like workflow)

---

### Option A: Local Skills Directory

This uses a pre-built trik from the `server/skills/` directory.

#### Terminal 1: Start the Server

From the monorepo root:

```bash
pnpm install
pnpm build
```

Start trik-server:

```bash
cd examples/server-playground/server
npm @trikhub/server start
```

You should see:

```
{"level":30,"msg":"Server listening at http://0.0.0.0:3000"}
{"level":30,"skillId":"trik-article-search","msg":"Skill loaded"}
```

#### Configure Trik Secrets

If the trik needs API keys (e.g., for LLM calls within the trik):

```bash
cd examples/server-playground/server/.trikhub
cp secrets.json.example secrets.json
# Edit secrets.json with your API keys
```

**Note:** These secrets are for the **triks themselves**, not for your agent's LLM. Agent LLM keys go in `agent/.env`.

---

### Option B: npm-Installed Triks

This demonstrates the production workflow where triks are installed as npm packages.

#### Step 1: Create a Server Directory

```bash
mkdir my-trik-server
cd my-trik-server
npm init -y
```

#### Step 2: Install Triks

```bash
# Install the trik CLI globally (if not already)
npm install -g @trikhub/cli

# Install a trik
trik install @molefas/trik-article-search
```

This:
- Adds the trik to `package.json`
- Downloads it to `node_modules/`
- Registers it in `.trikhub/config.json`

#### Step 3: Configure Secrets

```bash
# Create secrets file
cat > .trikhub/secrets.json << 'EOF'
{
  "trik-article-search": {
    "ANTHROPIC_API_KEY": "your-key-here"
  }
}
EOF
```

#### Step 4: Start the Server

```bash
# From your server directory
npx @trikhub/server
```

Or with explicit config path:

```bash
CONFIG_PATH=.trikhub/config.json npx @trikhub/server
```

The server will:
- Auto-detect `.trikhub/config.json` in the current directory
- Load secrets from `.trikhub/secrets.json` (same directory as config)
- Load all registered triks from `node_modules/`

---

### Terminal 2: Run the Python Agent

```bash
cd examples/server-playground/agent
cp .env.example .env
# Edit .env and uncomment ONE provider with your API key

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
LangGraph Agent CLI with TrikHub Support
Loading...

[Triks] Loaded: trik-article-search
LLM: anthropic (claude-sonnet-4-20250514)
Built-in tools: get_weather, calculate, search_web
Triks: trik-article-search
Total tools: 6
Type "/tools" to list all, "exit" to quit.

You:
```

## LLM Provider Selection

The agent supports multiple LLM providers. It auto-detects which to use based on available API keys.

| Priority | Provider  | Default Model            | API Key Env Var     |
|----------|-----------|--------------------------|---------------------|
| 1        | Anthropic | claude-sonnet-4-20250514 | ANTHROPIC_API_KEY   |
| 2        | Google    | gemini-1.5-flash         | GOOGLE_API_KEY      |
| 3        | OpenAI    | gpt-4o-mini              | OPENAI_API_KEY      |

### Override Detection

```bash
# Force a specific provider
LLM_PROVIDER=anthropic python cli.py

# Use a specific model
LLM_MODEL=gpt-4-turbo python cli.py
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
You: What's the weather in Lisbon?
Agent: The weather in Lisbon is sunny, 25°C.

You: Calculate 15 * 7 + 23
Agent: The result is 128.
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

## Server Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Server host |
| `CONFIG_PATH` | `.trikhub/config.json` (if exists) | Path to trik config file |
| `SKILLS_DIR` | (none) | Directory with local skill folders |
| `AUTH_TOKEN` | (none) | Bearer token for API authentication |
| `LOG_LEVEL` | `info` | Logging level (debug, info, warn, error) |

**Note:** `SKILLS_DIR` is optional when using `CONFIG_PATH`. You can use either or both.

## Two-Tier Secrets Architecture

TrikHub has two separate secret configurations:

### 1. Agent LLM Keys (`agent/.env`)

These are for **your agent's LLM** - the AI that decides which tools to call:

```bash
# agent/.env
ANTHROPIC_API_KEY=sk-ant-...  # For agent reasoning
```

### 2. Trik Secrets (`.trikhub/secrets.json`)

These are for **the triks themselves** - injected when a trik executes:

```json
{
  "trik-article-search": {
    "ANTHROPIC_API_KEY": "sk-ant-...",
    "OPENAI_API_KEY": "sk-..."
  }
}
```

**Why separate?** Your agent might use GPT-4 for reasoning, while a trik might need Claude for content generation. They're independent.

## Project Structure

### Option A: Local Skills

```
server-playground/
├── server/
│   ├── start.sh              # Starts trik-server
│   ├── .trikhub/
│   │   ├── secrets.json      # Secrets for triks
│   │   └── secrets.json.example
│   └── skills/
│       └── article-search/   # Pre-built local trik
│           ├── manifest.json
│           └── graph.js
├── agent/
│   ├── cli.py                # Interactive REPL
│   ├── agent.py              # LangGraph workflow
│   ├── llm.py                # Multi-provider LLM support
│   ├── tools.py              # Built-in tools + HTTP tool loader
│   ├── trik_client.py        # HTTP client for trik-server
│   ├── .env                  # Agent LLM API keys
│   └── requirements.txt
```

### Option B: npm-Installed Triks

```
my-trik-server/
├── package.json              # Triks as dependencies
├── node_modules/
│   └── @molefas/
│       └── trik-article-search/
│           ├── manifest.json
│           └── graph.js
└── .trikhub/
    ├── config.json           # Lists installed triks
    └── secrets.json          # Trik API keys
```

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/health` | GET | Health check |
| `/api/v1/tools` | GET | List available tools |
| `/api/v1/triks` | GET | List installed triks |
| `/api/v1/triks/install` | POST | Install a trik package |
| `/api/v1/triks/:name` | DELETE | Uninstall a trik |
| `/api/v1/triks/reload` | POST | Hot-reload all triks |
| `/api/v1/execute` | POST | Execute a trik action |
| `/api/v1/content/:ref` | GET | Retrieve passthrough content |
| `/docs` | GET | Swagger UI documentation |

## Troubleshooting

**"Connection refused" on localhost:3000**

→ Make sure the server is running in Terminal 1

**"ModuleNotFoundError: No module named 'langchain'"**

→ Activate your venv and run `pip install -r requirements.txt`

**"ANTHROPIC_API_KEY is not set" (or other API key error)**

→ Create `.env` file in the `agent/` directory with your key
→ Or set `LLM_PROVIDER` to use a different provider

**"No skills loaded" or empty tools list**

→ For local skills: Check that `server/skills/article-search/` exists with manifest.json
→ For npm triks: Check that `.trikhub/config.json` lists your triks and they're installed in node_modules

**"[Skill] No API key found"**

→ Create `.trikhub/secrets.json` with the API keys for your triks
→ Make sure the trik ID in secrets.json matches the manifest ID (e.g., `trik-article-search`)

## Next Steps

- [Build your own trik](../../README.md#building-a-trik)
- [Try the local playground](../local-playground) - Same concepts, pure TypeScript
- [Run trik-server in Docker](../../packages/trik-server/README.md#docker-usage)
