"""trik login / logout / whoami — authentication commands."""

from __future__ import annotations

import asyncio
import sys
import time
import webbrowser

import click

from trikhub.cli.config import (
    GlobalConfig,
    is_auth_expired,
    read_global_config,
    write_global_config,
)
from trikhub.cli.registry import get_registry


@click.command("login")
def login_command() -> None:
    """Authenticate with TrikHub via GitHub."""

    async def _login():
        async with get_registry() as registry:
            try:
                device = await registry.start_device_auth()
            except (ConnectionError, RuntimeError) as e:
                click.echo(click.style(f"  Error: {e}", fg="red"))
                sys.exit(1)

            click.echo()
            click.echo("  Open this URL in your browser:")
            click.echo(click.style(f"  {device.verification_url}", fg="cyan", bold=True))
            click.echo()
            click.echo(f"  Enter code: {click.style(device.user_code, bold=True)}")
            click.echo()

            # Try to open browser
            try:
                webbrowser.open(device.verification_url)
            except Exception:
                pass

            click.echo("  Waiting for authorization...", nl=False)

            deadline = time.time() + device.expires_in
            while time.time() < deadline:
                await asyncio.sleep(device.interval)
                try:
                    result = await registry.poll_device_auth(device.device_code)
                except (ConnectionError, RuntimeError) as e:
                    click.echo(click.style(f"\n  Error: {e}", fg="red"))
                    sys.exit(1)

                if result is not None:
                    # Save credentials
                    config = read_global_config()
                    config.auth_token = result.access_token
                    config.auth_expires_at = result.expires_at
                    config.publisher_username = result.publisher.username
                    write_global_config(config)

                    click.echo()
                    click.echo(click.style(
                        f"\n  Logged in as @{result.publisher.username}",
                        fg="green",
                        bold=True,
                    ))
                    return

            click.echo(click.style("\n  Authorization timed out", fg="red"))
            sys.exit(1)

    asyncio.run(_login())


@click.command("logout")
def logout_command() -> None:
    """Log out of TrikHub."""

    async def _logout():
        async with get_registry() as registry:
            try:
                await registry.logout()
            except Exception:
                pass

    asyncio.run(_logout())

    config = read_global_config()
    config.auth_token = None
    config.auth_expires_at = None
    config.publisher_username = None
    write_global_config(config)

    click.echo("  Logged out.")


@click.command("whoami")
def whoami_command() -> None:
    """Show current authenticated user."""
    config = read_global_config()

    if not config.auth_token:
        click.echo("  Not logged in. Run `trik login`")
        return

    if is_auth_expired(config):
        click.echo(click.style("  Session expired. Run `trik login`", fg="yellow"))
        return

    async def _whoami():
        async with get_registry() as registry:
            try:
                user = await registry.get_current_user()
                verified = " (verified)" if user.verified else ""
                click.echo(f"  {user.display_name}")
                click.echo(f"  @{user.username}{verified}")
            except PermissionError:
                click.echo(click.style("  Session expired. Run `trik login`", fg="yellow"))
            except ConnectionError as e:
                click.echo(click.style(f"  Error: {e}", fg="red"))

    asyncio.run(_whoami())
