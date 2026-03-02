"""Python Trik Template Generator (v2).

Generates all files needed for a v2 Python trik project.
Supports conversational and tool modes using the trikhub SDK.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any


@dataclass
class PyTemplateConfig:
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


def _to_package_name(name: str) -> str:
    return name.replace("-", "_")


def _to_pascal_case(name: str) -> str:
    return "".join(part.capitalize() for part in name.split("-"))


def generate_python_project(config: PyTemplateConfig) -> list[GeneratedFile]:
    files: list[GeneratedFile] = []

    files.append(GeneratedFile("manifest.json", _generate_manifest(config)))
    files.append(GeneratedFile("trikhub.json", _generate_trikhub_json(config)))
    files.append(GeneratedFile("pyproject.toml", _generate_pyproject(config)))
    files.append(GeneratedFile("test.py", _generate_test_py(config)))
    files.append(GeneratedFile(".gitignore", _generate_gitignore()))

    if config.agent_mode == "conversational":
        files.append(GeneratedFile("src/agent.py", _generate_conversational_agent(config)))
        files.append(GeneratedFile("src/tools/example.py", _generate_example_tool()))
        files.append(GeneratedFile("src/prompts/system.md", _generate_system_prompt(config)))
    else:
        files.append(GeneratedFile("src/agent.py", _generate_tool_agent(config)))

    # Include manifest inside src/ so it's included in the pip wheel.
    # The gateway can discover it after `pip install`.
    files.append(GeneratedFile("src/manifest.json", _generate_package_manifest(config)))

    return files


def _generate_manifest(config: PyTemplateConfig) -> str:
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
            "module": "./src/agent.py",
            "export": "agent",
            "runtime": "python",
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


def _generate_package_manifest(config: PyTemplateConfig) -> str:
    """Generate a manifest for inclusion inside the pip wheel.

    Paths are adjusted to be relative to the src/ directory instead of the repo root.
    """
    manifest = json.loads(_generate_manifest(config))

    # Adjust entry.module to be relative to the package directory
    manifest["entry"]["module"] = "./agent.py"

    # Adjust systemPromptFile if present
    if "systemPromptFile" in manifest.get("agent", {}):
        manifest["agent"]["systemPromptFile"] = "./prompts/system.md"

    return json.dumps(manifest, indent=2) + "\n"


def _generate_trikhub_json(config: PyTemplateConfig) -> str:
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


def _generate_pyproject(config: PyTemplateConfig) -> str:
    deps = [
        '"trikhub>=0.6.0"',
    ]
    if config.agent_mode == "conversational":
        deps.extend([
            '"langchain-anthropic>=0.3.0"',
            '"langgraph>=0.2.0"',
        ])

    deps_str = ",\n    ".join(deps)

    return f'''[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "{config.name}"
version = "0.1.0"
description = "{config.description}"
readme = "README.md"
requires-python = ">=3.10"
license = {{text = "MIT"}}
authors = [
    {{ name = "{config.author_name}" }}
]
dependencies = [
    {deps_str},
]

[project.urls]
Repository = "https://github.com/{config.author_github}/{config.name}"

[tool.hatch.build.targets.wheel]
packages = ["src"]

[tool.hatch.build.targets.wheel.force-include]
"manifest.json" = "src/manifest.json"

[tool.hatch.build.targets.sdist]
include = [
    "src/**",
    "manifest.json",
    "trikhub.json",
    "README.md",
]
'''


def _generate_conversational_agent(config: PyTemplateConfig) -> str:
    class_name = _to_pascal_case(config.name)
    return f'''"""
{config.display_name} — conversational agent

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

    # Read system prompt from file (loaded by gateway via manifest.agent.systemPromptFile)
    tools = [example_tool, transfer_back_tool]

    return create_react_agent(
        model,
        tools=tools,
    )


# Export wrapped agent for the TrikHub worker
agent = wrap_agent(create_agent)
'''


def _generate_tool_agent(config: PyTemplateConfig) -> str:
    handlers: list[str] = []
    for tool_name in (config.tool_names or ["exampleTool"]):
        handlers.append(f'''    "{tool_name}": {_to_handler_name(tool_name)},''')

    func_defs: list[str] = []
    for tool_name in (config.tool_names or ["exampleTool"]):
        func_name = _to_handler_name(tool_name)
        func_defs.append(f'''
async def {func_name}(input_data: dict, context) -> dict:
    """Handle {tool_name} tool calls."""
    query = input_data.get("query", "")
    return {{"result": f"Processed: {{query}}"}}
''')

    handlers_str = "\n".join(handlers)
    func_defs_str = "\n".join(func_defs)

    return f'''"""
{config.display_name} — tool mode agent

Exports native tools via wrapToolHandlers from the TrikHub SDK.
"""

from __future__ import annotations

from trikhub.sdk import wrap_tool_handlers

{func_defs_str}

# Export wrapped tool handlers for the TrikHub worker
agent = wrap_tool_handlers({{
{handlers_str}
}})
'''


def _to_handler_name(tool_name: str) -> str:
    """Convert camelCase tool name to snake_case handler name."""
    result = []
    for i, char in enumerate(tool_name):
        if char.isupper() and i > 0:
            result.append("_")
        result.append(char.lower())
    return "handle_" + "".join(result)


def _generate_example_tool() -> str:
    return '''"""Example tool for the conversational agent."""

from langchain_core.tools import tool


@tool
def example_tool(query: str) -> str:
    """Search for information about a topic.

    Args:
        query: The search query.
    """
    return f"Result for: {query}"
'''


def _generate_system_prompt(config: PyTemplateConfig) -> str:
    return f"""You are {config.display_name}, a helpful assistant.

{config.description}

When you have finished helping the user, use the transfer_back tool to return control to the main agent.
"""


def _generate_test_py(config: PyTemplateConfig) -> str:
    if config.agent_mode == "tool":
        tool_name = (config.tool_names or ["exampleTool"])[0]
        handler_name = _to_handler_name(tool_name)
        return f'''"""Local test script — run with: python test.py"""

import asyncio
from src.agent import agent


async def main():
    result = await agent.execute_tool(
        "{tool_name}",
        {{"query": "hello world"}},
        context=None,
    )
    print(result)


if __name__ == "__main__":
    asyncio.run(main())
'''
    else:
        return f'''"""Local test script — run with: python test.py"""

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
'''


def _generate_gitignore() -> str:
    return """__pycache__/
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
"""
