"""
Trik discovery for Python packages.

Discovers triks installed via pip in site-packages.
"""

from __future__ import annotations

import importlib.metadata
import importlib.util
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from trikhub.manifest import TrikManifest, validate_manifest


# ============================================================================
# Data Types
# ============================================================================


@dataclass
class DiscoveredTrik:
    """Information about a discovered trik package."""

    package_name: str
    trik_id: str
    version: str
    path: Path
    manifest: TrikManifest
    description: str = ""
    runtime: str = "python"


# ============================================================================
# Discovery Functions
# ============================================================================


def get_site_packages_dirs() -> list[Path]:
    """Get all site-packages directories."""
    dirs: list[Path] = []

    for path_str in sys.path:
        path = Path(path_str)
        if path.exists() and path.is_dir():
            if "site-packages" in path.name or "dist-packages" in path.name:
                dirs.append(path)

    return dirs


def find_manifest_in_package(package_path: Path) -> Path | None:
    """Find manifest.json in a package directory."""
    # Check direct manifest.json
    manifest_path = package_path / "manifest.json"
    if manifest_path.exists():
        return manifest_path

    # Check for manifest in subdirectories (e.g., src layout)
    for child in package_path.iterdir():
        if child.is_dir() and not child.name.startswith(("_", ".")):
            manifest_path = child / "manifest.json"
            if manifest_path.exists():
                return manifest_path

    return None


def is_trik_package(package_path: Path) -> bool:
    """Check if a package directory contains a valid trik manifest."""
    manifest_path = find_manifest_in_package(package_path)
    if not manifest_path:
        return False

    try:
        content = manifest_path.read_text(encoding="utf-8")
        manifest_data = json.loads(content)
        validation = validate_manifest(manifest_data)
        return validation.valid
    except (json.JSONDecodeError, OSError):
        return False


def load_trik_manifest(package_path: Path) -> tuple[TrikManifest, Path] | None:
    """Load and parse a trik manifest from a package."""
    manifest_path = find_manifest_in_package(package_path)
    if not manifest_path:
        return None

    try:
        content = manifest_path.read_text(encoding="utf-8")
        manifest_data = json.loads(content)
        validation = validate_manifest(manifest_data)
        if not validation.valid:
            return None
        manifest = TrikManifest.model_validate(manifest_data)
        return manifest, manifest_path.parent
    except (json.JSONDecodeError, OSError, Exception):
        return None


def discover_triks_in_site_packages() -> list[DiscoveredTrik]:
    """Discover all trik packages installed in site-packages."""
    discovered: list[DiscoveredTrik] = []
    seen_packages: set[str] = set()

    # Get all installed packages via importlib.metadata
    for dist in importlib.metadata.distributions():
        package_name = dist.metadata.get("Name", "")
        if not package_name or package_name in seen_packages:
            continue
        seen_packages.add(package_name)

        # Try to find the package location
        try:
            # Get the package's top-level modules
            if dist.files:
                # Find the package root
                for file in dist.files:
                    if file.name == "manifest.json":
                        package_path = Path(str(dist.locate_file(file))).parent
                        result = load_trik_manifest(package_path)
                        if result:
                            manifest, trik_path = result
                            runtime = manifest.entry.runtime if manifest.entry else "python"
                            discovered.append(
                                DiscoveredTrik(
                                    package_name=package_name,
                                    trik_id=manifest.id,
                                    version=dist.version,
                                    path=trik_path,
                                    manifest=manifest,
                                    description=manifest.description,
                                    runtime=runtime,
                                )
                            )
                        break
        except Exception:
            # Skip packages we can't inspect
            continue

    return discovered


def discover_triks_in_directory(directory: Path) -> list[DiscoveredTrik]:
    """
    Discover triks in a specific directory.

    Supports scoped directory structure: directory/@scope/trik-name/
    """
    discovered: list[DiscoveredTrik] = []

    if not directory.exists() or not directory.is_dir():
        return discovered

    for entry in directory.iterdir():
        if not entry.is_dir():
            continue

        # Skip hidden and special directories
        if entry.name.startswith((".", "_")):
            continue

        # Handle scoped packages (@scope/name)
        if entry.name.startswith("@"):
            for scoped_entry in entry.iterdir():
                if not scoped_entry.is_dir():
                    continue
                if scoped_entry.name.startswith((".", "_")):
                    continue

                result = load_trik_manifest(scoped_entry)
                if result:
                    manifest, trik_path = result
                    package_name = f"{entry.name}/{scoped_entry.name}"
                    runtime = manifest.entry.runtime if manifest.entry else "python"
                    discovered.append(
                        DiscoveredTrik(
                            package_name=package_name,
                            trik_id=manifest.id,
                            version=manifest.version,
                            path=trik_path,
                            manifest=manifest,
                            description=manifest.description,
                            runtime=runtime,
                        )
                    )
        else:
            # Regular package
            result = load_trik_manifest(entry)
            if result:
                manifest, trik_path = result
                runtime = manifest.entry.runtime if manifest.entry else "python"
                discovered.append(
                    DiscoveredTrik(
                        package_name=entry.name,
                        trik_id=manifest.id,
                        version=manifest.version,
                        path=trik_path,
                        manifest=manifest,
                        description=manifest.description,
                        runtime=runtime,
                    )
                )

    return discovered


def get_package_info(package_name: str) -> dict[str, Any] | None:
    """Get information about an installed Python package."""
    try:
        dist = importlib.metadata.distribution(package_name)
        return {
            "name": dist.metadata.get("Name", package_name),
            "version": dist.version,
            "description": dist.metadata.get("Summary", ""),
            "author": dist.metadata.get("Author", ""),
        }
    except importlib.metadata.PackageNotFoundError:
        return None
