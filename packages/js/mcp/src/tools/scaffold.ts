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
}

interface ScaffoldInput {
  name: string;
  displayName: string;
  description: string;
  language: 'ts' | 'py';
  category: string;
  mode: 'conversational' | 'one-shot';
  handoffDescription: string;
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
      handoffDescription: input.handoffDescription,
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
    module: input.language === 'ts' ? './dist/agent.js' : `./${input.name.replace(/-/g, '_')}/agent.py`,
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

  if (input.mode === 'one-shot') {
    return `/**
 * ${input.displayName} — one-shot agent entry point.
 */

import { wrapAgent, transferBackTool } from '@trikhub/sdk';
import type { TrikContext } from '@trikhub/sdk';
${toolImports ? `\n${toolImports}\n` : ''}
export default wrapAgent((context: TrikContext) => {
${destructureStr}  // One-shot mode: process the request and transfer back immediately.
  // The agent will call tools as needed, then transfer_back with a summary.

  const tools = [
${toolArray}
    transferBackTool,
  ];

  // TODO: Replace with your one-shot processing logic
  // For one-shot mode, consider using a simple function instead of a full LLM agent
  throw new Error('Not implemented — replace with your processing logic');
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
    modelName: 'claude-sonnet-4-20250514',
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
    dependencies: {
      '@trikhub/sdk': 'latest',
      '@langchain/anthropic': '^0.3.0',
      '@langchain/core': '^0.3.0',
      '@langchain/langgraph': '^0.2.0',
      zod: '^3.25.0',
    },
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

function generatePyAgent(input: ScaffoldInput): string {
  const moduleName = input.name.replace(/-/g, '_');
  return `"""
${input.displayName} — agent entry point.
"""

from typing import Any


async def process_message(message: str, context: dict[str, Any]) -> dict[str, Any]:
    """Process a user message and return a response."""
    # TODO: Implement your agent logic here
    return {
        "message": f"Received: {message}",
        "transferBack": False,
        "toolCalls": [],
    }


# Default export for TrikHub
default = process_message
`;
}

function generatePyProjectToml(input: ScaffoldInput): string {
  return `[project]
name = "${input.name}"
version = "0.1.0"
description = "${input.description}"
requires-python = ">=3.10"

[build-system]
requires = ["setuptools>=68.0"]
build-backend = "setuptools.backends._legacy:_Backend"
`;
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
    }

    // Tool files
    for (const tool of input.tools || []) {
      files.push({
        path: `src/tools/${tool.name}.ts`,
        content: generateToolFile(tool),
      });
    }

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

    nextSteps.push('1. Run `npm install` to install dependencies');
    nextSteps.push('2. Implement your tools in src/tools/');
    nextSteps.push('3. Customize the system prompt in src/prompts/system.md');
    nextSteps.push('4. Run `npm run build` to compile');
    nextSteps.push('5. Test with `trik lint .` to validate your manifest');
    nextSteps.push('6. Publish with `trik publish`');
  } else {
    // Python project
    const moduleName = input.name.replace(/-/g, '_');

    files.push({
      path: `${moduleName}/agent.py`,
      content: generatePyAgent(input),
    });

    files.push({
      path: `${moduleName}/__init__.py`,
      content: `"""${input.displayName}"""\n`,
    });

    files.push({
      path: 'pyproject.toml',
      content: generatePyProjectToml(input),
    });

    files.push({
      path: '.gitignore',
      content: `__pycache__/\n*.pyc\n.env\ndist/\n*.egg-info/\n`,
    });

    nextSteps.push('1. Implement your agent logic in the agent.py file');
    nextSteps.push('2. Add any required Python dependencies to pyproject.toml');
    nextSteps.push('3. Test with `trik lint .` to validate your manifest');
    nextSteps.push('4. Publish with `trik publish`');
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
