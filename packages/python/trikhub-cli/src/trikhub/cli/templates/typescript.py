"""TypeScript Trik Template Generator (v2).

Generates all files needed for a v2 TypeScript trik project.
Supports conversational and tool modes using the @trikhub/sdk.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any


@dataclass
class TsTemplateConfig:
    name: str
    display_name: str
    description: str
    author_name: str
    author_github: str
    category: str
    enable_storage: bool
    enable_config: bool
    agent_mode: str  # 'conversational' | 'tool'
    handoff_description: str = ""
    domain_tags: list[str] = field(default_factory=list)
    tool_names: list[str] = field(default_factory=list)


@dataclass
class GeneratedFile:
    path: str
    content: str


def generate_typescript_project(config: TsTemplateConfig) -> list[GeneratedFile]:
    files: list[GeneratedFile] = []

    files.append(GeneratedFile("manifest.json", _generate_manifest(config)))
    files.append(GeneratedFile("trikhub.json", _generate_trikhub_json(config)))
    files.append(GeneratedFile("package.json", _generate_package_json(config)))
    files.append(GeneratedFile("tsconfig.json", _generate_tsconfig()))
    files.append(GeneratedFile(".gitignore", _generate_gitignore()))

    if config.agent_mode == "conversational":
        files.append(GeneratedFile("src/agent.ts", _generate_conversational_agent(config)))
        files.append(GeneratedFile("src/tools/example.ts", _generate_example_tool_ts()))
        files.append(GeneratedFile("src/prompts/system.md", _generate_system_prompt(config)))
    else:
        files.append(GeneratedFile("src/agent.ts", _generate_tool_agent(config)))

    return files


def _generate_manifest(config: TsTemplateConfig) -> str:
    agent: dict[str, Any] = {
        "mode": config.agent_mode,
        "domain": config.domain_tags or [config.category],
    }

    if config.agent_mode == "conversational":
        agent["handoffDescription"] = config.handoff_description or config.description
        agent["systemPromptFile"] = "./src/prompts/system.md"
        agent["model"] = {"capabilities": ["tool_use"]}

    manifest: dict[str, Any] = {
        "schemaVersion": 2,
        "id": config.name,
        "name": config.display_name,
        "description": config.description,
        "version": "0.1.0",
        "agent": agent,
        "limits": {"maxTurnTimeMs": 30000},
        "entry": {
            "module": "./dist/agent.js",
            "export": "default",
            "runtime": "node",
        },
        "author": f"@{config.author_github}",
        "repository": f"https://github.com/{config.author_github}/{config.name}",
    }

    if config.agent_mode == "tool":
        tools: dict[str, Any] = {}
        for tool_name in (config.tool_names or ["exampleTool"]):
            tools[tool_name] = {
                "description": f"TODO: describe {tool_name}",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Input query"},
                    },
                    "required": ["query"],
                },
                "outputSchema": {
                    "type": "object",
                    "properties": {
                        "result": {
                            "type": "string",
                            "maxLength": 1000,
                            "pattern": "^.{0,1000}$",
                        },
                    },
                },
                "outputTemplate": "Result: {{result}}",
            }
        manifest["tools"] = tools
    else:
        manifest["tools"] = {
            "exampleTool": {
                "description": "An example tool",
            },
        }

    if config.enable_storage:
        manifest["capabilities"] = {
            "storage": {"enabled": True, "maxSizeBytes": 1048576, "persistent": True},
        }

    if config.enable_config:
        manifest["config"] = {
            "required": [{"key": "API_KEY", "description": "Your API key"}],
            "optional": [],
        }

    return json.dumps(manifest, indent=2) + "\n"


def _generate_trikhub_json(config: TsTemplateConfig) -> str:
    trikhub = {
        "displayName": config.display_name,
        "shortDescription": config.description,
        "categories": [config.category],
        "keywords": [config.name],
        "author": {
            "name": config.author_name,
            "github": config.author_github,
        },
        "repository": f"https://github.com/{config.author_github}/{config.name}",
    }
    return json.dumps(trikhub, indent=2) + "\n"


def _generate_package_json(config: TsTemplateConfig) -> str:
    deps: dict[str, str] = {"@trikhub/sdk": "^0.8.0"}
    if config.agent_mode == "conversational":
        deps.update({
            "@langchain/anthropic": "^0.3.0",
            "@langchain/core": "^0.3.0",
            "@langchain/langgraph": "^0.2.0",
            "zod": "^3.22.0",
        })

    pkg = {
        "name": f"@{config.author_github.lower()}/{config.name}",
        "version": "0.1.0",
        "description": config.description,
        "type": "module",
        "main": "dist/agent.js",
        "scripts": {
            "build": "tsc",
            "clean": "rm -rf dist",
        },
        "dependencies": deps,
        "devDependencies": {
            "@types/node": "^20.0.0",
            "typescript": "^5.6.0",
        },
        "engines": {"node": ">=20"},
    }
    return json.dumps(pkg, indent=2) + "\n"


def _generate_tsconfig() -> str:
    tsconfig = {
        "compilerOptions": {
            "target": "ES2022",
            "module": "NodeNext",
            "moduleResolution": "NodeNext",
            "outDir": "./dist",
            "rootDir": "./src",
            "strict": True,
            "esModuleInterop": True,
            "skipLibCheck": True,
            "declaration": True,
        },
        "include": ["src/**/*"],
        "exclude": ["node_modules", "dist"],
    }
    return json.dumps(tsconfig, indent=2) + "\n"


def _generate_conversational_agent(config: TsTemplateConfig) -> str:
    return f'''/**
 * {config.display_name} — conversational agent
 *
 * Uses LangGraph ReAct pattern with the TrikHub SDK.
 */

import {{ ChatAnthropic }} from '@langchain/anthropic';
import {{ createReactAgent }} from '@langchain/langgraph/prebuilt';
import {{ wrapAgent, transferBackTool }} from '@trikhub/sdk';
import type {{ TrikContext }} from '@trikhub/sdk';

import {{ exampleTool }} from './tools/example.js';

export default wrapAgent((context: TrikContext) => {{
  const model = new ChatAnthropic({{ modelName: 'claude-sonnet-4-20250514' }});
  const tools = [exampleTool, transferBackTool];

  return createReactAgent({{
    llm: model,
    tools,
  }});
}});
'''


def _generate_tool_agent(config: TsTemplateConfig) -> str:
    handlers: list[str] = []
    for tool_name in (config.tool_names or ["exampleTool"]):
        handlers.append(f"""  {tool_name}: async (input, context) => {{
    const query = (input as {{ query: string }}).query;
    return {{ result: `Processed: ${{query}}` }};
  }},""")

    handlers_str = "\n".join(handlers)
    return f'''/**
 * {config.display_name} — tool mode agent
 *
 * Exports native tools via wrapToolHandlers from the TrikHub SDK.
 */

import {{ wrapToolHandlers }} from '@trikhub/sdk';

export default wrapToolHandlers({{
{handlers_str}
}});
'''


def _generate_example_tool_ts() -> str:
    return '''/**
 * Example tool for the conversational agent.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const exampleTool = tool(
  async ({ query }) => {
    return `Result for: ${query}`;
  },
  {
    name: 'exampleTool',
    description: 'Search for information about a topic',
    schema: z.object({
      query: z.string().describe('The search query'),
    }),
  },
);
'''


def _generate_system_prompt(config: TsTemplateConfig) -> str:
    return f"""You are {config.display_name}, a helpful assistant.

{config.description}

When you have finished helping the user, use the transfer_back tool to return control to the main agent.
"""


def _generate_gitignore() -> str:
    return """node_modules/
dist/
*.log
.DS_Store
"""
