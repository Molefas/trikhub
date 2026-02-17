# TrikHub Complete Playground

Explore **storage** and **configuration** capabilities with a working demo trik.

## What You'll Learn

- How triks use **persistent storage** to save data across sessions
- How triks access **configuration values** (API keys, settings)
- How to visualize storage usage and config status via CLI commands
- The complete trik development workflow (manifest → implement → test)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Node.js Process                            │
│  ┌──────────┐   ┌───────────┐   ┌────────────┐   ┌───────────┐  │
│  │ CLI (You)│◄─►│ LangGraph │◄─►│  Gateway   │◄─►│   Trik    │  │
│  │          │   │   Agent   │   │            │   │           │  │
│  └──────────┘   └───────────┘   └─────┬──────┘   └───────────┘  │
│                                       │                         │
│                          ┌────────────┴────────────┐            │
│                          ▼                         ▼            │
│                   ┌────────────┐           ┌────────────┐       │
│                   │  Storage   │           │   Config   │       │
│                   │ (JSON file)│           │ (secrets)  │       │
│                   └────────────┘           └────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

The gateway injects both **storage** and **config** contexts into the trik, allowing secure, sandboxed access to persistent data and user-provided credentials.

## Prerequisites

- Node.js 18+
- pnpm (or npm)
- OpenAI API key

## Quick Start

**1. Build the monorepo**

From the monorepo root:

```bash
pnpm install
pnpm build
```

**2. Install dependencies and set up symlinks**

```bash
cd examples/local-complete-playground

# Install npm dependencies
npm install

# Create symlinks for @trikhub packages
mkdir -p node_modules/@trikhub node_modules/@demo
ln -sf "$(cd ../../packages/trik-manifest && pwd)" node_modules/@trikhub/manifest
ln -sf "$(cd ../../packages/trik-gateway && pwd)" node_modules/@trikhub/gateway
ln -sf "$(pwd)/triks/demo-notes" node_modules/@demo/notes

# Symlink manifest types for the demo trik
mkdir -p triks/demo-notes/node_modules/@trikhub
ln -sf "$(cd ../../packages/trik-manifest && pwd)" triks/demo-notes/node_modules/@trikhub/manifest
```

**3. Build the demo trik**

```bash
cd triks/demo-notes
npx tsc
cd ../..
```

**4. Set up your API key**

```bash
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY
```

**5. Run the agent**

```bash
npx tsx src/cli.ts
# or
npm run dev
```

You should see:

```
LangGraph Agent CLI with TrikHub Support
Loading triks...

[Triks] Loaded 1 triks: @demo/notes
[Config] @demo/notes: API_KEY ✓

Built-in tools: request_refund, find_order, get_project_details
Loaded triks: @demo/notes
Total tools available: 8

Type "/tools" to list tools, "/storage" for storage info, "/config" for config status.
Type "exit" or "quit" to end.

You:
```

## Try It Out

### Storage Demo

**Add notes to persistent storage:**

```
You: add a note titled "Meeting Notes" with content "Discussed Q4 roadmap and budget allocation"
Agent: Added note "Meeting Notes" with ID note_m5k2x

You: add another note called "Shopping List" with content "Milk, eggs, bread, coffee"
Agent: Added note "Shopping List" with ID note_m5k3y
```

**List stored notes:**

```
You: list my notes
Agent: Found 2 note(s)
```

**View a specific note (passthrough mode):**

```
You: show me the meeting notes
--- Direct Content (note) ---
# Meeting Notes

Discussed Q4 roadmap and budget allocation

---
Created: 2024-01-15T10:30:00.000Z
ID: note_m5k2x
--- End ---
```

**Check storage usage:**

```
You: /storage

Storage Usage:

  @demo/notes
    [████████████░░░░░░░░] 256.00 B (0.0%)
    Path: ~/.trikhub/storage/@demo/notes
```

**Delete a note:**

```
You: delete the shopping list
Agent: Deleted note "Shopping List" (note_m5k3y)
```

**Persistence test:**

```
You: quit

# Restart the CLI
pnpm dev

You: list my notes
Agent: Found 1 note(s)   # Meeting Notes persisted!
```

### Configuration Demo

**Check what's configured:**

```
You: show my configuration
Agent: Configuration: API_KEY=true, WEBHOOK_URL=false
```

**Use the /config command:**

```
You: /config

Configuration Status:

  @demo/notes
    API_KEY: ✓ configured
    WEBHOOK_URL: ✗ not set (optional)

Secrets files:
  Local: /path/to/project/.trikhub/secrets.json
```

**Test missing config:**

Edit `.trikhub/secrets.json` and remove the API_KEY:

```json
{
  "@demo/notes": {}
}
```

Restart and check:

```
You: /config

Configuration Status:

  @demo/notes
    API_KEY: ✗ MISSING (required)
    WEBHOOK_URL: ✗ not set (optional)
```

The trik will still run (for demo purposes), but real triks can use `config.has('API_KEY')` to require configuration.

## CLI Commands

| Command | Description |
|---------|-------------|
| `/tools` | List all available tools |
| `/storage` | Show storage usage for all triks |
| `/config` | Show configuration status for all triks |
| `/clear @demo/notes` | Clear all storage for a trik |
| `exit` or `quit` | Exit the CLI |

## How It Works

### Storage Interface

Triks receive a `storage` context with these methods:

```typescript
// In trik code
async function addNote(input, storage) {
  const noteId = generateId();

  // Store data - persists to ~/.trikhub/storage/@demo/notes/data.json
  await storage.set(`notes:${noteId}`, {
    id: noteId,
    title: input.title,
    content: input.content,
    createdAt: new Date().toISOString(),
  });

  // Can also: get, delete, list, getMany, setMany
}
```

**Key features:**
- **Namespace isolation**: Each trik can only access its own storage
- **Quota enforcement**: Default 100MB limit per trik
- **TTL support**: `storage.set(key, value, ttlMs)` for auto-expiring data
- **Persistence**: Data survives process restarts

### Configuration Interface

Triks receive a `config` context with these methods:

```typescript
// In trik code
function showConfig(config) {
  const apiKey = config.get('API_KEY');      // Returns value or undefined
  const hasKey = config.has('API_KEY');      // Returns boolean
  const keys = config.keys();                 // Returns ['API_KEY', ...]

  // Use the API key...
  if (apiKey) {
    // Make authenticated request
  }
}
```

**Key features:**
- **Scoped access**: Triks only see their own config values
- **Manifest validation**: Gateway can warn about missing required config
- **Local/global override**: Project `.trikhub/secrets.json` overrides `~/.trikhub/secrets.json`

### Template vs Passthrough

This example demonstrates both response modes:

- **`add_note`**: Returns structured data → Agent says "Added note X with ID Y"
- **`get_note`**: Returns full content → Bypasses agent, shown directly to you

## Project Structure

```
local-complete-playground/
├── src/
│   ├── cli.ts              # Interactive REPL with /storage, /config commands
│   ├── agent.ts            # LangGraph workflow
│   └── tools.ts            # Built-in tools + trik loader
├── triks/
│   └── demo-notes/         # Local demo trik
│       ├── src/index.ts    # Trik implementation
│       ├── manifest.json   # Declares storage + config capabilities
│       └── package.json
├── .trikhub/
│   ├── config.json         # Points to local trik
│   └── secrets.json        # Demo API key
├── .env.example            # Environment template
└── package.json
```

## Troubleshooting

**"Cannot find module '@trikhub/gateway'"**

→ Run `pnpm build` from the monorepo root first

**"Cannot find module '../triks/demo-notes/dist/index.js'"**

→ Run `pnpm build` in the `triks/demo-notes` directory

**"OPENAI_API_KEY is not set"**

→ Copy `.env.example` to `.env` and add your key

**Storage not persisting**

→ Check `~/.trikhub/storage/@demo/notes/data.json` exists and has write permissions

**Config not loading**

→ Ensure `.trikhub/secrets.json` has valid JSON with the trik ID as key:
```json
{
  "@demo/notes": {
    "API_KEY": "your-value"
  }
}
```

## Next Steps

- Modify the demo trik to add new actions
- Add TTL (time-to-live) to stored notes
- Try the [local-playground](../local-playground) example for session state
- [Build your own trik](../../README.md#building-a-trik) with storage + config
