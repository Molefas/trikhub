"""
Container Manager — Docker container lifecycle management for containerized triks.

Manages Docker containers that run trik workers with filesystem and shell capabilities.
Each containerized trik gets its own container with:
  - /workspace mounted (read-write) for filesystem operations
  - /trik mounted (read-only) for trik source code
  - JSON-RPC 2.0 communication over stdin/stdout (same protocol as NodeWorker)

The ContainerWorkerHandle implements the same interface as NodeWorker,
allowing the gateway to treat containerized triks identically to regular ones.

Mirrors packages/js/gateway/src/container-manager.ts.
"""

from __future__ import annotations

import atexit
import asyncio
import json
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
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
# Types
# ============================================================================

WORKER_IMAGES = {
    "node": "trikhub/worker-node:22",
    "python": "trikhub/worker-python:3.12",
}


@dataclass
class ContainerOptions:
    """Options for launching a containerized trik."""

    runtime: str  # 'node' or 'python'
    workspace_path: str
    trik_path: str
    network_enabled: bool = True
    memory_limit_mb: int = 512
    cpu_limit: float | None = None


@dataclass
class ContainerManagerConfig:
    """Configuration for the DockerContainerManager."""

    workspace_base_dir: str | None = None
    startup_timeout_ms: int = 30000
    invoke_timeout_ms: int = 120000
    debug: bool = False


# ============================================================================
# Result types (shared with NodeWorker)
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
# ContainerWorkerHandle
# ============================================================================


@dataclass
class _PendingRequest:
    future: asyncio.Future[JsonRpcResponse]
    timeout_task: asyncio.Task[None] | None = None


def _sanitize_container_name(trik_id: str) -> str:
    """Sanitize trik ID for use as a Docker container name."""
    return re.sub(r"[^a-z0-9-]", "-", trik_id, flags=re.IGNORECASE)


class ContainerWorkerHandle:
    """
    A worker handle that wraps a Docker container.
    Implements the same interface as NodeWorker for gateway compatibility.

    Mirrors ContainerWorkerHandle from container-manager.ts.
    """

    def __init__(
        self,
        trik_id: str,
        options: ContainerOptions,
        config: ContainerManagerConfig,
    ) -> None:
        self._trik_id = trik_id
        self._options = options
        self._config = config
        self._container_name = f"trikhub-{_sanitize_container_name(trik_id)}"

        self._process: asyncio.subprocess.Process | None = None
        self._pending: dict[str, _PendingRequest] = {}
        self._is_ready = False
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
        """Start the container and wait for the worker to be ready."""
        if self._process is not None:
            raise RuntimeError(f"Container already started for trik {self._trik_id}")

        # Remove any stale container with the same name (e.g. from a previous crash)
        try:
            subprocess.run(
                ["docker", "rm", "-f", self._container_name],
                capture_output=True,
                timeout=5,
            )
        except Exception:
            pass  # No stale container — expected

        # Ensure workspace directory exists on host
        os.makedirs(self._options.workspace_path, exist_ok=True)

        image = WORKER_IMAGES[self._options.runtime]

        # Build docker run arguments
        args = ["run", "-i", "--rm"]

        # Container name
        args.extend(["--name", self._container_name])

        # Volume mounts
        args.extend(["-v", f"{self._options.workspace_path}:/workspace"])
        args.extend(["-v", f"{self._options.trik_path}:/trik:ro"])

        # Resource limits
        args.append(f"--memory={self._options.memory_limit_mb}m")

        if self._options.cpu_limit is not None:
            args.append(f"--cpus={self._options.cpu_limit}")

        # Network
        if not self._options.network_enabled:
            args.append("--network=none")

        # Labels for container identification
        args.extend(["--label", f"trikhub.trik-id={self._trik_id}"])
        args.extend(["--label", "trikhub.managed=true"])

        # Image
        args.append(image)

        if self._config.debug:
            print(f"[ContainerManager] docker {' '.join(args)}")

        try:
            self._process = await asyncio.create_subprocess_exec(
                "docker",
                *args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError:
            raise RuntimeError(
                "Docker is not installed or not in PATH. "
                "Install Docker to use containerized triks."
            )

        self._stderr_buffer = []
        self._read_task = asyncio.create_task(self._read_loop())
        asyncio.create_task(self._read_stderr())

        # Send health check to verify worker inside container is ready
        try:
            health = await asyncio.wait_for(
                self._check_health_internal(),
                timeout=self._config.startup_timeout_ms / 1000,
            )
            if health.status != "ok":
                raise RuntimeError(
                    f"Container health check failed for trik {self._trik_id}"
                )
            self._is_ready = True
            self._emit("ready", health)
        except asyncio.TimeoutError:
            stderr_output = "\n".join(self._stderr_buffer) if self._stderr_buffer else ""
            self.kill()
            msg = (
                f"Container startup timed out after "
                f"{self._config.startup_timeout_ms}ms for trik {self._trik_id}"
            )
            if stderr_output:
                msg += f"\nStderr: {stderr_output}"
            raise RuntimeError(msg)

    async def health(self) -> HealthResult:
        """Check worker health inside the container."""
        if not self._process:
            raise RuntimeError(f"Container not running for trik {self._trik_id}")
        return await self._check_health_internal()

    async def shutdown(self, grace_period_ms: int = 5000) -> None:
        """Gracefully shutdown the container."""
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
        """Force kill the container."""
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

        # Reject all pending requests
        for rid, pending in list(self._pending.items()):
            if pending.timeout_task:
                pending.timeout_task.cancel()
            if not pending.future.done():
                pending.future.set_exception(RuntimeError("Container killed"))
            del self._pending[rid]

        # Also stop the docker container by name (in case the process detached)
        try:
            subprocess.run(
                ["docker", "rm", "-f", self._container_name],
                capture_output=True,
                timeout=5,
            )
        except Exception:
            pass

        self._stderr_buffer.clear()

    def set_storage_context(self, ctx: TrikStorageContext | None) -> None:
        """Set the storage context for subsequent calls."""
        self._storage_context = ctx

    # -- Public API -----------------------------------------------------------

    async def process_message(
        self,
        *,
        trik_path: str,
        message: str,
        session_id: str,
        config: dict[str, str],
        storage_namespace: str,
    ) -> ProcessMessageResult:
        """Send a processMessage request to the worker inside the container."""
        if not self._process:
            raise RuntimeError(f"Container not running for trik {self._trik_id}")

        # Override trikPath to the container-internal path
        req = create_request("processMessage", {
            "trikPath": "/trik",
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
            raise RuntimeError(
                f"processMessage failed in container: {resp.error.message}"
            )

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
        """Send an executeTool request to the worker inside the container."""
        if not self._process:
            raise RuntimeError(f"Container not running for trik {self._trik_id}")

        # Override trikPath to the container-internal path
        req = create_request("executeTool", {
            "trikPath": "/trik",
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
            raise RuntimeError(
                f"executeTool failed in container: {resp.error.message}"
            )

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
                print(f"[Container:{self._trik_id}] Read error: {e}")

    async def _read_stderr(self) -> None:
        if not self._process or not self._process.stderr:
            return
        try:
            while True:
                line = await self._process.stderr.readline()
                if not line:
                    break
                msg = line.decode("utf-8").strip()
                if msg:
                    self._stderr_buffer.append(msg)
                    if self._config.debug:
                        print(f"[Container:{self._trik_id}:stderr] {msg}")
                    self._emit("stderr", msg)
        except (asyncio.CancelledError, Exception):
            pass

    async def _handle_line(self, line: str) -> None:
        if self._config.debug:
            print(f"[Container:{self._trik_id}:recv] {line}")

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
            raise RuntimeError("Container stdin not available")

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
                print(f"[Container:{self._trik_id}:send] {line.strip()}")
            self._process.stdin.write(line.encode("utf-8"))
            await self._process.stdin.drain()

    async def _write_response(self, response: JsonRpcResponse) -> None:
        async with self._write_lock:
            if not self._process or not self._process.stdin:
                return
            line = json.dumps(response.to_dict()) + "\n"
            if self._config.debug:
                print(f"[Container:{self._trik_id}:send] {line.strip()}")
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


# ============================================================================
# DockerContainerManager
# ============================================================================


class DockerContainerManager:
    """
    Manages Docker container lifecycle for containerized triks.

    Each containerized trik gets its own container, launched on first interaction
    and stopped when the handoff ends or the session expires.

    Mirrors DockerContainerManager from container-manager.ts.
    """

    def __init__(self, config: ContainerManagerConfig | None = None) -> None:
        cfg = config or ContainerManagerConfig()
        default_base = os.path.join(os.path.expanduser("~"), ".trikhub", "workspace")
        self._config = ContainerManagerConfig(
            workspace_base_dir=cfg.workspace_base_dir or default_base,
            startup_timeout_ms=cfg.startup_timeout_ms,
            invoke_timeout_ms=cfg.invoke_timeout_ms,
            debug=cfg.debug,
        )
        self._containers: dict[str, ContainerWorkerHandle] = {}

        # Register process exit handler to force-kill all containers.
        # This ensures containers don't leak when the process is killed or
        # exits without calling shutdown().
        atexit.register(self._kill_all)

    async def launch(
        self, trik_id: str, options: ContainerOptions
    ) -> ContainerWorkerHandle:
        """
        Launch a container for a trik and return a WorkerHandle.

        If a container is already running for this trik, returns the existing handle.
        """
        existing = self._containers.get(trik_id)
        if existing and existing.ready:
            return existing

        # Check Docker is available
        await self._ensure_docker_available()

        # Check/pull image if not present
        image = WORKER_IMAGES[options.runtime]
        await self._ensure_image_available(image)

        # Create workspace directory on host
        workspace_path = options.workspace_path or os.path.join(
            self._config.workspace_base_dir or "", trik_id
        )
        os.makedirs(workspace_path, exist_ok=True)

        # Create and start container
        handle = ContainerWorkerHandle(
            trik_id,
            ContainerOptions(
                runtime=options.runtime,
                workspace_path=workspace_path,
                trik_path=options.trik_path,
                network_enabled=options.network_enabled,
                memory_limit_mb=options.memory_limit_mb,
                cpu_limit=options.cpu_limit,
            ),
            self._config,
        )

        self._containers[trik_id] = handle

        try:
            await handle.start()
            return handle
        except Exception:
            self._containers.pop(trik_id, None)
            raise

    async def stop(self, trik_id: str) -> None:
        """Stop and remove a container for a trik."""
        handle = self._containers.pop(trik_id, None)
        if handle:
            await handle.shutdown()

    def is_running(self, trik_id: str) -> bool:
        """Check if a container is running for a trik."""
        handle = self._containers.get(trik_id)
        return handle.ready if handle else False

    async def stop_all(self) -> None:
        """Stop all managed containers gracefully."""
        atexit.unregister(self._kill_all)
        tasks = [self.stop(trik_id) for trik_id in list(self._containers.keys())]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._containers.clear()

    def _kill_all(self) -> None:
        """Synchronously force-kill all containers. Used as process exit handler."""
        for handle in self._containers.values():
            handle.kill()
        self._containers.clear()

    def get_workspace_path(self, trik_id: str) -> str:
        """Get the workspace path for a trik."""
        return os.path.join(self._config.workspace_base_dir or "", trik_id)

    async def _ensure_docker_available(self) -> None:
        """Check that Docker is installed and the daemon is running."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "docker", "info",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await asyncio.wait_for(proc.wait(), timeout=5)
        except (FileNotFoundError, asyncio.TimeoutError, Exception):
            raise RuntimeError(
                "Docker is not available. Please install Docker and ensure "
                "the Docker daemon is running to use triks with "
                "filesystem/shell capabilities."
            )

    async def _ensure_image_available(self, image: str) -> None:
        """Check if a Docker image is available locally, pull it if not."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "docker", "image", "inspect", image,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            code = await asyncio.wait_for(proc.wait(), timeout=5)
            if code == 0:
                return
        except (FileNotFoundError, asyncio.TimeoutError, Exception):
            pass

        # Image not found locally, try to pull
        if self._config.debug:
            print(f"[ContainerManager] Pulling image {image}...")
        try:
            proc = await asyncio.create_subprocess_exec(
                "docker", "pull", image,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            code = await asyncio.wait_for(proc.wait(), timeout=300)  # 5 min
            if code != 0:
                raise RuntimeError("Pull failed")
        except Exception:
            raise RuntimeError(
                f"Docker image {image} not found. "
                f"Build it locally with: ./docker/build-images.sh"
            )
