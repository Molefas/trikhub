"""trik install / uninstall — manage trik installations."""

from __future__ import annotations

import asyncio
import json as _json
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import click

from trikhub.cli.config import (
    add_trik_to_config,
    get_config_dir,
    read_config,
    read_global_config,
    remove_trik_from_config,
)
from trikhub.cli.discovery import get_package_info
from trikhub.cli.registry import RegistryClient, get_registry
from trikhub.linter.scanner import scan_capabilities, cross_check_manifest


def _parse_package_spec(spec: str) -> tuple[str, str | None]:
    """Parse @scope/name@version → (name, version)."""
    match = re.match(r"^(@[^@]+)@(.+)$", spec)
    if match:
        return match.group(1), match.group(2)
    return spec, None


def _get_pip_package_names(package_name: str) -> list[str]:
    """Generate pip package name candidates from @scope/name."""
    if package_name.startswith("@"):
        parts = package_name.lstrip("@").split("/", 1)
        if len(parts) == 2:
            scope, name = parts
            name = name.replace("_", "-")
            return [name, f"{scope}-{name}"]
        return [parts[0]]
    return [package_name.replace("_", "-")]


def _download_to_triks_directory(
    repo_url: str, git_tag: str, package_name: str, base_dir: str | None = None,
) -> Path:
    """Shallow clone a trik to .trikhub/triks/."""
    triks_dir = get_config_dir(base_dir) / "triks"

    if package_name.startswith("@"):
        parts = package_name.split("/", 1)
        target = triks_dir / parts[0] / parts[1]
    else:
        target = triks_dir / package_name

    if target.exists():
        shutil.rmtree(target)

    target.parent.mkdir(parents=True, exist_ok=True)

    clone_url = f"https://github.com/{repo_url}" if not repo_url.startswith("http") else repo_url
    subprocess.run(
        ["git", "clone", "--depth", "1", "--branch", git_tag, clone_url, str(target)],
        check=True,
        capture_output=True,
        text=True,
    )

    git_dir = target / ".git"
    if git_dir.exists():
        shutil.rmtree(git_dir)

    # Write identity file for trusted scoped name
    identity_path = target / ".trikhub-identity.json"
    identity = {
        "scopedName": package_name,
        "installedAt": datetime.now(timezone.utc).isoformat(),
    }
    identity_path.write_text(_json.dumps(identity, indent=2))

    # Auto-install npm deps for Node triks (detect package manager from lockfile)
    package_json = target / "package.json"
    if package_json.exists():
        if (target / "pnpm-lock.yaml").exists():
            cmd = ["pnpm", "install", "--frozen-lockfile", "--prod"]
        elif (target / "yarn.lock").exists():
            cmd = ["yarn", "install", "--production", "--frozen-lockfile"]
        else:
            cmd = ["npm", "install", "--production"]
        subprocess.run(
            cmd,
            cwd=str(target),
            check=False,
            capture_output=True,
        )

    return target


def _get_trik_download_path(package_name: str) -> Path:
    """Get the path where a trik is downloaded to."""
    triks_dir = get_config_dir() / "triks"
    if package_name.startswith("@"):
        parts = package_name.split("/", 1)
        return triks_dir / parts[0] / parts[1]
    return triks_dir / package_name


def _verify_trik_capabilities(trik_path: Path) -> tuple[bool, list[str]]:
    """Verify that downloaded trik source matches its manifest declarations."""
    try:
        import json as _json
        manifest_path = trik_path / "manifest.json"
        if not manifest_path.exists():
            # Check subdirectories (Python package layout)
            for child in trik_path.iterdir():
                if child.is_dir() and not child.name.startswith((".", "_")):
                    candidate = child / "manifest.json"
                    if candidate.exists():
                        manifest_path = candidate
                        break
            else:
                return True, []  # No manifest to verify against
        manifest = _json.loads(manifest_path.read_text(encoding="utf-8"))
        scan = scan_capabilities(trik_path)
        errors = cross_check_manifest(scan, manifest)
        if not errors:
            return True, []
        return False, [e["message"] for e in errors]
    except Exception:
        return False, ["Failed to verify trik capabilities"]


def _ensure_secrets_json(trik_id: str, required_config: list) -> None:
    """Create .trikhub/secrets.json with placeholder entries if it doesn't exist."""
    config_dir = get_config_dir()
    secrets_path = config_dir / "secrets.json"

    secrets: dict = {}
    if secrets_path.exists():
        try:
            secrets = _json.loads(secrets_path.read_text(encoding="utf-8"))
        except Exception:
            pass  # Corrupted file, overwrite

    if trik_id not in secrets:
        secrets[trik_id] = {
            cfg.key: f"your-{cfg.key}-here" for cfg in required_config
        }
        config_dir.mkdir(parents=True, exist_ok=True)
        secrets_path.write_text(
            _json.dumps(secrets, indent=2) + "\n", encoding="utf-8"
        )


def _show_config_hint(package_name: str, runtime: str) -> None:
    """Show required config hint after install if the trik needs configuration."""
    try:
        if runtime == "python":
            # Python triks: find manifest in site-packages
            from trikhub.cli.discovery import discover_triks_in_site_packages
            triks = discover_triks_in_site_packages()
            manifest = None
            for t in triks:
                if t.package_name == package_name or t.trik_id == package_name:
                    manifest = t.manifest
                    break
        else:
            # Node triks: read from .trikhub/triks/
            from trikhub.cli.discovery import load_trik_manifest
            if package_name.startswith("@"):
                parts = package_name.split("/", 1)
                trik_path = get_config_dir() / "triks" / parts[0] / parts[1]
            else:
                trik_path = get_config_dir() / "triks" / package_name
            result = load_trik_manifest(trik_path)
            manifest = result[0] if result else None

        if manifest and manifest.config and manifest.config.required:
            trik_id = manifest.id
            # Ensure secrets.json exists with placeholder entries
            _ensure_secrets_json(trik_id, manifest.config.required)

            click.echo()
            click.echo(click.style("  This trik requires configuration:", fg="yellow"))
            for cfg in manifest.config.required:
                click.echo(click.style(f"    - {cfg.key}: {cfg.description}", fg="yellow"))
            click.echo()
            click.echo(f"  Update your secrets in .trikhub/secrets.json:")
            click.echo(f'    {{ "{trik_id}": {{ ... }} }}')
    except Exception:
        pass  # Don't fail install if config check fails


CAPABILITY_DESCRIPTIONS = {
    "storage": "Can store persistent data",
    "filesystem": "Can read and write files (runs in Docker container)",
    "shell": "Can execute shell commands (runs in Docker container)",
    "trikManagement": "Can search, install, uninstall, and upgrade triks",
}


def _prompt_capability_consent(
    manifest_data: dict, github_repo: str, skip_prompt: bool,
) -> bool:
    """Display capability warnings and prompt for consent before installing."""
    caps = manifest_data.get("capabilities") or {}
    declared = []
    for cap_name in ["storage", "filesystem", "shell", "trikManagement"]:
        cap = caps.get(cap_name) or {}
        if cap.get("enabled") is True:
            declared.append(cap_name)

    if not declared:
        return True

    click.echo()
    click.echo(click.style("  ⚠️  This trik declares the following capabilities:", fg="yellow"))
    click.echo()
    for cap in declared:
        desc = CAPABILITY_DESCRIPTIONS.get(cap, cap)
        click.echo(click.style(f"     • {cap} — {desc}", fg="yellow"))
    click.echo()
    click.echo("  These capabilities are granted at install time.")
    click.echo(f"  Review the trik source at: github.com/{github_repo}")
    click.echo()

    if skip_prompt:
        return True

    return click.confirm("  Continue?", default=False)


async def _verify_git_tag_sha(
    github_repo: str, git_tag: str, expected_sha: str,
) -> tuple[bool, str | None]:
    """Verify that a GitHub tag points to the expected commit SHA."""
    try:
        import httpx

        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"https://api.github.com/repos/{github_repo}/git/refs/tags/{git_tag}",
            )
            if resp.status_code == 404:
                return False, None
            if resp.status_code != 200:
                return True, None  # Can't verify, proceed with caution

            data = resp.json()
            current_sha = data["object"]["sha"]

            # Dereference annotated tags
            if data["object"].get("type") == "tag":
                tag_resp = await client.get(
                    f"https://api.github.com/repos/{github_repo}/git/tags/{current_sha}",
                )
                if tag_resp.status_code == 200:
                    current_sha = tag_resp.json()["object"]["sha"]

            return current_sha == expected_sha, current_sha
    except Exception:
        return True, None  # Can't verify, proceed


async def _install_from_registry(
    registry: RegistryClient, package_name: str, version: str | None,
    skip_prompt: bool = False,
) -> None:
    """Install a trik from the TrikHub registry."""
    trik = await registry.get_trik(package_name)
    if not trik:
        raise FileNotFoundError(f"Trik not found: {package_name}")

    install_version = version or trik.latest_version
    runtime = trik.runtime

    # Check capabilities and prompt for consent before installing
    target_version = next(
        (v for v in trik.versions if v.version == install_version), None,
    )

    if not target_version:
        raise FileNotFoundError(
            f"Version {install_version} not found for {package_name}"
        )

    if target_version.manifest:
        consent = _prompt_capability_consent(
            target_version.manifest, trik.github_repo, skip_prompt,
        )
        if not consent:
            click.echo(click.style("  Installation cancelled.", fg="red"))
            raise SystemExit(1)

    # Verify the commit SHA hasn't changed (security check)
    if target_version.commit_sha:
        click.echo(f"  Verifying {package_name}@{install_version}...")
        valid, current_sha = await _verify_git_tag_sha(
            trik.github_repo, target_version.git_tag, target_version.commit_sha,
        )
        if not valid:
            click.echo(click.style(
                f"\n  ⚠ Security warning: Tag {target_version.git_tag} has been modified!", fg="red",
            ))
            click.echo(f"    Expected SHA: {target_version.commit_sha}")
            if current_sha:
                click.echo(f"    Current SHA:  {current_sha}")
            click.echo(click.style(
                "\n  This could indicate tampering. Aborting installation.", fg="red",
            ))
            raise SystemExit(1)

    # Containerized triks (filesystem/shell) need a self-contained directory
    # for Docker volume mounts, so they always go to .trikhub/triks/
    manifest_data = target_version.manifest
    needs_container = False
    if manifest_data:
        caps = manifest_data.get("capabilities") or {}
        needs_container = bool(
            (caps.get("filesystem") or {}).get("enabled")
            or (caps.get("shell") or {}).get("enabled")
        )

    # Use git_tag from registry (not hardcoded v{version})
    git_tag = target_version.git_tag

    if runtime == "python" and not needs_container:
        # Same-runtime, non-containerized: install via pip from git
        pip_url = f"git+https://github.com/{trik.github_repo}@{git_tag}"
        click.echo(f"  Installing {package_name}@{install_version} via pip...")
        subprocess.run(
            [sys.executable, "-m", "pip", "install", pip_url, "--quiet"],
            check=True,
        )
    else:
        # Cross-language or containerized: download to .trikhub/triks/
        click.echo(f"  Downloading {package_name}@{install_version}...")
        _download_to_triks_directory(trik.github_repo, git_tag, package_name)

        # Verify downloaded trik matches its manifest declarations
        trik_dir = _get_trik_download_path(package_name)
        verified, cap_errors = _verify_trik_capabilities(trik_dir)
        if not verified:
            click.echo(click.style("\n  ⚠ Capability verification warnings:", fg="yellow"))
            for err in cap_errors:
                click.echo(click.style(f"    • {err}", fg="yellow"))
            click.echo()

    add_trik_to_config(package_name, trikhub_version=install_version, runtime=runtime)

    # Report download (analytics, non-blocking)
    await registry.report_download(package_name, install_version)

    click.echo(click.style(f"  Installed {package_name}@{install_version}", fg="green"))

    _show_config_hint(package_name, runtime)


@click.command("install")
@click.argument("package")
@click.option("-v", "--version", default=None, help="Specific version to install")
@click.option("-y", "--yes", is_flag=True, default=False, help="Skip capability consent prompt")
def install_command(package: str, version: str | None, yes: bool) -> None:
    """Install a trik from the TrikHub registry."""
    package_name, parsed_version = _parse_package_spec(package)
    version = version or parsed_version

    async def _install():
        async with get_registry() as registry:
            await _install_from_registry(registry, package_name, version, skip_prompt=yes)

    asyncio.run(_install())


@click.command("uninstall")
@click.argument("package")
def uninstall_command(package: str) -> None:
    """Uninstall a trik."""
    from trikhub.cli.output import ok, warn

    # Parse @version suffix (e.g., @scope/name@1.0.0 -> @scope/name)
    at_index = package.rfind("@")
    if at_index > 0:
        package_name = package[:at_index]
    else:
        package_name = package

    config = read_config()
    runtime = config.runtimes.get(package_name, "python")

    # Remove from config
    was_in_config = remove_trik_from_config(package_name)
    if was_in_config:
        ok(f"Removed {package_name} from config")
    else:
        warn(f"{package_name} was not in config")

    # Remove files
    removed_files = False
    if runtime == "node":
        triks_dir = get_config_dir() / "triks"
        if package_name.startswith("@"):
            parts = package_name.split("/", 1)
            target = triks_dir / parts[0] / parts[1]
        else:
            target = triks_dir / package_name
        if target.exists():
            shutil.rmtree(target)
            ok(f"Removed {package_name} from .trikhub/triks/")
            removed_files = True
    else:
        pip_names = _get_pip_package_names(package_name)
        for pip_name in pip_names:
            try:
                subprocess.run(
                    [sys.executable, "-m", "pip", "uninstall", pip_name, "-y", "--quiet"],
                    check=True,
                    capture_output=True,
                    text=True,
                )
                ok(f"Uninstalled {pip_name} via pip")
                removed_files = True
                break
            except subprocess.CalledProcessError:
                continue

    if not was_in_config and not removed_files:
        warn(f"{package_name} was not installed")
        return

    click.echo()
    ok(f"Uninstalled {package_name}")
