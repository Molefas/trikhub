"""Tests for trikhub.linter.scanner — capability scanning."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from trikhub.linter.scanner import scan_capabilities, format_scan_result, adjust_tier_for_manifest, cross_check_manifest


def _write(path: Path, content: str) -> None:
    """Helper to write a file, creating parent dirs as needed."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


# ── Capability detection ─────────────────────────────────────────────────


def test_detects_filesystem_in_js_files(tmp_path: Path) -> None:
    _write(tmp_path / "index.js", "const fs = require('node:fs');\n")
    result = scan_capabilities(tmp_path)
    categories = [c["category"] for c in result["capabilities"]]
    assert "filesystem" in categories


def test_detects_network_in_python_files(tmp_path: Path) -> None:
    _write(tmp_path / "main.py", "import requests\n")
    result = scan_capabilities(tmp_path)
    categories = [c["category"] for c in result["capabilities"]]
    assert "network" in categories


def test_detects_process_execution(tmp_path: Path) -> None:
    _write(tmp_path / "run.py", "import subprocess\n")
    result = scan_capabilities(tmp_path)
    categories = [c["category"] for c in result["capabilities"]]
    assert "process" in categories


def test_detects_environment_access(tmp_path: Path) -> None:
    _write(tmp_path / "config.py", "val = os.environ['KEY']\n")
    result = scan_capabilities(tmp_path)
    categories = [c["category"] for c in result["capabilities"]]
    assert "environment" in categories


# ── Tier resolution ──────────────────────────────────────────────────────


def test_clean_trik_is_tier_a(tmp_path: Path) -> None:
    _write(tmp_path / "index.js", "console.log('hello');\n")
    result = scan_capabilities(tmp_path)
    assert result["tier"] == "A"
    assert result["tier_label"] == "Sandboxed"
    assert result["capabilities"] == []


def test_network_only_is_tier_b(tmp_path: Path) -> None:
    _write(tmp_path / "api.py", "import requests\n")
    result = scan_capabilities(tmp_path)
    assert result["tier"] == "B"
    assert result["tier_label"] == "Network"


def test_filesystem_is_tier_c(tmp_path: Path) -> None:
    _write(tmp_path / "io.py", "import pathlib\n")
    result = scan_capabilities(tmp_path)
    assert result["tier"] == "C"
    assert result["tier_label"] == "System"


def test_process_is_tier_d(tmp_path: Path) -> None:
    _write(tmp_path / "run.py", "import subprocess\n")
    result = scan_capabilities(tmp_path)
    assert result["tier"] == "D"
    assert result["tier_label"] == "Unrestricted"


# ── Excluded directories ─────────────────────────────────────────────────


def test_skips_excluded_dirs(tmp_path: Path) -> None:
    # Files inside excluded dirs should NOT be scanned
    _write(tmp_path / "node_modules" / "dep.js", "const fs = require('fs');\n")
    _write(tmp_path / "dist" / "bundle.js", "const fs = require('fs');\n")
    # A clean top-level file
    _write(tmp_path / "index.js", "console.log('clean');\n")
    result = scan_capabilities(tmp_path)
    assert result["tier"] == "A"
    assert result["capabilities"] == []


# ── Location references ──────────────────────────────────────────────────


def test_includes_file_and_line_references(tmp_path: Path) -> None:
    _write(
        tmp_path / "main.py",
        "# line 1\nimport requests\n# line 3\nimport subprocess\n",
    )
    result = scan_capabilities(tmp_path)
    # Should have network and process capabilities
    cap_map = {c["category"]: c["locations"] for c in result["capabilities"]}

    assert "network" in cap_map
    net_loc = cap_map["network"]
    assert len(net_loc) == 1
    assert net_loc[0]["file"] == "main.py"
    assert net_loc[0]["line"] == 2

    assert "process" in cap_map
    proc_loc = cap_map["process"]
    assert len(proc_loc) == 1
    assert proc_loc[0]["file"] == "main.py"
    assert proc_loc[0]["line"] == 4


# ── Tier adjustment for manifest capabilities ────────────────────────────


def test_adjust_tier_filesystem_to_c(tmp_path: Path) -> None:
    _write(tmp_path / "index.js", "console.log('clean');\n")
    scan = scan_capabilities(tmp_path)
    assert scan["tier"] == "A"
    adjusted = adjust_tier_for_manifest(scan, {"capabilities": {"filesystem": {"enabled": True}}})
    assert adjusted["tier"] == "C"
    assert adjusted["tier_label"] == "System"


def test_adjust_tier_shell_to_d(tmp_path: Path) -> None:
    _write(tmp_path / "index.js", "console.log('clean');\n")
    scan = scan_capabilities(tmp_path)
    adjusted = adjust_tier_for_manifest(scan, {"capabilities": {"shell": {"enabled": True}}})
    assert adjusted["tier"] == "D"
    assert adjusted["tier_label"] == "Unrestricted"


def test_adjust_tier_trik_management_to_c(tmp_path: Path) -> None:
    _write(tmp_path / "index.js", "console.log('clean');\n")
    scan = scan_capabilities(tmp_path)
    assert scan["tier"] == "A"
    adjusted = adjust_tier_for_manifest(scan, {"capabilities": {"trikManagement": {"enabled": True}}})
    assert adjusted["tier"] == "C"
    assert adjusted["tier_label"] == "System"


def test_adjust_tier_no_downgrade(tmp_path: Path) -> None:
    _write(tmp_path / "run.py", "import subprocess\n")
    scan = scan_capabilities(tmp_path)
    assert scan["tier"] == "D"
    adjusted = adjust_tier_for_manifest(scan, {"capabilities": {"trikManagement": {"enabled": True}}})
    # trikManagement implies C, but code is already D — stays D
    assert adjusted["tier"] == "D"


def test_adjust_tier_no_caps(tmp_path: Path) -> None:
    _write(tmp_path / "index.js", "console.log('clean');\n")
    scan = scan_capabilities(tmp_path)
    adjusted = adjust_tier_for_manifest(scan, {"capabilities": {"session": {"enabled": True}}})
    assert adjusted["tier"] == "A"


# ── SDK context detection ─────────────────────────────────────────────────

def test_detects_storage_context_usage(tmp_path: Path) -> None:
    _write(tmp_path / "agent.py", "val = await context.storage.get('key')\n")
    result = scan_capabilities(tmp_path)
    categories = [c["category"] for c in result["capabilities"]]
    assert "storage" in categories


def test_detects_registry_context_usage(tmp_path: Path) -> None:
    _write(tmp_path / "agent.py", "results = await context.registry.search('test')\n")
    result = scan_capabilities(tmp_path)
    categories = [c["category"] for c in result["capabilities"]]
    assert "trik_management" in categories


def test_detects_dynamic_import(tmp_path: Path) -> None:
    _write(tmp_path / "agent.py", "mod = __import__('os')\n")
    result = scan_capabilities(tmp_path)
    categories = [c["category"] for c in result["capabilities"]]
    assert "dynamic_code" in categories


def test_detects_dynamic_js_import(tmp_path: Path) -> None:
    _write(tmp_path / "index.js", "const mod = await import(someVar);\n")
    result = scan_capabilities(tmp_path)
    categories = [c["category"] for c in result["capabilities"]]
    assert "dynamic_code" in categories


def test_static_import_not_flagged_as_dynamic(tmp_path: Path) -> None:
    _write(tmp_path / "index.js", "const mod = await import('./local');\n")
    result = scan_capabilities(tmp_path)
    categories = [c["category"] for c in result["capabilities"]]
    assert "dynamic_code" not in categories


# ── Cross-check: scanner vs manifest ──────────────────────────────────────

def test_xcheck_filesystem_undeclared(tmp_path: Path) -> None:
    _write(tmp_path / "index.js", "import fs from 'node:fs';\n")
    scan = scan_capabilities(tmp_path)
    manifest = {"capabilities": {}}
    errors = cross_check_manifest(scan, manifest)
    assert any(e["capability"] == "filesystem" for e in errors)


def test_xcheck_filesystem_declared(tmp_path: Path) -> None:
    _write(tmp_path / "index.js", "import fs from 'node:fs';\n")
    scan = scan_capabilities(tmp_path)
    manifest = {"capabilities": {"filesystem": {"enabled": True}}}
    errors = cross_check_manifest(scan, manifest)
    assert errors == []


def test_xcheck_shell_undeclared(tmp_path: Path) -> None:
    _write(tmp_path / "run.py", "import subprocess\n")
    scan = scan_capabilities(tmp_path)
    manifest = {"capabilities": {}}
    errors = cross_check_manifest(scan, manifest)
    assert any(e["capability"] == "shell" for e in errors)


def test_xcheck_storage_undeclared(tmp_path: Path) -> None:
    _write(tmp_path / "agent.py", "val = await context.storage.get('key')\n")
    scan = scan_capabilities(tmp_path)
    manifest = {"capabilities": {}}
    errors = cross_check_manifest(scan, manifest)
    assert any(e["capability"] == "storage" for e in errors)


def test_xcheck_registry_undeclared(tmp_path: Path) -> None:
    _write(tmp_path / "agent.py", "r = await context.registry.search('q')\n")
    scan = scan_capabilities(tmp_path)
    manifest = {"capabilities": {}}
    errors = cross_check_manifest(scan, manifest)
    assert any(e["capability"] == "trikManagement" for e in errors)


def test_xcheck_dynamic_code_flagged(tmp_path: Path) -> None:
    _write(tmp_path / "agent.py", "mod = __import__('os')\n")
    scan = scan_capabilities(tmp_path)
    manifest = {"capabilities": {}}
    errors = cross_check_manifest(scan, manifest)
    assert any(e["category"] == "dynamic_code" for e in errors)


# ── Integration: scan + cross-check via lint pipeline ─────────────────────


def test_lint_cross_check_fails_on_undeclared_subprocess(tmp_path: Path) -> None:
    """Integration: scan + cross-check detects undeclared process usage."""
    manifest = {
        "schemaVersion": 2,
        "id": "xcheck-test",
        "name": "xcheck-test",
        "description": "test",
        "version": "1.0.0",
        "agent": {"mode": "conversational", "handoffDescription": "test test test", "systemPrompt": "test", "domain": ["t"]},
        "entry": {"module": "agent.py", "export": "default"},
        "capabilities": {},
    }
    _write(tmp_path / "manifest.json", json.dumps(manifest))
    _write(tmp_path / "agent.py", "import subprocess\n")

    scan = scan_capabilities(tmp_path)
    errors = cross_check_manifest(scan, manifest)
    assert len(errors) > 0
    assert any(e["capability"] == "shell" for e in errors)
