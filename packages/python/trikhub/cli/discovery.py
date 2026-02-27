"""Trik discovery for Python packages.

Discovers triks installed via pip in site-packages and in local directories.
"""

from __future__ import annotations

import importlib.metadata
import json
import sys
from dataclasses import dataclass
from pathlib import Path

from trikhub.manifest import TrikManifest, validate_manifest


@dataclass
class DiscoveredTrik:
    package_name: str
    trik_id: str
    version: str
    path: Path
    manifest: TrikManifest
    description: str = ""
    runtime: str = "python"


def find_manifest_in_package(package_path: Path) -> Path | None:
    manifest_path = package_path / "manifest.json"
    if manifest_path.exists():
        return manifest_path
    for child in package_path.iterdir():
        if child.is_dir() and not child.name.startswith(("_", ".")):
            manifest_path = child / "manifest.json"
            if manifest_path.exists():
                return manifest_path
    return None


def load_trik_manifest(package_path: Path) -> tuple[TrikManifest, Path] | None:
    manifest_path = find_manifest_in_package(package_path)
    if not manifest_path:
        return None
    try:
        manifest_data = json.loads(manifest_path.read_text(encoding="utf-8"))
        validation = validate_manifest(manifest_data)
        if not validation.valid:
            return None
        manifest = TrikManifest.model_validate(manifest_data)
        return manifest, manifest_path.parent
    except (json.JSONDecodeError, OSError, Exception):
        return None


def discover_triks_in_site_packages() -> list[DiscoveredTrik]:
    discovered: list[DiscoveredTrik] = []
    seen_packages: set[str] = set()

    for dist in importlib.metadata.distributions():
        package_name = dist.metadata.get("Name", "")
        if not package_name or package_name in seen_packages:
            continue
        seen_packages.add(package_name)

        try:
            if dist.files:
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
            continue

    return discovered


def discover_triks_in_directory(directory: Path) -> list[DiscoveredTrik]:
    discovered: list[DiscoveredTrik] = []
    if not directory.exists() or not directory.is_dir():
        return discovered

    for entry in directory.iterdir():
        if not entry.is_dir() or entry.name.startswith((".", "_")):
            continue

        if entry.name.startswith("@"):
            for scoped_entry in entry.iterdir():
                if not scoped_entry.is_dir() or scoped_entry.name.startswith((".", "_")):
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


def get_package_info(package_name: str) -> dict[str, str] | None:
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
