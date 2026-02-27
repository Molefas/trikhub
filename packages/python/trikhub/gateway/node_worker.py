"""
Node.js Worker — Subprocess manager for executing JavaScript triks.

Spawns and manages a Node.js worker process (``@trikhub/worker-js``)
that executes JavaScript triks via JSON-RPC 2.0 over stdin/stdout.

v2 protocol methods:
  - processMessage: conversational trik execution
  - executeTool: tool-mode trik execution
  - health / shutdown: lifecycle

Mirrors packages/js/gateway/src/python-worker.ts (but in reverse).
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
from dataclasses import dataclass
from typing import Any, Callable

from trikhub.worker.protocol import (
    ErrorCode,
    JsonRpcError,
    JsonRpcRequest,
    JsonRpcResponse,
    create_request,
    error_response,
    is_request,
    is_response,
    success_response,
)
from trikhub.manifest import TrikStorageContext


# ============================================================================
# Configuration
# ============================================================================


def _find_node_executable() -> str:
    """
    Find the Node.js executable.

    Search order:
    1. PATH via shutil.which
    2. NVM directories (~/.nvm/versions/node/*/bin/node)
    3. Common install locations (/usr/local/bin/node, /opt/homebrew/bin/node)
    """
    node = shutil.which("node")
    if node:
        return node

    home = os.path.expanduser("~")
    nvm_dir = os.path.join(home, ".nvm", "versions", "node")
    if os.path.isdir(nvm_dir):
        versions = []
        try:
            for v in os.listdir(nvm_dir):
                p = os.path.join(nvm_dir, v, "bin", "node")
                if os.path.isfile(p):
                    versions.append((v, p))
            if versions:
                versions.sort(key=lambda x: x[0], reverse=True)
                return versions[0][1]
        except Exception:
            pass

    for p in ["/usr/local/bin/node", "/usr/bin/node", "/opt/homebrew/bin/node"]:
        if os.path.isfile(p):
            return p

    return "node"


@dataclass
class NodeWorkerConfig:
    """Configuration for the Node.js worker."""

    node_path: str | None = None
    startup_timeout_ms: int = 10000
    invoke_timeout_ms: int = 60000
    debug: bool = False
    worker_script_path: str | None = None

    def __post_init__(self) -> None:
        if self.node_path is None:
            # Check env vars first, then auto-detect
            self.node_path = (
                os.environ.get("TRIKHUB_NODE")
                or os.environ.get("NODE_PATH_EXEC")
                or _find_node_executable()
            )


# ============================================================================
# Result types
# ============================================================================


@dataclass
class HealthResult:
    status: str
    runtime: str
    version: str | None = None
    uptime: float | None = None


@dataclass
class ProcessMessageResult:
    message: str
    transfer_back: bool
    tool_calls: list[dict[str, Any]] | None = None


@dataclass
class ExecuteToolResult:
    output: dict[str, Any]


# ============================================================================
# Node Worker
# ============================================================================


@dataclass
class _PendingRequest:
    future: asyncio.Future[JsonRpcResponse]
    timeout_task: asyncio.Task[None] | None = None


class NodeWorker:
    """
    Node.js worker process for executing JavaScript triks.

    Communicates via stdin/stdout using JSON-RPC 2.0 (v2 protocol).
    """

    def __init__(self, config: NodeWorkerConfig | None = None) -> None:
        self._config = config or NodeWorkerConfig()
        self._process: asyncio.subprocess.Process | None = None
        self._pending: dict[str, _PendingRequest] = {}
        self._is_ready = False
        self._startup_promise: asyncio.Task[None] | None = None
        self._read_task: asyncio.Task[None] | None = None
        self._write_lock = asyncio.Lock()
        self._storage_context: TrikStorageContext | None = None
        self._event_handlers: dict[str, list[Callable[..., Any]]] = {}
        self._stderr_buffer: list[str] = []

    @property
    def ready(self) -> bool:
        return self._is_ready

    # -- Lifecycle ------------------------------------------------------------

    async def start(self) -> None:
        if self._process is not None:
            raise RuntimeError("Worker already started")
        if self._startup_promise is not None:
            await self._startup_promise
            return
        self._startup_promise = asyncio.create_task(self._do_start())
        await self._startup_promise

    async def _do_start(self) -> None:
        worker_script = self._find_worker_script()

        if worker_script.startswith("npx:"):
            package = worker_script[4:]
            cmd = ["npx", package]
        else:
            cmd = [self._config.node_path, worker_script]

        if self._config.debug:
            print(f"[NodeWorker] Starting: {' '.join(cmd)}")

        self._process = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "NODE_NO_WARNINGS": "1"},
        )

        self._read_task = asyncio.create_task(self._read_loop())
        asyncio.create_task(self._read_stderr())

        try:
            health = await asyncio.wait_for(
                self._check_health_internal(),
                timeout=self._config.startup_timeout_ms / 1000,
            )
            if health.status != "ok":
                raise RuntimeError("Worker health check failed")
            self._is_ready = True
            self._emit("ready", health)
        except asyncio.TimeoutError:
            stderr_output = "\n".join(self._stderr_buffer) if self._stderr_buffer else ""
            self.kill()
            msg = f"Worker startup timed out after {self._config.startup_timeout_ms}ms"
            if stderr_output:
                msg += f"\nStderr:\n{stderr_output}"
            raise RuntimeError(msg)

    def _find_worker_script(self) -> str:
        if self._config.worker_script_path:
            return self._config.worker_script_path

        possible = [
            # Local development (monorepo: packages/python/trikhub/gateway/ → packages/js/worker/)
            os.path.join(
                os.path.dirname(__file__),
                "..", "..", "..",
                "js", "worker", "dist", "worker.js",
            ),
            # npm global install
            shutil.which("trikhub-worker-js"),
            # npm local install (node_modules in cwd)
            os.path.join(
                os.getcwd(), "node_modules", "@trikhub", "worker-js", "dist", "worker.js"
            ),
        ]

        for p in possible:
            if p and os.path.isfile(p):
                return os.path.abspath(p)

        # Fallback to npx
        if shutil.which("npx"):
            return "npx:@trikhub/worker-js"

        raise RuntimeError(
            "Could not find @trikhub/worker-js. "
            "Install it with: npm install -g @trikhub/worker-js"
        )

    async def shutdown(self, grace_period_ms: int = 5000) -> None:
        if not self._process:
            return
        try:
            req = create_request("shutdown", {"gracePeriodMs": grace_period_ms})
            await asyncio.wait_for(
                self._send_request(req),
                timeout=(grace_period_ms + 1000) / 1000,
            )
        except Exception:
            pass
        self.kill()

    def kill(self) -> None:
        if self._process:
            try:
                self._process.kill()
            except ProcessLookupError:
                pass
            self._process = None
            self._is_ready = False

        self._stderr_buffer.clear()

        if self._read_task:
            self._read_task.cancel()
            self._read_task = None

        for rid, pending in list(self._pending.items()):
            if pending.timeout_task:
                pending.timeout_task.cancel()
            if not pending.future.done():
                pending.future.set_exception(RuntimeError("Worker killed"))
            del self._pending[rid]

    # -- Public API -----------------------------------------------------------

    def set_storage_context(self, ctx: TrikStorageContext | None) -> None:
        self._storage_context = ctx

    async def health(self) -> HealthResult:
        if not self._process:
            raise RuntimeError("Worker not started")
        return await self._check_health_internal()

    async def process_message(
        self,
        *,
        trik_path: str,
        message: str,
        session_id: str,
        config: dict[str, str],
        storage_namespace: str,
    ) -> ProcessMessageResult:
        if not self._is_ready:
            await self.start()

        req = create_request("processMessage", {
            "trikPath": trik_path,
            "message": message,
            "sessionId": session_id,
            "config": config,
            "storageNamespace": storage_namespace,
        })

        try:
            resp = await asyncio.wait_for(
                self._send_request(req),
                timeout=self._config.invoke_timeout_ms / 1000,
            )
        except asyncio.TimeoutError:
            raise RuntimeError(
                f"processMessage timed out after {self._config.invoke_timeout_ms}ms"
            )

        if resp.error is not None:
            stderr_output = "\n".join(self._stderr_buffer) if self._stderr_buffer else ""
            msg = f"processMessage failed: {resp.error.message}"
            if stderr_output:
                msg += f"\nStderr:\n{stderr_output}"
            raise RuntimeError(msg)

        result = resp.result or {}
        return ProcessMessageResult(
            message=result.get("message", ""),
            transfer_back=result.get("transferBack", False),
            tool_calls=result.get("toolCalls"),
        )

    async def execute_tool(
        self,
        *,
        trik_path: str,
        tool_name: str,
        input: dict[str, Any],
        session_id: str,
        config: dict[str, str],
        storage_namespace: str,
    ) -> ExecuteToolResult:
        if not self._is_ready:
            await self.start()

        req = create_request("executeTool", {
            "trikPath": trik_path,
            "toolName": tool_name,
            "input": input,
            "sessionId": session_id,
            "config": config,
            "storageNamespace": storage_namespace,
        })

        try:
            resp = await asyncio.wait_for(
                self._send_request(req),
                timeout=self._config.invoke_timeout_ms / 1000,
            )
        except asyncio.TimeoutError:
            raise RuntimeError(
                f"executeTool timed out after {self._config.invoke_timeout_ms}ms"
            )

        if resp.error is not None:
            stderr_output = "\n".join(self._stderr_buffer) if self._stderr_buffer else ""
            msg = f"executeTool failed: {resp.error.message}"
            if stderr_output:
                msg += f"\nStderr:\n{stderr_output}"
            raise RuntimeError(msg)

        result = resp.result or {}
        return ExecuteToolResult(output=result.get("output", {}))

    # -- Internal: I/O --------------------------------------------------------

    async def _read_loop(self) -> None:
        if not self._process or not self._process.stdout:
            return
        try:
            while True:
                line = await self._process.stdout.readline()
                if not line:
                    break
                line_str = line.decode("utf-8").strip()
                if not line_str:
                    continue
                await self._handle_line(line_str)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            if self._config.debug:
                print(f"[NodeWorker] Read error: {e}")

    async def _read_stderr(self) -> None:
        if not self._process or not self._process.stderr:
            return
        try:
            while True:
                line = await self._process.stderr.readline()
                if not line:
                    break
                msg = line.decode("utf-8").strip()
                self._stderr_buffer.append(msg)
                if self._config.debug:
                    print(f"[NodeWorker:stderr] {msg}")
                self._emit("stderr", msg)
        except (asyncio.CancelledError, Exception):
            pass

    async def _handle_line(self, line: str) -> None:
        if self._config.debug:
            print(f"[NodeWorker:recv] {line}")

        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            self._emit("parse-error", ValueError(f"Bad JSON: {line}"), line)
            return

        if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0":
            return

        if is_response(msg):
            resp = JsonRpcResponse(
                id=msg["id"],
                result=msg.get("result"),
                error=(
                    JsonRpcError(
                        code=msg["error"].get("code", ErrorCode.INTERNAL_ERROR),
                        message=msg["error"].get("message", "Unknown error"),
                        data=msg["error"].get("data"),
                    )
                    if msg.get("error")
                    else None
                ),
            )
            pending = self._pending.pop(resp.id, None)
            if pending:
                if pending.timeout_task:
                    pending.timeout_task.cancel()
                pending.future.set_result(resp)
        elif is_request(msg):
            await self._handle_worker_request(msg)

    async def _handle_worker_request(self, msg: dict[str, Any]) -> None:
        method = msg.get("method", "")
        request_id = msg.get("id", "unknown")

        if method.startswith("storage."):
            await self._handle_storage_request(request_id, method, msg.get("params", {}))
        else:
            resp = error_response(
                request_id, ErrorCode.METHOD_NOT_FOUND, f"Unknown method: {method}"
            )
            await self._write_response(resp)

    async def _handle_storage_request(
        self, request_id: str, method: str, params: dict[str, Any]
    ) -> None:
        if not self._storage_context:
            resp = error_response(
                request_id, ErrorCode.STORAGE_ERROR, "Storage not available"
            )
            await self._write_response(resp)
            return

        try:
            result: dict[str, Any]
            if method == "storage.get":
                value = await self._storage_context.get(params.get("key", ""))
                result = {"value": value}
            elif method == "storage.set":
                await self._storage_context.set(
                    params.get("key", ""),
                    params.get("value"),
                    params.get("ttl"),
                )
                result = {"success": True}
            elif method == "storage.delete":
                deleted = await self._storage_context.delete(params.get("key", ""))
                result = {"deleted": deleted}
            elif method == "storage.list":
                keys = await self._storage_context.list(params.get("prefix"))
                result = {"keys": keys}
            elif method == "storage.getMany":
                values = await self._storage_context.get_many(params.get("keys", []))
                result = {"values": values}
            elif method == "storage.setMany":
                await self._storage_context.set_many(params.get("entries", {}))
                result = {"success": True}
            else:
                resp = error_response(
                    request_id, ErrorCode.METHOD_NOT_FOUND, f"Unknown storage method: {method}"
                )
                await self._write_response(resp)
                return

            resp = success_response(request_id, result)
            await self._write_response(resp)
        except Exception as e:
            resp = error_response(
                request_id, ErrorCode.STORAGE_ERROR, f"Storage error: {e}"
            )
            await self._write_response(resp)

    async def _check_health_internal(self) -> HealthResult:
        req = create_request("health", {})
        resp = await self._send_request(req)
        if resp.error is not None:
            raise RuntimeError(f"Health check failed: {resp.error.message}")
        r = resp.result or {}
        return HealthResult(
            status=r.get("status", "error"),
            runtime=r.get("runtime", "unknown"),
            version=r.get("version"),
            uptime=r.get("uptime"),
        )

    async def _send_request(self, request: JsonRpcRequest) -> JsonRpcResponse:
        if not self._process or not self._process.stdin:
            raise RuntimeError("Worker stdin not available")

        future: asyncio.Future[JsonRpcResponse] = asyncio.get_running_loop().create_future()
        self._pending[request.id] = _PendingRequest(future=future)

        await self._write_request(request)
        return await future

    async def _write_request(self, request: JsonRpcRequest) -> None:
        async with self._write_lock:
            if not self._process or not self._process.stdin:
                return
            line = json.dumps(request.to_dict()) + "\n"
            if self._config.debug:
                print(f"[NodeWorker:send] {line.strip()}")
            self._process.stdin.write(line.encode("utf-8"))
            await self._process.stdin.drain()

    async def _write_response(self, response: JsonRpcResponse) -> None:
        async with self._write_lock:
            if not self._process or not self._process.stdin:
                return
            line = json.dumps(response.to_dict()) + "\n"
            if self._config.debug:
                print(f"[NodeWorker:send] {line.strip()}")
            self._process.stdin.write(line.encode("utf-8"))
            await self._process.stdin.drain()

    # -- Events ---------------------------------------------------------------

    def _emit(self, event: str, *args: Any) -> None:
        for handler in self._event_handlers.get(event, []):
            try:
                handler(*args)
            except Exception:
                pass

    def on(self, event: str, handler: Callable[..., Any]) -> None:
        self._event_handlers.setdefault(event, []).append(handler)

    def off(self, event: str, handler: Callable[..., Any]) -> None:
        handlers = self._event_handlers.get(event, [])
        try:
            handlers.remove(handler)
        except ValueError:
            pass
