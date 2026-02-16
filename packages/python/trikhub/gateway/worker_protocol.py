"""
Worker Protocol for Cross-Language Trik Execution

This module defines the JSON-RPC 2.0 protocol used for communication
between the gateway and language-specific workers (Python, Node.js).

Communication happens over stdin/stdout with newline-delimited JSON.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Any, Literal, TypedDict


# ============================================================================
# Error Codes
# ============================================================================


class WorkerErrorCodes(IntEnum):
    """JSON-RPC and worker-specific error codes."""

    # JSON-RPC standard errors
    PARSE_ERROR = -32700
    INVALID_REQUEST = -32600
    METHOD_NOT_FOUND = -32601
    INVALID_PARAMS = -32602
    INTERNAL_ERROR = -32603

    # Custom worker errors
    TRIK_NOT_FOUND = 1001
    ACTION_NOT_FOUND = 1002
    EXECUTION_TIMEOUT = 1003
    SCHEMA_VALIDATION_FAILED = 1004
    WORKER_NOT_READY = 1005
    STORAGE_ERROR = 1006


# ============================================================================
# Type Definitions
# ============================================================================


class SessionHistoryEntry(TypedDict, total=False):
    """Entry in session history."""

    timestamp: int
    action: str
    input: Any
    agentData: Any
    userContent: Any


class SessionContext(TypedDict):
    """Session context passed to trik."""

    sessionId: str
    history: list[SessionHistoryEntry]


class PassthroughContent(TypedDict, total=False):
    """Content delivered directly to user."""

    contentType: str
    content: str
    metadata: dict[str, Any]


class ClarificationQuestion(TypedDict, total=False):
    """Question for clarification flow."""

    questionId: str
    questionText: str
    questionType: Literal["text", "multiple_choice", "boolean"]
    options: list[str]
    required: bool


class InvokeParams(TypedDict, total=False):
    """Parameters for the invoke method."""

    trikPath: str
    action: str
    input: Any
    session: SessionContext
    config: dict[str, str]


class InvokeResult(TypedDict, total=False):
    """Result from trik execution."""

    responseMode: Literal["template", "passthrough"]
    agentData: Any
    userContent: PassthroughContent
    needsClarification: bool
    clarificationQuestions: list[ClarificationQuestion]
    endSession: bool


class HealthResult(TypedDict, total=False):
    """Result from health check."""

    status: Literal["ok", "error"]
    runtime: Literal["python", "node"]
    version: str
    uptime: float


class JsonRpcError(TypedDict, total=False):
    """JSON-RPC error object."""

    code: int
    message: str
    data: Any


# ============================================================================
# Message Classes
# ============================================================================


@dataclass
class JsonRpcRequest:
    """JSON-RPC 2.0 request message."""

    method: str
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    params: Any = None
    jsonrpc: str = "2.0"

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        result: dict[str, Any] = {
            "jsonrpc": self.jsonrpc,
            "id": self.id,
            "method": self.method,
        }
        if self.params is not None:
            result["params"] = self.params
        return result

    def to_json(self) -> str:
        """Serialize to JSON string."""
        return json.dumps(self.to_dict())

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> JsonRpcRequest:
        """Create from dictionary."""
        return cls(
            jsonrpc=data.get("jsonrpc", "2.0"),
            id=data.get("id", str(uuid.uuid4())),
            method=data["method"],
            params=data.get("params"),
        )


@dataclass
class JsonRpcResponse:
    """JSON-RPC 2.0 response message."""

    id: str
    result: Any = None
    error: JsonRpcError | None = None
    jsonrpc: str = "2.0"

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        result: dict[str, Any] = {
            "jsonrpc": self.jsonrpc,
            "id": self.id,
        }
        if self.error is not None:
            result["error"] = self.error
        else:
            result["result"] = self.result
        return result

    def to_json(self) -> str:
        """Serialize to JSON string."""
        return json.dumps(self.to_dict())

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> JsonRpcResponse:
        """Create from dictionary."""
        return cls(
            jsonrpc=data.get("jsonrpc", "2.0"),
            id=data["id"],
            result=data.get("result"),
            error=data.get("error"),
        )

    @property
    def is_error(self) -> bool:
        """Check if this is an error response."""
        return self.error is not None


# ============================================================================
# Protocol Helper Class
# ============================================================================


class WorkerProtocol:
    """Helper class for working with the worker protocol."""

    @staticmethod
    def create_request(method: str, params: Any = None) -> JsonRpcRequest:
        """Create a generic JSON-RPC request."""
        return JsonRpcRequest(method=method, params=params)

    @staticmethod
    def create_invoke_request(params: InvokeParams) -> JsonRpcRequest:
        """Create an invoke request."""
        return JsonRpcRequest(method="invoke", params=params)

    @staticmethod
    def create_health_request() -> JsonRpcRequest:
        """Create a health check request."""
        return JsonRpcRequest(method="health")

    @staticmethod
    def create_shutdown_request(grace_period_ms: int | None = None) -> JsonRpcRequest:
        """Create a shutdown request."""
        params = {"gracePeriodMs": grace_period_ms} if grace_period_ms else None
        return JsonRpcRequest(method="shutdown", params=params)

    @staticmethod
    def create_storage_request(method: str, params: dict[str, Any]) -> JsonRpcRequest:
        """Create a storage proxy request."""
        return JsonRpcRequest(method=method, params=params)

    @staticmethod
    def create_success_response(request_id: str, result: Any) -> JsonRpcResponse:
        """Create a success response."""
        return JsonRpcResponse(id=request_id, result=result)

    @staticmethod
    def create_error_response(
        request_id: str,
        code: int,
        message: str,
        data: Any = None,
    ) -> JsonRpcResponse:
        """Create an error response."""
        error: JsonRpcError = {"code": code, "message": message}
        if data is not None:
            error["data"] = data
        return JsonRpcResponse(id=request_id, error=error)

    @staticmethod
    def parse_message(line: str) -> JsonRpcRequest | JsonRpcResponse:
        """Parse a JSON-RPC message from a string."""
        try:
            data = json.loads(line)
        except json.JSONDecodeError as e:
            raise ValueError(f"Failed to parse JSON-RPC message: {e}") from e

        if not isinstance(data, dict):
            raise ValueError("Failed to parse JSON-RPC message: Message must be an object")

        if data.get("jsonrpc") != "2.0":
            raise ValueError("Invalid JSON-RPC version")

        if "id" not in data or not isinstance(data.get("id"), str):
            raise ValueError("Message ID must be a string")

        # Determine if request or response
        if "method" in data:
            return JsonRpcRequest.from_dict(data)
        elif "result" in data or "error" in data:
            return JsonRpcResponse.from_dict(data)
        else:
            raise ValueError("Message must be a request or response")

    @staticmethod
    def is_request(message: JsonRpcRequest | JsonRpcResponse) -> bool:
        """Check if message is a request."""
        return isinstance(message, JsonRpcRequest)

    @staticmethod
    def is_response(message: JsonRpcRequest | JsonRpcResponse) -> bool:
        """Check if message is a response."""
        return isinstance(message, JsonRpcResponse)

    @staticmethod
    def serialize_message(message: JsonRpcRequest | JsonRpcResponse) -> str:
        """Serialize a message to JSON string."""
        return message.to_json()
