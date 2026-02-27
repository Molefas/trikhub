"""trik search / info — browse the registry."""

from __future__ import annotations

import asyncio
import json
import sys

import click

from trikhub.cli.registry import get_registry


def _format_number(num: int) -> str:
    if num >= 1_000_000:
        return f"{num / 1_000_000:.1f}M"
    if num >= 1_000:
        return f"{num / 1_000:.1f}K"
    return str(num)


@click.command("search")
@click.argument("query")
@click.option("-j", "--json-output", "as_json", is_flag=True, help="Output as JSON")
@click.option("-l", "--limit", default=10, help="Max results", type=int)
@click.option("--runtime", default=None, help="Filter by runtime (python/node)")
def search_command(query: str, as_json: bool, limit: int, runtime: str | None) -> None:
    """Search for triks in the registry."""
    from trikhub.cli.config import read_config
    from trikhub.cli.output import info

    async def _search():
        async with get_registry() as registry:
            try:
                result = await registry.search(query, per_page=limit, runtime=runtime)
            except ConnectionError as e:
                click.echo(click.style(f"  Error: {e}", fg="red"))
                sys.exit(1)

            if as_json:
                data = [{
                    "name": t.full_name,
                    "description": t.description,
                    "version": t.latest_version,
                    "runtime": t.runtime,
                    "downloads": t.downloads,
                } for t in result.results]
                click.echo(json.dumps(data, indent=2))
                return

            if not result.results:
                click.echo(click.style(f'\nNo triks found for "{query}"\n', fg="yellow"))
                info("Try a different search term or browse all triks at https://trikhub.com")
                return

            # Check installed triks for badge
            config = read_config()
            installed_triks = set(config.triks)

            click.echo(
                click.style(f"\nFound {result.total} trik{'s' if result.total != 1 else ''}:\n", bold=True)
            )

            for trik in result.results:
                installed = trik.full_name in installed_triks
                installed_badge = click.style(" [installed]", fg="green") if installed else ""
                verified_badge = click.style(" \u2713", fg="blue") if trik.verified else ""

                click.echo(f"  {click.style(trik.full_name, fg='cyan')}{verified_badge}{installed_badge}")
                if trik.description:
                    click.echo(click.style(f"  {trik.description}", dim=True))
                click.echo(click.style(
                    f"  v{trik.latest_version} \u00b7 \u2b07 {_format_number(trik.downloads)} \u00b7 \u2b50 {trik.stars}",
                    dim=True,
                ))
                click.echo()

            if result.total > len(result.results):
                click.echo(click.style(
                    f"Showing {len(result.results)} of {result.total} results. Use --limit to see more.",
                    dim=True,
                ))

            click.echo(click.style("\nInstall with: trik install @scope/name", dim=True))

    asyncio.run(_search())


@click.command("info")
@click.argument("package")
@click.option("-j", "--json-output", "as_json", is_flag=True, help="Output as JSON")
def info_command(package: str, as_json: bool) -> None:
    """Show detailed information about a trik."""
    from trikhub.cli.config import read_config
    from trikhub.cli.output import ok

    async def _info():
        async with get_registry() as registry:
            try:
                trik = await registry.get_trik(package)
            except ConnectionError as e:
                click.echo(click.style(f"  Error: {e}", fg="red"))
                sys.exit(1)

            if not trik:
                click.echo(click.style(f"\nTrik {package} not found in registry\n", fg="red"))
                sys.exit(1)

            if as_json:
                data = {
                    "name": trik.full_name,
                    "description": trik.description,
                    "version": trik.latest_version,
                    "runtime": trik.runtime,
                    "github_repo": trik.github_repo,
                    "downloads": trik.downloads,
                    "stars": trik.stars,
                    "verified": trik.verified,
                    "versions": [
                        {"version": v.version, "published_at": v.published_at}
                        for v in trik.versions
                    ],
                }
                click.echo(json.dumps(data, indent=2))
                return

            # Header
            click.echo()
            name_str = click.style(trik.full_name, fg="cyan", bold=True)
            verified_str = click.style(" \u2713 Verified", fg="blue") if trik.verified else ""
            click.echo(f"{name_str}{verified_str}")
            if trik.description:
                click.echo(click.style(trik.description, dim=True))
            click.echo()

            # Install status
            config = read_config()
            is_installed = trik.full_name in config.triks
            installed_version = config.trikhub.get(trik.full_name)
            if is_installed:
                ok(f"Installed (v{installed_version or 'unknown'})")
                click.echo()

            # Stats
            click.echo(click.style("Stats", bold=True))
            click.echo(f"  Latest version: {click.style(trik.latest_version, fg='cyan')}")
            click.echo(f"  Downloads: {_format_number(trik.downloads)}")
            click.echo(f"  Stars: {trik.stars}")
            click.echo()

            # Categories
            if trik.categories:
                click.echo(click.style("Categories", bold=True))
                click.echo(f"  {', '.join(trik.categories)}")
                click.echo()

            if trik.keywords:
                click.echo(click.style("Keywords", bold=True))
                click.echo(f"  {', '.join(trik.keywords)}")
                click.echo()

            # Links
            click.echo(click.style("Links", bold=True))
            if trik.github_repo:
                click.echo(f"  GitHub: https://github.com/{trik.github_repo}")
            click.echo()

            # Versions
            if trik.versions:
                click.echo(click.style("Versions", bold=True))
                for v in trik.versions[:5]:
                    date_str = v.published_at[:10] if v.published_at else "N/A"
                    latest = click.style(" (latest)", fg="green") if v.version == trik.latest_version else ""
                    click.echo(
                        f"  {click.style(v.version, fg='cyan')}{latest}"
                        f" - {click.style(date_str, dim=True)}"
                        f" - {_format_number(v.downloads)} downloads"
                    )
                if len(trik.versions) > 5:
                    click.echo(click.style(f"  ... and {len(trik.versions) - 5} more versions", dim=True))
                click.echo()

            # Install command
            if not is_installed:
                click.echo(click.style("Install", bold=True))
                click.echo(f"  {click.style(f'trik install {trik.full_name}', fg='cyan')}")
                click.echo()

    asyncio.run(_info())
