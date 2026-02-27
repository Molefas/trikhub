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
    # Check .trikhub/triks/ directory (cross-language installs land here)
    triks_dir = get_config_dir(base_dir) / "triks"
    if name.startswith("@"):
        parts = name.split("/", 1)
        target = triks_dir / parts[0] / parts[1]
    else:
        target = triks_dir / name
    if target.exists():
        return True

    if runtime == "node":
        return False
    else:
        # Python trik — also check pip site-packages
        try:
            importlib.metadata.distribution(name.replace("@", "").replace("/", "-"))
            return True
        except importlib.metadata.PackageNotFoundError:
            return False


def _get_trik_manifest(name: str, runtime: str, base_dir: str | None = None) -> dict | None:
    """Try to read manifest.json for an installed trik."""
    import json as _json

    if runtime == "node":
        triks_dir = get_config_dir(base_dir) / "triks"
        if name.startswith("@"):
            parts = name.split("/", 1)
            trik_path = triks_dir / parts[0] / parts[1]
        else:
            trik_path = triks_dir / name

        # Try root manifest.json
        manifest_path = trik_path / "manifest.json"
        if manifest_path.exists():
            try:
                return _json.loads(manifest_path.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                return None

        # Try subdirectory (Python package layout)
        if trik_path.exists():
            for child in trik_path.iterdir():
                if child.is_dir() and not child.name.startswith((".", "_")):
                    candidate = child / "manifest.json"
                    if candidate.exists():
                        try:
                            return _json.loads(candidate.read_text(encoding="utf-8"))
                        except (ValueError, OSError):
                            pass
        return None
    else:
        # Python trik -- check site-packages via discovery
        for d in discover_triks_in_site_packages():
            if d.package_name == name or d.trik_id == name:
                return {
                    "description": d.description,
                    "agent": {"mode": d.manifest.agent.mode if d.manifest.agent else None},
                }
        return None


@click.command("list")
@click.option("-j", "--json-output", "as_json", is_flag=True, help="Output as JSON")
@click.option("--runtime", default=None, help="Filter by runtime (python/node)")
def list_command(as_json: bool, runtime: str | None) -> None:
    """List installed triks."""
    config = read_config()

    if not config.triks:
        click.echo(click.style("No triks installed.", fg="yellow"))
        click.echo(click.style("\nUse `trik install @scope/name` to install a trik", dim=True))
        click.echo(click.style("Use `trik sync` to discover triks in site-packages", dim=True))
        return

    triks_data = []
    for name in sorted(config.triks):
        trik_runtime = config.runtimes.get(name, "python")
        if runtime and trik_runtime != runtime:
            continue

        version = config.trikhub.get(name, "local")
        exists = _check_trik_exists(name, trik_runtime)
        is_cross_language = trik_runtime == "node"
        manifest = _get_trik_manifest(name, trik_runtime) if exists else None

        triks_data.append({
            "name": name,
            "version": version,
            "runtime": trik_runtime,
            "installed": exists,
            "crossLanguage": is_cross_language,
            "description": manifest.get("description") if manifest else None,
            "agentMode": manifest.get("agent", {}).get("mode") if manifest else None,
        })

    if as_json:
        click.echo(json.dumps(triks_data, indent=2))
        return

    if not triks_data:
        click.echo(f"  No {runtime} triks installed.")
        return

    click.echo(click.style(f"\nInstalled triks ({len(triks_data)}):\n", bold=True))

    for trik in triks_data:
        status = click.style("\u25cf", fg="green") if trik["installed"] else click.style("\u25cb", fg="red")
        name_str = click.style(trik["name"], fg="cyan")
        version_str = click.style(f"v{trik['version']}", dim=True) if trik["version"] != "local" else ""

        click.echo(f"  {status} {name_str} {version_str}")

        if trik["description"]:
            click.echo(click.style(f"      {trik['description']}", dim=True))

        if trik["agentMode"]:
            click.echo(click.style(f"      [{trik['agentMode']}]", dim=True))

        if trik["crossLanguage"] and trik["installed"]:
            click.echo(click.style("      \U0001f4e6 Cross-language trik (in .trikhub/triks/)", dim=True))

        if not trik["installed"]:
            if trik["runtime"] == "node":
                click.echo(click.style(
                    f"      \u26a0 Not in .trikhub/triks/! Run 'trik install {trik['name']}'", fg="red"
                ))
            else:
                click.echo(click.style(
                    f"      \u26a0 Not found! Run 'trik install {trik['name']}'", fg="red"
                ))

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
