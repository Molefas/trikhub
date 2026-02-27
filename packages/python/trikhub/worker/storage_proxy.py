"""
Storage proxy that forwards storage calls to the gateway via stdout.

When a trik calls ``await context.storage.get("key")``, the proxy creates
a JSON-RPC request, writes it to stdout, and waits for the gateway to
respond on stdin. The main loop routes incoming responses back here.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any, Callable


class StorageProxy:
    """Implements the TrikStorageContext protocol by proxying to the gateway."""

    def __init__(self, write_line: Callable[[str], None]) -> None:
        self._write_line = write_line
        self._pending: dict[str, asyncio.Future[Any]] = {}

    # -- TrikStorageContext interface ------------------------------------------

    async def get(self, key: str) -> Any | None:
        result = await self._send("storage.get", {"key": key})
        return result.get("value") if isinstance(result, dict) else None

    async def set(self, key: str, value: Any, ttl: int | None = None) -> None:
        params: dict[str, Any] = {"key": key, "value": value}
        if ttl is not None:
            params["ttl"] = ttl
        await self._send("storage.set", params)

    async def delete(self, key: str) -> bool:
        result = await self._send("storage.delete", {"key": key})
        return result.get("deleted", False) if isinstance(result, dict) else False

    async def list(self, prefix: str | None = None) -> list[str]:
        params: dict[str, Any] = {}
        if prefix is not None:
            params["prefix"] = prefix
        result = await self._send("storage.list", params)
        return result.get("keys", []) if isinstance(result, dict) else []

    async def get_many(self, keys: list[str]) -> dict[str, Any]:
        result = await self._send("storage.getMany", {"keys": keys})
        return result.get("values", {}) if isinstance(result, dict) else {}

    async def set_many(self, entries: dict[str, Any]) -> None:
        await self._send("storage.setMany", {"entries": entries})

    # -- Response routing (called by main loop) -------------------------------

    def handle_response(self, msg_id: str, result: Any = None, error: Any = None) -> bool:
        """Route an incoming response to the waiting future. Returns True if handled."""
        future = self._pending.pop(msg_id, None)
        if future is None:
            return False
        if error is not None:
            err_msg = error.get("message", "Storage error") if isinstance(error, dict) else str(error)
            future.set_exception(RuntimeError(f"Storage error: {err_msg}"))
        else:
            future.set_result(result)
        return True

    # -- Internal -------------------------------------------------------------

    async def _send(self, method: str, params: dict[str, Any]) -> Any:
        import json

        request_id = str(uuid.uuid4())
        msg = json.dumps({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params,
        })

        loop = asyncio.get_running_loop()
        future: asyncio.Future[Any] = loop.create_future()
        self._pending[request_id] = future

        self._write_line(msg)
        return await future
