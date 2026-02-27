/**
 * v2 Python scaffold template.
 *
 * Generates a complete v2 trik project structure for Python,
 * mirroring the TypeScript template but using Python conventions.
 */

import type { InitConfig } from './typescript.js';

// ============================================================================
// Helpers
// ============================================================================

/** Convert trik name (dashes) to Python package name (underscores) */
function toPythonPackage(name: string): string {
  return name.replace(/-/g, '_');
}

// ============================================================================
// File generators
// ============================================================================

function generateManifest(config: InitConfig): string {
  const isToolMode = config.agentMode === 'tool';
  const pkg = toPythonPackage(config.name);

  const agent: Record<string, unknown> = {
    mode: config.agentMode,
    domain: config.domainTags,
  };

  if (!isToolMode) {
    agent.handoffDescription = config.handoffDescription;
    agent.systemPromptFile = `./src/${pkg}/prompts/system.md`;
    agent.model = { capabilities: ['tool_use'] };
  }

  const manifest: Record<string, unknown> = {
    schemaVersion: 2,
    id: config.name,
    name: config.displayName,
    description: config.description,
    version: '0.1.0',
    agent,
  };

  // Tools block
  if (isToolMode && config.toolNames.length > 0) {
    const tools: Record<string, Record<string, unknown>> = {};
    for (const toolName of config.toolNames) {
      tools[toolName] = {
        description: `TODO: describe ${toolName}`,
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', maxLength: 200 },
          },
          required: ['query'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['success', 'error'] },
            resultId: { type: 'string', format: 'id' },
          },
          required: ['status'],
        },
        outputTemplate: `${toolName}: {{status}} ({{resultId}})`,
      };
    }
    manifest.tools = tools;
  } else {
    manifest.tools = {
      exampleTool: {
        description: 'An example tool',
      },
    };
  }

  if (config.enableStorage) {
    manifest.capabilities = {
      storage: { enabled: true },
    };
  }

  manifest.limits = { maxTurnTimeMs: 30000 };
  manifest.entry = {
    module: `./src/${pkg}/main.py`,
    export: 'default',
    runtime: 'python',
  };
  manifest.author = config.authorName;

  if (config.enableConfig) {
    manifest.config = {
      optional: [
        { key: 'ANTHROPIC_API_KEY', description: 'Anthropic API key for the agent' },
      ],
    };
  }

  return JSON.stringify(manifest, null, 2);
}

function generateTrikhubJson(config: InitConfig): string {
  const metadata = {
    displayName: config.displayName,
    shortDescription: config.description,
    categories: [config.category],
    keywords: [] as string[],
    author: {
      name: config.authorName,
      github: config.authorGithub,
    },
    repository: `https://github.com/${config.authorGithub}/${config.name}`,
  };

  return JSON.stringify(metadata, null, 2);
}

function generatePyprojectToml(config: InitConfig): string {
  const isToolMode = config.agentMode === 'tool';
  const pkg = toPythonPackage(config.name);

  const deps = ['    "trikhub-sdk>=0.1.0",'];
  if (!isToolMode) {
    deps.push('    "langchain-anthropic>=0.3.0",');
    deps.push('    "langchain-core>=0.3.0",');
    deps.push('    "langgraph>=0.2.0",');
  }

  return `[build-system]
requires = ["setuptools>=61.0", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "${config.name}"
version = "0.1.0"
description = "${config.description}"
requires-python = ">=3.10"
license = "MIT"

dependencies = [
${deps.join('\n')}
]

[tool.setuptools.packages.find]
where = ["src"]
include = ["${pkg}*"]
`;
}

function generateToolModeMain(config: InitConfig): string {
  const handlers = config.toolNames.map((name) =>
    `async def ${toSnakeCase(name)}(input: dict[str, Any], context: TrikContext) -> dict[str, Any]:
    # TODO: Implement ${name}
    return {"result": "Not implemented"}`
  ).join('\n\n\n');

  const handlerMap = config.toolNames.map((name) =>
    `    "${name}": ${toSnakeCase(name)},`
  ).join('\n');

  return `"""
${config.displayName} — tool-mode trik.

Exports native tools to the main agent. No handoff, no session.
Uses wrap_tool_handlers() for native tool export.
"""

from typing import Any

from trikhub.sdk import wrap_tool_handlers, TrikContext


${handlers}


default = wrap_tool_handlers({
${handlerMap}
})
`;
}

function generateConversationalMain(config: InitConfig): string {
  const apiKeyAccess = config.enableConfig
    ? 'config.get("ANTHROPIC_API_KEY")'
    : 'os.environ.get("ANTHROPIC_API_KEY")';

  return `"""
${config.displayName} — conversational trik.

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


@tool
async def example_tool(query: str) -> str:
    """An example tool — replace with your own implementation."""
    return f"Processed: {query}"


default = wrap_agent(lambda context: create_react_agent(
    model=ChatAnthropic(
        model="claude-sonnet-4-20250514",
        api_key=${apiKeyAccess},
    ),
    tools=[example_tool, transfer_back_tool],
    prompt=_SYSTEM_PROMPT,
))
`;
}

function generateMainPy(config: InitConfig): string {
  if (config.agentMode === 'tool') {
    return generateToolModeMain(config);
  }
  return generateConversationalMain(config);
}

function generateSystemPrompt(config: InitConfig): string {
  const domainStr = config.domainTags.join(', ');

  return `# ${config.displayName}

You are ${config.displayName}, a specialized assistant for ${config.description.toLowerCase()}.

## Your capabilities
- **example_tool**: An example tool

## Guidelines
- Focus on tasks within your domain: ${domainStr}
- When the user's request is outside your expertise, use the transfer_back tool
- Provide clear, actionable responses

## Transfer back
Use the \`transfer_back\` tool when:
- The user's request is outside your domain
- You've completed the task and the user wants to do something else
- The user explicitly asks to go back
`;
}

function generateGitignore(): string {
  return `__pycache__/
*.egg-info/
*.pyc
dist/
build/
*.egg
.venv/
.env
.trikhub/secrets.json
`;
}

function generateReadme(config: InitConfig): string {
  const domainStr = config.domainTags.join(', ');
  const isToolMode = config.agentMode === 'tool';
  const pkg = toPythonPackage(config.name);

  const devSection = isToolMode
    ? `- Implement your tool handlers in \`src/${pkg}/main.py\`
- Update inputSchema/outputSchema in \`manifest.json\``
    : `- Edit your agent logic in \`src/${pkg}/main.py\`
- Add tools as \`@tool\` decorated functions
- Customize the system prompt in \`src/${pkg}/prompts/system.md\``;

  const archSection = isToolMode
    ? `Tools from this trik appear as native tools on the main agent — no handoff, no session.`
    : `The main agent routes conversations to this trik using a \`talk_to_${config.name}\` tool.
When done, use the \`transfer_back\` tool to return control.`;

  return `# ${config.displayName}

${config.description}

## Getting Started

1. Create a virtual environment: \`python -m venv .venv && source .venv/bin/activate\`
2. Install dependencies: \`pip install -e .\`
3. Validate: \`trik lint .\`
4. Publish: \`trik publish\`

## Development

${devSection}

## Architecture

This trik uses the TrikHub v2 architecture:
- **Mode**: ${config.agentMode}
- **Domain**: ${domainStr}

${archSection}
`;
}

/** Convert camelCase to snake_case */
function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Generate a complete v2 Python trik project.
 *
 * @returns Map of { relativePath: fileContent } for all project files.
 */
export function generatePythonProject(config: InitConfig): Record<string, string> {
  const files: Record<string, string> = {};
  const pkg = toPythonPackage(config.name);

  // Core config files (at project root)
  files['manifest.json'] = generateManifest(config);
  files['trikhub.json'] = generateTrikhubJson(config);
  files['pyproject.toml'] = generatePyprojectToml(config);
  files['.gitignore'] = generateGitignore();
  files['README.md'] = generateReadme(config);

  // Python package files
  files[`src/${pkg}/__init__.py`] = '';
  files[`src/${pkg}/main.py`] = generateMainPy(config);

  if (config.agentMode === 'conversational') {
    files[`src/${pkg}/prompts/system.md`] = generateSystemPrompt(config);
  }

  return files;
}
