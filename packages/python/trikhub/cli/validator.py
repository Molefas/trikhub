"""
Trik Validator

Validates trik structure before publishing.
Port of packages/js/cli/src/lib/validator.ts and publish.ts git helpers.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


# ============================================================================
# Data Types
# ============================================================================


@dataclass
class ValidationResult:
    """Validation result."""

    valid: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class ManifestLocation:
    """Location of manifest.json in a repository."""

    manifest_path: Path
    manifest_dir: Path
    package_type: str  # 'node' or 'python'


# ============================================================================
# Manifest Location
# ============================================================================


def find_manifest_path(repo_dir: Path) -> ManifestLocation | None:
    """Find the manifest.json file in a trik repository.

    Node.js packages: manifest.json at root
    Python packages: manifest.json inside package subdirectory

    Port of JS findManifestPath() in publish.ts lines 64-101.
    """
    # First, check for manifest.json at root (Node.js pattern)
    root_manifest = repo_dir / "manifest.json"
    if root_manifest.exists():
        return ManifestLocation(
            manifest_path=root_manifest,
            manifest_dir=repo_dir,
            package_type="node",
        )

    # Check if this is a Python package (has pyproject.toml or setup.py)
    has_pyproject = (repo_dir / "pyproject.toml").exists()
    has_setup_py = (repo_dir / "setup.py").exists()

    if has_pyproject or has_setup_py:
        # Python package: search subdirectories for manifest.json
        try:
            for entry in repo_dir.iterdir():
                if entry.is_dir() and not entry.name.startswith(".") and not entry.name.startswith("_"):
                    sub_manifest = entry / "manifest.json"
                    if sub_manifest.exists():
                        return ManifestLocation(
                            manifest_path=sub_manifest,
                            manifest_dir=entry,
                            package_type="python",
                        )
        except OSError:
            pass

    return None


# ============================================================================
# Validation
# ============================================================================


def validate_trik(trik_path: Path) -> ValidationResult:
    """Validate a trik at the given path.

    Port of JS validateTrik() in validator.ts lines 57-158.
    """
    errors: list[str] = []
    warnings: list[str] = []

    # 1. Check manifest.json exists
    manifest_path = trik_path / "manifest.json"
    if not manifest_path.exists():
        return ValidationResult(
            valid=False,
            errors=["Missing manifest.json"],
        )

    # 2. Parse manifest
    try:
        content = manifest_path.read_text(encoding="utf-8")
        manifest: dict[str, Any] = json.loads(content)
    except (json.JSONDecodeError, OSError) as e:
        return ValidationResult(
            valid=False,
            errors=[f"Invalid manifest.json: {e}"],
        )

    # 3. Validate required fields
    required_fields = [
        "schemaVersion",
        "id",
        "name",
        "version",
        "description",
        "entry",
        "actions",
        "capabilities",
        "limits",
    ]
    for field_name in required_fields:
        if field_name not in manifest:
            errors.append(f"Missing required field: {field_name}")

    if errors:
        return ValidationResult(valid=False, errors=errors, warnings=warnings)

    # 4. Validate entry point
    entry = manifest.get("entry", {})
    if not entry.get("module") or not entry.get("export"):
        errors.append("Invalid entry: must have module and export")
    else:
        entry_path = trik_path / entry["module"]
        if not entry_path.exists():
            errors.append(f"Entry point not found: {entry['module']}")

    # 5. Validate actions
    actions = manifest.get("actions", {})
    if not actions:
        errors.append("Manifest must define at least one action")

    # 6. Check each action for required fields
    for action_name, action in actions.items():
        response_mode = action.get("responseMode")
        if response_mode not in ("template", "passthrough"):
            errors.append(f'Action "{action_name}": Invalid responseMode "{response_mode}"')
            continue

        # Template mode: must have agentDataSchema and responseTemplates
        if response_mode == "template":
            if not action.get("agentDataSchema"):
                errors.append(f'Action "{action_name}": Template mode requires agentDataSchema')
            if not action.get("responseTemplates"):
                errors.append(f'Action "{action_name}": Template mode requires responseTemplates')

        # Passthrough mode: must have userContentSchema
        if response_mode == "passthrough":
            if not action.get("userContentSchema"):
                errors.append(f'Action "{action_name}": Passthrough mode requires userContentSchema')

    # 7. Validate limits
    limits = manifest.get("limits", {})
    if limits.get("maxExecutionTimeMs", 0) > 120000:
        warnings.append("maxExecutionTimeMs is very high (>2min)")

    return ValidationResult(
        valid=len(errors) == 0,
        errors=errors,
        warnings=warnings,
    )


def format_validation_result(result: ValidationResult) -> str:
    """Format validation result for display."""
    lines: list[str] = []

    if result.valid:
        lines.append("Validation passed")
    else:
        lines.append("Validation failed")

    for error in result.errors:
        lines.append(f"  [error] {error}")

    for warning in result.warnings:
        lines.append(f"  [warn] {warning}")

    return "\n".join(lines)


# ============================================================================
# Git Helpers
# ============================================================================


def get_remote_tag_commit_sha(repo_dir: Path, tag: str) -> str | None:
    """Get the commit SHA that a tag points to on the remote.

    Port of JS getRemoteTagCommitSha() in publish.ts lines 106-139.
    """
    try:
        # First try to get the tag's commit from the remote
        result = subprocess.run(
            ["git", "ls-remote", "--tags", "origin", f"refs/tags/{tag}"],
            cwd=repo_dir,
            capture_output=True,
            text=True,
            check=False,
        )

        if result.returncode != 0 or not result.stdout.strip():
            return None

        # Format is: "sha\trefs/tags/tagname"
        sha = result.stdout.strip().split("\t")[0]

        # If it's an annotated tag, we need to dereference it to get the commit SHA
        deref_result = subprocess.run(
            ["git", "ls-remote", "--tags", "origin", f"refs/tags/{tag}^{{}}"],
            cwd=repo_dir,
            capture_output=True,
            text=True,
            check=False,
        )

        if deref_result.returncode == 0 and deref_result.stdout.strip():
            # Annotated tag - use dereferenced commit
            return deref_result.stdout.strip().split("\t")[0]

        # Lightweight tag - use the SHA directly
        return sha
    except Exception:
        return None


def is_path_committed(repo_dir: Path, relative_path: str) -> bool:
    """Check if a file/directory is committed (not ignored).

    Port of JS isPathCommitted() in publish.ts lines 162-174.
    """
    try:
        result = subprocess.run(
            ["git", "ls-files", relative_path],
            cwd=repo_dir,
            capture_output=True,
            text=True,
            check=False,
        )
        return bool(result.stdout.strip())
    except Exception:
        return False


def is_dist_committed(repo_dir: Path) -> bool:
    """Check if the dist/ directory is committed (not ignored).

    Port of JS isDistCommitted() in publish.ts lines 144-157.
    """
    return is_path_committed(repo_dir, "dist/")


def get_git_remote_url(repo_dir: Path) -> str | None:
    """Get the origin remote URL."""
    try:
        result = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            cwd=repo_dir,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 0:
            return result.stdout.strip()
        return None
    except Exception:
        return None


def normalize_git_url(url: str) -> str:
    """Normalize a git URL for comparison.

    Handles SSH and HTTPS variants.
    """
    return (
        url.replace("git@github.com:", "github.com/")
        .replace("https://", "")
        .replace("http://", "")
        .rstrip(".git")
        .lower()
    )
