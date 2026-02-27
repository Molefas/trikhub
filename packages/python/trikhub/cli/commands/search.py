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

    async def _info():
        async with get_registry() as registry:
            try:
                trik = await registry.get_trik(package)
            except ConnectionError as e:
                click.echo(click.style(f"  Error: {e}", fg="red"))
                sys.exit(1)

            if not trik:
                click.echo(click.style(f"  Trik not found: {package}", fg="red"))
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

            click.echo()
            click.echo(click.style(f"  {trik.full_name}", bold=True))
            if trik.description:
                click.echo(f"  {trik.description}")
            click.echo()
            click.echo(f"  Latest: v{trik.latest_version}")
            click.echo(f"  Runtime: {trik.runtime}")
            if trik.github_repo:
                click.echo(f"  Repo: https://github.com/{trik.github_repo}")
            click.echo(f"  Downloads: {_format_number(trik.downloads)}")
            if trik.verified:
                click.echo(click.style("  Verified", fg="green"))
            if trik.categories:
                click.echo(f"  Categories: {', '.join(trik.categories)}")

            if trik.versions:
                click.echo(f"\n  Versions ({len(trik.versions)}):")
                for v in trik.versions[:5]:
                    click.echo(f"    v{v.version} ({v.published_at[:10] if v.published_at else 'N/A'})")
                if len(trik.versions) > 5:
                    click.echo(f"    ... and {len(trik.versions) - 5} more")
            click.echo()

    asyncio.run(_info())
