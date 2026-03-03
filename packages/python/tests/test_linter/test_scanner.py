"""Tests for the capability scanner tier adjustment."""

from __future__ import annotations

import pytest

from trikhub.linter.scanner import adjust_tier_for_manifest, ScanResult


def _make_scan(tier: str = "A", tier_label: str = "Sandboxed") -> ScanResult:
    """Create a minimal ScanResult for testing."""
    return {"tier": tier, "tier_label": tier_label, "capabilities": []}


class TestAdjustTierForManifest:
    """Tests for adjust_tier_for_manifest()."""

    def test_upgrades_to_c_for_filesystem(self):
        scan = _make_scan("A", "Sandboxed")
        manifest = {"capabilities": {"filesystem": {"enabled": True}}}
        result = adjust_tier_for_manifest(scan, manifest)
        assert result["tier"] == "C"
        assert result["tier_label"] == "System"

    def test_upgrades_to_d_for_shell(self):
        scan = _make_scan("A", "Sandboxed")
        manifest = {
            "capabilities": {
                "filesystem": {"enabled": True},
                "shell": {"enabled": True},
            }
        }
        result = adjust_tier_for_manifest(scan, manifest)
        assert result["tier"] == "D"
        assert result["tier_label"] == "Unrestricted"

    def test_does_not_downgrade_tier(self):
        # Code is tier D, filesystem only implies C — stays D
        scan = _make_scan("D", "Unrestricted")
        manifest = {"capabilities": {"filesystem": {"enabled": True}}}
        result = adjust_tier_for_manifest(scan, manifest)
        assert result["tier"] == "D"

    def test_no_adjustment_without_capabilities(self):
        scan = _make_scan("A", "Sandboxed")
        manifest = {"capabilities": {"session": {"enabled": True}}}
        result = adjust_tier_for_manifest(scan, manifest)
        assert result["tier"] == "A"

    def test_no_adjustment_without_capabilities_key(self):
        scan = _make_scan("B", "Network")
        manifest = {}
        result = adjust_tier_for_manifest(scan, manifest)
        assert result["tier"] == "B"

    def test_filesystem_disabled_no_adjustment(self):
        scan = _make_scan("A", "Sandboxed")
        manifest = {"capabilities": {"filesystem": {"enabled": False}}}
        result = adjust_tier_for_manifest(scan, manifest)
        assert result["tier"] == "A"

    def test_upgrades_b_to_c_for_filesystem(self):
        scan = _make_scan("B", "Network")
        manifest = {"capabilities": {"filesystem": {"enabled": True}}}
        result = adjust_tier_for_manifest(scan, manifest)
        assert result["tier"] == "C"
        assert result["tier_label"] == "System"

    def test_upgrades_c_to_d_for_shell(self):
        scan = _make_scan("C", "System")
        manifest = {
            "capabilities": {
                "filesystem": {"enabled": True},
                "shell": {"enabled": True},
            }
        }
        result = adjust_tier_for_manifest(scan, manifest)
        assert result["tier"] == "D"
        assert result["tier_label"] == "Unrestricted"
