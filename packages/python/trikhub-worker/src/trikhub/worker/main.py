"""
Python Worker for TrikHub (v2 Protocol)

Executes Python triks via JSON-RPC 2.0 over stdin/stdout.

v2 Protocol methods:
  - health: Health check
  - shutdown: Graceful shutdown
  - processMessage: Execute a conversational trik agent
  - executeTool: Execute a tool-mode trik

Usage:
    python -m trikhub.worker.main
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
from typing import Any

from trikhub.manifest import TrikContext

from trikhub.worker.protocol import (
    ErrorCode,
    JsonRpcResponse,
    error_response,
    is_request,
    is_response,
    success_response,
)
from trikhub.worker.storage_proxy import StorageProxy
from trikhub.worker.trik_loader import TrikLoader


class PythonWorker:
    """Python worker process for executing triks via v2 protocol."""

    def __init__(self) -> None:
        self._trik_loader = TrikLoader()
        self._storage_proxy = StorageProxy(self._write_line)
        self._start_time = time.monotonic()
        self._running = True
        self._write_lock = asyncio.Lock()

    async def run(self) -> None:
        """Main worker loop: read stdin line by line, dispatch JSON-RPC."""
        reader = asyncio.StreamReader()
        protocol = asyncio.StreamReaderProtocol(reader)
        await asyncio.get_event_loop().connect_read_pipe(lambda: protocol, sys.stdin)

        while self._running:
            try:
                line = await reader.readline()
                if not line:
                    break  # EOF
                line_str = line.decode("utf-8").strip()
                if not line_str:
                    continue
                # Don't await — keep reading stdin so storage proxy responses
                # can arrive while a trik invocation is in progress
                asyncio.create_task(self._handle_message_safe(line_str))
            except Exception:
                break

    # -- Message routing ------------------------------------------------------

    async def _handle_message_safe(self, line: str) -> None:
        try:
            await self._handle_message(line)
        except Exception as exc:
            resp = error_response(
                "unknown",
                ErrorCode.INTERNAL_ERROR,
                f"Worker error: {exc}",
            )
            self._write_response(resp)

    async def _handle_message(self, line: str) -> None:
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as exc:
            self._write_response(
                error_response("unknown", ErrorCode.PARSE_ERROR, str(exc))
            )
            return

        if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0":
            self._write_response(
                error_response(
                    msg.get("id", "unknown") if isinstance(msg, dict) else "unknown",
                    ErrorCode.INVALID_REQUEST,
                    "Invalid JSON-RPC 2.0 message",
                )
            )
            return

        # Storage proxy responses come back through here
        if is_response(msg):
            self._storage_proxy.handle_response(
                msg_id=msg["id"],
                result=msg.get("result"),
                error=msg.get("error"),
            )
            return

        # Otherwise it's a request from the gateway
        if is_request(msg):
            resp = await self._handle_request(msg)
            self._write_response(resp)

    async def _handle_request(self, msg: dict[str, Any]) -> JsonRpcResponse:
        method = msg.get("method", "")
        request_id = msg.get("id", "unknown")
        params = msg.get("params") or {}

        if method == "health":
            return self._handle_health(request_id)
        elif method == "shutdown":
            return self._handle_shutdown(request_id)
        elif method == "processMessage":
            return await self._handle_process_message(request_id, params)
        elif method == "executeTool":
            return await self._handle_execute_tool(request_id, params)
        else:
            return error_response(
                request_id,
                ErrorCode.METHOD_NOT_FOUND,
                f"Unknown method: {method}",
            )

    # -- Method handlers ------------------------------------------------------

    def _handle_health(self, request_id: str) -> JsonRpcResponse:
        uptime = time.monotonic() - self._start_time
        return success_response(request_id, {
            "status": "ok",
            "runtime": "python",
            "version": sys.version.split()[0],
            "uptime": round(uptime, 3),
        })

    def _handle_shutdown(self, request_id: str) -> JsonRpcResponse:
        self._running = False
        return success_response(request_id, {"acknowledged": True})

    async def _handle_process_message(
        self, request_id: str, params: dict[str, Any]
    ) -> JsonRpcResponse:
        trik_path = params.get("trikPath")
        if not trik_path:
            return error_response(request_id, ErrorCode.INVALID_PARAMS, "Missing trikPath parameter")

        message = params.get("message")
        if message is None:
            return error_response(request_id, ErrorCode.INVALID_PARAMS, "Missing message parameter")

        try:
            agent = self._trik_loader.load(trik_path)

            if not callable(getattr(agent, "process_message", None)):
                return error_response(
                    request_id,
                    ErrorCode.INTERNAL_ERROR,
                    "Trik does not implement process_message (not a conversational trik)",
                )

            context = self._build_context(params)
            response = await agent.process_message(str(message), context)

            result: dict[str, Any] = {
                "message": response.message,
                "transferBack": response.transferBack,
            }
            if response.toolCalls is not None:
                result["toolCalls"] = [tc.model_dump() for tc in response.toolCalls]

            return success_response(request_id, result)

        except FileNotFoundError as exc:
            return error_response(request_id, ErrorCode.TRIK_NOT_FOUND, str(exc))
        except Exception as exc:
            return error_response(
                request_id,
                ErrorCode.INTERNAL_ERROR,
                f"Execution error: {exc}",
            )

    async def _handle_execute_tool(
        self, request_id: str, params: dict[str, Any]
    ) -> JsonRpcResponse:
        trik_path = params.get("trikPath")
        if not trik_path:
            return error_response(request_id, ErrorCode.INVALID_PARAMS, "Missing trikPath parameter")

        tool_name = params.get("toolName")
        if not tool_name:
            return error_response(request_id, ErrorCode.INVALID_PARAMS, "Missing toolName parameter")

        try:
            agent = self._trik_loader.load(trik_path)

            if not callable(getattr(agent, "execute_tool", None)):
                return error_response(
                    request_id,
                    ErrorCode.INTERNAL_ERROR,
                    "Trik does not implement execute_tool (not a tool-mode trik)",
                )

            context = self._build_context(params)
            result = await agent.execute_tool(str(tool_name), params.get("input", {}), context)

            return success_response(request_id, {"output": result.output})

        except FileNotFoundError as exc:
            return error_response(request_id, ErrorCode.TRIK_NOT_FOUND, str(exc))
        except Exception as exc:
            return error_response(
                request_id,
                ErrorCode.INTERNAL_ERROR,
                f"Execution error: {exc}",
            )

    # -- Helpers --------------------------------------------------------------

    def _build_context(self, params: dict[str, Any]) -> TrikContext:
        config_record = params.get("config", {})
        config_ctx = _ConfigContext(config_record)
        return TrikContext(
            sessionId=params.get("sessionId", ""),
            config=config_ctx,
            storage=self._storage_proxy,
        )

    def _write_response(self, response: JsonRpcResponse) -> None:
        self._write_line(json.dumps(response.to_dict()))

    def _write_line(self, line: str) -> None:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


class _ConfigContext:
    """Simple config context wrapping a dict."""

    def __init__(self, data: dict[str, str]) -> None:
        self._data = data

    def get(self, key: str) -> str | None:
        return self._data.get(key)

    def has(self, key: str) -> bool:
        return key in self._data

    def keys(self) -> list[str]:
        return list(self._data.keys())


async def run_worker() -> None:
    worker = PythonWorker()
    await worker.run()


if __name__ == "__main__":
    asyncio.run(run_worker())
