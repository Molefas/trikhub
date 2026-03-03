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
    filesystem?: boolean;
    shell?: boolean;
    config?: Array<{ key: string; description: string }>;
  };
}

// ============================================================================
// Template generators
// ============================================================================

function generateManifest(input: ScaffoldInput, pkgName?: string): string {
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
        ? {
            systemPromptFile: input.language === 'py' && pkgName
              ? `./src/${pkgName}/prompts/system.md`
              : './src/prompts/system.md',
          }
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
        // Derive outputSchema from outputTemplate placeholders when available
        const placeholders = tool.outputTemplate
          ? extractTemplatePlaceholders(tool.outputTemplate)
          : [];
        if (placeholders.length > 0) {
          // Use placeholder names — add format:'id' for *Id fields, enum for *status fields
          const properties: Record<string, unknown> = {};
          for (const p of placeholders) {
            if (p.toLowerCase().endsWith('id')) {
              properties[p] = { type: 'string', format: 'id' };
            } else if (p === 'status' || p === 'match') {
              properties[p] = p === 'match'
                ? { type: 'boolean' }
                : { type: 'string', enum: ['success', 'error'] };
            } else {
              properties[p] = { type: 'string', maxLength: 500 };
            }
          }
          toolDef.outputSchema = {
            type: 'object',
            properties,
            required: placeholders,
          };
        } else {
          toolDef.outputSchema = {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['success', 'error'] },
              resultId: { type: 'string', format: 'id' },
            },
            required: ['status'],
          };
        }
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
  if (input.capabilities?.filesystem) {
    caps.filesystem = { enabled: true, maxSizeBytes: 524288000 };
  }
  if (input.capabilities?.shell) {
    caps.shell = { enabled: true, timeoutMs: 60000, maxConcurrent: 3 };
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
    module: input.language === 'ts'
      ? './dist/agent.js'
      : `./src/${pkgName}/main.py`,
    export: 'default',
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

// Factory pattern: receives TrikContext with config + storage at runtime.
// The factory runs once on first use — the resolved agent is reused.
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

function generatePyConversationalAgent(input: ScaffoldInput, pkgName: string): string {
  const hasStorage = input.capabilities?.storage;
  const tools = input.tools || [];

  const storageImport = hasStorage ? ', TrikStorageContext' : '';

  if (hasStorage && tools.length > 0) {
    // Closure-based pattern: tools closed over storage
    const toolFuncs = tools.map((t) => {
      const snakeName = toSnakeCase(t.name);
      return `
    @tool
    async def ${snakeName}(query: str) -> str:
        """${t.description}"""
        # TODO: Implement ${t.name} using storage
        raise NotImplementedError("TODO: implement ${snakeName}")
`;
    }).join('');

    const toolList = tools.map((t) => `        ${toSnakeCase(t.name)},`).join('\n');

    return `"""
${input.displayName} — conversational trik.

${input.description}
Uses the wrap_agent() pattern for multi-turn conversation via handoff.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from langchain_anthropic import ChatAnthropic
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent

from trikhub.sdk import wrap_agent, transfer_back_tool, TrikContext${storageImport}


_PROMPT_PATH = Path(__file__).parent / "prompts" / "system.md"
_SYSTEM_PROMPT = _PROMPT_PATH.read_text(encoding="utf-8")


def _build_tools(storage: TrikStorageContext):
${toolFuncs}
    return [
${toolList}
    ]


# Factory pattern: receives TrikContext with config + storage at runtime.
# The factory runs once on first use — the resolved agent is reused.
default = wrap_agent(lambda context: create_react_agent(
    model=ChatAnthropic(
        model="claude-sonnet-4-20250514",
        api_key=os.environ.get("ANTHROPIC_API_KEY"),
    ),
    tools=[*_build_tools(context.storage), transfer_back_tool],
    prompt=_SYSTEM_PROMPT,
))
`;
  }

  // No storage — module-level tools
  const toolFuncs = tools.length > 0
    ? tools.map((t) => {
        const snakeName = toSnakeCase(t.name);
        return `
@tool
async def ${snakeName}(query: str) -> str:
    """${t.description}"""
    # TODO: Implement ${t.name}
    raise NotImplementedError("TODO: implement ${snakeName}")
`;
      }).join('')
    : `
@tool
async def example_tool(query: str) -> str:
    """An example tool. Replace with your actual tools."""
    # TODO: Implement your tool logic
    return f"Result for: {query}"
`;

  const toolList = tools.length > 0
    ? tools.map((t) => `    ${toSnakeCase(t.name)},`).join('\n')
    : '    example_tool,';

  return `"""
${input.displayName} — conversational trik.

${input.description}
Uses the wrap_agent() pattern for multi-turn conversation via handoff.
"""

from __future__ import annotations

import os
from pathlib import Path

from langchain_anthropic import ChatAnthropic
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent

from trikhub.sdk import wrap_agent, transfer_back_tool, TrikContext


_PROMPT_PATH = Path(__file__).parent / "prompts" / "system.md"
_SYSTEM_PROMPT = _PROMPT_PATH.read_text(encoding="utf-8")

${toolFuncs}

# Factory pattern: receives TrikContext with config + storage at runtime.
# The factory runs once on first use — the resolved agent is reused.
default = wrap_agent(lambda context: create_react_agent(
    model=ChatAnthropic(
        model="claude-sonnet-4-20250514",
        api_key=os.environ.get("ANTHROPIC_API_KEY"),
    ),
    tools=[
${toolList}
        transfer_back_tool,
    ],
    prompt=_SYSTEM_PROMPT,
))
`;
}

function generatePyToolAgent(input: ScaffoldInput): string {
  const tools = input.tools || [{ name: 'exampleTool', description: 'An example tool' }];

  const handlerFuncs = tools
    .map((t) => {
      const handlerName = `handle_${toSnakeCase(t.name)}`;
      return `
async def ${handlerName}(input: dict[str, Any], context: TrikContext) -> dict[str, Any]:
    """Handle ${t.name} tool calls."""
    # TODO: Implement ${t.name}
    # Access input fields via: input["fieldName"]
    raise NotImplementedError("TODO: implement ${handlerName}")
`;
    })
    .join('\n');

  const handlerMap = tools
    .map((t) => `    "${t.name}": handle_${toSnakeCase(t.name)},`)
    .join('\n');

  return `"""
${input.displayName} — tool-mode trik.

${input.description}
Uses wrap_tool_handlers() for native tool export.
"""

from __future__ import annotations

from typing import Any

from trikhub.sdk import wrap_tool_handlers, TrikContext

${handlerFuncs}

default = wrap_tool_handlers({
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
  const toolList = (input.tools || [])
    .map((t) => `- **${t.name}**: ${t.description}`)
    .join('\n') || '- (add your tool descriptions here)';

  return `# ${input.displayName}

You are ${input.displayName}, a specialized assistant for ${input.description.toLowerCase().replace(/\.$/, '')}.

## Your tools

${toolList}

## Guidelines

- Focus on tasks within your domain: ${input.domain.join(', ')}
- When the user's request is outside your expertise, use \`transfer_back\` to return to the main agent
- Provide clear, concise responses
- Ask for clarification if a request is ambiguous

## When to transfer back

Use \`transfer_back\` when:
- The user asks for something outside your domain
- You've completed the task and the user wants something different
- The user explicitly asks to go back to the main agent
`;
}

function generatePyTestFile(input: ScaffoldInput, pkgName: string): string {
  if (input.mode === 'tool') {
    const toolName = (input.tools || [{ name: 'exampleTool' }])[0].name;
    return `"""Local test script — run with: python test.py

Requires: pip install -e .
Note: context=None only works for handlers that don't use storage/config.
For storage-dependent triks, test via the gateway instead.
"""

import asyncio
from ${pkgName}.main import default


async def main():
    result = await default.execute_tool(
        "${toolName}",
        {"query": "hello world"},  # Replace with actual input fields
        context=None,
    )
    print(result)


if __name__ == "__main__":
    asyncio.run(main())
`;
  }

  return `"""Local test script — run with: python test.py

Requires: pip install -e .
"""

import asyncio
from ${pkgName}.main import default


async def main():
    result = await default.process_message(
        "Hello! What can you do?",
        session_id="test-session",
        context=None,
    )
    print(result)


if __name__ == "__main__":
    asyncio.run(main())
`;
}

function generatePyProjectToml(input: ScaffoldInput, pkgName: string): string {
  const isConversational = input.mode === 'conversational';
  const deps = isConversational
    ? `    "trikhub>=0.6.0",
    "langchain-anthropic>=0.3.0",
    "langchain-core>=0.3.0",
    "langgraph>=0.2.0",`
    : `    "trikhub>=0.6.0",`;

  return `[build-system]
requires = ["setuptools>=61.0", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "${input.name}"
version = "0.1.0"
description = "${input.description}"
requires-python = ">=3.10"
license = "MIT"

dependencies = [
${deps}
]

[tool.setuptools.packages.find]
where = ["src"]
include = ["${pkgName}*"]
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
.env
.trikhub/secrets.json
.DS_Store
`;
}

/** Convert camelCase to snake_case */
function toSnakeCase(name: string): string {
  return name.replace(/([A-Z])/g, (_, c, i) => (i > 0 ? '_' : '') + c.toLowerCase());
}

/** Derive Python package name from trik name (hyphens → underscores) */
function toPythonPackageName(name: string): string {
  return name.replace(/-/g, '_');
}

/** Extract {{placeholder}} names from an outputTemplate string */
function extractTemplatePlaceholders(template: string): string[] {
  const matches = template.matchAll(/\{\{(\w+)\}\}/g);
  return [...new Set([...matches].map((m) => m[1]))];
}

// ============================================================================
// Public API
// ============================================================================

export function scaffoldTrik(input: ScaffoldInput): ScaffoldResult {
  const files: ScaffoldFile[] = [];
  const nextSteps: string[] = [];
  const pkgName = input.language === 'py' ? toPythonPackageName(input.name) : '';

  // Generate manifest
  files.push({
    path: 'manifest.json',
    content: generateManifest(input, pkgName),
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
      nextSteps.push('6. Test locally: use `trik create-agent ts` or add your trik path to examples/js/local-playground/.trikhub/config.json');
      nextSteps.push('7. When ready, publish with `trik publish`');
    } else {
      nextSteps.push('1. Run `npm install` to install dependencies');
      nextSteps.push('2. Implement your tools in src/tools/');
      nextSteps.push('3. Customize the system prompt in src/prompts/system.md');
      nextSteps.push('4. Run `npm run build` to compile');
      nextSteps.push('5. Test with `trik lint .` to validate your manifest');
      nextSteps.push('6. Test locally: use `trik create-agent ts` or add your trik path to examples/js/local-playground/.trikhub/config.json');
      nextSteps.push('7. When ready, publish with `trik publish`');
    }
  } else {
    // Python project — v2 SDK patterns (wrap_agent / wrap_tool_handlers)
    if (input.mode === 'conversational') {
      files.push({
        path: `src/${pkgName}/main.py`,
        content: generatePyConversationalAgent(input, pkgName),
      });

      files.push({
        path: `src/${pkgName}/__init__.py`,
        content: '',
      });

      files.push({
        path: `src/${pkgName}/prompts/system.md`,
        content: generatePySystemPrompt(input),
      });
    } else {
      // Tool mode
      files.push({
        path: `src/${pkgName}/main.py`,
        content: generatePyToolAgent(input),
      });

      files.push({
        path: `src/${pkgName}/__init__.py`,
        content: '',
      });
    }

    files.push({
      path: 'pyproject.toml',
      content: generatePyProjectToml(input, pkgName),
    });

    files.push({
      path: 'test.py',
      content: generatePyTestFile(input, pkgName),
    });

    files.push({
      path: '.gitignore',
      content: generatePyGitignore(),
    });

    if (input.mode === 'tool') {
      nextSteps.push('1. Run `pip install -e .` to install in development mode');
      nextSteps.push(`2. Implement your tool handlers in src/${pkgName}/main.py`);
      nextSteps.push('3. Update inputSchema/outputSchema in manifest.json');
      nextSteps.push('4. Run `python test.py` to test locally');
      nextSteps.push('5. Test with an agent: use `trik create-agent py` or add your trik path to examples/python/local-playground/.trikhub/config.json');
      nextSteps.push('6. When ready, publish with `trik publish`');
    } else {
      nextSteps.push('1. Run `pip install -e .` to install in development mode');
      nextSteps.push(`2. Implement your tools in src/${pkgName}/main.py`);
      nextSteps.push(`3. Customize the system prompt in src/${pkgName}/prompts/system.md`);
      nextSteps.push('4. Run `python test.py` to test locally');
      nextSteps.push('5. Test with an agent: use `trik create-agent py` or add your trik path to examples/python/local-playground/.trikhub/config.json');
      nextSteps.push('6. When ready, publish with `trik publish`');
    }
  }

  // Config secrets template
  if (input.capabilities?.config && input.capabilities.config.length > 0) {
    const secrets: Record<string, string> = {};
    const secretsExample: Record<string, string> = {};
    for (const cfg of input.capabilities.config) {
      secrets[cfg.key] = '';
      secretsExample[cfg.key] = `your-${cfg.key.toLowerCase().replace(/_/g, '-')}-here`;
    }
    files.push({
      path: '.trikhub/secrets.json',
      content: JSON.stringify(secrets, null, 2),
    });
    files.push({
      path: '.trikhub/secrets.json.example',
      content: JSON.stringify(secretsExample, null, 2),
    });
    nextSteps.push(`- Copy .trikhub/secrets.json.example to .trikhub/secrets.json and add your API keys`);
  }

  // .env.example for conversational triks (they need an LLM API key)
  if (input.mode === 'conversational') {
    const envLines: string[] = ['# Environment variables for local development'];
    // Check if ANTHROPIC_API_KEY is already in config — if not, add it to .env.example
    const configKeys = (input.capabilities?.config || []).map((c) => c.key);
    if (!configKeys.includes('ANTHROPIC_API_KEY')) {
      envLines.push('ANTHROPIC_API_KEY=sk-ant-your-key-here');
    }
    for (const cfg of input.capabilities?.config || []) {
      envLines.push(`${cfg.key}=your-${cfg.key.toLowerCase().replace(/_/g, '-')}-here`);
    }
    files.push({
      path: '.env.example',
      content: envLines.join('\n') + '\n',
    });
  }

  return { files, nextSteps };
}
