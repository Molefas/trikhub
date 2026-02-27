"""
JSON-RPC 2.0 protocol types for the worker.

Mirrors the TypeScript worker-protocol.ts types. Messages are newline-delimited
JSON sent over stdin/stdout between the gateway and this worker.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Any


# ============================================================================
# Error Codes
# ============================================================================


class ErrorCode(IntEnum):
    # JSON-RPC standard
    PARSE_ERROR = -32700
    INVALID_REQUEST = -32600
    METHOD_NOT_FOUND = -32601
    INVALID_PARAMS = -32602
    INTERNAL_ERROR = -32603
    # Custom worker errors
    TRIK_NOT_FOUND = 1001
    EXECUTION_TIMEOUT = 1003
    WORKER_NOT_READY = 1005
    STORAGE_ERROR = 1006


# ============================================================================
# JSON-RPC 2.0 Message Types
# ============================================================================


@dataclass
class JsonRpcError:
    code: int
    message: str
    data: Any = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.data is not None:
            d["data"] = self.data
        return d


@dataclass
class JsonRpcRequest:
    method: str
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    params: Any = None
    jsonrpc: str = "2.0"

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"jsonrpc": self.jsonrpc, "id": self.id, "method": self.method}
        if self.params is not None:
            d["params"] = self.params
        return d


@dataclass
class JsonRpcResponse:
    id: str
    result: Any = None
    error: JsonRpcError | None = None
    jsonrpc: str = "2.0"

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"jsonrpc": self.jsonrpc, "id": self.id}
        if self.error is not None:
            d["error"] = self.error.to_dict()
        else:
            d["result"] = self.result
        return d


# ============================================================================
# Builders
# ============================================================================


def success_response(request_id: str, result: Any) -> JsonRpcResponse:
    return JsonRpcResponse(id=request_id, result=result)


def error_response(request_id: str, code: int, message: str, data: Any = None) -> JsonRpcResponse:
    return JsonRpcResponse(id=request_id, error=JsonRpcError(code=code, message=message, data=data))


def create_request(method: str, params: Any = None) -> JsonRpcRequest:
    return JsonRpcRequest(method=method, params=params)


# ============================================================================
# Message Parsing
# ============================================================================


def is_request(msg: dict[str, Any]) -> bool:
    return "method" in msg


def is_response(msg: dict[str, Any]) -> bool:
    return "result" in msg or "error" in msg


def parse_error_object(err: dict[str, Any]) -> JsonRpcError:
    return JsonRpcError(
        code=err.get("code", ErrorCode.INTERNAL_ERROR),
        message=err.get("message", "Unknown error"),
        data=err.get("data"),
    )
