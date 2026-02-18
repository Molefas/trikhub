# TrikHub Local Playground
This demo is meant to simulate an existing LangGraph Agent ready to consume Triks and the process of finding, installing and running these.

## Disclaimer
There is a significant portion of boilerplate that would ideally not be added to the main Agent, however, I needed to make sure that the basic example is ready to run with one command AND that it supports the main LLMs (OpenAI, Anthropic and Google).

## What You'll Learn
- How to load triks using `@trikhub/gateway` and exposing env variables to them
- How template responses keep agents safe from prompt injection
- How passthrough content is delivered directly to users
- How to expose Environment variables per Trik
- How to interact with persistent storage

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Node.js Process                      │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────┐  │
│  │   CLI (You)  │◄──►│  LangGraph   │◄──►│  Gateway  │  │
│  │              │    │    Agent     │    │  (triks)  │  │
│  └──────────────┘    └──────────────┘    └───────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Why in-process?** Fastest option for Node.js/TypeScript agents. No network latency, no separate server to manage.

## Prerequisites

- Node.js 18+
- pnpm (or npm)
- OpenAI / Anthropic / Googel API key

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
[TrikGateway] No config file found at /../config.json
[Triks] No triks configured
LLM: ... // Your LLM if you've added the details on the .env
Built-in tools: get_weather, calculate, search_web
Total tools: 3
Type "/tools" to list all, "exit" to quit.

You:
```

## Try It Out
### Built-in Tools

```
You: Can you tell me the weather in Lisbon, Portugal?
Agent: The weather in Lisbon is currently rainy with a temperature of 30°C (86 F). It's quite warm despite the rain!

```

### Install new Triks
You can now search and install existing Triks to test. 
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

## How It Works

### Template Mode (Safe for Agent)

```
Trik returns: { template: "success", count: 3 }
Agent sees:   "I found 3 articles about AI."
```

The agent only sees structured data (enums, numbers, IDs) - never free-form text that could contain prompt injection.

### Passthrough Mode (Direct to User)

```
Trik returns: { content: "# Article Title\n\nFull article text..." }
Agent sees:   "[Content delivered directly]"
You see:      The full article
```

Content that might contain untrusted text bypasses the agent entirely.

### Session State

Triks remember context. When you say "the healthcare one", the trik resolves this reference using the history of your conversation.

## Project Structure

```
local-playground/
├── src/
│   ├── cli.ts          # Interactive REPL
│   ├── agent.ts        # LangGraph workflow with validation
│   └── tools.ts        # Built-in tools + trik loader
│   └── llm.ts          # Langgraph Model selection based on key provided
├── .trikhub/
│   └── config.json     # Installed triks (once there are Triks installed)
│   └── secrets.json    # Secrets segregation per Trik
├── .env.example        # Environment template
└── package.json
└── langgraph.json
```

## Troubleshooting

**"Cannot find module '@trikhub/gateway'"**

→ Run `pnpm build` from the monorepo root first

**"OPENAI_API_KEY is not set"**

→ Copy `.env.example` to `.env` and add your key

**Trik not loading**

→ Check `.trikhub/config.json` has the trik listed
→ If you're running Python Triks you need to have an available Python environment regardless (see below)

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
