# TrikHub Local Playground
This demo shows how to enhance an existing LangGraph agent with TrikHub support using the v2 `enhance()` API. The agent gains the ability to hand off conversations to specialist trik agents (conversational mode) and use trik-provided tools directly (tool mode).

## What You'll Learn
- How to enhance an agent with TrikHub support using `enhance()`
- How the handoff routing model works (`talk_to_X` tools, `transfer_back`)
- How tool-mode triks expose native tools to the main agent
- How to use `/back` to force a transfer-back from any trik handoff

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Node.js Process                      │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────┐  │
│  │   CLI (You)  │◄──►│  Enhanced    │◄──►│  Gateway  │  │
│  │              │    │    Agent     │    │  (triks)  │  │
│  └──────────────┘    └──────────────┘    └───────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Why in-process?** Fastest option for Node.js/TypeScript agents. No network latency, no separate server to manage.

## Prerequisites

- Node.js 22.5+
- pnpm (or npm)
- OpenAI / Anthropic / Google API key

## Quick Start

**1. Clone and build**

```bash
git clone https://github.com/molefas/trikhub.git
cd trikhub
pnpm install
pnpm build
```

**2. Set up the playground**

```bash
cd examples/js/local-playground
npm install

# Provide an LLM key to the main agent
cp .env.example .env
# Edit .env and add your API key

# Provide an LLM key for trik agents
cp .trikhub/secrets.json.example .trikhub/secrets.json
# Edit secrets.json with the trik's API key
```

**3. Run the agent**

```bash
pnpm dev
```

You should see:

```
LangGraph Agent CLI with TrikHub Handoff Support
Loading...

LLM: openai (gpt-4o-mini)
Built-in tools: get_weather, calculate, search_web
Handoff triks: talk_to_content_hoarder
Tool-mode triks: searchArticles
Type "/back" to return from a trik handoff, "exit" to quit.

You:
```

## Try It Out
### Built-in Tools

```
You: Can you tell me the weather in Lisbon, Portugal?
Agent: The weather in Lisbon is currently rainy with a temperature of 30C (86 F). It's quite warm despite the rain!
```

### Handoff to a Trik

```
You: I want to create an article about AI trends

[Handoff to content-hoarder]

Content-Hoarder: I'll help you create an article about AI trends...

You: /back

[Transferred back to main agent]
```

### Install new Triks
You can search and install existing Triks to test.
```bash
# This will help you find triks by keywords
trik search {keyword}

# Install these
trik install @[org]/[trik-name]

# Restart the CLI
pnpm run dev
```

I've shipped a few basic Triks for this example:
```bash
# A Python Trik to test cross-env execution
@molefas/trik-article-search-py

# A basic Trik to test persistent storage through SQLite
@molefas/trik-demo-notes
```

You can find more details on how to interact with each Trik in their documentations.
Find more about these on [Trikhub.com](https://trikhub.com).

## Trik Modes

TrikHub v2 supports two modes for triks:

### Conversational Mode (Handoff)

Conversational triks are full agents that take over the conversation. The gateway generates a `talk_to_<trik-name>` tool for each one.

- **talk_to_X**: The main agent calls this tool to hand off to a specialist trik agent
- **transfer_back**: The trik agent calls this when it has finished, returning control to the main agent
- **/back command**: Type `/back` in the CLI to force a transfer-back if the trik doesn't return on its own
- **Session state**: Triks remember context within a session

### Tool Mode (Exposed Tools)

Tool-mode triks export individual tools that appear as native tools on the main agent. No handoff occurs — the main agent calls the tool directly and receives a structured response. The trik's `outputTemplate` controls what the main agent sees.

## Project Structure

```
local-playground/
├── src/
│   ├── cli.ts          # Interactive REPL
│   ├── agent.ts        # LangGraph workflow with enhance()
│   ├── tools.ts        # Built-in demo tools (weather, calc, search)
│   └── llm.ts          # Multi-provider LLM selection
├── .trikhub/
│   ├── config.json     # Installed triks (created by `trik install`)
│   └── secrets.json    # Per-trik API keys and secrets
├── .env.example        # Environment template
└── package.json
```

## Troubleshooting

**"Cannot find module '@trikhub/gateway'"**

> Run `pnpm build` from the monorepo root first

**"OPENAI_API_KEY is not set"**

> Copy `.env.example` to `.env` and add your key

**Trik not loading**

> Check `.trikhub/config.json` has the trik listed
> If you're running Python Triks you need to have an available Python environment regardless (see below)

## Using Python Triks

The JavaScript gateway can execute Python triks through a worker subprocess. This allows you to use triks written in either language from a single agent.

### Local Python Trik Example

This playground includes a local Python trik at `.trikhub/triks/python-text-utils/` that demonstrates cross-language execution. It provides two tool-mode tools:

- **wordCount**: Count words, characters, and lines in text
- **slugify**: Convert text to a URL-friendly slug

The trik uses the v2 Python SDK (`wrap_tool_handlers`) and is loaded automatically by the gateway when listed in `.trikhub/config.json`. Try it:

```
You: Count the words in "Hello world, this is a test"
Assistant: Text stats: 6 words, 27 characters, 1 lines
```

### Installing a Python Trik from Registry

1. Ensure Python 3.10+ is installed
2. Install the Python trik using the CLI:

   ```bash
   trik install @molefas/trik-article-search-py
   ```

   Or manually add it to your `package.json` and `.trikhub/config.json`:

   **package.json:**

   ```json
   {
     "dependencies": {
       "@molefas/trik-article-search": "github:Molefas/trik-article-search#v1.0.1",
       "@molefas/trik-article-search-py": "github:Molefas/trik-article-search-py#v1.0.0"
     }
   }
   ```

   **.trikhub/config.json:**

   ```json
   {
     "triks": [
       "@molefas/trik-article-search",
       "@molefas/trik-article-search-py"
     ]
   }
   ```

3. Run `npm install` or `pnpm install` to fetch the packages
4. The gateway automatically detects Python triks by their `runtime: "python"` manifest entry and uses the Python worker

### Python Worker

When the gateway loads a Python trik, it:

1. Spawns a Python subprocess with the TrikHub Python runtime
2. Communicates via JSON-RPC over stdin/stdout
3. Manages the subprocess lifecycle automatically

This means you can mix JavaScript and Python triks in the same agent seamlessly.

## Next Steps
- [Check our docs](https://trikhub.com/docs)
- [Try the Python local playground](../python/local-playground) - Same concepts in Python
