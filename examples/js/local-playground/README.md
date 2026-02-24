# TrikHub Local Playground
This demo shows how to enhance an existing LangGraph agent with TrikHub handoff support using the v2 `enhance()` API. The agent gains the ability to hand off conversations to specialist trik agents and receive control back seamlessly.

## What You'll Learn
- How to enhance an agent with TrikHub handoff support using `enhance()`
- How the handoff routing model works (`talk_to_X` tools, `transfer_back`)
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

- Node.js 18+
- pnpm (or npm)
- OpenAI / Anthropic / Google API key

## Quick Start

**1. Install dependencies**

From the monorepo root:

## Clone the repository

```bash
git clone https://github.com/molefas/trikhub.git
cd trikhub
```

## Setup

```bash
# Install dependencies and build packages
pnpm install
pnpm build

# Navigate to the example
cd examples/js/local-playground

# Install dependencies just for the demo
npm install

# Provide an LLM key to the main Agent
cp .env.example .env
# Edit .env and add your LLM's API KEY
```

```bash
# Provide an LLM key to the Trik Agent
cd .trikhub
cp secrets.json.example secrets.json
# Edit secrets.json with your LLM's API KEY
```

**3. Run the agent**

```bash
pnpm dev
```

You should see:

```
LangGraph Agent CLI with TrikHub Handoff Support

Loaded 1 trik(s).
Type your message, /back to return from handoff, or "exit" to quit.

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

## Handoff Model

The v2 architecture uses a handoff routing model instead of the v1 template/passthrough modes.

### talk_to_X tools

When triks are loaded, the gateway generates a `talk_to_<trik-name>` tool for each trik. The main agent calls these tools to hand off the conversation to a specialist trik agent. For example, installing a content-hoarder trik creates a `talk_to_content_hoarder` tool.

### transfer_back

Each trik agent has a `transfer_back` tool it can call when it has finished its task. This returns control to the main agent with the trik's response.

### /back command

If a trik agent does not transfer back on its own, the user can type `/back` in the CLI to force a transfer-back. This is useful when the trik enters a loop or you simply want to return to the main agent.

### Session State

Triks remember context within a session. When you say "the healthcare one", the trik resolves this reference using the history of your conversation.

## Project Structure

```
local-playground/
├── src/
│   ├── cli.ts          # Interactive REPL
│   ├── agent.ts        # LangGraph workflow with enhance()
│   └── tools.ts        # Built-in tools + trik loader
│   └── llm.ts          # LangGraph model selection based on key provided
├── .trikhub/
│   └── config.json     # Installed triks (once there are Triks installed)
│   └── secrets.json    # Secrets segregation per Trik
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

### Installing a Python Trik

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
     ],
     "trikhub": {
       "@molefas/trik-article-search": "1.0.1",
       "@molefas/trik-article-search-py": "1.0.0"
     }
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
