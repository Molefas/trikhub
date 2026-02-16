# Python Local Playground

A real-world example of integrating TrikHub with a LangGraph-based AI agent in Python.

This example mirrors the [JS Local Playground](../../js/local-playground/) but uses Python and LangGraph instead of TypeScript and LangChain.

## What You'll Learn

1. **LangGraph Agent Architecture** - How to build a reactive agent with tool calling
2. **TrikHub Integration** - Loading and executing triks from a LangGraph agent
3. **Multi-Provider LLM** - Auto-detecting and using Anthropic, OpenAI, or Google
4. **Passthrough Content** - Handling direct-to-user content from triks
5. **Session Management** - Multi-turn conversations with trik state

## Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                         CLI Interface                            │
│                          (cli.py)                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      LangGraph Agent                             │
│                        (agent.py)                                │
│  ┌─────────────┐     ┌──────────────┐     ┌─────────────────┐  │
│  │   Agent     │────▶│  Should      │────▶│    ToolNode     │  │
│  │   Node      │     │  Continue?   │     │                 │  │
│  └─────────────┘     └──────────────┘     └─────────────────┘  │
│         │                                          │            │
│         └──────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Tools Layer                              │
│                        (tools.py)                                │
│  ┌─────────────────┐          ┌────────────────────────────┐   │
│  │  Built-in Tools │          │      TrikHub Tools         │   │
│  │  - get_weather  │          │  (via LangChain Adapter)   │   │
│  │  - calculate    │          │  - article_search:search   │   │
│  │  - search_web   │          │  - article_search:details  │   │
│  └─────────────────┘          │  - article_search:list     │   │
│                               └────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      TrikHub Gateway                             │
│             (packages/python/trikhub/gateway)                    │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                     Python Triks                            │ │
│  │              (native Python execution)                      │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Prerequisites

- Python 3.10+
- At least one LLM API key (Anthropic, OpenAI, or Google)

## Quick Start

### 1. Install Dependencies

```bash
cd examples/python/local-playground

# Create and activate virtual environment (recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install TrikHub SDK from local packages
pip install -e ../../../packages/python

# Install example dependencies
pip install -r requirements.txt
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env and add your API key
```

### 3. Run the Agent

```bash
python cli.py
```

## Example Conversation

```text
You: search for articles about AI
Assistant: I found 2 articles about AI. Would you like me to list them?

You: list them
--- Direct Content (article-list) ---
1. **The Rise of Artificial Intelligence**
   AI is transforming industries from healthcare to finance...

2. **Machine Learning in Practice**
   Practical applications of ML are everywhere...
--- End ---

You: show me the first one
--- Direct Content (article) ---
# The Rise of Artificial Intelligence

AI is transforming industries from healthcare to finance...

[Full article content displayed directly to user]
--- End ---
```

## Project Structure

```text
examples/python/local-playground/
├── cli.py              # REPL interface (entry point)
├── agent.py            # LangGraph StateGraph setup
├── tools.py            # Built-in tools + trik loading
├── llm_factory.py      # Multi-provider LLM factory
├── requirements.txt    # Python dependencies
├── .env.example        # Environment template
├── .trikhub/
│   └── config.json     # Trik configuration
└── README.md           # This file
```

## Key Concepts

### Passthrough Content

When a trik returns `responseMode: "passthrough"`, the content bypasses the agent and goes directly to the user. This is useful for:

- Large content (articles, documents)
- Sensitive data that shouldn't be processed by the LLM
- Rich content formats (markdown, HTML)

### Template Responses

When a trik returns `responseMode: "template"`, the agent receives structured data it can use to formulate a response. This is useful for:

- Search results (IDs only, not full content)
- Status information
- Metadata the agent can act on

### Session Management

Triks can maintain state across multiple calls using sessions. The LangChain adapter handles this automatically, storing session IDs per trik.

## Troubleshooting

### "No API key found"

Make sure you have set at least one API key in your `.env` file:

```bash
ANTHROPIC_API_KEY=sk-ant-...
# or
OPENAI_API_KEY=sk-...
# or
GOOGLE_API_KEY=...
```

### "No triks loaded"

Check that:

1. The `.trikhub/config.json` file exists and has valid trik paths
2. The trik paths point to valid trik directories with `manifest.json`

### Import errors

Make sure you've installed the TrikHub SDK:

```bash
pip install -e ../../../packages/python
```

## Using JavaScript Triks

The Python gateway can execute JavaScript triks through a Node.js worker subprocess. This allows you to use triks written in either language from a single agent.

### Adding a JavaScript Trik

1. Ensure Node.js 18+ is installed
1. Add the JS trik to your `.trikhub/config.json`:

```json
{
  "triks": [
    {
      "id": "@molefas/article-search-py",
      "path": "/Users/ruimolefas/Code/trikhub-skills/article-search-py"
    },
    {
      "id": "@molefas/article-search",
      "path": "/Users/ruimolefas/Code/trikhub-skills/article-search"
    }
  ]
}
```

1. The gateway automatically detects JS triks by their `runtime: "node"` manifest entry and uses the Node.js worker

### Node.js Worker

When the gateway loads a JavaScript trik, it:

1. Spawns a Node.js subprocess with the TrikHub worker (`@trikhub/worker-js`)
1. Communicates via JSON-RPC over stdin/stdout
1. Manages the subprocess lifecycle automatically

This means you can mix Python and JavaScript triks in the same agent seamlessly.

## Related Examples

- [JS Local Playground](../../js/local-playground/) - Same example in TypeScript
- [Python Playground](../playground/) - Low-level gateway test harness
