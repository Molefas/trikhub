"""Tests for scoped identity resolution and resource isolation in Python gateway.

Validates that:
- _resolve_scoped_name reads .trikhub-identity.json when present
- Falls back to local/<manifest.id> for dev triks
- _to_tool_name converts scoped names to tool-safe identifiers
"""

import json
import os
import tempfile

import pytest

from trikhub.gateway.gateway import TrikGateway
from trikhub.manifest.types import TrikManifest


def _make_manifest(trik_id: str = "weather") -> TrikManifest:
    """Create a minimal valid TrikManifest for testing."""
    return TrikManifest(
        schemaVersion=2,
        id=trik_id,
        name="Test Trik",
        version="1.0.0",
        description="A test trik",
        agent={"mode": "tool", "domain": ["test"]},
        tools={
            "test": {
                "description": "test tool",
                "inputSchema": {"type": "object", "properties": {"q": {"type": "string"}}, "required": ["q"]},
                "outputSchema": {"type": "object", "properties": {"r": {"type": "number"}}},
                "outputTemplate": "Result: {{r}}",
            },
        },
        entry={"module": "./index.js", "export": "default"},
    )


# ============================================================================
# _resolve_scoped_name
# ============================================================================


class TestResolveScopedName:
    def test_returns_scoped_name_from_identity_file(self, tmp_path):
        identity = {"scopedName": "@alice/weather", "installedAt": "2026-01-01T00:00:00Z"}
        (tmp_path / ".trikhub-identity.json").write_text(json.dumps(identity))

        result = TrikGateway._resolve_scoped_name(str(tmp_path), _make_manifest())
        assert result == "@alice/weather"

    def test_returns_local_fallback_when_no_identity_file(self, tmp_path):
        result = TrikGateway._resolve_scoped_name(str(tmp_path), _make_manifest("weather"))
        assert result == "local/weather"

    def test_returns_local_fallback_when_malformed_json(self, tmp_path):
        (tmp_path / ".trikhub-identity.json").write_text("not valid json")

        result = TrikGateway._resolve_scoped_name(str(tmp_path), _make_manifest("weather"))
        assert result == "local/weather"

    def test_returns_local_fallback_when_no_scoped_name_field(self, tmp_path):
        (tmp_path / ".trikhub-identity.json").write_text(json.dumps({"other": "field"}))

        result = TrikGateway._resolve_scoped_name(str(tmp_path), _make_manifest("weather"))
        assert result == "local/weather"

    def test_returns_local_fallback_when_scoped_name_not_string(self, tmp_path):
        (tmp_path / ".trikhub-identity.json").write_text(json.dumps({"scopedName": 42}))

        result = TrikGateway._resolve_scoped_name(str(tmp_path), _make_manifest("weather"))
        assert result == "local/weather"


# ============================================================================
# _to_tool_name
# ============================================================================


class TestToToolName:
    def test_scoped_name(self):
        assert TrikGateway._to_tool_name("@alice/weather") == "alice__weather"

    def test_local_name(self):
        assert TrikGateway._to_tool_name("local/weather") == "local__weather"

    def test_org_name(self):
        assert TrikGateway._to_tool_name("@org/my-trik") == "org__my-trik"

    def test_name_without_at(self):
        assert TrikGateway._to_tool_name("simple/name") == "simple__name"


# ============================================================================
# load_trik duplicate detection
# ============================================================================


class TestLoadTrikDuplicateDetection:
    @pytest.mark.asyncio
    async def test_throws_on_duplicate_scoped_name(self, tmp_path):
        gw = TrikGateway()

        trik_dir1 = tmp_path / "trik1"
        trik_dir2 = tmp_path / "trik2"
        trik_dir1.mkdir()
        trik_dir2.mkdir()

        manifest = {
            "schemaVersion": 2,
            "id": "weather",
            "name": "Weather Trik",
            "version": "1.0.0",
            "description": "A weather trik",
            "agent": {"mode": "tool", "domain": ["test"]},
            "tools": {
                "getWeather": {
                    "description": "Get weather",
                    "inputSchema": {"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]},
                    "outputSchema": {"type": "object", "properties": {"temp": {"type": "number"}}},
                    "outputTemplate": "Temperature: {{temp}}",
                },
            },
            "entry": {"module": "./index.js", "export": "default"},
        }

        (trik_dir1 / "manifest.json").write_text(json.dumps(manifest))
        (trik_dir2 / "manifest.json").write_text(json.dumps(manifest))

        identity = {"scopedName": "@alice/weather", "installedAt": "2026-01-01T00:00:00Z"}
        (trik_dir1 / ".trikhub-identity.json").write_text(json.dumps(identity))
        (trik_dir2 / ".trikhub-identity.json").write_text(json.dumps(identity))

        # First load should succeed
        await gw.load_trik(str(trik_dir1))

        # Second load should raise duplicate error
        with pytest.raises(ValueError, match="Duplicate trik identity"):
            await gw.load_trik(str(trik_dir2))
