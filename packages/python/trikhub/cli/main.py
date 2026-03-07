"""TrikHub CLI — scaffold, install, and publish triks.

Usage:
    trik init ts|py            Initialize a new trik project
    trik create-agent ts|py    Scaffold a minimal agent project
    trik install @scope/name   Install a trik from the registry or pip
    trik uninstall @scope/name Uninstall a trik
    trik lint [path]           Validate a trik for security and correctness
    trik list                  List installed triks
    trik sync                  Discover triks in site-packages
    trik search query          Search for triks in the registry
    trik info @scope/name      Show trik details
    trik login                 Authenticate with TrikHub via GitHub
    trik logout                Log out of TrikHub
    trik whoami                Show current authenticated user
    trik publish               Publish a trik to the registry
    trik unpublish @scope/name Permanently remove a trik from the registry
"""

from __future__ import annotations

import os

import click

from trikhub.cli.commands.init import init_command
from trikhub.cli.commands.create_agent import create_agent_command
from trikhub.cli.commands.install import install_command, uninstall_command
from trikhub.cli.commands.lint import lint_command
from trikhub.cli.commands.list import list_command, sync_command
from trikhub.cli.commands.login import login_command, logout_command, whoami_command
from trikhub.cli.commands.publish import publish_command, unpublish_command
from trikhub.cli.commands.search import info_command, search_command


@click.group()
@click.version_option(version="0.18.0", prog_name="trik")
@click.option("--dev", is_flag=True, help="Use development registry (localhost:3001)")
@click.pass_context
def cli(ctx: click.Context, dev: bool) -> None:
    """TrikHub CLI — scaffold, install, and publish triks."""
    ctx.ensure_object(dict)
    ctx.obj["dev"] = dev
    if dev:
        os.environ["TRIKHUB_ENV"] = "development"


# Register commands
cli.add_command(init_command)
cli.add_command(create_agent_command)
cli.add_command(install_command)
cli.add_command(lint_command)
cli.add_command(uninstall_command)
cli.add_command(list_command)
cli.add_command(sync_command)
cli.add_command(search_command)
cli.add_command(info_command)
cli.add_command(login_command)
cli.add_command(logout_command)
cli.add_command(whoami_command)
cli.add_command(publish_command)
cli.add_command(unpublish_command)


if __name__ == "__main__":
    cli()
