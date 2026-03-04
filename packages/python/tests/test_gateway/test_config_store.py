"""Tests for ConfigStore implementations."""

import json
import os
import tempfile

import pytest

from trikhub.gateway.config_store import (
    FileConfigStore,
    InMemoryConfigStore,
    _ConfigContext,
)
from trikhub.manifest import (
    AgentDefinition,
    ConfigRequirement,
    TrikConfig,
    TrikEntry,
    TrikManifest,
)


# ============================================================================
# _ConfigContext
# ============================================================================


def test_config_context_get():
    ctx = _ConfigContext({"api_key": "secret123"})
    assert ctx.get("api_key") == "secret123"
    assert ctx.get("missing") is None


def test_config_context_has():
    ctx = _ConfigContext({"api_key": "secret123"})
    assert ctx.has("api_key") is True
    assert ctx.has("missing") is False


def test_config_context_keys():
    ctx = _ConfigContext({"a": "1", "b": "2"})
    assert sorted(ctx.keys()) == ["a", "b"]


def test_config_context_defaults():
    ctx = _ConfigContext({"a": "1"}, defaults={"b": "default_b"})
    assert ctx.get("a") == "1"
    assert ctx.get("b") == "default_b"
    assert ctx.has("b") is True
    assert sorted(ctx.keys()) == ["a", "b"]


def test_config_context_override():
    ctx = _ConfigContext({"a": "override"}, defaults={"a": "default"})
    assert ctx.get("a") == "override"


# ============================================================================
# InMemoryConfigStore
# ============================================================================


@pytest.mark.asyncio
async def test_inmemory_load():
    store = InMemoryConfigStore()
    await store.load()  # no-op


def test_inmemory_set_and_get():
    store = InMemoryConfigStore()
    store.set_for_trik("my-trik", {"API_KEY": "abc123"})
    ctx = store.get_for_trik("my-trik")
    assert ctx.get("API_KEY") == "abc123"


def test_inmemory_empty_trik():
    store = InMemoryConfigStore()
    ctx = store.get_for_trik("unknown")
    assert ctx.get("anything") is None
    assert ctx.has("anything") is False
    assert ctx.keys() == []


def test_inmemory_validate_config_no_requirements():
    store = InMemoryConfigStore()
    manifest = _make_manifest()
    assert store.validate_config(manifest) == []


def test_inmemory_validate_config_missing():
    store = InMemoryConfigStore()
    manifest = _make_manifest(required_config=["API_KEY"])
    missing = store.validate_config(manifest)
    assert "API_KEY" in missing


def test_inmemory_validate_config_present():
    store = InMemoryConfigStore({"test-trik": {"API_KEY": "abc"}})
    manifest = _make_manifest(required_config=["API_KEY"])
    assert store.validate_config(manifest) == []


def test_inmemory_configured_triks():
    store = InMemoryConfigStore({"a": {"k": "v"}, "b": {"k": "v"}})
    assert sorted(store.get_configured_triks()) == ["a", "b"]


def test_inmemory_clear():
    store = InMemoryConfigStore({"a": {"k": "v"}})
    store.clear()
    assert store.get_configured_triks() == []


def test_inmemory_set_defaults_from_manifest():
    store = InMemoryConfigStore()
    manifest = _make_manifest(optional_config=[("TIMEOUT", "30"), ("RETRIES", "3")])
    store.set_defaults_from_manifest(manifest)
    ctx = store.get_for_trik("test-trik")
    assert ctx.get("TIMEOUT") == "30"
    assert ctx.get("RETRIES") == "3"


def test_inmemory_set_defaults_overridden_by_explicit():
    store = InMemoryConfigStore({"test-trik": {"TIMEOUT": "60"}})
    manifest = _make_manifest(optional_config=[("TIMEOUT", "30")])
    store.set_defaults_from_manifest(manifest)
    ctx = store.get_for_trik("test-trik")
    assert ctx.get("TIMEOUT") == "60"  # explicit wins


def test_inmemory_set_defaults_no_optional():
    store = InMemoryConfigStore()
    manifest = _make_manifest()
    store.set_defaults_from_manifest(manifest)
    ctx = store.get_for_trik("test-trik")
    assert ctx.get("anything") is None


def test_inmemory_validate_config_with_scoped_trik_id():
    """validate_config should look up config by trik_id when provided."""
    store = InMemoryConfigStore({
        "@alice/test-trik": {"API_KEY": "key123"},
    })

    manifest = _make_manifest(required_config=["API_KEY"])

    # Without trik_id: should report missing (looks up "test-trik")
    missing = store.validate_config(manifest)
    assert "API_KEY" in missing

    # With trik_id: should find it (looks up "@alice/test-trik")
    missing = store.validate_config(manifest, trik_id="@alice/test-trik")
    assert len(missing) == 0


# ============================================================================
# FileConfigStore
# ============================================================================


@pytest.mark.asyncio
async def test_file_config_store_load():
    with tempfile.TemporaryDirectory() as tmpdir:
        global_path = os.path.join(tmpdir, "global.json")
        local_path = os.path.join(tmpdir, "local.json")

        with open(global_path, "w") as f:
            json.dump({"trik-a": {"KEY": "global_val"}}, f)

        with open(local_path, "w") as f:
            json.dump({"trik-a": {"KEY": "local_val"}, "trik-b": {"X": "y"}}, f)

        store = FileConfigStore(
            global_secrets_path=global_path, local_secrets_path=local_path
        )
        await store.load()

        # Local overrides global
        ctx_a = store.get_for_trik("trik-a")
        assert ctx_a.get("KEY") == "local_val"

        ctx_b = store.get_for_trik("trik-b")
        assert ctx_b.get("X") == "y"


@pytest.mark.asyncio
async def test_file_config_store_missing_files():
    store = FileConfigStore(
        global_secrets_path="/nonexistent/global.json",
        local_secrets_path="/nonexistent/local.json",
    )
    await store.load()
    ctx = store.get_for_trik("any")
    assert ctx.get("any") is None


@pytest.mark.asyncio
async def test_file_config_store_reload():
    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "secrets.json")
        with open(path, "w") as f:
            json.dump({"trik": {"KEY": "v1"}}, f)

        store = FileConfigStore(
            global_secrets_path=path, local_secrets_path="/nonexistent"
        )
        await store.load()
        assert store.get_for_trik("trik").get("KEY") == "v1"

        with open(path, "w") as f:
            json.dump({"trik": {"KEY": "v2"}}, f)

        await store.reload()
        assert store.get_for_trik("trik").get("KEY") == "v2"


# ============================================================================
# Helpers
# ============================================================================


def _make_manifest(
    required_config: list[str] | None = None,
    optional_config: list[tuple[str, str]] | None = None,
) -> TrikManifest:
    config = None
    required = (
        [ConfigRequirement(key=k, description=f"{k} config") for k in required_config]
        if required_config
        else None
    )
    optional = (
        [ConfigRequirement(key=k, description=f"{k} config", default=v) for k, v in optional_config]
        if optional_config
        else None
    )
    if required or optional:
        config = TrikConfig(required=required, optional=optional)
    return TrikManifest(
        schemaVersion=2,
        id="test-trik",
        name="Test Trik",
        description="A test trik",
        version="0.1.0",
        agent=AgentDefinition(mode="conversational", domain=["test"]),
        entry=TrikEntry(module="./agent.py", export="agent", runtime="python"),
        config=config,
    )
