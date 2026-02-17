"""Tests for the Node.js worker integration."""

import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from trikhub.gateway.node_worker import (
    NodeWorker,
    NodeWorkerConfig,
    ExecuteNodeTrikOptions,
    HealthResult,
    InvokeResult,
    get_shared_node_worker,
    shutdown_shared_node_worker,
)
from trikhub.gateway.worker_protocol import (
    WorkerProtocol,
    JsonRpcRequest,
    JsonRpcResponse,
    WorkerErrorCodes,
)


class TestNodeWorkerConfig:
    """Tests for NodeWorkerConfig."""

    def test_default_config(self):
        """Test default configuration values."""
        config = NodeWorkerConfig()
        # node_path is auto-detected - verify it's set and contains "node"
        assert config.node_path is not None
        assert "node" in config.node_path
        assert config.startup_timeout_ms == 10000
        assert config.invoke_timeout_ms == 60000
        assert config.debug is False
        assert config.worker_script_path is None

    def test_custom_config(self):
        """Test custom configuration values."""
        config = NodeWorkerConfig(
            node_path="/usr/local/bin/node",
            startup_timeout_ms=5000,
            invoke_timeout_ms=30000,
            debug=True,
            worker_script_path="/path/to/worker.js",
        )
        assert config.node_path == "/usr/local/bin/node"
        assert config.startup_timeout_ms == 5000
        assert config.invoke_timeout_ms == 30000
        assert config.debug is True
        assert config.worker_script_path == "/path/to/worker.js"


class TestHealthResult:
    """Tests for HealthResult."""

    def test_health_result(self):
        """Test HealthResult creation."""
        result = HealthResult(
            status="ok",
            runtime="node",
            version="v20.0.0",
            uptime=123.45,
        )
        assert result.status == "ok"
        assert result.runtime == "node"
        assert result.version == "v20.0.0"
        assert result.uptime == 123.45


class TestExecuteNodeTrikOptions:
    """Tests for ExecuteNodeTrikOptions."""

    def test_default_options(self):
        """Test default options."""
        options = ExecuteNodeTrikOptions()
        assert options.session is None
        assert options.config is None
        assert options.storage is None


class TestNodeWorkerProtocolIntegration:
    """Tests for NodeWorker and WorkerProtocol integration."""

    def test_create_health_request(self):
        """Test creating a health check request."""
        request = WorkerProtocol.create_request("health", {})
        assert request.method == "health"
        assert request.jsonrpc == "2.0"
        assert request.id is not None

    def test_create_invoke_request(self):
        """Test creating an invoke request."""
        request = WorkerProtocol.create_request(
            "invoke",
            {
                "trikPath": "/path/to/trik",
                "action": "search",
                "input": {"query": "test"},
            },
        )
        assert request.method == "invoke"
        assert request.params["trikPath"] == "/path/to/trik"
        assert request.params["action"] == "search"

    def test_parse_success_response(self):
        """Test parsing a success response."""
        json_str = '{"jsonrpc": "2.0", "id": "test-id", "result": {"status": "ok"}}'
        message = WorkerProtocol.parse_message(json_str)
        assert isinstance(message, JsonRpcResponse)
        assert message.id == "test-id"
        assert message.result == {"status": "ok"}
        assert not message.is_error

    def test_parse_error_response(self):
        """Test parsing an error response."""
        json_str = '{"jsonrpc": "2.0", "id": "test-id", "error": {"code": -32600, "message": "Invalid request"}}'
        message = WorkerProtocol.parse_message(json_str)
        assert isinstance(message, JsonRpcResponse)
        assert message.id == "test-id"
        assert message.is_error
        assert message.error["code"] == -32600


class TestNodeWorkerUnit:
    """Unit tests for NodeWorker (no actual subprocess spawning)."""

    def test_worker_initialization(self):
        """Test worker initialization."""
        config = NodeWorkerConfig(debug=True)
        worker = NodeWorker(config)
        assert worker.ready is False
        assert worker._config.debug is True

    def test_event_registration(self):
        """Test event handler registration."""
        worker = NodeWorker()
        handler_called = False

        def handler(result):
            nonlocal handler_called
            handler_called = True

        worker.on("ready", handler)
        worker._emit("ready", HealthResult(status="ok", runtime="node"))
        assert handler_called

    def test_event_unregistration(self):
        """Test event handler unregistration."""
        worker = NodeWorker()
        call_count = 0

        def handler(result):
            nonlocal call_count
            call_count += 1

        worker.on("ready", handler)
        worker._emit("ready", HealthResult(status="ok", runtime="node"))
        assert call_count == 1

        worker.off("ready", handler)
        worker._emit("ready", HealthResult(status="ok", runtime="node"))
        assert call_count == 1  # Should not have increased


class TestInvokeResult:
    """Tests for InvokeResult conversion."""

    def test_invoke_result_template_mode(self):
        """Test InvokeResult for template mode."""
        result = InvokeResult(
            response_mode="template",
            agent_data={"template": "success", "count": 5},
        )
        assert result.response_mode == "template"
        assert result.agent_data == {"template": "success", "count": 5}
        assert result.user_content is None
        assert result.needs_clarification is False
        assert result.end_session is False

    def test_invoke_result_passthrough_mode(self):
        """Test InvokeResult for passthrough mode."""
        result = InvokeResult(
            response_mode="passthrough",
            user_content={
                "contentType": "text/html",
                "data": "<h1>Hello</h1>",
            },
        )
        assert result.response_mode == "passthrough"
        assert result.user_content["contentType"] == "text/html"

    def test_invoke_result_clarification(self):
        """Test InvokeResult with clarification needed."""
        result = InvokeResult(
            response_mode="template",
            needs_clarification=True,
            clarification_questions=[
                {"id": "q1", "question": "What do you mean?", "type": "text"}
            ],
        )
        assert result.needs_clarification is True
        assert len(result.clarification_questions) == 1


class TestSharedWorkerManager:
    """Tests for shared worker management."""

    @pytest.mark.asyncio
    async def test_shared_worker_singleton(self):
        """Test that get_shared_node_worker returns the same instance."""
        # Reset the shared worker first
        await shutdown_shared_node_worker()

        worker1 = get_shared_node_worker()
        worker2 = get_shared_node_worker()
        assert worker1 is worker2

        # Cleanup
        await shutdown_shared_node_worker()

    @pytest.mark.asyncio
    async def test_shared_worker_shutdown_resets(self):
        """Test that shutting down resets the shared worker."""
        await shutdown_shared_node_worker()

        worker1 = get_shared_node_worker()
        await shutdown_shared_node_worker()
        worker2 = get_shared_node_worker()

        # After shutdown, a new instance should be created
        assert worker1 is not worker2

        # Cleanup
        await shutdown_shared_node_worker()


# Integration tests (require actual Node.js)
# These are marked to be skipped by default in CI without Node.js

@pytest.mark.skipif(
    True,  # Skip by default - uncomment below to run
    # os.environ.get("RUN_NODE_INTEGRATION_TESTS") != "1",
    reason="Node.js integration tests disabled",
)
class TestNodeWorkerIntegration:
    """Integration tests that actually spawn Node.js worker."""

    @pytest.mark.asyncio
    async def test_worker_health_check(self):
        """Test actual worker health check."""
        worker = NodeWorker(NodeWorkerConfig(debug=True))
        try:
            await worker.start()
            assert worker.ready is True

            health = await worker.health()
            assert health.status == "ok"
            assert health.runtime == "node"
        finally:
            await worker.shutdown()

    @pytest.mark.asyncio
    async def test_worker_invoke_trik(self):
        """Test invoking a simple trik."""
        # This test requires a test trik to be set up
        pass
