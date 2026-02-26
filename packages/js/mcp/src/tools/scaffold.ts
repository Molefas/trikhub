/**
 * scaffold_trik — v2 implementation.
 *
 * Generates a complete v2 trik project structure:
 * - v2 manifest.json with agent block
 * - agent.ts using wrapAgent() from @trikhub/sdk
 * - prompts/system.md template
 * - Tool implementations in tools/ directory
 * - package.json with @trikhub/sdk dependency
 */

import type { ScaffoldFile, ScaffoldResult } from './types.js';

// ============================================================================
// Input types
// ============================================================================

interface ToolDef {
  name: string;
  description: string;
  logTemplate?: string;
  logSchema?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  outputTemplate?: string;
}

interface ScaffoldInput {
  name: string;
  displayName: string;
  description: string;
  language: 'ts' | 'py';
  category: string;
  mode: 'conversational' | 'tool';
  handoffDescription?: string;
  domain: string[];
  tools?: ToolDef[];
  capabilities?: {
    storage?: boolean;
    session?: boolean;
    config?: Array<{ key: string; description: string }>;
  };
}

// ============================================================================
// Template generators
// ============================================================================

function generateManifest(input: ScaffoldInput): string {
  const manifest: Record<string, unknown> = {
    schemaVersion: 2,
    id: input.name,
    name: input.displayName,
    description: input.description,
    version: '0.1.0',

    agent: {
      mode: input.mode,
      ...(input.mode !== 'tool'
        ? { handoffDescription: input.handoffDescription }
        : {}),
      ...(input.mode === 'conversational'
        ? { systemPromptFile: './src/prompts/system.md' }
        : {}),
      ...(input.mode === 'conversational'
        ? { model: { capabilities: ['tool_use'] } }
        : {}),
      domain: input.domain,
    },
  };

  // Tools
  if (input.tools && input.tools.length > 0) {
    const tools: Record<string, Record<string, unknown>> = {};
    for (const tool of input.tools) {
      const toolDef: Record<string, unknown> = {
        description: tool.description,
      };
      if (tool.logTemplate) {
        toolDef.logTemplate = tool.logTemplate;
      }
      if (tool.logSchema) {
        toolDef.logSchema = tool.logSchema;
      }
      if (tool.inputSchema) {
        toolDef.inputSchema = tool.inputSchema;
      }
      if (tool.outputSchema) {
        toolDef.outputSchema = tool.outputSchema;
      }
      if (tool.outputTemplate) {
        toolDef.outputTemplate = tool.outputTemplate;
      }
      // For tool-mode, add default schemas if not provided
      if (input.mode === 'tool' && !tool.inputSchema) {
        toolDef.inputSchema = {
          type: 'object',
          properties: { query: { type: 'string', maxLength: 200 } },
          required: ['query'],
        };
      }
      if (input.mode === 'tool' && !tool.outputSchema) {
        toolDef.outputSchema = {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['success', 'error'] },
            resultId: { type: 'string', format: 'id' },
          },
          required: ['status'],
        };
      }
      if (input.mode === 'tool' && !tool.outputTemplate) {
        toolDef.outputTemplate = `${tool.name}: {{status}} ({{resultId}})`;
      }
      tools[tool.name] = toolDef;
    }
    manifest.tools = tools;
  }

  // Capabilities
  const caps: Record<string, unknown> = {};
  if (input.capabilities?.session) {
    caps.session = { enabled: true, maxDurationMs: 1800000 };
  }
  if (input.capabilities?.storage) {
    caps.storage = { enabled: true };
  }
  if (Object.keys(caps).length > 0) {
    manifest.capabilities = caps;
  }

  // Config
  if (input.capabilities?.config && input.capabilities.config.length > 0) {
    manifest.config = {
      optional: input.capabilities.config,
    };
  }

  // Limits and entry
  manifest.limits = { maxTurnTimeMs: 30000 };
  manifest.entry = {
    module: input.language === 'ts' ? './dist/agent.js' : './src/agent.py',
    export: input.language === 'ts' ? 'default' : 'agent',
    ...(input.language === 'py' ? { runtime: 'python' } : {}),
  };

  return JSON.stringify(manifest, null, 2);
}

function generateAgentTs(input: ScaffoldInput): string {
  const toolImports = (input.tools || [])
    .map((t) => `import { ${t.name} } from './tools/${t.name}.js';`)
    .join('\n');

  const toolArray = (input.tools || [])
    .map((t) => `    ${t.name},`)
    .join('\n');

  const hasStorage = input.capabilities?.storage;
  const hasConfig = input.capabilities?.config && input.capabilities.config.length > 0;

  const contextDestructure: string[] = [];
  if (hasStorage) contextDestructure.push('storage');
  if (hasConfig) contextDestructure.push('config');
  const destructureStr = contextDestructure.length > 0
    ? `  const { ${contextDestructure.join(', ')} } = context;\n\n`
    : '';

  if (input.mode === 'tool') {
    // Tool mode: use wrapToolHandlers, no LLM or LangChain
    const toolHandlers = (input.tools || [])
      .map((t) => `  ${t.name}: async (input, context) => {\n    // TODO: Implement ${t.name}\n    return { result: 'Not implemented' };\n  },`)
      .join('\n');

    return `/**
 * ${input.displayName} — tool-mode agent entry point.
 *
 * Exports native tools to the main agent. No handoff, no session.
 */

import { wrapToolHandlers } from '@trikhub/sdk';

export default wrapToolHandlers({
${toolHandlers}
});
`;
  }

  // Conversational mode
  return `/**
 * ${input.displayName} — conversational agent entry point.
 */

import { ChatAnthropic } from '@langchain/anthropic';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { wrapAgent, transferBackTool } from '@trikhub/sdk';
import type { TrikContext } from '@trikhub/sdk';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
${toolImports ? `\n${toolImports}\n` : ''}
const __dirname = dirname(fileURLToPath(import.meta.url));
const systemPrompt = readFileSync(join(__dirname, '../src/prompts/system.md'), 'utf-8');

export default wrapAgent((context: TrikContext) => {
${destructureStr}  const model = new ChatAnthropic({
    modelName: 'claude-sonnet-4-6',
    anthropicApiKey: ${hasConfig ? "config.get('ANTHROPIC_API_KEY')" : "process.env.ANTHROPIC_API_KEY"},
  });

  const tools = [
${toolArray}
    transferBackTool,
  ];

  return createReactAgent({
    llm: model,
    tools,
    messageModifier: systemPrompt,
  });
});
`;
}

function generateSystemPrompt(input: ScaffoldInput): string {
  return `# ${input.displayName}

You are ${input.displayName}, a specialized assistant for ${input.description.toLowerCase()}.

## Your capabilities

${(input.tools || []).map((t) => `- **${t.name}**: ${t.description}`).join('\n') || '- (define your tools)'}

## Guidelines

- Focus on tasks within your domain: ${input.domain.join(', ')}
- When the user's request is outside your expertise, use the transfer_back tool to return to the main agent
- Provide clear, actionable responses
- If you need more information, ask the user before proceeding

## Transfer back

Use the \`transfer_back\` tool when:
- The user's request is outside your domain
- You've completed the task and the user wants to do something else
- The user explicitly asks to go back
`;
}

function generateToolFile(tool: ToolDef): string {
  return `/**
 * ${tool.name} tool implementation.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const ${tool.name} = tool(
  async (input) => {
    // TODO: Implement ${tool.name}
    return JSON.stringify({ result: 'Not implemented' });
  },
  {
    name: '${tool.name}',
    description: '${tool.description}',
    schema: z.object({
      // TODO: Define input schema
      query: z.string().describe('Input for ${tool.name}'),
    }),
  },
);
`;
}

function generatePackageJson(input: ScaffoldInput): string {
  const isToolMode = input.mode === 'tool';

  const dependencies: Record<string, string> = {
    '@trikhub/sdk': 'latest',
  };

  if (!isToolMode) {
    dependencies['@langchain/anthropic'] = '^0.3.0';
    dependencies['@langchain/core'] = '^0.3.0';
    dependencies['@langchain/langgraph'] = '^0.2.0';
    dependencies['zod'] = '^3.25.0';
  }

  const pkg: Record<string, unknown> = {
    name: input.name,
    version: '0.1.0',
    description: input.description,
    type: 'module',
    main: './dist/agent.js',
    scripts: {
      build: 'tsc',
      dev: 'node --import tsx src/agent.ts',
      clean: 'rm -rf dist *.tsbuildinfo',
    },
    dependencies,
    devDependencies: {
      tsx: '^4.19.0',
      typescript: '^5.7.0',
    },
  };

  return JSON.stringify(pkg, null, 2);
}

function generateTsConfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'nodenext',
        outDir: './dist',
        rootDir: './src',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        declaration: true,
        declarationMap: true,
        sourceMap: true,
      },
      include: ['src/**/*'],
    },
    null,
    2,
  );
}

function generateGitignore(): string {
  return `node_modules/
dist/
*.tsbuildinfo
.env
.trikhub/secrets.json
`;
}

function generatePyConversationalAgent(input: ScaffoldInput): string {
  return `"""
${input.displayName} — conversational agent

Uses LangGraph ReAct pattern with the TrikHub SDK.
"""

from __future__ import annotations

from langchain_anthropic import ChatAnthropic
from langgraph.prebuilt import create_react_agent

from trikhub.sdk import wrap_agent, transfer_back_tool
from trikhub.manifest import TrikContext

from .tools.example import example_tool


def create_agent(context: TrikContext):
    """Factory that creates a new agent per session."""
    model = ChatAnthropic(model="claude-sonnet-4-20250514")

    tools = [example_tool, transfer_back_tool]

    return create_react_agent(
        model,
        tools=tools,
    )


# Export wrapped agent for the TrikHub worker
agent = wrap_agent(create_agent)
`;
}

function generatePyToolAgent(input: ScaffoldInput): string {
  const tools = input.tools || [{ name: 'exampleTool', description: 'An example tool' }];

  const handlerFuncs = tools
    .map((t) => {
      const handlerName = `handle_${toSnakeCase(t.name)}`;
      return `
async def ${handlerName}(input_data: dict, context) -> dict:
    """Handle ${t.name} tool calls."""
    query = input_data.get("query", "")
    return {"result": f"Processed: {query}"}
`;
    })
    .join('\n');

  const handlerMap = tools
    .map((t) => `    "${t.name}": handle_${toSnakeCase(t.name)},`)
    .join('\n');

  return `"""
${input.displayName} — tool mode agent

Exports native tools via wrap_tool_handlers from the TrikHub SDK.
"""

from __future__ import annotations

from trikhub.sdk import wrap_tool_handlers

${handlerFuncs}

# Export wrapped tool handlers for the TrikHub worker
agent = wrap_tool_handlers({
${handlerMap}
})
`;
}

function generatePyExampleTool(): string {
  return `"""Example tool for the conversational agent."""

from langchain_core.tools import tool


@tool
def example_tool(query: str) -> str:
    """Search for information about a topic.

    Args:
        query: The search query.
    """
    return f"Result for: {query}"
`;
}

function generatePySystemPrompt(input: ScaffoldInput): string {
  return `You are ${input.displayName}, a helpful assistant.

${input.description}

When you have finished helping the user, use the transfer_back tool to return control to the main agent.
`;
}

function generatePyTestFile(input: ScaffoldInput): string {
  if (input.mode === 'tool') {
    const toolName = (input.tools || [{ name: 'exampleTool' }])[0].name;
    return `"""Local test script — run with: python test.py"""

import asyncio
from src.agent import agent


async def main():
    result = await agent.execute_tool(
        "${toolName}",
        {"query": "hello world"},
        context=None,
    )
    print(result)


if __name__ == "__main__":
    asyncio.run(main())
`;
  }

  return `"""Local test script — run with: python test.py"""

import asyncio
from src.agent import agent


async def main():
    result = await agent.process_message(
        "Hello! What can you do?",
        session_id="test-session",
        context=None,
    )
    print(result)


if __name__ == "__main__":
    asyncio.run(main())
`;
}

function generatePyProjectToml(input: ScaffoldInput): string {
  const isConversational = input.mode === 'conversational';
  const deps = isConversational
    ? `    "trikhub-sdk>=0.1.0",
    "langchain-anthropic>=0.3.0",
    "langgraph>=0.2.0",`
    : `    "trikhub-sdk>=0.1.0",`;

  return `[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "${input.name}"
version = "0.1.0"
description = "${input.description}"
readme = "README.md"
requires-python = ">=3.10"
license = {text = "MIT"}
dependencies = [
${deps}
]

[tool.hatch.build.targets.wheel]
packages = ["src"]

[tool.hatch.build.targets.sdist]
include = [
    "src/**",
    "manifest.json",
    "trikhub.json",
    "README.md",
]
`;
}

function generatePyTrikhubJson(input: ScaffoldInput): string {
  return JSON.stringify(
    {
      displayName: input.displayName,
      shortDescription: input.description,
      categories: [input.category],
      keywords: [input.name],
      repository: `https://github.com/your-username/${input.name}`,
    },
    null,
    2,
  );
}

function generatePyGitignore(): string {
  return `__pycache__/
*.py[cod]
*$py.class
*.so
.Python
build/
dist/
*.egg-info/
.eggs/
*.egg
.venv/
venv/
.DS_Store
`;
}

/** Convert camelCase to snake_case */
function toSnakeCase(name: string): string {
  return name.replace(/([A-Z])/g, (_, c, i) => (i > 0 ? '_' : '') + c.toLowerCase());
}

// ============================================================================
// Public API
// ============================================================================

export function scaffoldTrik(input: ScaffoldInput): ScaffoldResult {
  const files: ScaffoldFile[] = [];
  const nextSteps: string[] = [];

  // Generate manifest
  files.push({
    path: 'manifest.json',
    content: generateManifest(input),
  });

  if (input.language === 'ts') {
    // TypeScript project
    files.push({
      path: 'src/agent.ts',
      content: generateAgentTs(input),
    });

    if (input.mode === 'conversational') {
      files.push({
        path: 'src/prompts/system.md',
        content: generateSystemPrompt(input),
      });

      // Separate tool files for conversational mode
      for (const tool of input.tools || []) {
        files.push({
          path: `src/tools/${tool.name}.ts`,
          content: generateToolFile(tool),
        });
      }
    }
    // Tool mode: all handlers live in agent.ts, no separate tool files

    files.push({
      path: 'package.json',
      content: generatePackageJson(input),
    });

    files.push({
      path: 'tsconfig.json',
      content: generateTsConfig(),
    });

    files.push({
      path: '.gitignore',
      content: generateGitignore(),
    });

    if (input.mode === 'tool') {
      nextSteps.push('1. Run `npm install` to install dependencies');
      nextSteps.push('2. Implement your tool handlers in src/agent.ts');
      nextSteps.push('3. Update inputSchema/outputSchema in manifest.json');
      nextSteps.push('4. Run `npm run build` to compile');
      nextSteps.push('5. Test with `trik lint .` to validate your manifest');
      nextSteps.push('6. Publish with `trik publish`');
    } else {
      nextSteps.push('1. Run `npm install` to install dependencies');
      nextSteps.push('2. Implement your tools in src/tools/');
      nextSteps.push('3. Customize the system prompt in src/prompts/system.md');
      nextSteps.push('4. Run `npm run build` to compile');
      nextSteps.push('5. Test with `trik lint .` to validate your manifest');
      nextSteps.push('6. Publish with `trik publish`');
    }
  } else {
    // Python project — v2 SDK patterns (wrap_agent / wrap_tool_handlers)
    if (input.mode === 'conversational') {
      files.push({
        path: 'src/agent.py',
        content: generatePyConversationalAgent(input),
      });

      files.push({
        path: 'src/tools/example.py',
        content: generatePyExampleTool(),
      });

      files.push({
        path: 'src/tools/__init__.py',
        content: '',
      });

      files.push({
        path: 'src/__init__.py',
        content: '',
      });

      files.push({
        path: 'src/prompts/system.md',
        content: generatePySystemPrompt(input),
      });

      // Separate tool files for conversational mode
      for (const tool of input.tools || []) {
        if (tool.name !== 'exampleTool') {
          files.push({
            path: `src/tools/${toSnakeCase(tool.name)}.py`,
            content: `"""${tool.name} tool implementation."""

from langchain_core.tools import tool


@tool
def ${toSnakeCase(tool.name)}(query: str) -> str:
    """${tool.description}

    Args:
        query: Input for ${tool.name}.
    """
    # TODO: Implement ${tool.name}
    return f"Result for: {query}"
`,
          });
        }
      }
    } else {
      // Tool mode
      files.push({
        path: 'src/agent.py',
        content: generatePyToolAgent(input),
      });

      files.push({
        path: 'src/__init__.py',
        content: '',
      });
    }

    files.push({
      path: 'pyproject.toml',
      content: generatePyProjectToml(input),
    });

    files.push({
      path: 'trikhub.json',
      content: generatePyTrikhubJson(input),
    });

    files.push({
      path: 'test.py',
      content: generatePyTestFile(input),
    });

    files.push({
      path: '.gitignore',
      content: generatePyGitignore(),
    });

    if (input.mode === 'tool') {
      nextSteps.push('1. Run `pip install -e .` to install in development mode');
      nextSteps.push('2. Implement your tool handlers in src/agent.py');
      nextSteps.push('3. Update inputSchema/outputSchema in manifest.json');
      nextSteps.push('4. Run `python test.py` to test locally');
      nextSteps.push('5. Publish with `trik publish`');
    } else {
      nextSteps.push('1. Run `pip install -e .` to install in development mode');
      nextSteps.push('2. Implement your tools in src/tools/');
      nextSteps.push('3. Customize the system prompt in src/prompts/system.md');
      nextSteps.push('4. Run `python test.py` to test locally');
      nextSteps.push('5. Publish with `trik publish`');
    }
  }

  // Config secrets template
  if (input.capabilities?.config && input.capabilities.config.length > 0) {
    const secrets: Record<string, string> = {};
    for (const cfg of input.capabilities.config) {
      secrets[cfg.key] = '';
    }
    files.push({
      path: '.trikhub/secrets.json',
      content: JSON.stringify(secrets, null, 2),
    });
    nextSteps.push(`- Add your API keys to .trikhub/secrets.json`);
  }

  return { files, nextSteps };
}
