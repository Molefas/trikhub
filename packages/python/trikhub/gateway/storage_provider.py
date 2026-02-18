"""
Storage Provider for TrikHub Gateway

Provides persistent key-value storage for triks using SQLite.
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any


from trikhub.manifest import StorageCapabilities


# ============================================================================
# Default Configuration
# ============================================================================

DEFAULT_MAX_SIZE_BYTES = 100 * 1024 * 1024  # 100MB


# ============================================================================
# Storage Context Interface
# ============================================================================


class TrikStorageContext(ABC):
    """
    Storage context passed to triks in graph input.
    Provides persistent key-value storage scoped to the trik.
    """

    @abstractmethod
    async def get(self, key: str) -> Any | None:
        """
        Get a value by key.
        Returns None if the key doesn't exist.
        """
        ...

    @abstractmethod
    async def set(self, key: str, value: Any, ttl: int | None = None) -> None:
        """
        Set a value by key.

        Args:
            key: The key to store
            value: The value to store (must be JSON-serializable)
            ttl: Optional time-to-live in milliseconds
        """
        ...

    @abstractmethod
    async def delete(self, key: str) -> bool:
        """
        Delete a key.
        Returns True if the key existed and was deleted.
        """
        ...

    @abstractmethod
    async def list(self, prefix: str | None = None) -> list[str]:
        """List all keys, optionally filtered by prefix."""
        ...

    @abstractmethod
    async def get_many(self, keys: list[str]) -> dict[str, Any]:
        """Get multiple values at once."""
        ...

    @abstractmethod
    async def set_many(self, entries: dict[str, Any]) -> None:
        """Set multiple values at once."""
        ...


# ============================================================================
# Storage Provider Interface
# ============================================================================


class StorageProvider(ABC):
    """Interface for storage provider implementations."""

    @abstractmethod
    def for_trik(
        self, trik_id: str, capabilities: StorageCapabilities | None = None
    ) -> TrikStorageContext:
        """
        Get a storage context for a specific trik.
        The context is scoped to that trik's namespace.
        """
        ...

    @abstractmethod
    async def get_usage(self, trik_id: str) -> int:
        """Get the current storage usage for a trik in bytes."""
        ...

    @abstractmethod
    async def clear(self, trik_id: str) -> None:
        """Clear all storage for a trik."""
        ...

    @abstractmethod
    async def list_triks(self) -> list[str]:
        """List all triks with stored data."""
        ...


# ============================================================================
# Storage Entry
# ============================================================================


@dataclass
class StorageEntry:
    """Storage entry with metadata."""

    value: Any
    created_at: int
    expires_at: int | None = None


# ============================================================================
# SQLite Storage Provider
# ============================================================================


class SqliteStorageContext(TrikStorageContext):
    """SQLite-based storage context for a single trik."""

    def __init__(
        self, conn: sqlite3.Connection, trik_id: str, max_size_bytes: int
    ) -> None:
        self._conn = conn
        self._trik_id = trik_id
        self._max_size_bytes = max_size_bytes

    def _current_time_ms(self) -> int:
        """Get current time in milliseconds."""
        return int(time.time() * 1000)

    async def get(self, key: str) -> Any | None:
        """Get a value by key."""
        # Clean up expired entries for this trik
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

        # Double-check expiration
        if expires_at is not None and expires_at < self._current_time_ms():
            cursor.execute(
                "DELETE FROM storage WHERE trik_id = ? AND key = ?",
                (self._trik_id, key),
            )
            self._conn.commit()
            return None

        return json.loads(value)

    async def set(self, key: str, value: Any, ttl: int | None = None) -> None:
        """Set a value by key."""
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
        """Delete a key."""
        cursor = self._conn.cursor()
        cursor.execute(
            "DELETE FROM storage WHERE trik_id = ? AND key = ?",
            (self._trik_id, key),
        )
        self._conn.commit()
        return cursor.rowcount > 0

    async def list(self, prefix: str | None = None) -> list[str]:
        """List all keys, optionally filtered by prefix."""
        # Clean up expired entries first
        cursor = self._conn.cursor()
        cursor.execute(
            "DELETE FROM storage WHERE trik_id = ? AND expires_at IS NOT NULL AND expires_at < ?",
            (self._trik_id, self._current_time_ms()),
        )
        self._conn.commit()

        if prefix:
            # Escape special LIKE characters and add wildcard
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
        """Get multiple values at once."""
        result: dict[str, Any] = {}
        for key in keys:
            value = await self.get(key)
            if value is not None:
                result[key] = value
        return result

    async def set_many(self, entries: dict[str, Any]) -> None:
        """Set multiple values at once."""
        for key, value in entries.items():
            await self.set(key, value)

    async def get_usage(self) -> int:
        """Get current storage usage in bytes."""
        cursor = self._conn.cursor()
        cursor.execute(
            "SELECT COALESCE(SUM(LENGTH(value)), 0) FROM storage WHERE trik_id = ?",
            (self._trik_id,),
        )
        return cursor.fetchone()[0]

    async def clear(self) -> None:
        """Clear all data for this trik."""
        cursor = self._conn.cursor()
        cursor.execute(
            "DELETE FROM storage WHERE trik_id = ?",
            (self._trik_id,),
        )
        self._conn.commit()


class SqliteStorageProvider(StorageProvider):
    """
    SQLite-based storage provider.
    Stores all trik data in a single database at ~/.trikhub/storage/storage.db
    """

    def __init__(self, base_dir: str | None = None) -> None:
        storage_dir = base_dir or str(Path.home() / ".trikhub" / "storage")

        # Ensure directory exists
        os.makedirs(storage_dir, exist_ok=True)

        self._db_path = os.path.join(storage_dir, "storage.db")
        self._conn = sqlite3.connect(self._db_path, check_same_thread=False)
        self._contexts: dict[str, SqliteStorageContext] = {}

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
        """Get a storage context for a specific trik."""
        # Return cached context if available
        if trik_id in self._contexts:
            return self._contexts[trik_id]

        max_size = (
            capabilities.maxSizeBytes
            if capabilities and capabilities.maxSizeBytes
            else DEFAULT_MAX_SIZE_BYTES
        )

        context = SqliteStorageContext(self._conn, trik_id, max_size)
        self._contexts[trik_id] = context

        return context

    async def get_usage(self, trik_id: str) -> int:
        """Get the current storage usage for a trik in bytes."""
        context = self._contexts.get(trik_id)
        if context:
            return await context.get_usage()

        # Query directly if no cached context
        cursor = self._conn.cursor()
        cursor.execute(
            "SELECT COALESCE(SUM(LENGTH(value)), 0) FROM storage WHERE trik_id = ?",
            (trik_id,),
        )
        return cursor.fetchone()[0]

    async def clear(self, trik_id: str) -> None:
        """Clear all storage for a trik."""
        context = self._contexts.get(trik_id)
        if context:
            await context.clear()
            return

        # Delete directly if no cached context
        cursor = self._conn.cursor()
        cursor.execute(
            "DELETE FROM storage WHERE trik_id = ?",
            (trik_id,),
        )
        self._conn.commit()

    async def list_triks(self) -> list[str]:
        """List all triks with stored data."""
        cursor = self._conn.cursor()
        cursor.execute("SELECT DISTINCT trik_id FROM storage")
        return [row[0] for row in cursor.fetchall()]

    def get_db_path(self) -> str:
        """Get the database file path (for debugging)."""
        return self._db_path

    def close(self) -> None:
        """Close the database connection. Call this for graceful shutdown."""
        self._contexts.clear()
        self._conn.close()


# ============================================================================
# In-Memory Storage Provider
# ============================================================================


class InMemoryStorageContext(TrikStorageContext):
    """In-memory storage context implementation."""

    def __init__(self) -> None:
        self._storage: dict[str, StorageEntry] = {}

    def _current_time_ms(self) -> int:
        return int(time.time() * 1000)

    async def get(self, key: str) -> Any | None:
        entry = self._storage.get(key)
        if entry is None:
            return None
        if entry.expires_at is not None and entry.expires_at < self._current_time_ms():
            del self._storage[key]
            return None
        return entry.value

    async def set(self, key: str, value: Any, ttl: int | None = None) -> None:
        entry = StorageEntry(
            value=value,
            created_at=self._current_time_ms(),
            expires_at=self._current_time_ms() + ttl if ttl is not None and ttl > 0 else None,
        )
        self._storage[key] = entry

    async def delete(self, key: str) -> bool:
        if key in self._storage:
            del self._storage[key]
            return True
        return False

    async def list(self, prefix: str | None = None) -> list[str]:
        keys = list(self._storage.keys())
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


class InMemoryStorageProvider(StorageProvider):
    """In-memory storage provider for testing."""

    def __init__(self) -> None:
        self._storage: dict[str, InMemoryStorageContext] = {}

    def for_trik(
        self, trik_id: str, capabilities: StorageCapabilities | None = None
    ) -> TrikStorageContext:
        if trik_id not in self._storage:
            self._storage[trik_id] = InMemoryStorageContext()
        return self._storage[trik_id]

    async def get_usage(self, trik_id: str) -> int:
        context = self._storage.get(trik_id)
        if not context:
            return 0

        size = 0
        for entry in context._storage.values():
            size += len(json.dumps(entry.value).encode("utf-8"))
        return size

    async def clear(self, trik_id: str) -> None:
        if trik_id in self._storage:
            del self._storage[trik_id]

    async def list_triks(self) -> list[str]:
        return list(self._storage.keys())

    def clear_all(self) -> None:
        """Clear all storage."""
        self._storage.clear()
