# TrikHub Local Playground (Python)

This demo is meant to simulate an existing LangGraph Agent ready to consume Triks and the process of finding, installing and running these.

## Disclaimer

There is a significant portion of boilerplate that would ideally not be added to the main Agent, however, I needed to make sure that the basic example is ready to run with one command AND that it supports the main LLMs (OpenAI, Anthropic and Google).

## What You'll Learn

- How to load triks using `trikhub` and exposing env variables to them
- How template responses keep agents safe from prompt injection
- How passthrough content is delivered directly to users
- How to expose Environment variables per Trik
- How to interact with persistent storage

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Python Process                      │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────┐  │
│  │   CLI (You)  │◄──►│  LangGraph   │◄──►│  Gateway  │  │
│  │              │    │    Agent     │    │  (triks)  │  │
│  └──────────────┘    └──────────────┘    └───────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Why in-process?** Fastest option for Python agents. No network latency, no separate server to manage.

## Prerequisites

- Python 3.10+
- pip
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
# Navigate to the example
cd examples/python/local-playground

# Create and activate virtual environment (recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install TrikHub SDK from local packages
pip install -e ../../../packages/python

# Install example dependencies
pip install -r requirements.txt

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
python cli.py
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
python cli.py
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
│   ├── cli.py          # Interactive REPL
│   ├── agent.py        # LangGraph workflow with validation
│   ├── tools.py        # Built-in tools + trik loader
│   └── llm_factory.py  # LangGraph Model selection based on key provided
├── .trikhub/
│   └── config.json     # Installed triks (once there are Triks installed)
│   └── secrets.json    # Secrets segregation per Trik
├── .env.example        # Environment template
├── requirements.txt
└── langgraph.json
```

## Troubleshooting

**"No API key found"**

→ Copy `.env.example` to `.env` and add your key

**Trik not loading**

→ Check `.trikhub/config.json` has the trik listed
→ If you're running JavaScript Triks you need to have Node.js 18+ installed (see below)

**Import errors**

→ Make sure you've installed the TrikHub SDK: `pip install -e ../../../packages/python`

## Using JavaScript Triks

The Python gateway can execute JavaScript triks through a Node.js worker subprocess. This allows you to use triks written in either language from a single agent.

### Installing a JavaScript Trik

1. Ensure Node.js 18+ is installed
2. Install the JS trik using the CLI:

   ```bash
   trik install @molefas/trik-article-search
   ```

   Or manually add it to your `requirements.txt` and `.trikhub/config.json`:

   **requirements.txt:**

   ```
   trik-article-search @ git+https://github.com/Molefas/trik-article-search
   ```

   **.trikhub/config.json:**

   ```json
   {
     "triks": [
       "trik-article-search-py",
       "@molefas/trik-article-search"
     ]
   }
   ```

3. Run `pip install -r requirements.txt` to fetch the packages
4. The gateway automatically detects JavaScript triks by their `runtime: "node"` manifest entry and uses the Node.js worker

### Node.js Worker

When the gateway loads a JavaScript trik, it:

1. Spawns a Node.js subprocess with the TrikHub worker (`@trikhub/worker-js`)
2. Communicates via JSON-RPC over stdin/stdout
3. Manages the subprocess lifecycle automatically

This means you can mix Python and JavaScript triks in the same agent seamlessly.

## Next Steps
- [Check our docs](https://trikhub.com/docs)
- [Try the JS local playground](../../js/local-playground) - Same concepts in JavaScript