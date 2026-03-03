"""
Phase 5 Integration Tests — Gateway containerized trik routing.

Tests that the gateway correctly detects filesystem/shell capabilities
and marks triks as containerized for Docker-based execution.

Mirrors tests/js/gateway-container-integration.test.ts.
"""

import json
import os
import tempfile

import pytest

from trikhub.manifest import (
    TrikContext,
    TrikManifest,
    TrikResponse,
)
from trikhub.gateway.gateway import (
    TrikGateway,
    TrikGatewayConfig,
)
from trikhub.gateway.config_store import InMemoryConfigStore
from trikhub.gateway.storage_provider import InMemoryStorageProvider
from trikhub.gateway.session_storage import InMemorySessionStorage


# ============================================================================
# Test helpers
# ============================================================================


def _create_trik_dir(
    tmpdir: str,
    trik_id: str,
    mode: str = "conversational",
    runtime: str = "python",
    capabilities: dict | None = None,
) -> str:
    """Create a trik directory with manifest and a simple agent module."""
    trik_dir = os.path.join(tmpdir, trik_id)
    os.makedirs(trik_dir, exist_ok=True)

    manifest: dict = {
        "schemaVersion": 2,
        "id": trik_id,
        "name": trik_id,
        "description": f"Test trik {trik_id}",
        "version": "0.1.0",
        "agent": {
            "mode": mode,
            "domain": ["test"],
        },
        "entry": {
            "module": "./agent.py",
            "export": "agent",
            "runtime": runtime,
        },
    }

    if mode == "conversational":
        manifest["agent"]["handoffDescription"] = f"Talk to {trik_id}"
        manifest["agent"]["systemPrompt"] = f"You are {trik_id}."

    if capabilities:
        manifest["capabilities"] = capabilities

    with open(os.path.join(trik_dir, "manifest.json"), "w") as f:
        json.dump(manifest, f)

    # Write a Python agent module
    if mode == "conversational":
        agent_code = """
from trikhub.manifest import TrikResponse, TrikContext

class Agent:
    async def process_message(self, message: str, context: TrikContext) -> TrikResponse:
        return TrikResponse(message=f"Response: {message}", transferBack=False)

agent = Agent()
"""
    else:
        agent_code = """
from trikhub.manifest import ToolExecutionResult, TrikContext

class Agent:
    async def execute_tool(self, name: str, input: dict, context: TrikContext) -> ToolExecutionResult:
        return ToolExecutionResult(output={"result": "ok"})

agent = Agent()
"""

    with open(os.path.join(trik_dir, "agent.py"), "w") as f:
        f.write(agent_code)

    return trik_dir


def _create_gateway() -> TrikGateway:
    return TrikGateway(
        TrikGatewayConfig(
            config_store=InMemoryConfigStore(),
            storage_provider=InMemoryStorageProvider(),
            session_storage=InMemorySessionStorage(),
            validate_config=False,
        )
    )


# ============================================================================
# Gateway containerized trik detection
# ============================================================================


class TestGatewayContainerizedDetection:
    @pytest.mark.asyncio
    async def test_marks_trik_with_filesystem_as_containerized(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            trik_path = _create_trik_dir(
                tmpdir,
                "fs-trik",
                capabilities={"filesystem": {"enabled": True}},
            )
            gateway = _create_gateway()
            await gateway.initialize()
            manifest = await gateway.load_trik(trik_path)

            assert manifest.id == "fs-trik"
            assert gateway.is_loaded("fs-trik")
            loaded = gateway._triks["fs-trik"]
            assert loaded.containerized is True

    @pytest.mark.asyncio
    async def test_marks_trik_with_fs_and_shell_as_containerized(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            trik_path = _create_trik_dir(
                tmpdir,
                "builder-trik",
                capabilities={
                    "filesystem": {"enabled": True},
                    "shell": {"enabled": True},
                },
            )
            gateway = _create_gateway()
            await gateway.initialize()
            manifest = await gateway.load_trik(trik_path)

            loaded = gateway._triks["builder-trik"]
            assert loaded.containerized is True

    @pytest.mark.asyncio
    async def test_does_not_mark_trik_without_capabilities(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            trik_path = _create_trik_dir(tmpdir, "normal-trik")
            gateway = _create_gateway()
            await gateway.initialize()
            await gateway.load_trik(trik_path)

            loaded = gateway._triks["normal-trik"]
            assert loaded.containerized is False

    @pytest.mark.asyncio
    async def test_does_not_mark_session_storage_only(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            trik_path = _create_trik_dir(
                tmpdir,
                "session-trik",
                capabilities={
                    "session": {"enabled": True},
                    "storage": {"enabled": True},
                },
            )
            gateway = _create_gateway()
            await gateway.initialize()
            await gateway.load_trik(trik_path)

            loaded = gateway._triks["session-trik"]
            assert loaded.containerized is False

    @pytest.mark.asyncio
    async def test_does_not_mark_disabled_filesystem(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            trik_path = _create_trik_dir(
                tmpdir,
                "disabled-fs",
                capabilities={"filesystem": {"enabled": False}},
            )
            gateway = _create_gateway()
            await gateway.initialize()
            await gateway.load_trik(trik_path)

            loaded = gateway._triks["disabled-fs"]
            assert loaded.containerized is False

    @pytest.mark.asyncio
    async def test_js_trik_with_filesystem_is_containerized(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            trik_path = _create_trik_dir(
                tmpdir,
                "js-builder",
                runtime="node",
                capabilities={
                    "filesystem": {"enabled": True},
                    "shell": {"enabled": True},
                },
            )
            gateway = _create_gateway()
            await gateway.initialize()
            await gateway.load_trik(trik_path)

            loaded = gateway._triks["js-builder"]
            assert loaded.containerized is True
            # Should NOT have triggered node worker
            assert gateway._node_worker is None


# ============================================================================
# Gateway buildTrikContext with capabilities
# ============================================================================


class TestGatewayBuildTrikContextCapabilities:
    @pytest.mark.asyncio
    async def test_includes_capabilities_for_containerized_triks(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            trik_path = _create_trik_dir(
                tmpdir,
                "ctx-trik",
                capabilities={
                    "filesystem": {"enabled": True, "maxSizeBytes": 1024000},
                    "shell": {"enabled": True, "timeoutMs": 5000},
                },
            )
            gateway = _create_gateway()
            await gateway.initialize()
            await gateway.load_trik(trik_path)

            loaded = gateway._triks["ctx-trik"]
            ctx = gateway._build_trik_context("test-session", loaded)

            assert ctx.capabilities is not None
            assert ctx.capabilities.filesystem is not None
            assert ctx.capabilities.filesystem.enabled is True
            assert ctx.capabilities.shell is not None
            assert ctx.capabilities.shell.enabled is True

    @pytest.mark.asyncio
    async def test_no_capabilities_for_normal_triks(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            trik_path = _create_trik_dir(tmpdir, "plain-trik")
            gateway = _create_gateway()
            await gateway.initialize()
            await gateway.load_trik(trik_path)

            loaded = gateway._triks["plain-trik"]
            ctx = gateway._build_trik_context("test-session", loaded)

            assert ctx.capabilities is None


# ============================================================================
# Gateway _needs_containerization
# ============================================================================


class TestNeedsContainerization:
    def test_filesystem_enabled(self):
        manifest = TrikManifest(
            **{
                "schemaVersion": 2,
                "id": "test",
                "name": "test",
                "description": "test",
                "version": "0.1.0",
                "agent": {"mode": "conversational", "domain": ["test"], "handoffDescription": "test"},
                "entry": {"module": "./a.py", "export": "agent"},
                "capabilities": {"filesystem": {"enabled": True}},
            }
        )
        assert TrikGateway._needs_containerization(manifest) is True

    def test_shell_enabled(self):
        manifest = TrikManifest(
            **{
                "schemaVersion": 2,
                "id": "test",
                "name": "test",
                "description": "test",
                "version": "0.1.0",
                "agent": {"mode": "conversational", "domain": ["test"], "handoffDescription": "test"},
                "entry": {"module": "./a.py", "export": "agent"},
                "capabilities": {"filesystem": {"enabled": True}, "shell": {"enabled": True}},
            }
        )
        assert TrikGateway._needs_containerization(manifest) is True

    def test_no_capabilities(self):
        manifest = TrikManifest(
            **{
                "schemaVersion": 2,
                "id": "test",
                "name": "test",
                "description": "test",
                "version": "0.1.0",
                "agent": {"mode": "conversational", "domain": ["test"], "handoffDescription": "test"},
                "entry": {"module": "./a.py", "export": "agent"},
            }
        )
        assert TrikGateway._needs_containerization(manifest) is False

    def test_disabled_filesystem(self):
        manifest = TrikManifest(
            **{
                "schemaVersion": 2,
                "id": "test",
                "name": "test",
                "description": "test",
                "version": "0.1.0",
                "agent": {"mode": "conversational", "domain": ["test"], "handoffDescription": "test"},
                "entry": {"module": "./a.py", "export": "agent"},
                "capabilities": {"filesystem": {"enabled": False}},
            }
        )
        assert TrikGateway._needs_containerization(manifest) is False


# ============================================================================
# Gateway shutdown with containers
# ============================================================================


class TestGatewayShutdownContainers:
    @pytest.mark.asyncio
    async def test_shutdown_stops_container_manager(self):
        gateway = _create_gateway()
        await gateway.initialize()

        # Trigger container manager creation
        manager = gateway._ensure_container_manager()
        assert gateway._container_manager is not None

        # Shutdown should stop all containers
        await gateway.shutdown()
        assert gateway._container_manager is None

    @pytest.mark.asyncio
    async def test_shutdown_works_without_container_manager(self):
        gateway = _create_gateway()
        await gateway.initialize()
        await gateway.shutdown()  # Should not raise
