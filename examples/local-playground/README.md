# TrikHub Local Playground

Run a TypeScript AI agent with TrikHub triks **in a single process** - no server needed.

## What You'll Learn

- How to load triks using `@trikhub/gateway`
- How template responses keep agents safe from prompt injection
- How passthrough content is delivered directly to users
- How session state enables natural language references ("the second one")

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
- OpenAI API key

## Quick Start

**1. Install dependencies**

From the monorepo root:

```bash
pnpm install
pnpm build
```

Then in this example:

```bash
cd examples/local-playground
pnpm install
```

**2. Set up your API key**

```bash
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY
```

**3. Run the agent**

```bash
pnpm dev
```

You should see:

```
TrikHub Local Playground
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

Notice:

- **Search** returns a template ("I found X articles") - safe structured data
- **List/Details** return passthrough content - delivered directly to you, bypassing the agent

### Built-in Tools

```
You: I want a refund for order 123
Agent: I'll need a bit more detail. What's the reason for your refund request?

You: the product arrived damaged
Agent: Refund approved for order 123. Reason: product arrived damaged.
```

The agent validates refund reasons before processing - vague requests like "I just want my money back" are rejected.

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
├── .trikhub/
│   └── config.json     # Installed triks (like package.json for triks)
├── .env.example        # Environment template
└── package.json
```

## Troubleshooting

**"Cannot find module '@trikhub/gateway'"**

→ Run `pnpm build` from the monorepo root first

**"OPENAI_API_KEY is not set"**

→ Copy `.env.example` to `.env` and add your key

**Trik not loading**

→ Check `.trikhub/config.json` has the trik listed

## Next Steps

- [Build your own trik](../../README.md#building-a-trik)
- [Try the server playground](../server-playground) - Same concepts, Python + HTTP
- [Publish a trik](../../README.md#publishing-to-trikhub)
