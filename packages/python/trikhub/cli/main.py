"""
TrikHub CLI - Command-line interface for managing Python triks.

Usage:
    trik install @scope/name   Install a trik from the registry or pip
    trik uninstall @scope/name Uninstall a trik
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

import asyncio
import shutil
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


def get_pip_package_names(trik_name: str) -> list[str]:
    """
    Get possible pip package names for a trik.

    Python packages don't use npm-style scopes, so we try multiple variations:
    - @scope/name -> name (most common)
    - @scope/name -> scope-name (fallback)
    - name -> name (no scope)
    """
    if trik_name.startswith("@"):
        # Scoped: @scope/name
        parts = trik_name[1:].split("/", 1)
        if len(parts) == 2:
            scope, name = parts
            # Normalize underscores to hyphens for pip
            name = name.replace("_", "-")
            scope = scope.replace("_", "-")
            return [name, f"{scope}-{name}"]
    # Unscoped: just normalize
    return [trik_name.replace("_", "-")]


def find_package_info(trik_name: str) -> dict[str, Any] | None:
    """Find package info by trying multiple pip name variations."""
    for pip_name in get_pip_package_names(trik_name):
        info = get_package_info(pip_name)
        if info:
            return info
    return None


def run_pip(args: list[str], capture: bool = False) -> subprocess.CompletedProcess[str]:
    """Run a pip command."""
    cmd = [sys.executable, "-m", "pip"] + args
    if capture:
        return subprocess.run(cmd, capture_output=True, text=True)
    return subprocess.run(cmd)


def run_command(
    cmd: list[str], cwd: Path | None = None, capture: bool = True
) -> subprocess.CompletedProcess[str]:
    """Run a shell command."""
    return subprocess.run(cmd, cwd=cwd, capture_output=capture, text=True)


def get_triks_directory() -> Path:
    """Get the .trikhub/triks directory path."""
    return Path.cwd() / ".trikhub" / "triks"


def download_to_triks_directory(
    package_name: str,
    github_repo: str,
    git_tag: str,
    runtime: str = "node",
) -> tuple[bool, Path]:
    """
    Download a trik to .trikhub/triks/ via git clone.

    This mirrors the JS CLI approach for cross-language trik installation.

    Args:
        package_name: Full trik name (e.g., @scope/name)
        github_repo: GitHub repo (e.g., owner/repo)
        git_tag: Git tag to checkout (e.g., v1.0.0)
        runtime: Trik runtime ('node' or 'python')

    Returns:
        Tuple of (success, trik_path)
    """
    triks_dir = get_triks_directory()

    # Handle scoped packages: @scope/name -> .trikhub/triks/@scope/name
    if package_name.startswith("@"):
        # Split @scope/name into parts
        parts = package_name.split("/")
        trik_dir = triks_dir / parts[0] / parts[1] if len(parts) > 1 else triks_dir / package_name
    else:
        trik_dir = triks_dir / package_name

    # Create parent directories
    trik_dir.parent.mkdir(parents=True, exist_ok=True)

    # Remove existing directory if it exists
    if trik_dir.exists():
        click.echo(f"Removing existing {click.style(package_name, fg='cyan')}...")
        shutil.rmtree(trik_dir)

    # Clone the repository at the specific tag
    click.echo(f"Downloading {click.style(package_name, fg='cyan')}...")
    git_path = shutil.which("git")
    if not git_path:
        click.echo(click.style("Error: git not found. Install git to continue.", fg="red"))
        return False, trik_dir

    clone_result = run_command([
        git_path, "clone",
        "--depth", "1",
        "--branch", git_tag,
        f"https://github.com/{github_repo}.git",
        str(trik_dir),
    ])

    if clone_result.returncode != 0:
        click.echo(click.style(f"Git clone failed: {clone_result.stderr}", fg="red"))
        return False, trik_dir

    # Remove .git directory to save space
    git_dir = trik_dir / ".git"
    if git_dir.exists():
        shutil.rmtree(git_dir)

    # Install dependencies for Node.js triks
    if runtime == "node":
        package_json = trik_dir / "package.json"
        if package_json.exists():
            click.echo("Installing npm dependencies...")
            npm_path = shutil.which("npm")
            if npm_path:
                install_result = run_command(
                    [npm_path, "install", "--production"],
                    cwd=trik_dir,
                )
                if install_result.returncode != 0:
                    click.echo(click.style(f"Warning: npm install failed: {install_result.stderr}", fg="yellow"))
                    click.echo(click.style("You may need to run 'npm install' manually in the trik directory", dim=True))
            else:
                click.echo(click.style("Warning: npm not found, dependencies not installed", fg="yellow"))
                click.echo(click.style("Run 'npm install' in the trik directory before using", dim=True))

    return True, trik_dir


def is_trik_in_triks_directory(package_name: str) -> tuple[bool, Path | None]:
    """Check if a trik exists in .trikhub/triks/ directory."""
    triks_dir = get_triks_directory()

    if package_name.startswith("@"):
        parts = package_name.split("/")
        trik_dir = triks_dir / parts[0] / parts[1] if len(parts) > 1 else triks_dir / package_name
    else:
        trik_dir = triks_dir / package_name

    if trik_dir.exists() and (trik_dir / "manifest.json").exists():
        return True, trik_dir
    return False, None


def print_trik_info(trik: TrikInfo, installed: bool = False, show_runtime: bool = False) -> None:
    """Print formatted trik information."""
    installed_badge = click.style(" [installed]", fg="green") if installed else ""
    verified_badge = click.style(" ✓", fg="blue") if trik.verified else ""
    # Only show runtime badge when we have reliable data (e.g., from info command)
    runtime_badge = click.style(f" [{trik.runtime}]", fg="yellow") if show_runtime else ""

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
        trik install @acme/article-search
        trik install @acme/article-search --version 1.0.0
        trik install my-trik-package --pip
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
                    # Node.js trik - download to .trikhub/triks/ via git clone
                    version_info = None
                    for v in trik_info.versions:
                        if v.version == version_to_install:
                            version_info = v
                            break

                    if not version_info:
                        click.echo(click.style(f"Version {version_to_install} not found", fg="red"))
                        sys.exit(1)

                    click.echo(
                        click.style(
                            f"Cross-language trik: {trik_info.runtime} trik in Python project",
                            dim=True,
                        )
                    )

                    # Download to .trikhub/triks/
                    success, trik_path = download_to_triks_directory(
                        trik_info.full_name,
                        trik_info.github_repo,
                        version_info.git_tag,
                        runtime=trik_info.runtime,
                    )

                    if not success:
                        click.echo(click.style("Installation failed", fg="red"))
                        sys.exit(1)

                    # Register the trik
                    add_trik_to_config(
                        trik_info.full_name,
                        trikhub_version=version_to_install,
                        runtime="node",
                    )

                    # Report download
                    await registry.report_download(package_name, version_to_install)

                    click.echo(click.style(f"✓ Installed {trik_info.full_name}@{version_to_install}", fg="green"))
                    click.echo(click.style(f"  Downloaded to: {trik_path.relative_to(Path.cwd())}", dim=True))
                    click.echo(click.style("  Registered in: .trikhub/config.json", dim=True))
                    click.echo()
                    click.echo(click.style("The trik will run via the Node.js worker subprocess.", dim=True))
                    return

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
        trik uninstall @acme/article-search
        trik uninstall my-trik-package
    """
    # Parse package name (remove version if present)
    package_name = package
    if "@" in package and not package.startswith("@"):
        package_name = package[: package.rfind("@")]
    elif package.startswith("@") and package.count("@") > 1:
        package_name = package[: package.rfind("@")]

    # Get runtime before removing from config
    config = read_config()
    trik_runtime = config.runtimes.get(package_name, "python")

    # Remove from config (requires exact match)
    click.echo(f"Removing {click.style(package_name, fg='cyan')} from config...")
    was_in_config = remove_trik_from_config(package_name)

    if not was_in_config:
        click.echo(click.style(f"Error: {package_name} not found in config", fg="red"))
        click.echo(click.style("Use 'trik list' to see installed triks with their full names", dim=True))
        sys.exit(1)

    click.echo(click.style("✓ Removed from .trikhub/config.json", fg="green"))

    # Handle based on runtime
    if trik_runtime == "node":
        # Check .trikhub/triks/ directory
        exists, trik_path = is_trik_in_triks_directory(package_name)
        if exists and trik_path:
            click.echo("Removing from .trikhub/triks/...")
            shutil.rmtree(trik_path)
            click.echo(click.style(f"✓ Removed {package_name}", fg="green"))
        else:
            click.echo(click.style("Note: Directory not found in .trikhub/triks/ (may have been manually removed)", fg="yellow"))
    else:
        # Uninstall from pip using the correct package name
        pip_names = get_pip_package_names(package_name)
        click.echo("Uninstalling package...")

        uninstalled = False
        for pip_name in pip_names:
            result = run_pip(["uninstall", "-y", pip_name], capture=True)
            if result.returncode == 0:
                click.echo(click.style(f"✓ Uninstalled {package_name}", fg="green"))
                uninstalled = True
                break

        if not uninstalled:
            click.echo(click.style("Note: Package not found in pip (may have been manually removed)", fg="yellow"))


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

            if trik_runtime == "node":
                exists, _ = is_trik_in_triks_directory(trik_name)
                version = config.trikhub.get(trik_name, "unknown")
            else:
                pkg_info = find_package_info(trik_name)
                exists = pkg_info is not None
                version = pkg_info.get("version", "unknown") if pkg_info else "unknown"

            triks_data.append({
                "name": trik_name,
                "version": version,
                "runtime": trik_runtime,
                "exists": exists,
            })
        click.echo(json.dumps({"triks": triks_data}, indent=2))
        return

    if not config.triks:
        click.echo(click.style("No triks installed.", fg="yellow"))
        click.echo()
        click.echo(click.style("Use 'trik install @scope/name' to install a trik", dim=True))
        click.echo(click.style("Use 'trik sync' to discover triks in site-packages", dim=True))
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
        # Check existence based on runtime
        if trik_runtime == "node":
            # Check .trikhub/triks/ directory for Node.js triks
            exists, trik_path = is_trik_in_triks_directory(trik_name)
            version_str = config.trikhub.get(trik_name, "unknown")
            description = None
            if exists and trik_path:
                # Try to read description from manifest
                manifest_path = trik_path / "manifest.json"
                if manifest_path.exists():
                    try:
                        import json as json_mod
                        manifest = json_mod.loads(manifest_path.read_text())
                        description = manifest.get("description")
                    except Exception:
                        pass
        else:
            # Check pip for Python triks
            pkg_info = find_package_info(trik_name)
            exists = pkg_info is not None
            version_str = pkg_info.get("version", "unknown") if pkg_info else "unknown"
            description = pkg_info.get("description") if pkg_info else None

        status = click.style("●", fg="green") if exists else click.style("○", fg="red")
        name = click.style(trik_name, fg="cyan")
        version = click.style(f"v{version_str}", dim=True)
        runtime_badge = click.style(f"[{trik_runtime}]", fg="yellow")

        click.echo(f"  {status} {name} {version} {runtime_badge}")

        if description:
            click.echo(click.style(f"      {description}", dim=True))

        if not exists:
            click.echo(
                click.style(
                    f"      ⚠ Not installed! Run 'trik install {trik_name}'",
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
        trik sync                    # Scan site-packages
        trik sync --directory ./triks  # Scan specific directory
        trik sync --dry-run          # Preview changes
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
        trik search article
        trik search "web scraping" --runtime python
        trik search ai --limit 20
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

    click.echo(click.style("\nInstall with: trik install @scope/name", dim=True))


# ============================================================================
# Info Command
# ============================================================================


@cli.command()
@click.argument("package")
@click.option("-j", "--json", "as_json", is_flag=True, help="Output as JSON")
def info(package: str, as_json: bool) -> None:
    """Show detailed information about a trik.

    Examples:
        trik info @acme/article-search
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
        click.echo(click.style(f"Install with: trik install {trik_info.full_name}", dim=True))


# ============================================================================
# Login Command
# ============================================================================


@cli.command()
@click.pass_context
def login(ctx: click.Context) -> None:
    """Authenticate with TrikHub via GitHub.

    Uses GitHub's device flow for authentication.
    """
    asyncio.run(_login_async())


async def _login_async() -> None:
    """Async login implementation."""
    import time

    from trikhub.cli.config import (
        GlobalConfig,
        is_auth_expired,
        read_global_config,
        write_global_config,
    )

    config = read_global_config()

    # Check if already logged in
    if config.auth_token and not is_auth_expired(config):
        click.echo(
            click.style(f"Already logged in as ", fg="yellow")
            + click.style(f"@{config.publisher_username}", fg="cyan")
        )
        click.echo(click.style("Use 'trik logout' to sign out first", dim=True))
        return

    click.echo("Initializing authentication...")

    async with RegistryClient() as registry:
        try:
            # Start device flow
            device_auth = await registry.start_device_auth()
        except Exception as e:
            click.echo(click.style(f"Failed to start authentication: {e}", fg="red"))
            sys.exit(1)

        # Display instructions
        click.echo()
        click.echo(click.style("  To authenticate, please:", bold=True))
        click.echo()
        click.echo(f"  1. Visit: {click.style(device_auth.verification_url, fg='cyan')}")
        click.echo(f"  2. Enter code: {click.style(device_auth.user_code, fg='yellow', bold=True)}")
        click.echo()
        click.echo(click.style(f"  This code expires in {device_auth.expires_in // 60} minutes", dim=True))
        click.echo()

        # Poll for authorization
        click.echo("Waiting for authorization...")

        poll_interval = device_auth.interval
        max_attempts = device_auth.expires_in // poll_interval

        for _ in range(max_attempts):
            time.sleep(poll_interval)

            try:
                result = await registry.poll_device_auth(device_auth.device_code)

                if result:
                    # Authorization complete - save credentials
                    config.auth_token = result.access_token
                    config.auth_expires_at = result.expires_at
                    config.publisher_username = result.publisher.username
                    write_global_config(config)

                    click.echo(
                        click.style("✓ Authenticated as ", fg="green")
                        + click.style(result.publisher.display_name, bold=True)
                        + click.style(f" (@{result.publisher.username})", fg="cyan")
                    )
                    click.echo()
                    click.echo(click.style("You can now publish triks with 'trik publish'", dim=True))
                    return
                # Still pending, continue polling
            except RuntimeError as e:
                error_msg = str(e)
                if "expired" in error_msg:
                    click.echo(click.style("Authorization expired", fg="red"))
                    click.echo(click.style("Please run 'trik login' again", dim=True))
                    sys.exit(1)
                if "denied" in error_msg or "access_denied" in error_msg:
                    click.echo(click.style("Authorization denied", fg="red"))
                    sys.exit(1)
                raise

        click.echo(click.style("Authorization timeout", fg="red"))
        click.echo(click.style("Please run 'trik login' again", dim=True))
        sys.exit(1)


# ============================================================================
# Logout Command
# ============================================================================


@cli.command()
def logout() -> None:
    """Log out of TrikHub.

    Removes saved authentication credentials.
    """
    asyncio.run(_logout_async())


async def _logout_async() -> None:
    """Async logout implementation."""
    from trikhub.cli.config import read_global_config, write_global_config

    config = read_global_config()

    if not config.auth_token:
        click.echo(click.style("Not logged in", fg="yellow"))
        return

    username = config.publisher_username

    # Try to invalidate session on server
    try:
        async with RegistryClient() as registry:
            await registry.logout()
    except Exception:
        # Ignore errors - we'll clear local credentials anyway
        pass

    # Clear local credentials
    config.auth_token = None
    config.auth_expires_at = None
    config.publisher_username = None
    write_global_config(config)

    if username:
        click.echo(click.style(f"Logged out from @{username}", fg="green"))
    else:
        click.echo(click.style("Logged out", fg="green"))


# ============================================================================
# Whoami Command
# ============================================================================


@cli.command()
@click.pass_context
def whoami(ctx: click.Context) -> None:
    """Show the current authenticated user."""
    asyncio.run(_whoami_async())


async def _whoami_async() -> None:
    """Async whoami implementation."""
    from trikhub.cli.config import is_auth_expired, read_global_config

    config = read_global_config()

    if not config.auth_token:
        click.echo(click.style("Not logged in", fg="yellow"))
        click.echo(click.style("Run 'trik login' to authenticate", dim=True))
        return

    # Check if token is expired
    if is_auth_expired(config):
        click.echo(click.style("Session expired", fg="yellow"))
        click.echo(click.style("Run 'trik login' to re-authenticate", dim=True))
        return

    click.echo("Fetching user info...")

    try:
        async with RegistryClient() as registry:
            user = await registry.get_current_user()
    except Exception as e:
        click.echo(click.style(f"Failed to fetch user info: {e}", fg="red"))
        sys.exit(1)

    click.echo()
    click.echo(f"  {click.style(user.display_name, bold=True)}")
    click.echo(f"  {click.style(f'@{user.username}', fg='cyan')}")
    if user.verified:
        click.echo(f"  {click.style('✓ Verified publisher', fg='green')}")
    click.echo()


# ============================================================================
# Publish Command
# ============================================================================


@cli.command()
@click.option("-d", "--directory", default=".", help="Trik directory")
@click.option("-t", "--tag", help="Version tag (default: from manifest)")
@click.pass_context
def publish(ctx: click.Context, directory: str, tag: str | None) -> None:
    """Publish a trik to the registry.

    Supports both Node.js and Python package structures:
    - Node.js: manifest.json at repository root
    - Python: manifest.json inside package subdirectory

    Examples:
        trik publish
        trik publish -d ./my-trik
        trik publish --tag v1.0.0
    """
    asyncio.run(_publish_async(directory, tag))


async def _publish_async(directory: str, tag_override: str | None) -> None:
    """Async publish implementation."""
    import json
    import re

    from trikhub.cli.config import is_auth_expired, read_global_config
    from trikhub.cli.validator import (
        find_manifest_path,
        format_validation_result,
        get_remote_tag_commit_sha,
        is_dist_committed,
        is_path_committed,
        normalize_git_url,
        validate_trik,
    )

    config = read_global_config()
    repo_dir = Path(directory).resolve()

    # Step 1: Check if logged in
    if not config.auth_token:
        click.echo(click.style("Not logged in", fg="red"))
        click.echo(click.style("Run 'trik login' to authenticate first", dim=True))
        sys.exit(1)

    if is_auth_expired(config):
        click.echo(click.style("Session expired", fg="red"))
        click.echo(click.style("Run 'trik login' to re-authenticate", dim=True))
        sys.exit(1)

    # Step 2: Find manifest.json (supports both Node.js and Python)
    click.echo("Validating trik structure...")

    manifest_location = find_manifest_path(repo_dir)

    if not manifest_location:
        click.echo(click.style("✗ Missing manifest.json", fg="red"))
        click.echo(click.style("Create a manifest.json file with your trik definition", dim=True))
        click.echo()
        click.echo(click.style("For Node.js triks: place manifest.json at repository root", dim=True))
        click.echo(click.style("For Python triks: place manifest.json inside your package directory", dim=True))
        sys.exit(1)

    manifest_path = manifest_location.manifest_path
    manifest_dir = manifest_location.manifest_dir
    package_type = manifest_location.package_type

    # Log detected package type
    if package_type == "python":
        rel_path = manifest_dir.relative_to(repo_dir)
        click.echo(click.style(f"  Detected Python package: {rel_path}/", dim=True))

    # Step 3: Check trikhub.json exists (always at repo root)
    trikhub_path = repo_dir / "trikhub.json"
    if not trikhub_path.exists():
        click.echo(click.style("✗ Missing trikhub.json", fg="red"))
        click.echo(click.style("Create a trikhub.json file with registry metadata", dim=True))
        sys.exit(1)

    # Step 4: Read manifest and trikhub.json
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        click.echo(click.style(f"✗ Invalid manifest.json: {e}", fg="red"))
        sys.exit(1)

    try:
        trikhub_meta = json.loads(trikhub_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        click.echo(click.style(f"✗ Invalid trikhub.json: {e}", fg="red"))
        sys.exit(1)

    # Step 5: Check entry point exists (relative to manifest directory)
    entry = manifest.get("entry", {})
    entry_module = entry.get("module", "")
    entry_path = manifest_dir / entry_module

    if not entry_path.exists():
        click.echo(click.style(f"✗ Missing entry point: {entry_module}", fg="red"))
        if package_type == "node":
            click.echo(click.style("Build your trik first (e.g., npm run build)", dim=True))
        else:
            click.echo(click.style("Ensure your entry module exists", dim=True))
        sys.exit(1)

    # Step 6: Run validation
    validation = validate_trik(manifest_dir)
    if not validation.valid:
        click.echo(click.style("✗ Validation failed", fg="red"))
        click.echo(format_validation_result(validation))
        sys.exit(1)

    if validation.warnings:
        click.echo(click.style("⚠ Validation passed with warnings", fg="yellow"))
        click.echo(format_validation_result(validation))
    else:
        click.echo(click.style("✓ Validation passed", fg="green"))

    # Step 7: Determine version and git tag
    version = tag_override.lstrip("v") if tag_override else manifest.get("version", "")
    if not version:
        click.echo(click.style("✗ No version found in manifest or tag option", fg="red"))
        sys.exit(1)

    git_tag = f"v{version}"
    click.echo(click.style(f"  Version: {version}", dim=True))

    # Step 8: Get GitHub repo from trikhub.json and verify
    repo_url = trikhub_meta.get("repository", "")
    repo_match = re.search(r"github\.com/([^/]+/[^/]+)", repo_url)
    if not repo_match:
        click.echo(click.style("✗ Invalid repository URL in trikhub.json", fg="red"))
        click.echo(click.style("Expected format: https://github.com/owner/repo", dim=True))
        sys.exit(1)

    github_repo = repo_match.group(1).rstrip(".git")
    owner = github_repo.split("/")[0]
    trik_name = manifest.get("id") or manifest.get("name", "")
    full_name = f"@{owner}/{trik_name}"

    # Step 9: Verify git remote matches trikhub.json repository
    click.echo("Verifying git remote...")
    try:
        from trikhub.cli.validator import get_git_remote_url
        git_remote = get_git_remote_url(repo_dir)

        if not git_remote:
            click.echo(click.style("✗ Not a git repository or no remote configured", fg="red"))
            click.echo(click.style("Initialize git and add a remote that matches trikhub.json:", dim=True))
            click.echo(click.style(f"  git init", dim=True))
            click.echo(click.style(f"  git remote add origin {repo_url}", dim=True))
            sys.exit(1)

        normalized_remote = normalize_git_url(git_remote)

        if github_repo.lower() not in normalized_remote:
            click.echo(click.style("✗ Git remote does not match trikhub.json repository", fg="red"))
            click.echo()
            click.echo(click.style("Repository mismatch detected:", fg="red"))
            click.echo(click.style(f"  trikhub.json: {repo_url}", dim=True))
            click.echo(click.style(f"  git remote:   {git_remote}", dim=True))
            click.echo()
            click.echo(click.style("Update trikhub.json to match your git remote, or push to the correct repository.", dim=True))
            sys.exit(1)

        click.echo(click.style("✓ Git remote verified", fg="green"))
    except Exception as e:
        click.echo(click.style(f"✗ Git verification failed: {e}", fg="red"))
        sys.exit(1)

    click.echo(click.style(f"  Trik: {full_name}", dim=True))
    click.echo(click.style(f"  Repo: {github_repo}", dim=True))

    # Step 10: Check that entry module is committed
    if package_type == "node":
        # Node.js: check dist/ is committed
        click.echo("Checking dist/ is committed...")
        if not is_dist_committed(repo_dir):
            click.echo(click.style("✗ dist/ directory is not committed to git", fg="red"))
            click.echo()
            click.echo(click.style("Triks require dist/ to be committed for direct GitHub installation.", fg="red"))
            click.echo(click.style("Add dist/ to your repository:", dim=True))
            click.echo(click.style("  git add dist/ -f", dim=True))
            click.echo(click.style('  git commit -m "Add dist for publishing"', dim=True))
            click.echo(click.style("  git push", dim=True))
            sys.exit(1)
        click.echo(click.style("✓ dist/ is committed", fg="green"))
    else:
        # Python: check entry module is committed
        entry_rel_path = str(entry_path.relative_to(repo_dir))
        click.echo(f"Checking {entry_rel_path} is committed...")
        if not is_path_committed(repo_dir, entry_rel_path):
            click.echo(click.style("✗ Entry module is not committed to git", fg="red"))
            click.echo()
            click.echo(click.style(f"{entry_rel_path} must be committed for direct GitHub installation.", fg="red"))
            click.echo(click.style("Add it to your repository:", dim=True))
            click.echo(click.style(f'  git add "{entry_rel_path}"', dim=True))
            click.echo(click.style('  git commit -m "Add entry module for publishing"', dim=True))
            click.echo(click.style("  git push", dim=True))
            sys.exit(1)
        click.echo(click.style(f"✓ {entry_rel_path} is committed", fg="green"))

    # Step 11: Verify git tag exists on remote
    click.echo(f"Verifying tag {git_tag} exists on remote...")
    commit_sha = get_remote_tag_commit_sha(repo_dir, git_tag)

    if not commit_sha:
        click.echo(click.style(f"✗ Tag {git_tag} not found on remote", fg="red"))
        click.echo()
        click.echo(click.style("The git tag must exist on the remote before publishing.", fg="red"))
        click.echo(click.style("Create and push the tag:", dim=True))
        click.echo(click.style(f"  git tag {git_tag}", dim=True))
        click.echo(click.style(f"  git push origin {git_tag}", dim=True))
        sys.exit(1)

    click.echo(click.style(f"✓ Tag {git_tag} verified ({commit_sha[:8]}...)", fg="green"))

    # Step 12: Publish to registry
    click.echo("Publishing to TrikHub registry...")

    async with RegistryClient() as registry:
        try:
            # Check if trik exists, if not register it
            existing_trik = await registry.get_trik(full_name)

            if not existing_trik:
                # Register new trik
                try:
                    await registry.register_trik(
                        github_repo=github_repo,
                        name=trik_name,
                        description=trikhub_meta.get("shortDescription") or manifest.get("description"),
                        categories=trikhub_meta.get("categories"),
                        keywords=trikhub_meta.get("keywords"),
                    )
                    click.echo(click.style(f"  Registered new trik: {full_name}", dim=True))
                except RuntimeError as reg_error:
                    # If trik already exists (409), that's fine - continue to publish version
                    if "already exists" not in str(reg_error):
                        raise
                    click.echo(click.style(f"  Trik already registered: {full_name}", dim=True))

            # Publish version
            await registry.publish_version(
                full_name=full_name,
                version=version,
                git_tag=git_tag,
                commit_sha=commit_sha,
                manifest=manifest,
            )

            click.echo(click.style("✓ Published to TrikHub registry", fg="green"))

        except PermissionError as e:
            click.echo(click.style(f"✗ {e}", fg="red"))
            sys.exit(1)
        except RuntimeError as e:
            click.echo(click.style(f"✗ Failed to publish to registry: {e}", fg="red"))
            sys.exit(1)

    # Success message
    click.echo()
    click.echo(click.style("  Published successfully!", fg="green", bold=True))
    click.echo()
    click.echo(click.style(f"  Install with: trik install {full_name}@{version}", dim=True))
    click.echo(click.style(f"  View at: https://trikhub.com/triks/{full_name.replace('@', '%40')}", dim=True))
    click.echo()


# ============================================================================
# Unpublish Command
# ============================================================================


@cli.command()
@click.argument("package")
@click.pass_context
def unpublish(ctx: click.Context, package: str) -> None:
    """Permanently remove a trik from the registry.

    This will delete the trik and ALL its versions. This action cannot be undone.

    Examples:
        trik unpublish @acme/article-search
    """
    asyncio.run(_unpublish_async(package))


async def _unpublish_async(package: str) -> None:
    """Async unpublish implementation."""
    from trikhub.cli.config import is_auth_expired, read_global_config

    config = read_global_config()

    # Step 1: Check authentication
    if not config.auth_token:
        click.echo(click.style("Not logged in", fg="red"))
        click.echo(click.style("Run 'trik login' to authenticate first", dim=True))
        sys.exit(1)

    if is_auth_expired(config):
        click.echo(click.style("Session expired", fg="red"))
        click.echo(click.style("Run 'trik login' to re-authenticate", dim=True))
        sys.exit(1)

    # Step 2: Verify trik exists
    click.echo(f"Checking trik {click.style(package, fg='cyan')}...")

    async with RegistryClient() as registry:
        try:
            trik_info = await registry.get_trik(package)
            if not trik_info:
                click.echo(click.style(f"Trik not found: {package}", fg="red"))
                sys.exit(1)
        except Exception as e:
            click.echo(click.style(f"Failed to fetch trik info: {e}", fg="red"))
            sys.exit(1)

        click.echo(click.style(f"Found {package}", fg="green"))

        # Step 3: User confirmation
        click.echo()
        click.echo(
            click.style(
                f"WARNING: This will permanently delete {package} and ALL its versions.",
                fg="red",
                bold=True,
            )
        )
        click.echo(click.style("This action cannot be undone.", fg="red"))
        click.echo()

        confirmation = click.prompt(f"To confirm, type the trik name ({package})")

        if confirmation != package:
            click.echo(
                click.style("Unpublish cancelled - trik name did not match", fg="yellow")
            )
            sys.exit(1)

        # Step 4: Delete the trik
        click.echo(f"Unpublishing {click.style(package, fg='cyan')}...")

        try:
            await registry.delete_trik(package)
            click.echo(click.style(f"✓ Successfully unpublished {package}", fg="green"))
        except PermissionError as e:
            click.echo(click.style(f"✗ {e}", fg="red"))
            sys.exit(1)
        except RuntimeError as e:
            click.echo(click.style(f"✗ Failed to unpublish: {e}", fg="red"))
            sys.exit(1)


# ============================================================================
# Entry Point
# ============================================================================


if __name__ == "__main__":
    cli()
