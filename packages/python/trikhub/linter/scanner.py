"""Capability scanner — detects system capabilities used by trik source files.

Mirrors the JS implementation at packages/js/linter/src/scanner.ts.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import TypedDict

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

SecurityTier = str  # "A" | "B" | "C" | "D"

CapabilityCategory = str  # filesystem | network | process | environment | crypto | dns | workers


class Location(TypedDict):
    file: str
    line: int


class CapabilityMatch(TypedDict):
    category: str
    locations: list[Location]


class ScanResult(TypedDict):
    tier: str
    tier_label: str
    capabilities: list[CapabilityMatch]


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SOURCE_EXTENSIONS: set[str] = {
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
}

EXCLUDED_DIRS: set[str] = {
    "node_modules",
    ".git",
    "dist",
    "build",
    "__pycache__",
    ".venv",
    ".tox",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
}

# ---------------------------------------------------------------------------
# Capability regex patterns (matched per-line)
# ---------------------------------------------------------------------------

CAPABILITY_PATTERNS: dict[str, list[re.Pattern[str]]] = {
    "filesystem": [
        re.compile(r"""\b(?:require|import)\s*\(?\s*['"](?:node:)?fs(?:/promises)?['"]"""),
        re.compile(r"""\bfrom\s+['"](?:node:)?fs(?:/promises)?['"]"""),
        re.compile(r"""\bimport\s+(?:pathlib|shutil)\b"""),
        re.compile(r"""\bfrom\s+(?:pathlib|shutil)\s+import\b"""),
        re.compile(r"""\bimport\s+os\.path\b"""),
        re.compile(r"""\bfrom\s+os\.path\s+import\b"""),
        re.compile(r"""\bfrom\s+os\s+import\s+path\b"""),
    ],
    "network": [
        re.compile(r"""\b(?:require|import)\s*\(?\s*['"](?:node:)?(?:http|https|net)['"]"""),
        re.compile(r"""\bfrom\s+['"](?:node:)?(?:http|https|net)['"]"""),
        re.compile(r"""\bfetch\s*\("""),
        re.compile(r"""\b(?:require|import)\s*\(?\s*['"]axios['"]"""),
        re.compile(r"""\bfrom\s+['"]axios['"]"""),
        re.compile(r"""\bimport\s+(?:requests|urllib|httpx|aiohttp)\b"""),
        re.compile(r"""\bfrom\s+(?:requests|urllib|httpx|aiohttp)[\s.]"""),
    ],
    "process": [
        re.compile(r"""\b(?:require|import)\s*\(?\s*['"](?:node:)?child_process['"]"""),
        re.compile(r"""\bfrom\s+['"](?:node:)?child_process['"]"""),
        re.compile(r"""\beval\s*\("""),
        re.compile(r"""\bnew\s+Function\s*\("""),
        re.compile(r"""\bimport\s+subprocess\b"""),
        re.compile(r"""\bfrom\s+subprocess\s+import\b"""),
        re.compile(r"""\bos\.system\s*\("""),
        # Negative lookbehind: avoid matching regex.exec() etc.
        # Python lookbehinds must be fixed width, so (?<!\.\s*) becomes (?<!\.)
        re.compile(r"""(?<!\.)exec\s*\("""),
    ],
    "environment": [
        re.compile(r"""\bprocess\.env\b"""),
        re.compile(r"""\bos\.environ\b"""),
        re.compile(r"""\b(?:require|import)\s*\(?\s*['"]dotenv['"]"""),
        re.compile(r"""\bfrom\s+['"]dotenv['"]"""),
        re.compile(r"""\bimport\s+dotenv\b"""),
        re.compile(r"""\bfrom\s+dotenv\s+import\b"""),
    ],
    "crypto": [
        re.compile(r"""\b(?:require|import)\s*\(?\s*['"](?:node:)?(?:crypto|tls)['"]"""),
        re.compile(r"""\bfrom\s+['"](?:node:)?(?:crypto|tls)['"]"""),
        re.compile(r"""\bimport\s+(?:hashlib|ssl|cryptography)\b"""),
        re.compile(r"""\bfrom\s+(?:hashlib|ssl|cryptography)[\s.]"""),
    ],
    "dns": [
        re.compile(r"""\b(?:require|import)\s*\(?\s*['"](?:node:)?(?:dns|dgram)['"]"""),
        re.compile(r"""\bfrom\s+['"](?:node:)?(?:dns|dgram)['"]"""),
    ],
    "workers": [
        re.compile(r"""\b(?:require|import)\s*\(?\s*['"](?:node:)?(?:worker_threads|cluster)['"]"""),
        re.compile(r"""\bfrom\s+['"](?:node:)?(?:worker_threads|cluster)['"]"""),
        re.compile(r"""\bimport\s+(?:threading|multiprocessing)\b"""),
        re.compile(r"""\bfrom\s+(?:threading|multiprocessing)\s+import\b"""),
    ],
}

# ---------------------------------------------------------------------------
# Tier labels
# ---------------------------------------------------------------------------

TIER_LABELS: dict[str, str] = {
    "A": "Sandboxed",
    "B": "Network",
    "C": "System",
    "D": "Unrestricted",
}

# ---------------------------------------------------------------------------
# Tier resolution
# ---------------------------------------------------------------------------


def _resolve_tier(categories: set[str]) -> str:
    """Determine the security tier from the set of detected capability categories.

    Tier logic:
      A (Sandboxed)     — no capabilities detected
      B (Network)       — only network and/or crypto detected
      C (System)        — filesystem, environment, or dns detected
      D (Unrestricted)  — process or workers detected
    """
    if not categories:
        return "A"

    # D: process or workers present
    if "process" in categories or "workers" in categories:
        return "D"

    # C: filesystem, environment, or dns present
    if "filesystem" in categories or "environment" in categories or "dns" in categories:
        return "C"

    # If only network and/or crypto remain, tier is B
    for cat in categories:
        if cat not in ("network", "crypto"):
            return "C"  # safety fallback — should not be reached

    return "B"


# ---------------------------------------------------------------------------
# File walking
# ---------------------------------------------------------------------------


def _walk_source_files(dir_path: Path) -> list[Path]:
    """Recursively collect source file paths under ``dir_path``, skipping excluded dirs."""
    results: list[Path] = []

    def walk(current: Path) -> None:
        try:
            entries = list(current.iterdir())
        except (PermissionError, OSError):
            # Permission error or missing dir — skip silently
            return

        for entry in entries:
            if entry.is_dir():
                if entry.name not in EXCLUDED_DIRS and not entry.name.startswith("."):
                    walk(entry)
            elif entry.is_file():
                if entry.suffix in SOURCE_EXTENSIONS:
                    results.append(entry)

    walk(dir_path)
    return results


# ---------------------------------------------------------------------------
# Core scanner
# ---------------------------------------------------------------------------


def scan_capabilities(trik_path: Path | str) -> ScanResult:
    """Scan all source files under ``trik_path`` for capability usage.

    Walks ``.ts``, ``.tsx``, ``.js``, ``.jsx``, ``.mjs``, ``.cjs``, and ``.py``
    files, matches regex patterns per line against capability categories, and
    returns the resolved security tier together with all capability matches.
    """
    trik_path = Path(trik_path)
    files = _walk_source_files(trik_path)

    # category -> [Location, ...]
    match_map: dict[str, list[Location]] = {}

    for file_path in files:
        try:
            content = file_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue  # unreadable file — skip

        lines = content.split("\n")
        rel_path = os.path.relpath(file_path, trik_path)

        for i, line_text in enumerate(lines):
            for category, patterns in CAPABILITY_PATTERNS.items():
                for pattern in patterns:
                    if pattern.search(line_text):
                        if category not in match_map:
                            match_map[category] = []
                        match_map[category].append({"file": rel_path, "line": i + 1})
                        # One match per category per line is enough — break out of patterns
                        break

    capabilities: list[CapabilityMatch] = []
    for category, locations in match_map.items():
        capabilities.append({"category": category, "locations": locations})

    detected_categories = set(match_map.keys())
    tier = _resolve_tier(detected_categories)

    return {
        "tier": tier,
        "tier_label": TIER_LABELS[tier],
        "capabilities": capabilities,
    }


# ---------------------------------------------------------------------------
# Tier adjustment for manifest capabilities
# ---------------------------------------------------------------------------

TIER_ORDER: dict[str, int] = {"A": 0, "B": 1, "C": 2, "D": 3}


def adjust_tier_for_manifest(scan: ScanResult, manifest: dict) -> ScanResult:
    """Adjust scan tier based on manifest-declared capabilities.

    The source scanner only sees code-level imports. But manifest capabilities
    (filesystem, shell, trikManagement) are auto-injected at runtime by the SDK.
    The effective tier must account for both.

    - filesystem.enabled → at least tier C (System)
    - trikManagement.enabled → at least tier C (System)
    - shell.enabled → at least tier D (Unrestricted — process execution)
    """
    caps = manifest.get("capabilities") or {}
    fs_enabled = (caps.get("filesystem") or {}).get("enabled") is True
    shell_enabled = (caps.get("shell") or {}).get("enabled") is True
    trik_mgmt_enabled = (caps.get("trikManagement") or {}).get("enabled") is True

    if not fs_enabled and not shell_enabled and not trik_mgmt_enabled:
        return scan

    current_tier = scan["tier"]

    if shell_enabled and TIER_ORDER.get(current_tier, 0) < TIER_ORDER["D"]:
        implied_tier = "D"
    elif (fs_enabled or trik_mgmt_enabled) and TIER_ORDER.get(current_tier, 0) < TIER_ORDER["C"]:
        implied_tier = "C"
    else:
        return scan

    return {
        **scan,
        "tier": implied_tier,
        "tier_label": TIER_LABELS[implied_tier],
    }


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------


def format_scan_result(result: ScanResult) -> str:
    """Format a ``ScanResult`` for human-readable console output."""
    lines: list[str] = []

    lines.append(f"Security Tier: {result['tier']} ({result['tier_label']})")

    if not result["capabilities"]:
        lines.append("No capabilities detected.")
        return "\n".join(lines)

    lines.append("")
    lines.append("Detected capabilities:")

    for cap in result["capabilities"]:
        count = len(cap["locations"])
        plural = "" if count == 1 else "s"
        lines.append(f"  {cap['category']} ({count} occurrence{plural})")
        for loc in cap["locations"]:
            lines.append(f"    {loc['file']}:{loc['line']}")

    return "\n".join(lines)
