#!/usr/bin/env python3
"""
Python Worker for TrikHub

This module implements the worker process that executes Python triks.
It communicates with the gateway via stdin/stdout using JSON-RPC 2.0.

Usage:
    python -m trikhub.worker
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

from trikhub.gateway.worker_protocol import (
    JsonRpcRequest,
    JsonRpcResponse,
    WorkerErrorCodes,
    WorkerProtocol,
    InvokeParams,
    InvokeResult,
)


class StorageProxy:
    """
    Proxy for storage operations.

    Storage calls are forwarded to the gateway via stdout,
    and responses are received via stdin.
    """

    def __init__(self, send_request: Any, receive_response: Any):
        self._send_request = send_request
        self._receive_response = receive_response
        self._pending_requests: dict[str, asyncio.Future[Any]] = {}

    async def get(self, key: str) -> Any | None:
        """Get a value from storage."""
        request = WorkerProtocol.create_storage_request("storage.get", {"key": key})
        response = await self._send_and_wait(request)
        return response.get("value") if response else None

    async def set(self, key: str, value: Any, ttl: int | None = None) -> None:
        """Set a value in storage."""
        params: dict[str, Any] = {"key": key, "value": value}
        if ttl is not None:
            params["ttl"] = ttl
        request = WorkerProtocol.create_storage_request("storage.set", params)
        await self._send_and_wait(request)

    async def delete(self, key: str) -> bool:
        """Delete a value from storage."""
        request = WorkerProtocol.create_storage_request("storage.delete", {"key": key})
        response = await self._send_and_wait(request)
        return response.get("deleted", False) if response else False

    async def list(self, prefix: str | None = None) -> list[str]:
        """List keys in storage."""
        params: dict[str, Any] = {}
        if prefix is not None:
            params["prefix"] = prefix
        request = WorkerProtocol.create_storage_request("storage.list", params)
        response = await self._send_and_wait(request)
        return response.get("keys", []) if response else []

    async def get_many(self, keys: list[str]) -> dict[str, Any]:
        """Get multiple values from storage."""
        request = WorkerProtocol.create_storage_request("storage.getMany", {"keys": keys})
        response = await self._send_and_wait(request)
        return response.get("values", {}) if response else {}

    async def set_many(self, entries: dict[str, Any]) -> None:
        """Set multiple values in storage."""
        request = WorkerProtocol.create_storage_request(
            "storage.setMany", {"entries": entries}
        )
        await self._send_and_wait(request)

    async def _send_and_wait(self, request: JsonRpcRequest) -> Any:
        """Send a request and wait for the response."""
        future: asyncio.Future[Any] = asyncio.Future()
        self._pending_requests[request.id] = future
        await self._send_request(request)
        return await future

    def handle_response(self, response: JsonRpcResponse) -> bool:
        """Handle a response from the gateway. Returns True if handled."""
        if response.id in self._pending_requests:
            future = self._pending_requests.pop(response.id)
            if response.is_error:
                future.set_exception(
                    RuntimeError(f"Storage error: {response.error}")
                )
            else:
                future.set_result(response.result)
            return True
        return False


class TrikLoader:
    """Loads and caches Python trik modules."""

    def __init__(self):
        self._cache: dict[str, Any] = {}

    def load(self, trik_path: str, export_name: str = "graph") -> Any:
        """
        Load a Python trik module.

        Args:
            trik_path: Path to the trik directory
            export_name: Name of the export to use (default: "graph")

        Returns:
            The trik's graph object with an invoke() method
        """
        cache_key = f"{trik_path}:{export_name}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        # Find the module file
        trik_dir = Path(trik_path)
        manifest_path = trik_dir / "manifest.json"

        if not manifest_path.exists():
            raise FileNotFoundError(f"Manifest not found at {manifest_path}")

        with open(manifest_path) as f:
            manifest = json.load(f)

        entry = manifest.get("entry", {})
        module_path = entry.get("module", "./graph.py")
        export_name = entry.get("export", "graph")

        # Resolve relative path
        if module_path.startswith("./"):
            module_path = module_path[2:]
        module_file = trik_dir / module_path

        if not module_file.exists():
            raise FileNotFoundError(f"Module not found at {module_file}")

        # Determine if this is a package (trik_dir is a Python package with __init__.py)
        # or just a standalone module
        init_file = trik_dir / "__init__.py"
        is_package = init_file.exists()

        if is_package:
            # For Python packages with relative imports:
            # 1. Add parent directory to sys.path
            # 2. Import the package properly so relative imports work
            parent_dir = str(trik_dir.parent)
            package_name = trik_dir.name

            if parent_dir not in sys.path:
                sys.path.insert(0, parent_dir)

            # Import the package first to set up the package context
            package = importlib.import_module(package_name)

            # Now import the specific module within the package
            module_name_without_ext = module_path.replace(".py", "").replace("/", ".")
            full_module_name = f"{package_name}.{module_name_without_ext}"

            # Reload in case it was cached with wrong context
            if full_module_name in sys.modules:
                module = importlib.reload(sys.modules[full_module_name])
            else:
                module = importlib.import_module(full_module_name)
        else:
            # For standalone modules without relative imports:
            # Use the original approach
            spec = importlib.util.spec_from_file_location("trik_module", module_file)
            if spec is None or spec.loader is None:
                raise ImportError(f"Could not load module from {module_file}")

            module = importlib.util.module_from_spec(spec)
            sys.modules["trik_module"] = module
            spec.loader.exec_module(module)

        # Get the exported graph
        if not hasattr(module, export_name):
            raise AttributeError(f"Module does not export '{export_name}'")

        graph = getattr(module, export_name)
        self._cache[cache_key] = graph
        return graph


class PythonWorker:
    """
    Python worker process for executing triks.

    Communicates with the gateway via stdin/stdout using JSON-RPC 2.0.
    """

    def __init__(self):
        self._trik_loader = TrikLoader()
        self._storage_proxy: StorageProxy | None = None
        self._start_time = time.time()
        self._running = True
        self._write_lock = asyncio.Lock()

    async def run(self) -> None:
        """Main worker loop."""
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

                await self._handle_message(line_str)

            except Exception as e:
                # Log error but keep running
                error_response = WorkerProtocol.create_error_response(
                    "unknown",
                    WorkerErrorCodes.INTERNAL_ERROR,
                    f"Worker error: {e}",
                )
                await self._write_response(error_response)

    async def _handle_message(self, line: str) -> None:
        """Handle an incoming message."""
        try:
            message = WorkerProtocol.parse_message(line)
        except ValueError as e:
            error_response = WorkerProtocol.create_error_response(
                "unknown",
                WorkerErrorCodes.PARSE_ERROR,
                str(e),
            )
            await self._write_response(error_response)
            return

        if WorkerProtocol.is_response(message):
            # This is a response to a storage proxy request
            assert isinstance(message, JsonRpcResponse)
            if self._storage_proxy:
                self._storage_proxy.handle_response(message)
            return

        assert isinstance(message, JsonRpcRequest)
        response = await self._handle_request(message)
        await self._write_response(response)

    async def _handle_request(self, request: JsonRpcRequest) -> JsonRpcResponse:
        """Handle a JSON-RPC request."""
        method = request.method

        if method == "health":
            return self._handle_health(request)
        elif method == "shutdown":
            return self._handle_shutdown(request)
        elif method == "invoke":
            return await self._handle_invoke(request)
        else:
            return WorkerProtocol.create_error_response(
                request.id,
                WorkerErrorCodes.METHOD_NOT_FOUND,
                f"Unknown method: {method}",
            )

    def _handle_health(self, request: JsonRpcRequest) -> JsonRpcResponse:
        """Handle health check."""
        result = {
            "status": "ok",
            "runtime": "python",
            "version": sys.version,
            "uptime": time.time() - self._start_time,
        }
        return WorkerProtocol.create_success_response(request.id, result)

    def _handle_shutdown(self, request: JsonRpcRequest) -> JsonRpcResponse:
        """Handle shutdown request."""
        self._running = False
        return WorkerProtocol.create_success_response(request.id, {"acknowledged": True})

    async def _handle_invoke(self, request: JsonRpcRequest) -> JsonRpcResponse:
        """Handle trik invocation."""
        params = request.params or {}

        trik_path = params.get("trikPath")
        if not trik_path:
            return WorkerProtocol.create_error_response(
                request.id,
                WorkerErrorCodes.INVALID_PARAMS,
                "Missing trikPath parameter",
            )

        action = params.get("action")
        if not action:
            return WorkerProtocol.create_error_response(
                request.id,
                WorkerErrorCodes.INVALID_PARAMS,
                "Missing action parameter",
            )

        try:
            # Load the trik
            graph = self._trik_loader.load(trik_path)

            # Build the input
            trik_input = {
                "action": action,
                "input": params.get("input"),
            }

            if "session" in params:
                trik_input["session"] = params["session"]

            if "config" in params:
                trik_input["config"] = params["config"]

            # Create storage proxy if needed
            if self._storage_proxy:
                trik_input["storage"] = self._storage_proxy

            # Execute the trik
            if asyncio.iscoroutinefunction(graph.invoke):
                result = await graph.invoke(trik_input)
            else:
                result = graph.invoke(trik_input)

            return WorkerProtocol.create_success_response(request.id, result)

        except FileNotFoundError as e:
            return WorkerProtocol.create_error_response(
                request.id,
                WorkerErrorCodes.TRIK_NOT_FOUND,
                str(e),
            )
        except Exception as e:
            return WorkerProtocol.create_error_response(
                request.id,
                WorkerErrorCodes.INTERNAL_ERROR,
                f"Execution error: {e}",
            )

    async def _write_response(self, response: JsonRpcResponse) -> None:
        """Write a response to stdout."""
        async with self._write_lock:
            line = response.to_json() + "\n"
            sys.stdout.write(line)
            sys.stdout.flush()

    async def _send_storage_request(self, request: JsonRpcRequest) -> None:
        """Send a storage request to the gateway."""
        await self._write_response(
            JsonRpcResponse(id=request.id, result=None)  # Placeholder
        )


def run_worker() -> None:
    """Entry point for the worker process."""
    worker = PythonWorker()
    asyncio.run(worker.run())


if __name__ == "__main__":
    run_worker()
