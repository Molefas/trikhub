"""trik list / sync — list and discover installed triks."""

from __future__ import annotations

import importlib.metadata
import json
from pathlib import Path

import click

from trikhub.cli.config import add_trik_to_config, get_config_dir, read_config
from trikhub.cli.discovery import discover_triks_in_directory, discover_triks_in_site_packages


def _check_trik_exists(name: str, runtime: str, base_dir: str | None = None) -> bool:
    """Check if a trik is actually installed (not just in config)."""
    if runtime == "node":
        triks_dir = get_config_dir(base_dir) / "triks"
        if name.startswith("@"):
            parts = name.split("/", 1)
            target = triks_dir / parts[0] / parts[1]
        else:
            target = triks_dir / name
        return target.exists()
    else:
        # Python trik — check importlib
        try:
            importlib.metadata.distribution(name.replace("@", "").replace("/", "-"))
            return True
        except importlib.metadata.PackageNotFoundError:
            return False


@click.command("list")
@click.option("-j", "--json-output", "as_json", is_flag=True, help="Output as JSON")
@click.option("--runtime", default=None, help="Filter by runtime (python/node)")
def list_command(as_json: bool, runtime: str | None) -> None:
    """List installed triks."""
    config = read_config()

    if not config.triks:
        click.echo("  No triks installed. Run `trik install` to add one.")
        return

    triks_data = []
    for name in sorted(config.triks):
        trik_runtime = config.runtimes.get(name, "python")
        if runtime and trik_runtime != runtime:
            continue

        version = config.trikhub.get(name, "local")
        exists = _check_trik_exists(name, trik_runtime)
        triks_data.append({
            "name": name,
            "version": version,
            "runtime": trik_runtime,
            "installed": exists,
        })

    if as_json:
        click.echo(json.dumps(triks_data, indent=2))
        return

    if not triks_data:
        click.echo(f"  No {runtime} triks installed.")
        return

    click.echo()
    for trik in triks_data:
        bullet = click.style("*", fg="green") if trik["installed"] else click.style("!", fg="red")
        name_str = click.style(trik["name"], bold=True)
        version_str = f"@{trik['version']}" if trik["version"] != "local" else ""
        runtime_badge = click.style(f"[{trik['runtime']}]", dim=True)
        warning = "" if trik["installed"] else click.style(" (not found)", fg="red")
        click.echo(f"  {bullet} {name_str}{version_str} {runtime_badge}{warning}")
    click.echo()


@click.command("sync")
@click.option("-n", "--dry-run", is_flag=True, help="Show what would be synced")
@click.option("-j", "--json-output", "as_json", is_flag=True, help="Output as JSON")
@click.option("-d", "--directory", default=None, help="Scan a specific directory")
def sync_command(dry_run: bool, as_json: bool, directory: str | None) -> None:
    """Discover and sync installed triks to config."""
    if directory:
        discovered = discover_triks_in_directory(Path(directory))
    else:
        discovered = discover_triks_in_site_packages()

    config = read_config()
    new_triks = [d for d in discovered if d.package_name not in config.triks]

    if as_json:
        data = [{
            "name": d.package_name,
            "trik_id": d.trik_id,
            "version": d.version,
            "runtime": d.runtime,
            "path": str(d.path),
        } for d in new_triks]
        click.echo(json.dumps(data, indent=2))
        return

    if not new_triks:
        click.echo("  All triks are already synced.")
        return

    click.echo(f"\n  Found {len(new_triks)} new triks:\n")
    for d in new_triks:
        click.echo(f"  + {d.package_name} (v{d.version}, {d.runtime})")

    if dry_run:
        click.echo("\n  Dry run — no changes made.")
        return

    for d in new_triks:
        add_trik_to_config(d.package_name, runtime=d.runtime)

    click.echo(click.style(f"\n  Synced {len(new_triks)} triks.", fg="green"))
