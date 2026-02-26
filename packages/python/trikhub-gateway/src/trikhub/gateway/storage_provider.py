"""
Storage provider for persistent trik data.

Mirrors packages/js/gateway/src/storage-provider.ts.
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from trikhub.manifest import StorageCapabilities, TrikStorageContext


# ============================================================================
# Default Configuration
# ============================================================================

DEFAULT_MAX_SIZE_BYTES = 100 * 1024 * 1024  # 100MB


# ============================================================================
# Protocol
# ============================================================================


class StorageProvider(Protocol):
    """Interface for storage provider implementations."""

    def for_trik(
        self, trik_id: str, capabilities: StorageCapabilities | None = None
    ) -> TrikStorageContext: ...

    async def get_usage(self, trik_id: str) -> int: ...
    async def clear(self, trik_id: str) -> None: ...
    async def list_triks(self) -> list[str]: ...


# ============================================================================
# In-Memory Implementation
# ============================================================================


@dataclass
class _StorageEntry:
    value: Any
    created_at: float
    expires_at: float | None = None


class _InMemoryStorageContext:
    """In-memory storage context implementing TrikStorageContext."""

    def __init__(self, store: dict[str, _StorageEntry]) -> None:
        self._store = store

    async def get(self, key: str) -> Any | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        if entry.expires_at is not None and entry.expires_at < time.time() * 1000:
            del self._store[key]
            return None
        return entry.value

    async def set(self, key: str, value: Any, ttl: int | None = None) -> None:
        now = time.time() * 1000
        expires_at = now + ttl if ttl is not None and ttl > 0 else None
        self._store[key] = _StorageEntry(
            value=value, created_at=now, expires_at=expires_at
        )

    async def delete(self, key: str) -> bool:
        if key in self._store:
            del self._store[key]
            return True
        return False

    async def list(self, prefix: str | None = None) -> list[str]:
        keys = list(self._store.keys())
        if prefix:
            keys = [k for k in keys if k.startswith(prefix)]
        return keys

    async def get_many(self, keys: list[str]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key in keys:
            value = await self.get(key)
            if value is not None:
                result[key] = value
        return result

    async def set_many(self, entries: dict[str, Any]) -> None:
        for key, value in entries.items():
            await self.set(key, value)


class InMemoryStorageProvider:
    """In-memory storage provider for development and testing."""

    def __init__(self) -> None:
        self._storage: dict[str, dict[str, _StorageEntry]] = {}
        self._contexts: dict[str, _InMemoryStorageContext] = {}

    def for_trik(
        self, trik_id: str, capabilities: StorageCapabilities | None = None
    ) -> TrikStorageContext:
        if trik_id not in self._storage:
            self._storage[trik_id] = {}
        if trik_id not in self._contexts:
            self._contexts[trik_id] = _InMemoryStorageContext(self._storage[trik_id])
        return self._contexts[trik_id]

    async def get_usage(self, trik_id: str) -> int:
        store = self._storage.get(trik_id, {})
        import json

        total = 0
        for entry in store.values():
            total += len(json.dumps(entry.value).encode("utf-8"))
        return total

    async def clear(self, trik_id: str) -> None:
        self._storage.pop(trik_id, None)
        self._contexts.pop(trik_id, None)

    async def list_triks(self) -> list[str]:
        return list(self._storage.keys())

    def clear_all(self) -> None:
        self._storage.clear()
        self._contexts.clear()


# ============================================================================
# SQLite Storage Provider
# ============================================================================


class _SqliteStorageContext:
    """SQLite-based storage context for a single trik."""

    def __init__(
        self, conn: sqlite3.Connection, trik_id: str, max_size_bytes: int
    ) -> None:
        self._conn = conn
        self._trik_id = trik_id
        self._max_size_bytes = max_size_bytes

    def _current_time_ms(self) -> int:
        return int(time.time() * 1000)

    async def get(self, key: str) -> Any | None:
        cursor = self._conn.cursor()
        cursor.execute(
            "DELETE FROM storage WHERE trik_id = ? AND expires_at IS NOT NULL AND expires_at < ?",
            (self._trik_id, self._current_time_ms()),
        )
        self._conn.commit()

        cursor.execute(
            "SELECT value, expires_at FROM storage WHERE trik_id = ? AND key = ?",
            (self._trik_id, key),
        )
        row = cursor.fetchone()

        if row is None:
            return None

        value, expires_at = row
        if expires_at is not None and expires_at < self._current_time_ms():
            cursor.execute(
                "DELETE FROM storage WHERE trik_id = ? AND key = ?",
                (self._trik_id, key),
            )
            self._conn.commit()
            return None

        return json.loads(value)

    async def set(self, key: str, value: Any, ttl: int | None = None) -> None:
        value_json = json.dumps(value)
        value_size = len(value_json.encode("utf-8"))

        cursor = self._conn.cursor()

        # Get current key size for updates
        cursor.execute(
            "SELECT value FROM storage WHERE trik_id = ? AND key = ?",
            (self._trik_id, key),
        )
        row = cursor.fetchone()
        current_key_size = len(row[0].encode("utf-8")) if row else 0

        # Get current usage excluding this key
        cursor.execute(
            "SELECT COALESCE(SUM(LENGTH(value)), 0) FROM storage WHERE trik_id = ?",
            (self._trik_id,),
        )
        usage = cursor.fetchone()[0] - current_key_size

        if usage + value_size > self._max_size_bytes:
            raise ValueError(
                f"Storage quota exceeded. Current: {usage} bytes, "
                f"Adding: {value_size} bytes, Max: {self._max_size_bytes} bytes"
            )

        now = self._current_time_ms()
        expires_at = now + ttl if ttl is not None and ttl > 0 else None

        cursor.execute(
            "INSERT OR REPLACE INTO storage (trik_id, key, value, created_at, expires_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (self._trik_id, key, value_json, now, expires_at),
        )
        self._conn.commit()

    async def delete(self, key: str) -> bool:
        cursor = self._conn.cursor()
        cursor.execute(
            "DELETE FROM storage WHERE trik_id = ? AND key = ?",
            (self._trik_id, key),
        )
        self._conn.commit()
        return cursor.rowcount > 0

    async def list(self, prefix: str | None = None) -> list[str]:
        cursor = self._conn.cursor()
        cursor.execute(
            "DELETE FROM storage WHERE trik_id = ? AND expires_at IS NOT NULL AND expires_at < ?",
            (self._trik_id, self._current_time_ms()),
        )
        self._conn.commit()

        if prefix:
            escaped_prefix = prefix.replace("%", "\\%").replace("_", "\\_") + "%"
            cursor.execute(
                "SELECT key FROM storage WHERE trik_id = ? AND key LIKE ? ESCAPE '\\'",
                (self._trik_id, escaped_prefix),
            )
        else:
            cursor.execute(
                "SELECT key FROM storage WHERE trik_id = ?",
                (self._trik_id,),
            )

        return [row[0] for row in cursor.fetchall()]

    async def get_many(self, keys: list[str]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key in keys:
            value = await self.get(key)
            if value is not None:
                result[key] = value
        return result

    async def set_many(self, entries: dict[str, Any]) -> None:
        for key, value in entries.items():
            await self.set(key, value)


class SqliteStorageProvider:
    """
    SQLite-based storage provider.
    Stores all trik data in a single database at ~/.trikhub/storage/storage.db
    """

    def __init__(self, base_dir: str | None = None) -> None:
        storage_dir = base_dir or str(Path.home() / ".trikhub" / "storage")
        os.makedirs(storage_dir, exist_ok=True)

        self._db_path = os.path.join(storage_dir, "storage.db")
        self._conn = sqlite3.connect(self._db_path, check_same_thread=False)
        self._contexts: dict[str, _SqliteStorageContext] = {}

        # Configure for concurrency and durability
        self._conn.execute("PRAGMA journal_mode = WAL")
        self._conn.execute("PRAGMA busy_timeout = 5000")

        # Initialize schema
        self._conn.executescript("""
            CREATE TABLE IF NOT EXISTS storage (
                trik_id TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER,
                PRIMARY KEY (trik_id, key)
            );

            CREATE INDEX IF NOT EXISTS idx_storage_trik ON storage(trik_id);
            CREATE INDEX IF NOT EXISTS idx_storage_expires ON storage(expires_at)
                WHERE expires_at IS NOT NULL;
        """)
        self._conn.commit()

    def for_trik(
        self, trik_id: str, capabilities: StorageCapabilities | None = None
    ) -> TrikStorageContext:
        if trik_id in self._contexts:
            return self._contexts[trik_id]

        max_size = (
            capabilities.maxSizeBytes
            if capabilities and capabilities.maxSizeBytes
            else DEFAULT_MAX_SIZE_BYTES
        )

        context = _SqliteStorageContext(self._conn, trik_id, max_size)
        self._contexts[trik_id] = context
        return context

    async def get_usage(self, trik_id: str) -> int:
        context = self._contexts.get(trik_id)
        if context:
            cursor = self._conn.cursor()
            cursor.execute(
                "SELECT COALESCE(SUM(LENGTH(value)), 0) FROM storage WHERE trik_id = ?",
                (trik_id,),
            )
            return cursor.fetchone()[0]

        cursor = self._conn.cursor()
        cursor.execute(
            "SELECT COALESCE(SUM(LENGTH(value)), 0) FROM storage WHERE trik_id = ?",
            (trik_id,),
        )
        return cursor.fetchone()[0]

    async def clear(self, trik_id: str) -> None:
        cursor = self._conn.cursor()
        cursor.execute(
            "DELETE FROM storage WHERE trik_id = ?",
            (trik_id,),
        )
        self._conn.commit()
        self._contexts.pop(trik_id, None)

    async def list_triks(self) -> list[str]:
        cursor = self._conn.cursor()
        cursor.execute("SELECT DISTINCT trik_id FROM storage")
        return [row[0] for row in cursor.fetchall()]

    def get_db_path(self) -> str:
        return self._db_path

    def close(self) -> None:
        self._contexts.clear()
        self._conn.close()
