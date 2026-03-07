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
    "rich>=13.0.0",
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
    return '''#!/usr/bin/env python3
"""CLI for the TrikHub-powered agent."""

from __future__ import annotations

import asyncio
import sys

from dotenv import load_dotenv

load_dotenv()

from agent import initialize_agent

pretty = "--no-pretty" not in sys.argv

if pretty:
    from rich.console import Console
    from rich.markdown import Markdown
    from rich.theme import Theme

    theme = Theme({"trik.name": "bold magenta", "trik.system": "dim italic", "trik.error": "bold red"})
    console = Console(theme=theme)


def render_response(result) -> None:
    if not pretty:
        if result.source == "system":
            print(f"\\n\\033[2m{result.message}\\033[0m\\n")
        elif result.source != "main":
            print(f"\\n[{result.source}] {result.message}\\n")
        else:
            print(f"\\nAssistant: {result.message}\\n")
        return

    if result.source == "system":
        console.print(f"  [trik.system]{result.message}[/]")
    elif result.source != "main":
        console.print(f"\\n  [trik.name]{result.source}[/]\\n")
        md = Markdown(result.message, code_theme="monokai")
        console.print(md, width=min(console.width, 100))
        console.print()
    else:
        console.print()
        md = Markdown(result.message, code_theme="monokai")
        console.print(md, width=min(console.width, 100))
        console.print()


async def main() -> None:
    if pretty:
        with console.status("Loading agent..."):
            app = await initialize_agent()
    else:
        print("Loading agent...\\n")
        app = await initialize_agent()

    status = None

    # Subscribe to gateway events for real-time status feedback
    def on_start(e):
        nonlocal status
        if pretty:
            status = console.status(f"  Connecting to {e[\'trikName\']}...")
            status.start()
        else:
            print(f"[{e[\'trikName\']}] Connecting...")

    def on_container(e):
        nonlocal status
        if pretty and status:
            status.update(f"  Starting {e[\'trikName\']} container...")
        elif not pretty:
            print(f"[{e[\'trikName\']}] Starting container...")

    def on_thinking(e):
        nonlocal status
        if pretty and status:
            status.update(f"  {e[\'trikName\']} is thinking...")
        elif not pretty:
            print(f"[{e[\'trikName\']}] Thinking...")

    def on_error(e):
        nonlocal status
        if status:
            status.stop()
            status = None
        if pretty:
            console.print(f"  [trik.error]\\u2716 [{e[\'trikName\']}] {e[\'error\']}[/]")
        else:
            print(f"[{e[\'trikName\']}] Error: {e[\'error\']}")

    def on_transfer_back(e):
        nonlocal status
        if status:
            status.stop()
            status = None
        if pretty:
            console.print(f"  [dim]\\u2190 {e[\'trikName\']} transferred back ({e[\'reason\']})[/]")
        else:
            print(f"[{e[\'trikName\']}] Transferred back ({e[\'reason\']})")

    app.gateway.on("handoff:start", on_start)
    app.gateway.on("handoff:container_start", on_container)
    app.gateway.on("handoff:thinking", on_thinking)
    app.gateway.on("handoff:error", on_error)
    app.gateway.on("handoff:transfer_back", on_transfer_back)

    loaded_triks = app.get_loaded_triks()
    if loaded_triks:
        if pretty:
            names = ", ".join(f"[cyan]{t}[/]" for t in loaded_triks)
            console.print(f"  [dim]Loaded triks:[/] {names}")
        else:
            print(f"Loaded triks: {\', \'.join(loaded_triks)}")
    if pretty:
        console.print("  [dim]Type /back to return from a trik, exit to quit.[/]\\n")
    else:
        print(\'Type "/back" to return from a trik handoff, "exit" to quit.\')
        print(\'Tip: Ask the Agent what to do next\\n\')

    session_id = f"cli-{id(app)}"

    while True:
        try:
            if pretty:
                user_input = console.input("[bold green]You:[/] ").strip()
            else:
                user_input = input("You: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\\n\\nGoodbye!")
            break

        if not user_input:
            continue
        if user_input.lower() in ("exit", "quit"):
            if pretty:
                console.print("\\n  [dim]Goodbye![/]\\n")
            else:
                print("\\nGoodbye!")
            break

        try:
            if status:
                status.stop()
                status = None
            result = await app.process_message(user_input, session_id)
            if status:
                status.stop()
                status = None
            render_response(result)
        except Exception as e:
            if status:
                status.stop()
                status = None
            if pretty:
                console.print(f"  [trik.error]Error: {e}[/]")
                console.print("  [dim]Please try again.[/]\\n")
            else:
                print(f"\\nError: {e}")
                print("Please try again.\\n")


if __name__ == "__main__":
    asyncio.run(main())
'''
