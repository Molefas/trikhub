"""
Node.js Worker - Subprocess manager for executing JavaScript triks

This module spawns and manages a Node.js worker process that executes
JavaScript triks via JSON-RPC 2.0 protocol over stdin/stdout.

Mirrors packages/trik-gateway/src/python-worker.ts
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
from dataclasses import dataclass, field
from typing import Any, Callable

from trikhub.gateway.worker_protocol import (
    JsonRpcRequest,
    JsonRpcResponse,
    WorkerProtocol,
    WorkerErrorCodes,
)
from trikhub.gateway.config_store import TrikConfigContext
from trikhub.gateway.storage_provider import TrikStorageContext


# ============================================================================
# Configuration
# ============================================================================


@dataclass
class NodeWorkerConfig:
    """Configuration for the Node.js worker."""

    # Path to Node.js executable (defaults to 'node')
    node_path: str = "node"
    # Timeout for worker startup in ms (default: 10000)
    startup_timeout_ms: int = 10000
    # Timeout for invoke requests in ms (default: 60000)
    invoke_timeout_ms: int = 60000
    # Whether to enable debug logging
    debug: bool = False
    # Path to the worker script (auto-detected if not specified)
    worker_script_path: str | None = None


@dataclass
class ExecuteNodeTrikOptions:
    """Options for executing a JavaScript trik."""

    # Session context if session is enabled
    session: dict[str, Any] | None = None
    # Configuration context for API keys
    config: TrikConfigContext | None = None
    # Storage context for persistent data
    storage: TrikStorageContext | None = None


@dataclass
class HealthResult:
    """Health check result."""

    status: str  # 'ok' or 'error'
    runtime: str  # 'node' or 'python'
    version: str | None = None
    uptime: float | None = None


@dataclass
class InvokeResult:
    """Result from trik execution via worker."""

    response_mode: str | None = None  # 'template' or 'passthrough'
    agent_data: Any = None
    user_content: Any = None
    needs_clarification: bool = False
    clarification_questions: list[Any] | None = None
    end_session: bool = False


@dataclass
class PendingRequest:
    """A pending request waiting for a response."""

    future: asyncio.Future[JsonRpcResponse]
    timeout_task: asyncio.Task[None] | None = None


# ============================================================================
# Node Worker
# ============================================================================


class NodeWorker:
    """
    Node.js worker process for executing JavaScript triks.

    Communicates with the worker via stdin/stdout using JSON-RPC 2.0.
    """

    def __init__(self, config: NodeWorkerConfig | None = None) -> None:
        self._config = config or NodeWorkerConfig()
        self._process: asyncio.subprocess.Process | None = None
        self._pending_requests: dict[str, PendingRequest] = {}
        self._is_ready = False
        self._startup_promise: asyncio.Task[None] | None = None
        self._read_task: asyncio.Task[None] | None = None
        self._write_lock = asyncio.Lock()
        self._storage_context: TrikStorageContext | None = None
        self._event_handlers: dict[str, list[Callable[..., Any]]] = {}

    @property
    def ready(self) -> bool:
        """Check if the worker is running and ready."""
        return self._is_ready

    async def start(self) -> None:
        """Start the Node.js worker process."""
        if self._process is not None:
            raise RuntimeError("Worker already started")

        if self._startup_promise is not None:
            await self._startup_promise
            return

        self._startup_promise = asyncio.create_task(self._do_start())
        await self._startup_promise

    async def _do_start(self) -> None:
        """Internal startup logic."""
        worker_script = self._find_worker_script()

        # Handle npx: prefix - run via npx instead of node directly
        if worker_script.startswith("npx:"):
            package_name = worker_script[4:]  # Remove "npx:" prefix
            cmd = ["npx", package_name]
            if self._config.debug:
                print(f"[NodeWorker] Starting worker: npx {package_name}")
        else:
            cmd = [self._config.node_path, worker_script]
            if self._config.debug:
                print(f"[NodeWorker] Starting worker: {self._config.node_path} {worker_script}")

        # Spawn the Node.js worker process
        self._process = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={
                **os.environ,
                "NODE_NO_WARNINGS": "1",  # Suppress experimental warnings
            },
        )

        # Start reading from stdout and stderr
        self._read_task = asyncio.create_task(self._read_loop())
        asyncio.create_task(self._read_stderr())

        # Wait for health check with timeout
        try:
            health_result = await asyncio.wait_for(
                self._check_health_internal(),
                timeout=self._config.startup_timeout_ms / 1000,
            )

            if health_result.status != "ok":
                raise RuntimeError("Worker health check failed")

            self._is_ready = True
            self._emit("ready", health_result)

            if self._config.debug:
                print(f"[NodeWorker] Worker ready: {health_result}")

        except asyncio.TimeoutError:
            self.kill()
            raise RuntimeError(
                f"Worker startup timed out after {self._config.startup_timeout_ms}ms"
            )

    def _find_worker_script(self) -> str:
        """Find the path to the worker script."""
        if self._config.worker_script_path:
            return self._config.worker_script_path

        # Try to find the worker script in common locations
        possible_paths = [
            # Local development (new structure: packages/js/worker)
            os.path.join(
                os.path.dirname(__file__),
                "..",
                "..",
                "..",
                "..",
                "packages",
                "js",
                "worker",
                "dist",
                "worker.js",
            ),
            # npm global install
            shutil.which("trikhub-worker-js"),
            # npm local install (node_modules)
            os.path.join(os.getcwd(), "node_modules", "@trikhub", "worker-js", "dist", "worker.js"),
            # npx fallback - use npx to run the worker
        ]

        for path in possible_paths:
            if path and os.path.isfile(path):
                return os.path.abspath(path)

        # Fall back to using npx
        npx_path = shutil.which("npx")
        if npx_path:
            # Return a marker that we should use npx
            return "npx:@trikhub/worker-js"

        raise RuntimeError(
            "Could not find @trikhub/worker-js. "
            "Install it with: npm install -g @trikhub/worker-js"
        )

    async def _read_loop(self) -> None:
        """Read lines from stdout and dispatch to handlers."""
        if not self._process or not self._process.stdout:
            return

        try:
            while True:
                line = await self._process.stdout.readline()
                if not line:
                    break  # EOF

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
        """Read lines from stderr for debugging."""
        if not self._process or not self._process.stderr:
            return

        try:
            while True:
                line = await self._process.stderr.readline()
                if not line:
                    break

                message = line.decode("utf-8").strip()
                if self._config.debug:
                    print(f"[NodeWorker:stderr] {message}")

                self._emit("stderr", message)

        except asyncio.CancelledError:
            pass
        except Exception:
            pass

    async def _handle_line(self, line: str) -> None:
        """Handle a line received from the worker."""
        if self._config.debug:
            print(f"[NodeWorker:recv] {line}")

        try:
            message = WorkerProtocol.parse_message(line)
        except ValueError as e:
            if self._config.debug:
                print(f"[NodeWorker] Failed to parse message: {line}, error: {e}")
            self._emit("parse-error", e, line)
            return

        if WorkerProtocol.is_response(message):
            # Response to a pending request
            assert isinstance(message, JsonRpcResponse)
            pending = self._pending_requests.pop(message.id, None)
            if pending:
                if pending.timeout_task:
                    pending.timeout_task.cancel()
                pending.future.set_result(message)
        else:
            # Request from worker (e.g., storage proxy)
            assert isinstance(message, JsonRpcRequest)
            await self._handle_worker_request(message)

    async def _handle_worker_request(self, request: JsonRpcRequest) -> None:
        """Handle a request from the worker (e.g., storage proxy)."""
        method = request.method

        if method.startswith("storage."):
            await self._handle_storage_request(request)
        else:
            # Unknown method
            response = WorkerProtocol.create_error_response(
                request.id,
                WorkerErrorCodes.METHOD_NOT_FOUND,
                f"Unknown method: {method}",
            )
            await self._write_response(response)

    async def _handle_storage_request(self, request: JsonRpcRequest) -> None:
        """Handle a storage proxy request from the worker."""
        if not self._storage_context:
            response = WorkerProtocol.create_error_response(
                request.id,
                WorkerErrorCodes.STORAGE_ERROR,
                "Storage not available",
            )
            await self._write_response(response)
            return

        method = request.method
        params = request.params or {}

        try:
            if method == "storage.get":
                key = params.get("key", "")
                value = await self._storage_context.get(key)
                result = {"value": value}

            elif method == "storage.set":
                key = params.get("key", "")
                value = params.get("value")
                ttl = params.get("ttl")
                await self._storage_context.set(key, value, ttl)
                result = {"success": True}

            elif method == "storage.delete":
                key = params.get("key", "")
                deleted = await self._storage_context.delete(key)
                result = {"deleted": deleted}

            elif method == "storage.list":
                prefix = params.get("prefix")
                keys = await self._storage_context.list(prefix)
                result = {"keys": keys}

            elif method == "storage.getMany":
                keys = params.get("keys", [])
                values = await self._storage_context.get_many(keys)
                result = {"values": values}

            elif method == "storage.setMany":
                entries = params.get("entries", {})
                await self._storage_context.set_many(entries)
                result = {"success": True}

            else:
                response = WorkerProtocol.create_error_response(
                    request.id,
                    WorkerErrorCodes.METHOD_NOT_FOUND,
                    f"Unknown storage method: {method}",
                )
                await self._write_response(response)
                return

            response = WorkerProtocol.create_success_response(request.id, result)
            await self._write_response(response)

        except Exception as e:
            response = WorkerProtocol.create_error_response(
                request.id,
                WorkerErrorCodes.STORAGE_ERROR,
                f"Storage error: {e}",
            )
            await self._write_response(response)

    async def _check_health_internal(self) -> HealthResult:
        """Internal health check without ready check."""
        request = WorkerProtocol.create_request("health", {})
        response = await self._send_request(request)

        if response.is_error:
            raise RuntimeError(f"Health check failed: {response.error}")

        result = response.result or {}
        return HealthResult(
            status=result.get("status", "error"),
            runtime=result.get("runtime", "unknown"),
            version=result.get("version"),
            uptime=result.get("uptime"),
        )

    async def invoke(
        self,
        trik_path: str,
        action: str,
        input_data: Any,
        options: ExecuteNodeTrikOptions | None = None,
    ) -> InvokeResult:
        """Execute a JavaScript trik."""
        if not self._is_ready:
            await self.start()

        options = options or ExecuteNodeTrikOptions()

        # Set storage context for proxy calls
        self._storage_context = options.storage

        # Build invoke params
        params: dict[str, Any] = {
            "trikPath": trik_path,
            "action": action,
            "input": input_data,
        }

        if options.session:
            params["session"] = options.session

        if options.config:
            # Convert config context to dict
            params["config"] = self._config_context_to_dict(options.config)

        request = WorkerProtocol.create_request("invoke", params)

        try:
            response = await asyncio.wait_for(
                self._send_request(request),
                timeout=self._config.invoke_timeout_ms / 1000,
            )
        except asyncio.TimeoutError:
            raise RuntimeError(
                f"Invoke timed out after {self._config.invoke_timeout_ms}ms"
            )
        finally:
            self._storage_context = None

        if response.is_error:
            raise RuntimeError(
                f"Invoke failed: {response.error.get('message', 'Unknown error')} "
                f"(code: {response.error.get('code', -1)})"
            )

        result = response.result or {}
        return InvokeResult(
            response_mode=result.get("responseMode"),
            agent_data=result.get("agentData"),
            user_content=result.get("userContent"),
            needs_clarification=result.get("needsClarification", False),
            clarification_questions=result.get("clarificationQuestions"),
            end_session=result.get("endSession", False),
        )

    async def health(self) -> HealthResult:
        """Check worker health."""
        if not self._process:
            raise RuntimeError("Worker not started")

        return await self._check_health_internal()

    async def shutdown(self, grace_period_ms: int = 5000) -> None:
        """Gracefully shutdown the worker."""
        if not self._process:
            return

        try:
            request = WorkerProtocol.create_request(
                "shutdown", {"gracePeriodMs": grace_period_ms}
            )
            await asyncio.wait_for(
                self._send_request(request),
                timeout=(grace_period_ms + 1000) / 1000,
            )
        except Exception:
            pass  # Ignore errors during shutdown

        self.kill()

    def kill(self) -> None:
        """Force kill the worker process."""
        if self._process:
            try:
                self._process.kill()
            except ProcessLookupError:
                pass
            self._process = None
            self._is_ready = False

        if self._read_task:
            self._read_task.cancel()
            self._read_task = None

        # Cancel all pending requests
        for request_id, pending in list(self._pending_requests.items()):
            if pending.timeout_task:
                pending.timeout_task.cancel()
            if not pending.future.done():
                pending.future.set_exception(RuntimeError("Worker killed"))
            del self._pending_requests[request_id]

    async def _send_request(self, request: JsonRpcRequest) -> JsonRpcResponse:
        """Send a request and wait for response."""
        if not self._process or not self._process.stdin:
            raise RuntimeError("Worker stdin not available")

        future: asyncio.Future[JsonRpcResponse] = asyncio.Future()
        self._pending_requests[request.id] = PendingRequest(future=future)

        await self._write_request(request)
        return await future

    async def _write_request(self, request: JsonRpcRequest) -> None:
        """Write a request to the worker's stdin."""
        async with self._write_lock:
            if not self._process or not self._process.stdin:
                return

            line = request.to_json() + "\n"
            if self._config.debug:
                print(f"[NodeWorker:send] {line.strip()}")

            self._process.stdin.write(line.encode("utf-8"))
            await self._process.stdin.drain()

    async def _write_response(self, response: JsonRpcResponse) -> None:
        """Write a response to the worker's stdin."""
        async with self._write_lock:
            if not self._process or not self._process.stdin:
                return

            line = response.to_json() + "\n"
            if self._config.debug:
                print(f"[NodeWorker:send] {line.strip()}")

            self._process.stdin.write(line.encode("utf-8"))
            await self._process.stdin.drain()

    def _config_context_to_dict(self, config: TrikConfigContext) -> dict[str, str]:
        """Convert a config context to a dict."""
        result: dict[str, str] = {}
        for key in config.keys():
            value = config.get(key)
            if value is not None:
                result[key] = value
        return result

    def _emit(self, event: str, *args: Any) -> None:
        """Emit an event to registered handlers."""
        handlers = self._event_handlers.get(event, [])
        for handler in handlers:
            try:
                handler(*args)
            except Exception:
                pass

    def on(self, event: str, handler: Callable[..., Any]) -> None:
        """Register an event handler."""
        if event not in self._event_handlers:
            self._event_handlers[event] = []
        self._event_handlers[event].append(handler)

    def off(self, event: str, handler: Callable[..., Any]) -> None:
        """Unregister an event handler."""
        if event in self._event_handlers:
            try:
                self._event_handlers[event].remove(handler)
            except ValueError:
                pass


# ============================================================================
# Singleton Worker Manager
# ============================================================================

_shared_worker: NodeWorker | None = None


def get_shared_node_worker(config: NodeWorkerConfig | None = None) -> NodeWorker:
    """Get or create a shared Node.js worker instance."""
    global _shared_worker
    if _shared_worker is None:
        _shared_worker = NodeWorker(config)
    return _shared_worker


async def shutdown_shared_node_worker() -> None:
    """Shutdown the shared Node.js worker."""
    global _shared_worker
    if _shared_worker:
        await _shared_worker.shutdown()
        _shared_worker = None
