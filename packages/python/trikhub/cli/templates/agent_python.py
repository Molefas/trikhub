"""Python Agent Template Generator.

Generates a minimal Python agent project ready to consume triks
via TrikGateway. Mirrors agent_typescript.py but targets a Python
environment.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from trikhub.cli.templates.agent_typescript import CreateAgentConfig, GeneratedFile


_PROVIDERS: dict[str, dict[str, str]] = {
    "openai": {
        "importPath": "langchain_openai",
        "className": "ChatOpenAI",
        "pipPackage": "langchain-openai",
        "defaultModel": "gpt-4o-mini",
        "envVar": "OPENAI_API_KEY",
    },
    "anthropic": {
        "importPath": "langchain_anthropic",
        "className": "ChatAnthropic",
        "pipPackage": "langchain-anthropic",
        "defaultModel": "claude-sonnet-4-20250514",
        "envVar": "ANTHROPIC_API_KEY",
    },
    "google": {
        "importPath": "langchain_google_genai",
        "className": "ChatGoogleGenerativeAI",
        "pipPackage": "langchain-google-genai",
        "defaultModel": "gemini-2.0-flash",
        "envVar": "GOOGLE_API_KEY",
    },
}


def generate_agent_python_project(config: CreateAgentConfig) -> list[GeneratedFile]:
    files: list[GeneratedFile] = []
    provider = _PROVIDERS[config.provider]

    files.append(GeneratedFile("pyproject.toml", _generate_pyproject(config, provider)))
    files.append(GeneratedFile(".env.example", f"{provider['envVar']}=your-api-key-here\n"))
    files.append(GeneratedFile(".gitignore", _generate_gitignore()))
    files.append(GeneratedFile(".trikhub/config.json", json.dumps({"triks": []}, indent=2)))
    files.append(GeneratedFile("agent.py", _generate_agent_py(config, provider)))
    files.append(GeneratedFile("cli.py", _generate_cli_py()))

    return files


def _generate_pyproject(config: CreateAgentConfig, provider: dict[str, str]) -> str:
    return f"""[build-system]
requires = ["setuptools>=61.0", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "{config.name}"
version = "0.1.0"
description = "AI agent powered by TrikHub"
requires-python = ">=3.10"

dependencies = [
    "{provider['pipPackage']}>=1.0.0",
    "langchain-core>=0.3.0",
    "langgraph>=0.2.0",
    "trikhub>=0.6.0",
    "python-dotenv>=1.0.0",
]
"""


def _generate_gitignore() -> str:
    return """__pycache__/
*.pyc
*.egg-info/
dist/
build/
.venv/
.env
"""


def _generate_agent_py(config: CreateAgentConfig, provider: dict[str, str]) -> str:
    return f'''"""AI agent with TrikHub integration."""

from __future__ import annotations

from {provider['importPath']} import {provider['className']}
from langgraph.prebuilt import create_react_agent

from trikhub.gateway import TrikGateway
from trikhub.langchain import enhance, get_handoff_tools_for_agent, get_exposed_tools_for_agent

SYSTEM_PROMPT = """You are a helpful assistant.
When a trik can handle the user's request, use the appropriate tool."""


async def initialize_agent():
    model = {provider['className']}(model="{provider['defaultModel']}")

    gateway = TrikGateway()
    await gateway.initialize()
    await gateway.load_triks_from_config()

    handoff_tools = get_handoff_tools_for_agent(gateway)
    exposed_tools = get_exposed_tools_for_agent(gateway)

    agent = create_react_agent(
        model=model,
        tools=[*handoff_tools, *exposed_tools],
        prompt=SYSTEM_PROMPT,
    )

    app = await enhance(agent, gateway_instance=gateway)

    return app, handoff_tools, exposed_tools
'''


def _generate_cli_py() -> str:
    return (
        '#!/usr/bin/env python3\n'
        '"""CLI for the TrikHub-powered agent."""\n'
        '\n'
        'from __future__ import annotations\n'
        '\n'
        'import asyncio\n'
        '\n'
        'from dotenv import load_dotenv\n'
        '\n'
        'load_dotenv()\n'
        '\n'
        'from agent import initialize_agent\n'
        '\n'
        '\n'
        'async def main() -> None:\n'
        '    print("Loading agent...\\n")\n'
        '\n'
        '    app, handoff_tools, exposed_tools = await initialize_agent()\n'
        '\n'
        '    if handoff_tools:\n'
        "        print(f\"Handoff triks: {', '.join(t.name for t in handoff_tools)}\")\n"
        '    if exposed_tools:\n'
        "        print(f\"Tool-mode triks: {', '.join(t.name for t in exposed_tools)}\")\n"
        '    print(\'Type "/back" to return from a trik handoff, "exit" to quit.\\n\')\n'
        '\n'
        '    session_id = f"cli-{id(app)}"\n'
        '\n'
        '    while True:\n'
        '        try:\n'
        '            user_input = input("You: ").strip()\n'
        '        except (KeyboardInterrupt, EOFError):\n'
        '            print("\\n\\nGoodbye!")\n'
        '            break\n'
        '\n'
        '        if not user_input:\n'
        '            continue\n'
        '        if user_input.lower() in ("exit", "quit"):\n'
        '            print("\\nGoodbye!")\n'
        '            break\n'
        '\n'
        '        try:\n'
        '            result = await app.process_message(user_input, session_id)\n'
        '\n'
        '            if result.source == "system":\n'
        '                print(f"\\n\\033[2m{result.message}\\033[0m\\n")\n'
        '            elif result.source != "main":\n'
        '                print(f"\\n[{result.source}] {result.message}\\n")\n'
        '            else:\n'
        '                print(f"\\nAssistant: {result.message}\\n")\n'
        '        except Exception as e:\n'
        '            print(f"\\nError: {e}")\n'
        '            print("Please try again.\\n")\n'
        '\n'
        '\n'
        'if __name__ == "__main__":\n'
        '    asyncio.run(main())\n'
    )
