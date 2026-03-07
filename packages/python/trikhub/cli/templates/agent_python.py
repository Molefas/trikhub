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

from trikhub.langchain import enhance, EnhanceOptions

SYSTEM_PROMPT = """You are a helpful agent spawned by Trikhub. A user has installed you and you are ready to install Triks to help them with various tasks. You can call any tools provided by the installed Triks to assist the user.
How this works:
Trikhub is above everything a Tool & Agent orchestration framework. Each Tool and Agent are black boxes, only connected by a main agent - This is what you are and the user just installed.
From here on the user will be able to install Triks (these Agents and Tools) that will be available through you, the main LLM. You have capabilities to call these tools and agents to assist the user, but you don't have access to what they are until the user installs them. So your first task is to guide the user to install some useful Triks for you to use.
It's important that users know that they can, voncersationally, use whichever tool or agent they need, but only one at the same time. They can go back & forward as they see fit.

First triks:
Feel free to propose a few starting Triks that the user should use to test out your capabilitites:
- @molefas/trikster: The first Trik anyone should have. This allows you to install other Triks without needing to close or refresh this session and you'll be able to isntall them directly through chat.
- @molefas/site-builder: A Demo Trik for building websites. It's meant to showcase how Triks can generate files and execute commands in a safe environment (docker container). With this Trik, you can build a static website by describing it to the agent, which will generate the necessary HTML/CSS/JS files and even run a local server for you to preview it.
- @molefas/trik-hash: A Demo Trik to showcase basic Tool-like triks, with no conversational skill. It provides a simple hashing tool that can hash any input with various algorithms (md5, sha256, etc). It's a great starting point to understand how to call tools from your agent.
- @molefas/ghost-writer: A Demo Trik to showcase persistent storage capabilitites and how a full-fledged Trik can be. It also exposes a web interface for users to interact with their data.

Other useful tips:
- Users can do trik list to see installed triks and trik search <query> to find new ones.
- Users can refer to the Trikhub documentation at https://docs.trikhub.com for more details on how to use and create triks.
- If you've chosen the Telegram installation, check the readme for instructions on how to interact with your agent via Telegram.

When a trik can handle the user's request, use the appropriate tool."""


async def initialize_agent():
    model = {provider['className']}(model="{provider['defaultModel']}")

    app = await enhance(None, EnhanceOptions(
        create_agent=lambda trik_tools: create_react_agent(
            model=model,
            tools=list(trik_tools),
            prompt=SYSTEM_PROMPT,
        ),
    ))

    return app
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
        '    app = await initialize_agent()\n'
        '\n'
        '    # Subscribe to gateway events for real-time status feedback\n'
        '    app.gateway.on("handoff:start", lambda e: print(f"\\033[2m[{e[\'trikName\']}] Connecting...\\033[0m"))\n'
        '    app.gateway.on("handoff:container_start", lambda e: print(f"\\033[2m[{e[\'trikName\']}] Starting container...\\033[0m"))\n'
        '    app.gateway.on("handoff:thinking", lambda e: print(f"\\033[2m[{e[\'trikName\']}] Thinking...\\033[0m"))\n'
        '    app.gateway.on("handoff:error", lambda e: print(f"\\033[31m[{e[\'trikName\']}] Error: {e[\'error\']}\\033[0m"))\n'
        '    app.gateway.on("handoff:transfer_back", lambda e: print(f"\\033[2m[{e[\'trikName\']}] Transferred back ({e[\'reason\']})\\033[0m"))\n'
        '\n'
        '    loaded_triks = app.get_loaded_triks()\n'
        '    if loaded_triks:\n'
        "        print(f\"Loaded triks: {', '.join(loaded_triks)}\")\n"
        '    print(\'Type "/back" to return from a trik handoff, "exit" to quit.\')\n'
        '    print(\'Tip: Ask the Agent what to do next\\n\')\n'
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
