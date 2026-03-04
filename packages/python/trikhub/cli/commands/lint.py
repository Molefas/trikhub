"""trik lint — validate a trik for security and correctness."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import click

from trikhub.cli.output import ok, fail, warn, info
from trikhub.linter.scanner import scan_capabilities, format_scan_result, adjust_tier_for_manifest
from trikhub.manifest import validate_manifest


def _find_manifest(trik_dir: Path) -> tuple[Path, dict] | None:
    """Find and parse manifest.json in the trik directory."""
    manifest_path = trik_dir / "manifest.json"
    if not manifest_path.exists():
        # Check subdirectories for Python package layout
        for child in trik_dir.iterdir():
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


@click.command("lint")
@click.argument("path", default=".")
@click.option("--warnings-as-errors", is_flag=True, help="Treat warnings as errors")
@click.option("--skip", multiple=True, help="Skip a specific rule (can be repeated)")
def lint_command(path: str, warnings_as_errors: bool, skip: tuple[str, ...]) -> None:
    """Validate a trik for security and correctness."""
    trik_dir = Path(path).resolve()

    click.echo(f"Linting trik at: {trik_dir}\n")

    # Find manifest
    result = _find_manifest(trik_dir)
    if not result:
        # Still show scan even without manifest
        scan_result = scan_capabilities(trik_dir)
        click.echo(format_scan_result(scan_result))
        click.echo("")
        fail("Missing manifest.json")
        info("Create a manifest.json file with your trik definition")
        info("For Node.js triks: place manifest.json at repository root")
        info("For Python triks: place manifest.json inside your package directory")
        sys.exit(1)

    manifest_path, manifest_data = result
    ok("manifest.json found")

    # Capability scan — adjusted for manifest-declared capabilities
    scan_result = scan_capabilities(trik_dir)
    scan_result = adjust_tier_for_manifest(scan_result, manifest_data)
    click.echo(format_scan_result(scan_result))
    click.echo("")

    # Check filesystem/shell/trikManagement capability rules
    caps = manifest_data.get("capabilities") or {}
    fs_enabled = (caps.get("filesystem") or {}).get("enabled") is True
    shell_enabled = (caps.get("shell") or {}).get("enabled") is True
    trik_mgmt_enabled = (caps.get("trikManagement") or {}).get("enabled") is True
    agent_mode = (manifest_data.get("agent") or {}).get("mode", "")

    if agent_mode == "tool":
        if fs_enabled:
            warn("Tool-mode triks should not declare filesystem capabilities. "
                 "Filesystem and shell tools are designed for conversational triks.")
        if shell_enabled:
            warn("Tool-mode triks should not declare shell capabilities. "
                 "Filesystem and shell tools are designed for conversational triks.")
        if trik_mgmt_enabled:
            warn("Tool-mode triks with trikManagement capability must ensure all "
                 "outputs use TDPS-safe types in their outputSchema.")

    if fs_enabled or shell_enabled:
        cap_list = " and ".join(
            c for c in ["filesystem", "shell"] if (c == "filesystem" and fs_enabled) or (c == "shell" and shell_enabled)
        )
        info(f"This trik declares {cap_list} capabilities and requires Docker for execution.")

    if trik_mgmt_enabled:
        info("This trik declares trikManagement capabilities and can search, install, uninstall, and upgrade triks.")

    # Check entry point exists
    manifest_dir = manifest_path.parent
    entry_module = manifest_data.get("entry", {}).get("module", "")
    if entry_module:
        entry_path = manifest_dir / entry_module
        if entry_path.exists():
            ok(f"Entry point exists: {entry_module}")
        else:
            fail(f"Entry point not found: {entry_module}")
    else:
        fail("No entry.module defined in manifest")

    # Run validation
    validation = validate_manifest(manifest_data)

    has_errors = False
    if not validation.valid:
        fail("Validation failed")
        if validation.errors:
            for error in validation.errors:
                if any(s in error for s in skip):
                    continue
                info(error)
                has_errors = True
    elif validation.warnings:
        filtered_warnings = [w for w in validation.warnings if not any(s in w for s in skip)]
        if filtered_warnings:
            if warnings_as_errors:
                fail("Validation failed (warnings treated as errors)")
                for w in filtered_warnings:
                    info(w)
                has_errors = True
            else:
                warn("Validation passed with warnings")
                for w in filtered_warnings:
                    info(w)
        else:
            ok("Validation passed")
    else:
        ok("Validation passed")

    if has_errors or (not validation.valid):
        sys.exit(1)
