"""
Tests for the Worker Protocol

These tests verify the JSON-RPC 2.0 protocol used for cross-language
trik execution between the gateway and language-specific workers.
"""

import json
import pytest

from trikhub.gateway.worker_protocol import (
    WorkerProtocol,
    WorkerErrorCodes,
    JsonRpcRequest,
    JsonRpcResponse,
    InvokeParams,
    InvokeResult,
)


class TestWorkerProtocol:
    """Test the WorkerProtocol class methods."""

    def test_create_request(self) -> None:
        """Should create a valid JSON-RPC request."""
        request = WorkerProtocol.create_request("health")

        assert request.jsonrpc == "2.0"
        assert request.method == "health"
        assert isinstance(request.id, str)
        assert len(request.id) > 0

    def test_create_invoke_request(self) -> None:
        """Should create an invoke request with params."""
        params: InvokeParams = {
            "trikPath": "/path/to/trik",
            "action": "search",
            "input": {"topic": "AI"},
            "config": {"API_KEY": "test-key"},
        }

        request = WorkerProtocol.create_invoke_request(params)

        assert request.method == "invoke"
        assert request.params == params

    def test_create_health_request(self) -> None:
        """Should create a health request."""
        request = WorkerProtocol.create_health_request()

        assert request.method == "health"
        assert request.params is None

    def test_create_shutdown_request(self) -> None:
        """Should create a shutdown request with grace period."""
        request = WorkerProtocol.create_shutdown_request(5000)

        assert request.method == "shutdown"
        assert request.params == {"gracePeriodMs": 5000}

    def test_create_storage_requests(self) -> None:
        """Should create storage requests."""
        get_request = WorkerProtocol.create_storage_request(
            "storage.get", {"key": "mykey"}
        )
        assert get_request.method == "storage.get"
        assert get_request.params == {"key": "mykey"}

        set_request = WorkerProtocol.create_storage_request(
            "storage.set", {"key": "mykey", "value": "myvalue"}
        )
        assert set_request.method == "storage.set"
        assert set_request.params == {"key": "mykey", "value": "myvalue"}


class TestResponseCreation:
    """Test response creation methods."""

    def test_create_success_response(self) -> None:
        """Should create a success response."""
        response = WorkerProtocol.create_success_response("test-id", {"count": 5})

        assert response.jsonrpc == "2.0"
        assert response.id == "test-id"
        assert response.result == {"count": 5}
        assert response.error is None

    def test_create_error_response(self) -> None:
        """Should create an error response."""
        response = WorkerProtocol.create_error_response(
            "test-id",
            WorkerErrorCodes.TRIK_NOT_FOUND,
            "Trik not found",
            {"path": "/missing/trik"},
        )

        assert response.jsonrpc == "2.0"
        assert response.id == "test-id"
        assert response.result is None
        assert response.error is not None
        assert response.error["code"] == 1001
        assert response.error["message"] == "Trik not found"
        assert response.error["data"] == {"path": "/missing/trik"}


class TestMessageParsing:
    """Test message parsing methods."""

    def test_parse_valid_request(self) -> None:
        """Should parse a valid request."""
        request_dict = {
            "jsonrpc": "2.0",
            "id": "test-id",
            "method": "invoke",
            "params": {"trikPath": "/path"},
        }
        json_str = json.dumps(request_dict)

        parsed = WorkerProtocol.parse_message(json_str)

        assert isinstance(parsed, JsonRpcRequest)
        assert parsed.method == "invoke"
        assert parsed.id == "test-id"

    def test_parse_valid_response(self) -> None:
        """Should parse a valid response."""
        response_dict = {
            "jsonrpc": "2.0",
            "id": "test-id",
            "result": {"success": True},
        }
        json_str = json.dumps(response_dict)

        parsed = WorkerProtocol.parse_message(json_str)

        assert isinstance(parsed, JsonRpcResponse)
        assert parsed.result == {"success": True}

    def test_parse_invalid_json(self) -> None:
        """Should raise on invalid JSON."""
        with pytest.raises(ValueError, match="Failed to parse JSON-RPC message"):
            WorkerProtocol.parse_message("not json")

    def test_parse_invalid_version(self) -> None:
        """Should raise on invalid JSON-RPC version."""
        invalid = json.dumps({"jsonrpc": "1.0", "id": "test", "method": "test"})
        with pytest.raises(ValueError, match="Invalid JSON-RPC version"):
            WorkerProtocol.parse_message(invalid)

    def test_parse_missing_id(self) -> None:
        """Should raise on missing id."""
        invalid = json.dumps({"jsonrpc": "2.0", "method": "test"})
        with pytest.raises(ValueError, match="Message ID must be a string"):
            WorkerProtocol.parse_message(invalid)


class TestMessageTypeGuards:
    """Test message type checking."""

    def test_is_request(self) -> None:
        """Should identify requests."""
        request = JsonRpcRequest(method="invoke", id="test-id")

        assert WorkerProtocol.is_request(request) is True

    def test_is_response_success(self) -> None:
        """Should identify success responses."""
        response = JsonRpcResponse(id="test-id", result={"data": "test"})

        assert WorkerProtocol.is_response(response) is True

    def test_is_response_error(self) -> None:
        """Should identify error responses."""
        response = JsonRpcResponse(
            id="test-id", error={"code": -32600, "message": "Invalid request"}
        )

        assert WorkerProtocol.is_response(response) is True


class TestMessageSerialization:
    """Test message serialization."""

    def test_serialize_request(self) -> None:
        """Should serialize a request to JSON."""
        request = WorkerProtocol.create_health_request()
        serialized = WorkerProtocol.serialize_message(request)

        assert isinstance(serialized, str)
        parsed = json.loads(serialized)
        assert parsed["method"] == "health"
        assert parsed["jsonrpc"] == "2.0"

    def test_serialize_response(self) -> None:
        """Should serialize a response to JSON."""
        response = WorkerProtocol.create_success_response("test-id", {"count": 10})
        serialized = WorkerProtocol.serialize_message(response)

        assert isinstance(serialized, str)
        parsed = json.loads(serialized)
        assert parsed["result"] == {"count": 10}


class TestErrorCodes:
    """Test error codes."""

    def test_standard_jsonrpc_error_codes(self) -> None:
        """Should have standard JSON-RPC error codes."""
        assert WorkerErrorCodes.PARSE_ERROR == -32700
        assert WorkerErrorCodes.INVALID_REQUEST == -32600
        assert WorkerErrorCodes.METHOD_NOT_FOUND == -32601
        assert WorkerErrorCodes.INVALID_PARAMS == -32602
        assert WorkerErrorCodes.INTERNAL_ERROR == -32603

    def test_custom_worker_error_codes(self) -> None:
        """Should have custom worker error codes."""
        assert WorkerErrorCodes.TRIK_NOT_FOUND == 1001
        assert WorkerErrorCodes.ACTION_NOT_FOUND == 1002
        assert WorkerErrorCodes.EXECUTION_TIMEOUT == 1003
        assert WorkerErrorCodes.SCHEMA_VALIDATION_FAILED == 1004
        assert WorkerErrorCodes.WORKER_NOT_READY == 1005
        assert WorkerErrorCodes.STORAGE_ERROR == 1006


class TestInvokeParams:
    """Test InvokeParams handling."""

    def test_minimal_params(self) -> None:
        """Should accept minimal params."""
        params: InvokeParams = {
            "trikPath": "/path/to/trik",
            "action": "search",
            "input": {"query": "test"},
        }

        request = WorkerProtocol.create_invoke_request(params)
        assert request.params == params

    def test_params_with_session(self) -> None:
        """Should accept params with session."""
        params: InvokeParams = {
            "trikPath": "/path/to/trik",
            "action": "details",
            "input": {"id": "123"},
            "session": {
                "sessionId": "session-1",
                "history": [
                    {
                        "timestamp": 1234567890,
                        "action": "search",
                        "input": {"query": "test"},
                        "agentData": {"count": 5},
                    }
                ],
            },
        }

        request = WorkerProtocol.create_invoke_request(params)
        assert request.params == params

    def test_params_with_config(self) -> None:
        """Should accept params with config."""
        params: InvokeParams = {
            "trikPath": "/path/to/trik",
            "action": "generate",
            "input": {"prompt": "Hello"},
            "config": {"API_KEY": "sk-test-key", "MODEL": "gpt-4"},
        }

        request = WorkerProtocol.create_invoke_request(params)
        assert request.params == params
