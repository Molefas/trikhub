"""trik init — scaffold a new trik project."""

from __future__ import annotations

import re
import sys
from pathlib import Path

import click

from trikhub.cli.config import load_defaults, save_defaults, TrikDefaults
from trikhub.cli.templates.python import (
    PyTemplateConfig,
    generate_python_project,
)
from trikhub.cli.templates.typescript import (
    TsTemplateConfig,
    generate_typescript_project,
)

CATEGORIES = [
    "utilities",
    "productivity",
    "developer",
    "data",
    "search",
    "content",
    "communication",
    "finance",
    "entertainment",
    "education",
    "other",
]

NAME_PATTERN = re.compile(r"^[a-z][a-z0-9-]*$")


def validate_name(name: str) -> str | None:
    if len(name) < 2 or len(name) > 50:
        return "Name must be 2-50 characters"
    if not NAME_PATTERN.match(name):
        return "Name must be lowercase, start with a letter, alphanumeric + dashes only"
    return None


@click.command("init")
@click.argument("language", type=click.Choice(["ts", "typescript", "py", "python"]))
def init_command(language: str) -> None:
    """Scaffold a new trik project."""
    lang = "ts" if language in ("ts", "typescript") else "py"

    click.echo()
    click.echo(click.style("  Create a new Trik", bold=True))
    click.echo()

    defaults = load_defaults()

    # Interactive prompts
    name = click.prompt("Trik name", default="my-trik").lower()
    error = validate_name(name)
    if error:
        click.echo(click.style(f"Error: {error}", fg="red"))
        sys.exit(1)

    default_display = " ".join(w.capitalize() for w in name.split("-"))
    display_name = click.prompt("Display name", default=default_display)
    description = click.prompt("Short description", default="A short description")
    author_name = click.prompt("Author name", default=defaults.author_name or "")
    author_github = click.prompt("GitHub username", default=defaults.author_github or "")

    # Category
    click.echo("\nCategories:")
    for i, cat in enumerate(CATEGORIES, 1):
        click.echo(f"  {i}. {cat}")
    cat_idx = click.prompt("Category (number)", type=int, default=1)
    category = CATEGORIES[max(0, min(cat_idx - 1, len(CATEGORIES) - 1))]

    enable_storage = click.confirm("Enable persistent storage?", default=False)
    enable_config = click.confirm("Enable configuration (env vars)?", default=False)

    # v2 agent mode
    click.echo("\nAgent mode:")
    click.echo("  1. conversational (multi-turn ReAct agent)")
    click.echo("  2. tool (export native tools to main agent)")
    mode_idx = click.prompt("Agent mode (number)", type=int, default=1)
    agent_mode = "conversational" if mode_idx == 1 else "tool"

    handoff_description = ""
    tool_names: list[str] = []

    if agent_mode == "conversational":
        handoff_description = click.prompt(
            "Handoff description (how should the main agent describe this trik?)",
        )
        if len(handoff_description) < 10:
            click.echo(click.style("Warning: handoff description should be >= 10 chars", fg="yellow"))
    else:
        raw = click.prompt(
            'Tool names (comma-separated, camelCase, e.g. "getWeather, getForecast")',
        )
        tool_names = [t.strip() for t in raw.split(",") if t.strip()]
        if not tool_names:
            click.echo(click.style("Error: at least one tool name is required", fg="red"))
            sys.exit(1)

    raw_tags = click.prompt(
        'Domain tags (comma-separated, e.g. "content curation, article writing")',
    )
    domain_tags = [t.strip() for t in raw_tags.split(",") if t.strip()]
    if not domain_tags:
        click.echo(click.style("Error: at least one domain tag is required", fg="red"))
        sys.exit(1)

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
    if lang == "py":
        config = PyTemplateConfig(
            name=name,
            display_name=display_name,
            description=description,
            author_name=author_name,
            author_github=author_github,
            category=category,
            enable_storage=enable_storage,
            enable_config=enable_config,
            agent_mode=agent_mode,
            handoff_description=handoff_description,
            domain_tags=domain_tags,
            tool_names=tool_names,
        )
        files = generate_python_project(config)
    else:
        config_ts = TsTemplateConfig(
            name=name,
            display_name=display_name,
            description=description,
            author_name=author_name,
            author_github=author_github,
            category=category,
            enable_storage=enable_storage,
            enable_config=enable_config,
            agent_mode=agent_mode,
            handoff_description=handoff_description,
            domain_tags=domain_tags,
            tool_names=tool_names,
        )
        files = generate_typescript_project(config_ts)

    # Write files
    for f in files:
        file_path = target_dir / f.path
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(f.content, encoding="utf-8")

    # Save author defaults
    save_defaults(TrikDefaults(author_name=author_name, author_github=author_github))

    click.echo(click.style("  Your trik is ready!", fg="green", bold=True))
    click.echo()
    click.echo(click.style("  Next steps:", dim=True))
    click.echo(f"    cd {name}")
    if lang == "py":
        click.echo("    pip install -e .")
        if agent_mode == "tool":
            click.echo("    Edit src/agent.py to implement your tool handlers")
        else:
            click.echo("    Edit src/agent.py to implement your agent logic")
            click.echo("    Add tools in src/tools/")
            click.echo("    Customize src/prompts/system.md")
    else:
        click.echo("    npm install && npm run build")
        if agent_mode == "tool":
            click.echo("    Edit src/agent.ts to implement your tool handlers")
        else:
            click.echo("    Edit src/agent.ts to implement your agent logic")
    click.echo("    trik publish")
    click.echo()
