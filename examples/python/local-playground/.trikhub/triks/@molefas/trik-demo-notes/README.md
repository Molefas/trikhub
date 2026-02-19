# Demo Notes Trik

A demo trik for testing storage and configuration capabilities. Creates, reads, updates, and deletes notes using TrikHub's persistent storage context.

## Features

This trik demonstrates:

- **Persistent Storage**: Notes are stored in `~/.trikhub/storage/@molefas/trik-demo-notes/`
- **Config Context**: Access to user-provided secrets via `config.get(key)`
- **Template Responses**: Structured data returned to the agent
- **Passthrough Mode**: Full note content delivered directly to users

## Actions

| Action | Description | Response Mode |
|--------|-------------|---------------|
| `add_note` | Add a new note with title and content | template |
| `list_notes` | List all stored notes (returns count and IDs) | template |
| `get_note` | Retrieve a note by ID or search by title | passthrough |
| `delete_note` | Delete a note by ID or title search | template |
| `show_config` | Show current configuration status | template |

## Installation

```bash
# Using the TrikHub CLI
trik install @molefas/trik-demo-notes
```

Or add manually to your `package.json`:

```json
{
  "dependencies": {
    "@molefas/trik-demo-notes": "github:Molefas/trik-demo-notes#v1.0.0"
  }
}
```

And update your `.trikhub/config.json`:

```json
{
  "triks": ["@molefas/trik-demo-notes"]
}
```

## Configuration

Create or update `.trikhub/secrets.json` in your project:

```json
{
  "@molefas/trik-demo-notes": {
    "API_KEY": "any-value-for-testing"
  }
}
```

| Key | Required | Description |
|-----|----------|-------------|
| `API_KEY` | Yes | Demo API key (any value works for testing) |
| `WEBHOOK_URL` | No | Optional webhook URL for notifications |

## Standalone Testing

```bash
# 1. Install dependencies
npm install

# 2. Build the trik
npm run build

# 3. Run the test script
npm run test
```

## Usage Examples

Once installed in an agent, you can interact with it naturally:

```
User: Add a note called "Shopping List" with content "Milk, Eggs, Bread"
Agent: Added note "Shopping List" with ID note_abc123

User: List my notes
Agent: Found 1 note(s)

User: Show me the Shopping List note
[Direct content delivered to user]
# Shopping List

Milk, Eggs, Bread

---
Created: 2024-02-17T10:30:00.000Z
ID: note_abc123

User: Delete the shopping list note
Agent: Deleted note "Shopping List" (note_abc123)
```

## Project Structure

```
trik-demo-notes/
├── src/
│   └── index.ts          # Trik implementation
├── dist/                 # Compiled output (after build)
├── manifest.json         # Actions, schemas, capabilities
├── trikhub.json          # Package metadata for registry
├── package.json
├── tsconfig.json
├── test-trik.ts          # Standalone test script
├── README.md
└── .trikhub/
    └── secrets.json      # Test configuration (gitignored)
```

## Response Modes

- **template**: Used by `add_note`, `list_notes`, `delete_note`, `show_config`. Returns structured data rendered via response templates.
- **passthrough**: Used by `get_note`. Delivers full note content directly to the user, bypassing agent interpretation.

## Storage Details

Notes are persisted to:
```
~/.trikhub/storage/@molefas/trik-demo-notes/data.json
```

Storage features:
- **Quota**: 10MB per trik (configurable in manifest)
- **Persistence**: Data survives process restarts
- **TTL Support**: Optional expiration times on stored values

## License

MIT
