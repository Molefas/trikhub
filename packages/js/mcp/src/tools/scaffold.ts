/**
 * Trik Scaffolding Tool
 *
 * Generates complete trik project structure including
 * manifest, code, and configuration files.
 */

import type {
  ScaffoldInput,
  ScaffoldResult,
  GeneratedFile,
  TrikArchitecture,
} from './types.js';

function toPascalCase(str: string): string {
  return str
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function toSnakeCase(str: string): string {
  return str.replace(/-/g, '_');
}

/**
 * Generate manifest.json content
 */
function generateManifest(input: ScaffoldInput): string {
  const manifest: Record<string, unknown> = {
    schemaVersion: 1,
    id: input.name,
    name: input.displayName,
    description: input.description,
    version: '0.1.0',
    actions: {},
    capabilities: {
      tools: [],
    },
    limits: {
      maxExecutionTimeMs: 30000,
    },
    entry: {
      module: input.language === 'ts' ? './dist/index.js' : './graph.py',
      export: 'default',
      runtime: input.language === 'ts' ? 'node' : 'python',
    },
  };

  // Add actions from input
  if (input.actions.length > 0) {
    const actions: Record<string, unknown> = {};
    for (const action of input.actions) {
      const actionDef = action as Record<string, unknown>;
      const actionName = (actionDef.name as string) || 'action';
      // Remove 'name' from the definition as it's the key
      const { name: _name, ...rest } = actionDef;
      actions[actionName] = rest;
    }
    manifest.actions = actions;
  } else {
    // Default action
    manifest.actions = {
      execute: {
        description: 'Main action',
        responseMode: 'template',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Input query' },
          },
          required: ['query'],
        },
        agentDataSchema: {
          type: 'object',
          properties: {
            template: { type: 'string', enum: ['success', 'error'] },
            message: { type: 'string', pattern: '^.{0,500}$' },
          },
          required: ['template', 'message'],
        },
        responseTemplates: {
          success: { text: '{{message}}' },
          error: { text: 'Error: {{message}}' },
        },
      },
    };
  }

  // Add storage capability
  if (input.capabilities.storage) {
    (manifest.capabilities as Record<string, unknown>).storage = {
      enabled: true,
      maxSizeBytes: 1048576,
      persistent: true,
    };
  }

  // Add session capability
  if (input.capabilities.session) {
    (manifest.capabilities as Record<string, unknown>).session = {
      enabled: true,
      maxDurationMs: 3600000,
      maxHistoryEntries: 50,
    };
  }

  // Add config requirements
  if (input.capabilities.config && input.capabilities.config.length > 0) {
    manifest.config = {
      required: input.capabilities.config,
      optional: [],
    };
  }

  return JSON.stringify(manifest, null, 2) + '\n';
}

/**
 * Generate trikhub.json content
 */
function generateTrikhubJson(input: ScaffoldInput): string {
  const trikhub = {
    displayName: input.displayName,
    shortDescription: input.description,
    categories: [input.category],
    keywords: [input.name],
    author: {
      name: 'Author Name',
      github: 'github-username',
    },
    repository: `https://github.com/github-username/${input.name}`,
  };

  return JSON.stringify(trikhub, null, 2) + '\n';
}

/**
 * Generate TypeScript files
 */
function generateTypeScriptFiles(input: ScaffoldInput): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const className = toPascalCase(input.name);

  // package.json
  const packageJson = {
    name: input.name,
    version: '0.1.0',
    description: input.description,
    type: 'module',
    main: 'dist/index.js',
    scripts: {
      build: 'tsc',
      clean: 'rm -rf dist',
      test: 'npm run build && tsx test.ts',
      'test:integration': 'npm run build && tsx test-trik.ts',
    },
    dependencies: {
      '@trikhub/manifest': '^0.11.0',
    },
    devDependencies: {
      '@trikhub/gateway': '^0.11.0',
      '@types/node': '^20.0.0',
      tsx: '^4.0.0',
      typescript: '^5.6.0',
    },
    engines: {
      node: '>=20',
    },
  };

  // Add LangGraph dependencies if needed
  if (input.architecture === 'langgraph') {
    (packageJson.dependencies as Record<string, string>)['@langchain/langgraph'] = '^0.2.0';
    (packageJson.dependencies as Record<string, string>)['@langchain/core'] = '^0.3.0';
  }

  files.push({
    path: 'package.json',
    content: JSON.stringify(packageJson, null, 2) + '\n',
  });

  // tsconfig.json
  files.push({
    path: 'tsconfig.json',
    content: JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        outDir: './dist',
        rootDir: './src',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        declaration: true,
      },
      include: ['src/**/*'],
      exclude: ['node_modules', 'dist'],
    }, null, 2) + '\n',
  });

  // src/index.ts
  const indexContent = input.architecture === 'langgraph'
    ? generateLangGraphIndex(input, className)
    : generateSimpleIndex(input, className);

  files.push({
    path: 'src/index.ts',
    content: indexContent,
  });

  const hasStorage = input.capabilities.storage;
  const hasConfig = input.capabilities.config && input.capabilities.config.length > 0;

  // test.ts (unit tests with mock storage)
  files.push({
    path: 'test.ts',
    content: `/**
 * Unit test script with mock storage
 * Run with: npm test
 */

import trik from './src/index.js';
${hasStorage ? `
// Mock storage implementation (simulates TrikHub gateway storage)
class MockStorage {
  private data = new Map<string, unknown>();

  async get(key: string): Promise<unknown> {
    return this.data.get(key) ?? null;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }

  async list(prefix?: string): Promise<string[]> {
    const keys = Array.from(this.data.keys());
    return prefix ? keys.filter((k) => k.startsWith(prefix)) : keys;
  }

  async getMany(keys: string[]): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};
    for (const key of keys) result[key] = this.data.get(key) ?? null;
    return result;
  }

  async setMany(entries: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(entries)) {
      this.data.set(key, value);
    }
  }
}
` : ''}
async function main() {
  console.log('🧪 Testing ${input.displayName}\\n');
${hasStorage ? '\n  const storage = new MockStorage();\n' : ''}
  // Test: execute action
  console.log('--- Test: execute ---');
  const result = await trik.invoke({
    action: 'execute',
    input: { query: 'test' },${hasStorage ? '\n    storage,' : ''}
  });
  console.log('Result:', JSON.stringify(result, null, 2));

  console.log('\\n✅ Tests complete!');
}

main().catch(console.error);
`,
  });

  // test-trik.ts (integration tests with real gateway)
  files.push({
    path: 'test-trik.ts',
    content: `/**
 * Integration test with TrikHub gateway
 * Run with: npm run test:integration
 */

import { TrikGateway, FileConfigStore, InMemoryStorageProvider } from '@trikhub/gateway';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log('🧪 Integration Testing ${input.displayName}\\n');

  // Config store reads from .trikhub/secrets.json
  const configStore = new FileConfigStore({
    localSecretsPath: join(__dirname, '.trikhub', 'secrets.json'),
  });
  await configStore.load();

  // Use InMemoryStorageProvider for testing
  // Use SqliteStorageProvider for persistent testing
  const storageProvider = new InMemoryStorageProvider();

  const gateway = new TrikGateway({ configStore, storageProvider });

  console.log('Loading trik from:', __dirname);
  await gateway.loadTrik(__dirname);
  console.log('✅ Trik loaded!\\n');

  // Test: execute action
  console.log('--- Test: execute ---');
  const result = await gateway.execute('${input.name}', 'execute', {
    query: 'integration test',
  });
  console.log('Result:', JSON.stringify(result, null, 2));

  // For passthrough mode, deliver content
  if (result.success && result.responseMode === 'passthrough') {
    const content = gateway.deliverContent((result as { userContentRef: string }).userContentRef);
    console.log('\\n--- Content ---');
    console.log(content);
  }

  console.log('\\n✅ Integration tests complete!');
  await gateway.shutdown();
}

main().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
`,
  });

  // .trikhub/secrets.json template
  if (hasConfig) {
    const secretsTemplate: Record<string, string> = {};
    for (const config of input.capabilities.config!) {
      secretsTemplate[config.key] = '';
    }
    files.push({
      path: '.trikhub/secrets.json',
      content: JSON.stringify(secretsTemplate, null, 2) + '\\n',
    });
  }

  // .gitignore
  files.push({
    path: '.gitignore',
    content: `node_modules/
*.log
.DS_Store
.env
.trikhub/
`,
  });

  // README.md
  files.push({
    path: 'README.md',
    content: `# ${input.displayName}

${input.description}

## Development

\`\`\`bash
npm install
npm run build
\`\`\`

## Testing

### Unit Tests (Mock Storage)

\`\`\`bash
npm test
\`\`\`

### Integration Tests (Real Gateway)

\`\`\`bash
npm run test:integration
\`\`\`
${hasConfig ? `
### Configuration

Create \`.trikhub/secrets.json\` with your API keys:

\`\`\`json
{
${input.capabilities.config!.map((c) => `  "${c.key}": "your-key-here"`).join(',\\n')}
}
\`\`\`
` : ''}
## Publishing

\`\`\`bash
trik lint .
trik publish
\`\`\`
`,
  });

  return files;
}

function generateSimpleIndex(input: ScaffoldInput, className: string): string {
  const hasStorage = input.capabilities.storage;
  const hasConfig = input.capabilities.config && input.capabilities.config.length > 0;

  return `/**
 * ${input.displayName}
 * ${input.description}
 */

type InvokeInput = {
  action: string;
  input: Record<string, unknown>;${hasStorage ? '\n  storage?: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void>; };' : ''}${hasConfig ? '\n  config?: { get(key: string): string | undefined; };' : ''}
};

type InvokeResult = {
  responseMode: 'template' | 'passthrough';
  agentData?: Record<string, unknown>;
  userContent?: Record<string, unknown>;
};

class ${className}Graph {
  async invoke(input: InvokeInput): Promise<InvokeResult> {
    const { action, input: actionInput } = input;

    switch (action) {
      case 'execute':
        return this.execute(actionInput);
      default:
        return {
          responseMode: 'template',
          agentData: {
            template: 'error',
            message: \`Unknown action: \${action}\`,
          },
        };
    }
  }

  private async execute(input: Record<string, unknown>): Promise<InvokeResult> {
    const query = input.query as string;

    // TODO: Implement your logic here
    return {
      responseMode: 'template',
      agentData: {
        template: 'success',
        message: \`Processed: \${query}\`,
      },
    };
  }
}

export default new ${className}Graph();
`;
}

function generateLangGraphIndex(input: ScaffoldInput, className: string): string {
  return `/**
 * ${input.displayName}
 * ${input.description}
 *
 * Uses LangGraph for workflow orchestration.
 */

import { StateGraph, START, END, Annotation } from '@langchain/langgraph';

// Define state schema
const StateAnnotation = Annotation.Root({
  action: Annotation<string>,
  input: Annotation<Record<string, unknown>>,
  result: Annotation<Record<string, unknown> | null>,
  error: Annotation<string | null>,
});

type State = typeof StateAnnotation.State;

// Graph nodes
async function processInput(state: State): Promise<Partial<State>> {
  const { action, input } = state;

  // TODO: Implement your processing logic
  return {
    result: {
      template: 'success',
      message: \`Processed \${action} with input: \${JSON.stringify(input)}\`,
    },
  };
}

async function handleError(state: State): Promise<Partial<State>> {
  return {
    result: {
      template: 'error',
      message: state.error || 'Unknown error occurred',
    },
  };
}

function shouldContinue(state: State): 'process' | 'error' {
  if (state.error) return 'error';
  return 'process';
}

// Build the graph
const workflow = new StateGraph(StateAnnotation)
  .addNode('process', processInput)
  .addNode('error', handleError)
  .addConditionalEdges(START, shouldContinue, {
    process: 'process',
    error: 'error',
  })
  .addEdge('process', END)
  .addEdge('error', END);

const compiledGraph = workflow.compile();

// Export interface matching trik contract
type InvokeInput = {
  action: string;
  input: Record<string, unknown>;
};

type InvokeResult = {
  responseMode: 'template' | 'passthrough';
  agentData?: Record<string, unknown>;
  userContent?: Record<string, unknown>;
};

class ${className}Graph {
  async invoke(input: InvokeInput): Promise<InvokeResult> {
    const result = await compiledGraph.invoke({
      action: input.action,
      input: input.input,
      result: null,
      error: null,
    });

    return {
      responseMode: 'template',
      agentData: result.result || { template: 'error', message: 'No result' },
    };
  }
}

export default new ${className}Graph();
`;
}

/**
 * Generate Python files
 */
function generatePythonFiles(input: ScaffoldInput): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const moduleName = toSnakeCase(input.name);

  // pyproject.toml
  files.push({
    path: 'pyproject.toml',
    content: `[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"

[project]
name = "${input.name}"
version = "0.1.0"
description = "${input.description}"
requires-python = ">=3.10"
dependencies = [
    "trikhub>=0.7.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0.0",
]
`,
  });

  // Module directory with manifest and graph
  files.push({
    path: `${moduleName}/__init__.py`,
    content: `from .graph import graph\n\n__all__ = ["graph"]\n`,
  });

  files.push({
    path: `${moduleName}/manifest.json`,
    content: generateManifest({ ...input, language: 'py' }),
  });

  files.push({
    path: `${moduleName}/graph.py`,
    content: `"""
${input.displayName}

${input.description}
"""

from typing import Any


class Graph:
    """Main trik graph."""

    async def invoke(self, input: dict[str, Any]) -> dict[str, Any]:
        action = input.get("action", "execute")
        action_input = input.get("input", {})

        if action == "execute":
            return await self._execute(action_input)

        return {
            "responseMode": "template",
            "agentData": {
                "template": "error",
                "message": f"Unknown action: {action}",
            },
        }

    async def _execute(self, input: dict[str, Any]) -> dict[str, Any]:
        query = input.get("query", "")

        # TODO: Implement your logic here
        return {
            "responseMode": "template",
            "agentData": {
                "template": "success",
                "message": f"Processed: {query}",
            },
        }


graph = Graph()
`,
  });

  // test.py
  files.push({
    path: 'test.py',
    content: `"""
Local test script

Run with: python test.py
"""

import asyncio
import json
from ${moduleName} import graph


async def main():
    result = await graph.invoke({
        "action": "execute",
        "input": {"query": "test"},
    })
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
`,
  });

  // .gitignore
  files.push({
    path: '.gitignore',
    content: `__pycache__/
*.py[cod]
*$py.class
*.so
.Python
dist/
*.egg-info/
.env
.venv/
`,
  });

  // README.md
  files.push({
    path: 'README.md',
    content: `# ${input.displayName}

${input.description}

## Development

\`\`\`bash
pip install -e ".[dev]"
python test.py
\`\`\`

## Publishing

\`\`\`bash
trik publish
\`\`\`
`,
  });

  return files;
}

/**
 * Generate implementation notes for each action
 */
function generateImplementationNotes(input: ScaffoldInput): Record<string, string> {
  const notes: Record<string, string> = {};

  for (const action of input.actions) {
    const actionDef = action as Record<string, unknown>;
    const actionName = (actionDef.name as string) || 'action';
    const responseMode = actionDef.responseMode as string;

    if (responseMode === 'template') {
      notes[actionName] =
        'Template mode: Return agentData with structured fields. The agent will fill the template.';
    } else {
      notes[actionName] =
        'Passthrough mode: Return userContent with free-text content. It goes directly to the user.';
    }
  }

  if (Object.keys(notes).length === 0) {
    notes['execute'] = 'Implement your main logic in the execute method.';
  }

  return notes;
}

/**
 * Scaffold a complete trik project
 */
export function scaffoldTrik(input: ScaffoldInput): ScaffoldResult {
  const files: GeneratedFile[] = [];

  // Generate manifest.json (at root for TS, in module for Python)
  if (input.language === 'ts') {
    files.push({
      path: 'manifest.json',
      content: generateManifest(input),
    });
  }

  // Generate trikhub.json
  files.push({
    path: 'trikhub.json',
    content: generateTrikhubJson(input),
  });

  // Generate language-specific files
  if (input.language === 'ts') {
    files.push(...generateTypeScriptFiles(input));
  } else {
    files.push(...generatePythonFiles(input));
  }

  // Generate next steps
  const nextSteps: string[] = [];
  if (input.language === 'ts') {
    nextSteps.push(`cd ${input.name}`);
    nextSteps.push('npm install');
    nextSteps.push('npm run build');
    nextSteps.push('npm test');
  } else {
    nextSteps.push(`cd ${input.name}`);
    nextSteps.push('pip install -e ".[dev]"');
    nextSteps.push('python test.py');
  }

  if (input.capabilities.config && input.capabilities.config.length > 0) {
    nextSteps.push(`Configure required keys in ~/.trikhub/secrets.json: ${input.capabilities.config.map((c) => c.key).join(', ')}`);
  }

  nextSteps.push('trik publish  # When ready to publish');

  return {
    files,
    nextSteps,
    implementationNotes: generateImplementationNotes(input),
  };
}
