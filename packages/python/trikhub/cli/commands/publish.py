"""trik publish / unpublish — publish triks to the registry."""

from __future__ import annotations

import asyncio
import json
import re
import subprocess
import sys
from pathlib import Path

import click

from trikhub.cli.config import is_auth_expired, read_global_config
from trikhub.cli.registry import get_registry
from trikhub.manifest import validate_manifest


def _find_manifest(repo_dir: Path) -> tuple[Path, dict] | None:
    """Find and parse manifest.json in the repo."""
    manifest_path = repo_dir / "manifest.json"
    if not manifest_path.exists():
        # Check subdirectories for v1 layout
        for child in repo_dir.iterdir():
            if child.is_dir() and not child.name.startswith((".", "_")):
                candidate = child / "manifest.json"
                if candidate.exists():
                    manifest_path = candidate
                    break
        else:
            return None

    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        return manifest_path, data
    except (json.JSONDecodeError, OSError):
        return None


def _find_trikhub_json(repo_dir: Path) -> dict | None:
    """Find and parse trikhub.json."""
    path = repo_dir / "trikhub.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _normalize_git_url(url: str) -> str:
    """Normalize a git URL for comparison."""
    url = url.rstrip("/")
    url = re.sub(r"\.git$", "", url)
    url = re.sub(r"^https?://github\.com/", "", url)
    url = re.sub(r"^git@github\.com:", "", url)
    return url.lower()


def _get_remote_url(repo_dir: Path) -> str | None:
    """Get the git remote origin URL."""
    try:
        result = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            cwd=str(repo_dir),
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError:
        return None


def _get_remote_tag_sha(repo_dir: Path, tag: str) -> str | None:
    """Get the commit SHA for a remote tag."""
    try:
        result = subprocess.run(
            ["git", "ls-remote", "--tags", "origin", tag],
            cwd=str(repo_dir),
            capture_output=True,
            text=True,
            check=True,
        )
        output = result.stdout.strip()
        if output:
            return output.split()[0]
        return None
    except subprocess.CalledProcessError:
        return None


def _is_path_committed(repo_dir: Path, rel_path: str) -> bool:
    """Check if a file path is committed to git."""
    try:
        result = subprocess.run(
            ["git", "ls-files", rel_path],
            cwd=str(repo_dir),
            capture_output=True,
            text=True,
            check=True,
        )
        return bool(result.stdout.strip())
    except subprocess.CalledProcessError:
        return False


@click.command("publish")
@click.option("-d", "--directory", default=".", help="Repository directory")
@click.option("-t", "--tag", default=None, help="Git tag override")
def publish_command(directory: str, tag: str | None) -> None:
    """Validate and publish a trik to the TrikHub registry."""
    repo_dir = Path(directory).resolve()

    # Check auth
    global_config = read_global_config()
    if not global_config.auth_token or is_auth_expired(global_config):
        click.echo(click.style("  Not authenticated. Run `trik login` first.", fg="red"))
        sys.exit(1)

    # Find manifest
    result = _find_manifest(repo_dir)
    if not result:
        click.echo(click.style("  No manifest.json found", fg="red"))
        sys.exit(1)
    manifest_path, manifest_data = result

    # Validate manifest
    validation = validate_manifest(manifest_data)
    if not validation.valid:
        click.echo(click.style("  Manifest validation failed:", fg="red"))
        for error in validation.errors:
            click.echo(f"    - {error}")
        sys.exit(1)

    if validation.warnings:
        for warning in validation.warnings:
            click.echo(click.style(f"  Warning: {warning}", fg="yellow"))

    # Check trikhub.json
    trikhub_json = _find_trikhub_json(repo_dir)
    if not trikhub_json:
        click.echo(click.style("  No trikhub.json found", fg="red"))
        sys.exit(1)

    # Check entry point exists
    manifest_dir = manifest_path.parent
    entry_module = manifest_data.get("entry", {}).get("module", "")
    entry_path = manifest_dir / entry_module
    if not entry_path.exists():
        click.echo(click.style(f"  Entry point not found: {entry_module}", fg="red"))
        sys.exit(1)

    # Get version and tag
    version = manifest_data.get("version", "0.1.0")
    git_tag = tag or f"v{version}"

    # Extract GitHub repo from trikhub.json
    repo_url = trikhub_json.get("repository", "")
    github_repo = _normalize_git_url(repo_url)

    if not github_repo:
        click.echo(click.style("  No repository URL in trikhub.json", fg="red"))
        sys.exit(1)

    # Verify git remote matches
    remote_url = _get_remote_url(repo_dir)
    if remote_url:
        normalized_remote = _normalize_git_url(remote_url)
        if normalized_remote != github_repo:
            click.echo(click.style(
                f"  Git remote ({normalized_remote}) doesn't match trikhub.json ({github_repo})",
                fg="red",
            ))
            sys.exit(1)

    # Check entry point is committed
    entry_rel = str(manifest_path.parent.relative_to(repo_dir) / entry_module)
    if not _is_path_committed(repo_dir, entry_rel):
        click.echo(click.style(f"  Entry point not committed: {entry_rel}", fg="yellow"))

    # Verify tag exists on remote
    commit_sha = _get_remote_tag_sha(repo_dir, git_tag)
    if not commit_sha:
        click.echo(click.style(f"  Tag {git_tag} not found on remote", fg="red"))
        click.echo(f"  Create and push: git tag {git_tag} && git push origin {git_tag}")
        sys.exit(1)

    # Publish
    click.echo(f"  Publishing {manifest_data['id']}@{version} ({git_tag})...")

    async def _publish():
        async with get_registry() as registry:
            # Register trik if needed
            try:
                await registry.register_trik(
                    github_repo=github_repo,
                    name=manifest_data.get("id"),
                    description=manifest_data.get("description"),
                    categories=trikhub_json.get("categories"),
                    keywords=trikhub_json.get("keywords"),
                )
            except RuntimeError:
                pass  # Already registered

            trik_name = f"@{global_config.publisher_username}/{manifest_data['id']}"
            await registry.publish_version(
                full_name=trik_name,
                version=version,
                git_tag=git_tag,
                commit_sha=commit_sha,
                manifest=manifest_data,
            )
            click.echo(click.style(f"  Published {trik_name}@{version}", fg="green"))

    asyncio.run(_publish())


@click.command("unpublish")
@click.argument("package")
def unpublish_command(package: str) -> None:
    """Remove a trik from the registry."""
    global_config = read_global_config()
    if not global_config.auth_token or is_auth_expired(global_config):
        click.echo(click.style("  Not authenticated. Run `trik login` first.", fg="red"))
        sys.exit(1)

    click.echo(click.style(
        f"\n  WARNING: This will permanently delete {package} from the registry.\n",
        fg="red",
        bold=True,
    ))

    confirm = click.prompt("Type the trik name to confirm")
    if confirm != package:
        click.echo("  Aborted.")
        return

    async def _unpublish():
        async with get_registry() as registry:
            await registry.delete_trik(package)
            click.echo(click.style(f"  Unpublished {package}", fg="green"))

    asyncio.run(_unpublish())
