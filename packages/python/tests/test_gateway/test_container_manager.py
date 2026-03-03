"""
Tests for DockerContainerManager and ContainerWorkerHandle.

Phase 4b: Tests verify correct container lifecycle behavior
without requiring Docker to be installed.

Mirrors tests/js/container-manager.test.ts.
"""

import asyncio
import os
import subprocess

import pytest

from trikhub.gateway.container_manager import (
    ContainerManagerConfig,
    ContainerOptions,
    ContainerWorkerHandle,
    DockerContainerManager,
    WORKER_IMAGES,
    _sanitize_container_name,
)


# ============================================================================
# Test helpers
# ============================================================================


def make_container_options(**overrides) -> ContainerOptions:
    defaults = {
        "runtime": "node",
        "workspace_path": "/tmp/test-workspace",
        "trik_path": "/tmp/test-trik",
    }
    defaults.update(overrides)
    return ContainerOptions(**defaults)


DEFAULT_CONFIG = ContainerManagerConfig(
    workspace_base_dir="/tmp/test-workspace",
    startup_timeout_ms=5000,
    invoke_timeout_ms=30000,
    debug=False,
)


# ============================================================================
# DockerContainerManager unit tests
# ============================================================================


class TestDockerContainerManager:
    def test_creates_with_default_config(self):
        manager = DockerContainerManager()
        assert manager is not None

    def test_creates_with_custom_config(self):
        manager = DockerContainerManager(
            ContainerManagerConfig(
                workspace_base_dir="/tmp/test-base",
                startup_timeout_ms=5000,
                invoke_timeout_ms=30000,
                debug=True,
            )
        )
        assert manager is not None

    def test_get_workspace_path(self):
        manager = DockerContainerManager(
            ContainerManagerConfig(workspace_base_dir="/tmp/test-workspace-base")
        )
        path = manager.get_workspace_path("my-trik")
        assert path == "/tmp/test-workspace-base/my-trik"

    def test_is_running_returns_false_for_unknown_trik(self):
        manager = DockerContainerManager()
        assert manager.is_running("nonexistent") is False

    @pytest.mark.asyncio
    async def test_stop_all_completes_when_no_containers(self):
        manager = DockerContainerManager()
        await manager.stop_all()  # Should not raise

    @pytest.mark.asyncio
    async def test_stop_completes_for_unknown_trik(self):
        manager = DockerContainerManager()
        await manager.stop("nonexistent")  # Should not raise


# ============================================================================
# ContainerWorkerHandle unit tests
# ============================================================================


class TestContainerWorkerHandle:
    def test_creates_with_correct_state(self):
        handle = ContainerWorkerHandle(
            "test-trik",
            make_container_options(),
            DEFAULT_CONFIG,
        )
        assert handle is not None
        assert handle.ready is False

    def test_sanitizes_trik_id_for_container_name(self):
        handle = ContainerWorkerHandle(
            "@scope/my-trik.v2",
            make_container_options(),
            DEFAULT_CONFIG,
        )
        assert handle is not None
        # The container name should not contain special characters
        assert handle._container_name == "trikhub--scope-my-trik-v2"

    @pytest.mark.asyncio
    async def test_process_message_throws_when_not_started(self):
        handle = ContainerWorkerHandle(
            "test-trik",
            make_container_options(),
            DEFAULT_CONFIG,
        )

        with pytest.raises(RuntimeError, match="Container not running"):
            await handle.process_message(
                trik_path="/trik",
                message="hello",
                session_id="sess-1",
                config={},
                storage_namespace="test",
            )

    @pytest.mark.asyncio
    async def test_execute_tool_throws_when_not_started(self):
        handle = ContainerWorkerHandle(
            "test-trik",
            make_container_options(),
            DEFAULT_CONFIG,
        )

        with pytest.raises(RuntimeError, match="Container not running"):
            await handle.execute_tool(
                trik_path="/trik",
                tool_name="test",
                input={},
                session_id="sess-1",
                config={},
                storage_namespace="test",
            )

    @pytest.mark.asyncio
    async def test_health_throws_when_not_started(self):
        handle = ContainerWorkerHandle(
            "test-trik",
            make_container_options(),
            DEFAULT_CONFIG,
        )

        with pytest.raises(RuntimeError, match="Container not running"):
            await handle.health()

    @pytest.mark.asyncio
    async def test_shutdown_completes_when_not_started(self):
        handle = ContainerWorkerHandle(
            "test-trik",
            make_container_options(),
            DEFAULT_CONFIG,
        )
        await handle.shutdown()  # Should not raise

    def test_kill_completes_when_not_started(self):
        handle = ContainerWorkerHandle(
            "test-trik",
            make_container_options(),
            DEFAULT_CONFIG,
        )
        handle.kill()  # Should not raise

    def test_set_storage_context(self):
        handle = ContainerWorkerHandle(
            "test-trik",
            make_container_options(),
            DEFAULT_CONFIG,
        )
        # Setting to None should work
        handle.set_storage_context(None)
        assert handle._storage_context is None

    def test_event_handlers(self):
        handle = ContainerWorkerHandle(
            "test-trik",
            make_container_options(),
            DEFAULT_CONFIG,
        )
        events: list[str] = []
        handler = lambda msg: events.append(msg)

        handle.on("stderr", handler)
        handle._emit("stderr", "test message")
        assert events == ["test message"]

        handle.off("stderr", handler)
        handle._emit("stderr", "should not appear")
        assert events == ["test message"]


# ============================================================================
# ContainerOptions validation tests
# ============================================================================


class TestContainerOptions:
    def test_node_runtime_accepted(self):
        handle = ContainerWorkerHandle(
            "test",
            make_container_options(runtime="node"),
            DEFAULT_CONFIG,
        )
        assert handle is not None

    def test_python_runtime_accepted(self):
        handle = ContainerWorkerHandle(
            "test",
            make_container_options(runtime="python"),
            DEFAULT_CONFIG,
        )
        assert handle is not None

    def test_custom_resource_limits(self):
        options = ContainerOptions(
            runtime="node",
            workspace_path="/tmp/test",
            trik_path="/tmp/trik",
            network_enabled=False,
            memory_limit_mb=1024,
            cpu_limit=2.0,
        )
        handle = ContainerWorkerHandle("test", options, DEFAULT_CONFIG)
        assert handle is not None


# ============================================================================
# Sanitize container name tests
# ============================================================================


class TestSanitizeContainerName:
    def test_simple_name(self):
        assert _sanitize_container_name("my-trik") == "my-trik"

    def test_scoped_name(self):
        assert _sanitize_container_name("@scope/my-trik") == "-scope-my-trik"

    def test_dots_and_special_chars(self):
        assert _sanitize_container_name("my.trik.v2") == "my-trik-v2"


# ============================================================================
# WORKER_IMAGES tests
# ============================================================================


class TestWorkerImages:
    def test_node_image(self):
        assert WORKER_IMAGES["node"] == "trikhub/worker-node:22"

    def test_python_image(self):
        assert WORKER_IMAGES["python"] == "trikhub/worker-python:3.12"


# ============================================================================
# Integration-style tests (require Docker — skipped when unavailable)
# ============================================================================


class TestDockerContainerManagerIntegration:
    @pytest.fixture(autouse=True)
    def check_docker(self):
        try:
            subprocess.run(
                ["docker", "info"],
                capture_output=True,
                timeout=5,
            )
            self.docker_available = True
        except Exception:
            self.docker_available = False

    @pytest.mark.asyncio
    async def test_launch_fails_gracefully_when_docker_unavailable(self):
        if self.docker_available:
            # Docker is available — just verify the manager can be created
            manager = DockerContainerManager()
            assert manager is not None
            return

        manager = DockerContainerManager(
            ContainerManagerConfig(startup_timeout_ms=2000)
        )
        with pytest.raises(RuntimeError, match="Docker"):
            await manager.launch("test-trik", make_container_options())
