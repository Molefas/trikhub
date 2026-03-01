"""trik create-agent — scaffold a minimal agent project."""

from __future__ import annotations

import re
import sys
from pathlib import Path

import click

from trikhub.cli.templates.agent_typescript import (
    CreateAgentConfig,
    generate_agent_typescript_project,
)
from trikhub.cli.templates.agent_python import generate_agent_python_project

NAME_PATTERN = re.compile(r"^[a-z][a-z0-9-]*$")

PROVIDERS = [
    ("openai", "OpenAI (gpt-4o-mini)"),
    ("anthropic", "Anthropic (claude-sonnet)"),
    ("google", "Google (gemini-2.0-flash)"),
]


def validate_name(name: str) -> str | None:
    if len(name) < 2 or len(name) > 50:
        return "Name must be 2-50 characters"
    if not NAME_PATTERN.match(name):
        return "Name must be lowercase, start with a letter, alphanumeric + dashes only"
    return None


@click.command("create-agent")
@click.argument("language", type=click.Choice(["ts", "typescript", "py", "python"]))
def create_agent_command(language: str) -> None:
    """Scaffold a minimal agent project ready to consume triks."""
    lang = "ts" if language in ("ts", "typescript") else "py"

    click.echo()
    click.echo(click.style("  Create a new Agent", bold=True))
    click.echo()

    # Project name
    name = click.prompt("Project name", default="my-agent").lower()
    error = validate_name(name)
    if error:
        click.echo(click.style(f"Error: {error}", fg="red"))
        sys.exit(1)

    # LLM provider
    click.echo("\nLLM Provider:")
    for i, (_, label) in enumerate(PROVIDERS, 1):
        click.echo(f"  {i}. {label}")
    provider_idx = click.prompt("Provider (number)", type=int, default=1)
    provider = PROVIDERS[max(0, min(provider_idx - 1, len(PROVIDERS) - 1))][0]

    # Path
    target_dir = Path.cwd() / name
    use_current = click.confirm(f"Create in ./{name}?", default=True)
    if not use_current:
        custom = click.prompt("Enter path", default=f"./{name}")
        target_dir = Path.cwd() / custom

    if target_dir.exists():
        click.echo(click.style(f"\nDirectory already exists: {target_dir}", fg="red"))
        sys.exit(1)

    click.echo()

    # Generate files
    config = CreateAgentConfig(name=name, provider=provider)

    if lang == "ts":
        files = generate_agent_typescript_project(config)
    else:
        files = generate_agent_python_project(config)

    # Write files
    for f in files:
        file_path = target_dir / f.path
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(f.content, encoding="utf-8")

    click.echo(click.style("  Your agent is ready!", fg="green", bold=True))
    click.echo()
    click.echo(click.style("  Next steps:", dim=True))
    click.echo(f"    cd {name}")
    click.echo("    cp .env.example .env")
    click.echo("    # Add your API key to .env")

    if lang == "py":
        click.echo("    python -m venv .venv && source .venv/bin/activate")
        click.echo("    pip install -e .")
        click.echo("    python cli.py")
    else:
        click.echo("    npm install && npm run dev")

    click.echo()
    click.echo(click.style("  Install triks:", dim=True))
    click.echo("    trik install @scope/trik-name")
    click.echo()
