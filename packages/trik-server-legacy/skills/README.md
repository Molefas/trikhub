# Skills Directory

Place your skills here. Each skill should be in its own subdirectory with a `manifest.json` file.

## Structure

```
skills/
├── my-skill/
│   ├── manifest.json    # Required: skill contract
│   └── graph.ts         # Required: skill implementation
├── another-skill/
│   ├── manifest.json
│   └── graph.ts
└── README.md
```

## Adding a New Skill

1. Create a directory for your skill:
   ```bash
   mkdir skills/my-skill
   ```

2. Create `manifest.json` with your skill definition (see template below)

3. Create `graph.ts` with your skill implementation

4. Validate with the linter:
   ```bash
   pnpm lint:skill ./skills/my-skill
   ```

5. Restart the server - it will auto-discover and load the skill

## Manifest Template

```json
{
  "id": "my-skill",
  "name": "My Skill",
  "version": "1.0.0",
  "description": "What this skill does",
  "entry": {
    "module": "graph.js",
    "export": "graph"
  },
  "capabilities": {
    "tools": [],
    "session": {
      "enabled": false
    }
  },
  "limits": {
    "maxExecutionTimeMs": 30000
  },
  "actions": {
    "myAction": {
      "description": "What this action does",
      "responseMode": "template",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": { "type": "string" }
        },
        "required": ["query"]
      },
      "agentDataSchema": {
        "type": "object",
        "properties": {
          "template": { "type": "string", "enum": ["success", "empty", "error"] },
          "count": { "type": "integer" }
        },
        "required": ["template"]
      },
      "responseTemplates": {
        "success": { "text": "Found {{count}} results." },
        "empty": { "text": "No results found." },
        "error": { "text": "An error occurred." }
      }
    }
  }
}
```

## Graph Template

```typescript
// graph.ts
interface SkillInput {
  action: string;
  input: unknown;
  session?: {
    sessionId: string;
    history: Array<{ action: string; input: unknown; agentData?: unknown }>;
  };
}

interface SkillOutput {
  responseMode: 'template' | 'passthrough';
  agentData?: unknown;
  userContent?: {
    contentType: string;
    content: string;
    metadata?: Record<string, unknown>;
  };
}

export const graph = {
  async invoke(input: SkillInput): Promise<SkillOutput> {
    const { action, input: actionInput } = input;

    switch (action) {
      case 'myAction': {
        const { query } = actionInput as { query: string };
        // Your logic here
        return {
          responseMode: 'template',
          agentData: {
            template: 'success',
            count: 42,
          },
        };
      }
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  },
};
```

## Response Modes

### Template Mode
- Agent receives structured `agentData` (enums, numbers, IDs - no free text)
- Gateway fills in template placeholders
- Use for: search results, confirmations, status updates

### Passthrough Mode
- Agent never sees the content
- Content goes directly to user
- Use for: articles, documents, any free-form text

## Security Rules

The linter enforces these rules:

1. **No free strings in agentData** - All strings must have `enum`, `const`, `pattern`, or safe `format`
2. **No forbidden imports** - fs, child_process, net, http, etc. are blocked
3. **No dynamic code** - eval(), Function() are blocked
