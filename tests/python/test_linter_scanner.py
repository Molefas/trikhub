"""Tests for trikhub.linter.scanner — capability scanning."""

from __future__ import annotations

from pathlib import Path

import pytest

from trikhub.linter.scanner import scan_capabilities, format_scan_result, adjust_tier_for_manifest


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
