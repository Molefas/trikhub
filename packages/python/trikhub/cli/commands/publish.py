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
from trikhub.cli.output import ok, fail, info, warn
from trikhub.cli.registry import get_registry
from trikhub.linter.scanner import scan_capabilities, cross_check_manifest
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


def _extract_github_repo(url: str) -> str | None:
    """Extract owner/repo from a GitHub URL, preserving case."""
    match = re.search(r"github\.com[/:]([^/]+/[^/]+)", url)
    if not match:
        return None
    return re.sub(r"\.git$", "", match.group(1))


def _normalize_git_url(url: str) -> str:
    """Normalize a git URL for comparison (lowercased)."""
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

    # Step 1: Check auth
    global_config = read_global_config()
    if not global_config.auth_token or is_auth_expired(global_config):
        fail("Not authenticated")
        info("Run `trik login` to authenticate first")
        sys.exit(1)

    # Step 2: Find and validate manifest
    result = _find_manifest(repo_dir)
    if not result:
        fail("Missing manifest.json")
        info("Create a manifest.json file with your trik definition")
        sys.exit(1)
    manifest_path, manifest_data = result

    # Check trikhub.json
    trikhub_json = _find_trikhub_json(repo_dir)
    if not trikhub_json:
        fail("Missing trikhub.json")
        info("Create a trikhub.json file with registry metadata")
        sys.exit(1)

    # Check entry point exists
    manifest_dir = manifest_path.parent
    entry_module = manifest_data.get("entry", {}).get("module", "")
    entry_path = manifest_dir / entry_module
    if not entry_path.exists():
        fail(f"Entry point not found: {entry_module}")
        sys.exit(1)

    # Validate manifest
    validation = validate_manifest(manifest_data)
    if not validation.valid:
        fail("Validation failed")
        for error in validation.errors:
            info(f"  {error}")
        sys.exit(1)

    if validation.warnings:
        warn("Validation passed with warnings")
        for warning in validation.warnings:
            info(warning)
    else:
        ok("Validation passed")

    # Cross-check: scanner results vs manifest declarations
    manifest_dir = manifest_path.parent
    scan_result = scan_capabilities(manifest_dir)
    cross_check_errors = cross_check_manifest(scan_result, manifest_data)
    if cross_check_errors:
        fail("Capability cross-check failed")
        for err in cross_check_errors:
            location_str = ""
            if err["locations"]:
                loc = err["locations"][0]
                location_str = f" ({loc['file']}:{loc['line']})"
            info(f"  {err['message']}{location_str}")
        sys.exit(1)

    # Step 3: Determine version and git tag
    version = manifest_data.get("version", "0.1.0")
    git_tag = tag or f"v{version}"
    info(f"Version: {version}")

    # Step 4: Extract GitHub repo from trikhub.json
    repo_url = trikhub_json.get("repository", "")
    github_repo = _extract_github_repo(repo_url)

    if not github_repo:
        fail("Invalid repository URL in trikhub.json")
        info("Expected format: https://github.com/owner/repo")
        sys.exit(1)

    # Step 5: Verify git remote matches trikhub.json repository
    remote_url = _get_remote_url(repo_dir)
    if remote_url:
        normalized_remote = _normalize_git_url(remote_url)
        normalized_repo = _normalize_git_url(repo_url)
        if normalized_remote != normalized_repo:
            fail("Git remote does not match trikhub.json repository")
            info(f"trikhub.json: {repo_url}")
            info(f"git remote:   {remote_url}")
            sys.exit(1)
        ok("Git remote verified")
    else:
        fail("Not a git repository or no remote configured")
        info(f"git remote add origin {repo_url}")
        sys.exit(1)

    owner = github_repo.split("/")[0]
    trik_name = manifest_data.get("id") or manifest_data.get("name", "")
    full_name = f"@{owner}/{trik_name}"
    info(f"Trik: {full_name}")
    info(f"Repo: {github_repo}")

    # Step 6: Check entry point is committed
    entry_rel = str(manifest_path.parent.relative_to(repo_dir) / entry_module)
    if not _is_path_committed(repo_dir, entry_rel):
        fail(f"Entry module is not committed to git")
        info(f"{entry_rel} must be committed for direct GitHub installation.")
        info(f'git add "{entry_rel}"')
        info(f'git commit -m "Add entry module for publishing"')
        info("git push")
        sys.exit(1)
    ok(f"{entry_rel} is committed")

    # Step 7: Verify tag exists on remote
    commit_sha = _get_remote_tag_sha(repo_dir, git_tag)
    if not commit_sha:
        fail(f"Tag {git_tag} not found on remote")
        info("The git tag must exist on the remote before publishing.")
        info(f"git tag {git_tag}")
        info(f"git push origin {git_tag}")
        sys.exit(1)
    ok(f"Tag {git_tag} verified ({commit_sha[:8]}...)")

    # Step 8: Publish to registry
    async def _publish():
        async with get_registry() as registry:
            # Register trik if needed
            try:
                existing = await registry.get_trik(full_name)
                if not existing:
                    await registry.register_trik(
                        github_repo=github_repo,
                        name=trik_name,
                        description=manifest_data.get("description"),
                        categories=trikhub_json.get("categories"),
                        keywords=trikhub_json.get("keywords"),
                    )
                    info(f"Registered new trik: {full_name}")
            except RuntimeError:
                pass  # Already registered

            await registry.publish_version(
                full_name=full_name,
                version=version,
                git_tag=git_tag,
                commit_sha=commit_sha,
                manifest=manifest_data,
            )
            ok("Published to TrikHub registry")

    try:
        asyncio.run(_publish())
    except Exception as exc:
        fail("Failed to publish to registry")
        info(str(exc))
        sys.exit(1)

    # Success message
    click.echo()
    click.echo(click.style("  Published successfully!", fg="green", bold=True))
    click.echo()
    info(f"Install with: trik install {full_name}@{version}")
    info(f"View at: https://trikhub.com/triks/{full_name}")
    click.echo()


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
