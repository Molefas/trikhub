"""
TrikHub CLI - Command-line interface for managing Python triks.

Usage:
    trikhub install @scope/name   Install a trik from the registry or pip
    trikhub uninstall @scope/name Uninstall a trik
    trikhub list                  List installed triks
    trikhub sync                  Discover triks in site-packages
    trikhub search query          Search for triks in the registry
    trikhub info @scope/name      Show trik details
"""

from __future__ import annotations

import asyncio
import subprocess
import sys
from pathlib import Path
from typing import Any

import click

from trikhub.cli.config import (
    add_trik_to_config,
    is_trik_installed,
    read_config,
    remove_trik_from_config,
)
from trikhub.cli.discovery import (
    discover_triks_in_directory,
    discover_triks_in_site_packages,
    get_package_info,
)
from trikhub.cli.registry import RegistryClient, TrikInfo, get_registry


# ============================================================================
# Helpers
# ============================================================================


def format_number(num: int) -> str:
    """Format a number with K/M suffixes."""
    if num >= 1_000_000:
        return f"{num / 1_000_000:.1f}M"
    if num >= 1_000:
        return f"{num / 1_000:.1f}K"
    return str(num)


def run_pip(args: list[str], capture: bool = False) -> subprocess.CompletedProcess[str]:
    """Run a pip command."""
    cmd = [sys.executable, "-m", "pip"] + args
    if capture:
        return subprocess.run(cmd, capture_output=True, text=True)
    return subprocess.run(cmd)


def print_trik_info(trik: TrikInfo, installed: bool = False) -> None:
    """Print formatted trik information."""
    installed_badge = click.style(" [installed]", fg="green") if installed else ""
    verified_badge = click.style(" \u2713", fg="blue") if trik.verified else ""
    runtime_badge = click.style(f" [{trik.runtime}]", fg="yellow")

    click.echo(f"  {click.style(trik.full_name, fg='cyan')}{verified_badge}{runtime_badge}{installed_badge}")
    click.echo(f"  {click.style(trik.description, dim=True)}")
    click.echo(
        click.style(
            f"  v{trik.latest_version} \u00b7 \u2b07 {format_number(trik.downloads)} \u00b7 \u2b50 {trik.stars}",
            dim=True,
        )
    )
    click.echo()


# ============================================================================
# CLI Group
# ============================================================================


@click.group()
@click.version_option(version="0.1.0", prog_name="trikhub")
@click.option("--dev", is_flag=True, help="Use development registry (localhost:3001)")
@click.pass_context
def cli(ctx: click.Context, dev: bool) -> None:
    """TrikHub CLI - Manage Python AI skills (triks)."""
    ctx.ensure_object(dict)
    ctx.obj["dev"] = dev
    if dev:
        import os
        os.environ["TRIKHUB_ENV"] = "development"


# ============================================================================
# Install Command
# ============================================================================


@cli.command()
@click.argument("package")
@click.option("-v", "--version", "pkg_version", help="Install a specific version")
@click.option("--pip", "use_pip", is_flag=True, help="Install from pip (not registry)")
@click.pass_context
def install(ctx: click.Context, package: str, pkg_version: str | None, use_pip: bool) -> None:
    """Install a trik from the registry or pip.

    Examples:
        trikhub install @acme/article-search
        trikhub install @acme/article-search --version 1.0.0
        trikhub install my-trik-package --pip
    """
    # Parse package name and version
    package_name = package
    version_spec = pkg_version

    # Handle @scope/name@version format
    if "@" in package and not package.startswith("@"):
        at_idx = package.rfind("@")
        package_name = package[:at_idx]
        version_spec = version_spec or package[at_idx + 1 :]
    elif package.startswith("@") and package.count("@") > 1:
        # @scope/name@version
        at_idx = package.rfind("@")
        package_name = package[:at_idx]
        version_spec = version_spec or package[at_idx + 1 :]

    if use_pip:
        # Direct pip install
        _install_from_pip(package_name, version_spec)
    else:
        # Try registry first, then pip
        asyncio.run(_install_from_registry_or_pip(package_name, version_spec))


def _install_from_pip(package_name: str, version_spec: str | None) -> None:
    """Install a package from pip."""
    click.echo(f"Installing {click.style(package_name, fg='cyan')} from pip...")

    pip_spec = f"{package_name}=={version_spec}" if version_spec else package_name
    result = run_pip(["install", pip_spec])

    if result.returncode != 0:
        click.echo(click.style(f"Failed to install {package_name}", fg="red"))
        sys.exit(1)

    # Check if it's a trik and register it
    pkg_info = get_package_info(package_name)
    if pkg_info:
        # Discover if it's a trik
        discovered = discover_triks_in_site_packages()
        for trik in discovered:
            if trik.package_name == package_name or trik.trik_id == package_name:
                add_trik_to_config(
                    trik.trik_id,
                    runtime=trik.runtime,
                )
                click.echo(click.style(f"\u2713 Registered {trik.trik_id} as a trik", fg="green"))
                return

    click.echo(click.style(f"\u2713 Installed {package_name}", fg="green"))


async def _install_from_registry_or_pip(package_name: str, version_spec: str | None) -> None:
    """Install from TrikHub registry, falling back to pip."""
    click.echo(f"Looking for {click.style(package_name, fg='cyan')}...")

    async with RegistryClient() as registry:
        try:
            trik_info = await registry.get_trik(package_name)

            if trik_info:
                click.echo(f"Found on TrikHub registry: {click.style(trik_info.full_name, fg='cyan')}")

                # Determine version to install
                version_to_install = version_spec or trik_info.latest_version

                # Check if it's a Python trik
                if trik_info.runtime == "python":
                    # Install via pip using GitHub URL
                    version_info = None
                    for v in trik_info.versions:
                        if v.version == version_to_install:
                            version_info = v
                            break

                    if not version_info:
                        click.echo(click.style(f"Version {version_to_install} not found", fg="red"))
                        sys.exit(1)

                    # Install from GitHub
                    git_url = f"git+https://github.com/{trik_info.github_repo}@{version_info.git_tag}"
                    click.echo(f"Installing from GitHub: {click.style(git_url, dim=True)}")

                    result = run_pip(["install", git_url])
                    if result.returncode != 0:
                        click.echo(click.style("Installation failed", fg="red"))
                        sys.exit(1)

                    # Register the trik
                    add_trik_to_config(
                        trik_info.full_name,
                        trikhub_version=version_to_install,
                        runtime="python",
                    )

                    # Report download
                    await registry.report_download(package_name, version_to_install)

                    click.echo(click.style(f"\u2713 Installed {trik_info.full_name}@{version_to_install}", fg="green"))
                    return
                else:
                    click.echo(
                        click.style(
                            f"Note: {package_name} is a Node.js trik. "
                            "Use 'trik install' from the Node CLI instead.",
                            fg="yellow",
                        )
                    )
                    sys.exit(1)

        except FileNotFoundError:
            pass  # Not in registry, try pip
        except ConnectionError as e:
            click.echo(click.style(f"Warning: Could not connect to registry: {e}", fg="yellow"))
            click.echo("Trying pip...")

    # Fall back to pip
    _install_from_pip(package_name, version_spec)


# ============================================================================
# Uninstall Command
# ============================================================================


@cli.command()
@click.argument("package")
def uninstall(package: str) -> None:
    """Uninstall a trik.

    Examples:
        trikhub uninstall @acme/article-search
        trikhub uninstall my-trik-package
    """
    # Parse package name (remove version if present)
    package_name = package
    if "@" in package and not package.startswith("@"):
        package_name = package[: package.rfind("@")]
    elif package.startswith("@") and package.count("@") > 1:
        package_name = package[: package.rfind("@")]

    # Remove from config
    click.echo(f"Removing {click.style(package_name, fg='cyan')} from config...")
    was_in_config = remove_trik_from_config(package_name)

    if was_in_config:
        click.echo(click.style(f"\u2713 Removed from .trikhub/config.json", fg="green"))
    else:
        click.echo(click.style(f"Note: {package_name} was not in config", fg="yellow"))

    # Try to uninstall from pip
    # Convert scoped name to pip package name if needed
    pip_name = package_name.replace("@", "").replace("/", "-")
    click.echo(f"Uninstalling package...")

    result = run_pip(["uninstall", "-y", pip_name], capture=True)

    if result.returncode == 0:
        click.echo(click.style(f"\u2713 Uninstalled {package_name}", fg="green"))
    else:
        # Package might not be installed via pip
        click.echo(click.style(f"Note: Package not found in pip", fg="yellow"))


# ============================================================================
# List Command
# ============================================================================


@cli.command(name="list")
@click.option("-j", "--json", "as_json", is_flag=True, help="Output as JSON")
@click.option("--runtime", type=click.Choice(["python", "node"]), help="Filter by runtime")
def list_triks(as_json: bool, runtime: str | None) -> None:
    """List installed triks.

    Shows all triks registered in .trikhub/config.json.
    """
    import json

    config = read_config()

    if as_json:
        triks_data: list[dict[str, Any]] = []
        for trik_name in config.triks:
            trik_runtime = config.runtimes.get(trik_name, "python")
            if runtime and trik_runtime != runtime:
                continue
            pkg_info = get_package_info(trik_name.replace("@", "").replace("/", "-"))
            triks_data.append({
                "name": trik_name,
                "version": pkg_info.get("version", "unknown") if pkg_info else "unknown",
                "runtime": trik_runtime,
                "exists": pkg_info is not None,
            })
        click.echo(json.dumps({"triks": triks_data}, indent=2))
        return

    if not config.triks:
        click.echo(click.style("No triks installed.", fg="yellow"))
        click.echo()
        click.echo(click.style("Use 'trikhub install @scope/name' to install a trik", dim=True))
        click.echo(click.style("Use 'trikhub sync' to discover triks in site-packages", dim=True))
        return

    # Filter by runtime if specified
    filtered_triks = []
    for trik_name in config.triks:
        trik_runtime = config.runtimes.get(trik_name, "python")
        if runtime and trik_runtime != runtime:
            continue
        filtered_triks.append((trik_name, trik_runtime))

    click.echo(click.style(f"\nInstalled triks ({len(filtered_triks)}):\n", bold=True))

    for trik_name, trik_runtime in filtered_triks:
        # Get package info
        pip_name = trik_name.replace("@", "").replace("/", "-")
        pkg_info = get_package_info(pip_name)

        exists = pkg_info is not None
        status = click.style("\u25cf", fg="green") if exists else click.style("\u25cb", fg="red")
        name = click.style(trik_name, fg="cyan")
        version = click.style(f"v{pkg_info.get('version', 'unknown')}" if pkg_info else "v?", dim=True)
        runtime_badge = click.style(f"[{trik_runtime}]", fg="yellow")

        click.echo(f"  {status} {name} {version} {runtime_badge}")

        if pkg_info and pkg_info.get("description"):
            click.echo(click.style(f"      {pkg_info['description']}", dim=True))

        if not exists:
            click.echo(
                click.style(
                    f"      \u26a0 Not installed! Run 'trikhub install {trik_name}'",
                    fg="red",
                )
            )

        click.echo()


# ============================================================================
# Sync Command
# ============================================================================


@cli.command()
@click.option("-n", "--dry-run", is_flag=True, help="Show what would be synced")
@click.option("-j", "--json", "as_json", is_flag=True, help="Output as JSON")
@click.option("-d", "--directory", help="Directory to scan for triks")
def sync(dry_run: bool, as_json: bool, directory: str | None) -> None:
    """Discover triks in site-packages and add to config.

    This command scans installed Python packages for triks (packages with
    a manifest.json) and registers them in .trikhub/config.json.

    Examples:
        trikhub sync                    # Scan site-packages
        trikhub sync --directory ./triks  # Scan specific directory
        trikhub sync --dry-run          # Preview changes
    """
    import json

    click.echo("Scanning for triks...")

    # Discover triks
    if directory:
        discovered = discover_triks_in_directory(Path(directory))
    else:
        discovered = discover_triks_in_site_packages()

    if not discovered:
        click.echo(click.style("No triks found.", fg="yellow"))
        click.echo()
        click.echo(click.style("Triks are Python packages with a manifest.json file.", dim=True))
        return

    click.echo(click.style(f"Found {len(discovered)} trik(s)", fg="green"))

    # Read current config
    config = read_config()
    current_triks = set(config.triks)

    added: list[str] = []
    already_configured: list[str] = []

    for trik in discovered:
        if trik.trik_id in current_triks:
            already_configured.append(trik.trik_id)
        else:
            added.append(trik.trik_id)

    if as_json:
        result = {
            "added": added,
            "alreadyConfigured": already_configured,
            "total": len(discovered),
        }
        click.echo(json.dumps(result, indent=2))
        return

    if not added:
        click.echo(click.style("\n\u2713 All discovered triks are already configured.", fg="green"))
        return

    if dry_run:
        click.echo(click.style("\nDry run - would add the following triks to config:\n", fg="yellow"))
        for trik_id in added:
            click.echo(click.style(f"  + {trik_id}", fg="cyan"))
    else:
        # Update config
        for trik in discovered:
            if trik.trik_id in added:
                add_trik_to_config(trik.trik_id, runtime=trik.runtime)

        click.echo(click.style("\nAdded to .trikhub/config.json:\n", fg="green"))
        for trik_id in added:
            click.echo(click.style(f"  + {trik_id}", fg="cyan"))

    if already_configured:
        click.echo(click.style("\nAlready configured:", dim=True))
        for trik_id in already_configured:
            click.echo(click.style(f"  = {trik_id}", dim=True))

    click.echo(click.style(f"\nTotal: {len(discovered)} trik(s), {len(added)} added", dim=True))


# ============================================================================
# Search Command
# ============================================================================


@cli.command()
@click.argument("query")
@click.option("-j", "--json", "as_json", is_flag=True, help="Output as JSON")
@click.option("-l", "--limit", default=10, help="Limit results")
@click.option("--runtime", type=click.Choice(["python", "node"]), help="Filter by runtime")
def search(query: str, as_json: bool, limit: int, runtime: str | None) -> None:
    """Search for triks in the registry.

    Examples:
        trikhub search article
        trikhub search "web scraping" --runtime python
        trikhub search ai --limit 20
    """
    asyncio.run(_search_async(query, as_json, limit, runtime))


async def _search_async(query: str, as_json: bool, limit: int, runtime: str | None) -> None:
    """Async search implementation."""
    import json

    click.echo(f"Searching for \"{query}\"...")

    async with RegistryClient() as registry:
        try:
            results = await registry.search(query, per_page=limit, runtime=runtime)
        except ConnectionError as e:
            click.echo(click.style(f"Error: {e}", fg="red"))
            sys.exit(1)
        except Exception as e:
            click.echo(click.style(f"Search failed: {e}", fg="red"))
            sys.exit(1)

    if as_json:
        data = {
            "total": results.total,
            "page": results.page,
            "perPage": results.per_page,
            "results": [
                {
                    "name": t.full_name,
                    "description": t.description,
                    "version": t.latest_version,
                    "downloads": t.downloads,
                    "stars": t.stars,
                    "runtime": t.runtime,
                    "verified": t.verified,
                }
                for t in results.results
            ],
        }
        click.echo(json.dumps(data, indent=2))
        return

    if results.total == 0:
        click.echo(click.style(f"\nNo triks found for \"{query}\"\n", fg="yellow"))
        click.echo(click.style("Try a different search term or browse at https://trikhub.com", dim=True))
        return

    click.echo(click.style(f"\nFound {results.total} trik{'s' if results.total != 1 else ''}:\n", bold=True))

    for trik in results.results:
        installed = is_trik_installed(trik.full_name)
        print_trik_info(trik, installed=installed)

    if results.total > len(results.results):
        click.echo(
            click.style(
                f"Showing {len(results.results)} of {results.total} results. Use --limit to see more.",
                dim=True,
            )
        )

    click.echo(click.style("\nInstall with: trikhub install @scope/name", dim=True))


# ============================================================================
# Info Command
# ============================================================================


@cli.command()
@click.argument("package")
@click.option("-j", "--json", "as_json", is_flag=True, help="Output as JSON")
def info(package: str, as_json: bool) -> None:
    """Show detailed information about a trik.

    Examples:
        trikhub info @acme/article-search
    """
    asyncio.run(_info_async(package, as_json))


async def _info_async(package: str, as_json: bool) -> None:
    """Async info implementation."""
    import json

    click.echo(f"Fetching info for {click.style(package, fg='cyan')}...")

    async with RegistryClient() as registry:
        try:
            trik_info = await registry.get_trik(package)
        except ConnectionError as e:
            click.echo(click.style(f"Error: {e}", fg="red"))
            sys.exit(1)
        except Exception as e:
            click.echo(click.style(f"Failed to fetch info: {e}", fg="red"))
            sys.exit(1)

    if not trik_info:
        click.echo(click.style(f"Trik not found: {package}", fg="red"))
        sys.exit(1)

    if as_json:
        data = {
            "name": trik_info.full_name,
            "scope": trik_info.scope,
            "shortName": trik_info.name,
            "description": trik_info.description,
            "latestVersion": trik_info.latest_version,
            "runtime": trik_info.runtime,
            "downloads": trik_info.downloads,
            "stars": trik_info.stars,
            "verified": trik_info.verified,
            "githubRepo": trik_info.github_repo,
            "categories": trik_info.categories,
            "keywords": trik_info.keywords,
            "versions": [
                {
                    "version": v.version,
                    "gitTag": v.git_tag,
                    "publishedAt": v.published_at,
                }
                for v in trik_info.versions
            ],
        }
        click.echo(json.dumps(data, indent=2))
        return

    installed = is_trik_installed(trik_info.full_name)

    click.echo()
    click.echo(click.style(trik_info.full_name, fg="cyan", bold=True))
    if trik_info.verified:
        click.echo(click.style("\u2713 Verified", fg="blue"))
    click.echo()
    click.echo(trik_info.description)
    click.echo()

    click.echo(click.style("Details:", bold=True))
    click.echo(f"  Version:  {trik_info.latest_version}")
    click.echo(f"  Runtime:  {trik_info.runtime}")
    click.echo(f"  Downloads: {format_number(trik_info.downloads)}")
    click.echo(f"  Stars:    {trik_info.stars}")
    click.echo(f"  GitHub:   https://github.com/{trik_info.github_repo}")
    click.echo()

    if trik_info.categories:
        click.echo(f"  Categories: {', '.join(trik_info.categories)}")
    if trik_info.keywords:
        click.echo(f"  Keywords: {', '.join(trik_info.keywords)}")

    if trik_info.versions:
        click.echo()
        click.echo(click.style("Versions:", bold=True))
        for v in trik_info.versions[:5]:
            click.echo(f"  {v.version} - {v.published_at[:10]}")
        if len(trik_info.versions) > 5:
            click.echo(click.style(f"  ... and {len(trik_info.versions) - 5} more", dim=True))

    click.echo()
    if installed:
        click.echo(click.style("\u2713 Installed", fg="green"))
    else:
        click.echo(click.style(f"Install with: trikhub install {trik_info.full_name}", dim=True))


# ============================================================================
# Entry Point
# ============================================================================


if __name__ == "__main__":
    cli()
