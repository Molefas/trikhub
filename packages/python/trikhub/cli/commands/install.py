"""trik install / uninstall — manage trik installations."""

from __future__ import annotations

import asyncio
import re
import shutil
import subprocess
import sys
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

    # Auto-install npm deps for Node triks
    package_json = target / "package.json"
    if package_json.exists():
        subprocess.run(
            ["npm", "install", "--production"],
            cwd=str(target),
            check=False,
            capture_output=True,
        )

    return target


async def _install_from_registry(
    registry: RegistryClient, package_name: str, version: str | None,
) -> None:
    """Install a trik from the TrikHub registry."""
    trik = await registry.get_trik(package_name)
    if not trik:
        raise FileNotFoundError(f"Trik not found: {package_name}")

    install_version = version or trik.latest_version
    runtime = trik.runtime

    if runtime == "python":
        # Python triks: install via pip from git
        git_tag = f"v{install_version}"
        pip_url = f"git+https://github.com/{trik.github_repo}@{git_tag}"
        click.echo(f"  Installing {package_name}@{install_version} via pip...")
        subprocess.run(
            [sys.executable, "-m", "pip", "install", pip_url, "--quiet"],
            check=True,
        )
    else:
        # Node triks: shallow clone to .trikhub/triks/
        git_tag = f"v{install_version}"
        click.echo(f"  Downloading {package_name}@{install_version}...")
        _download_to_triks_directory(trik.github_repo, git_tag, package_name)

    add_trik_to_config(package_name, trikhub_version=install_version, runtime=runtime)

    # Report download (analytics, non-blocking)
    await registry.report_download(package_name, install_version)

    click.echo(click.style(f"  Installed {package_name}@{install_version}", fg="green"))


@click.command("install")
@click.argument("package")
@click.option("-v", "--version", default=None, help="Specific version to install")
def install_command(package: str, version: str | None) -> None:
    """Install a trik from the TrikHub registry."""
    package_name, parsed_version = _parse_package_spec(package)
    version = version or parsed_version

    async def _install():
        async with get_registry() as registry:
            await _install_from_registry(registry, package_name, version)

    asyncio.run(_install())


@click.command("uninstall")
@click.argument("package")
def uninstall_command(package: str) -> None:
    """Uninstall a trik."""
    config = read_config()
    runtime = config.runtimes.get(package, "python")

    if not remove_trik_from_config(package):
        click.echo(click.style(f"  Trik not found in config: {package}", fg="yellow"))
        return

    if runtime == "node":
        triks_dir = get_config_dir() / "triks"
        if package.startswith("@"):
            parts = package.split("/", 1)
            target = triks_dir / parts[0] / parts[1]
        else:
            target = triks_dir / package
        if target.exists():
            shutil.rmtree(target)
            click.echo(f"  Removed {target}")
    else:
        pip_names = _get_pip_package_names(package)
        for pip_name in pip_names:
            try:
                subprocess.run(
                    [sys.executable, "-m", "pip", "uninstall", pip_name, "-y", "--quiet"],
                    check=True,
                    capture_output=True,
                    text=True,
                )
                break
            except subprocess.CalledProcessError:
                continue

    click.echo(click.style(f"  Uninstalled {package}", fg="green"))
