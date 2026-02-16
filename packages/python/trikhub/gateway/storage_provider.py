"""
Storage Provider for TrikHub Gateway

Mirrors packages/trik-gateway/src/storage-provider.ts
Provides persistent key-value storage for triks.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
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


@dataclass
class StorageData:
    """Storage data file structure."""

    entries: dict[str, StorageEntry] = field(default_factory=dict)
    trik_id: str = ""
    created_at: int = 0
    updated_at: int = 0
    total_size: int = 0


# ============================================================================
# JSON File Storage Context
# ============================================================================


class JsonFileStorageContext(TrikStorageContext):
    """JSON file-based storage context for a single trik."""

    def __init__(self, file_path: str, trik_id: str, max_size_bytes: int) -> None:
        self._file_path = file_path
        self._trik_id = trik_id
        self._max_size_bytes = max_size_bytes
        self._data: StorageData | None = None
        self._dirty = False
        self._save_task: asyncio.Task[None] | None = None

    def _current_time_ms(self) -> int:
        """Get current time in milliseconds."""
        return int(time.time() * 1000)

    def _create_empty_data(self) -> StorageData:
        """Create empty storage data."""
        now = self._current_time_ms()
        return StorageData(
            entries={},
            trik_id=self._trik_id,
            created_at=now,
            updated_at=now,
            total_size=0,
        )

    async def _ensure_loaded(self) -> StorageData:
        """Ensure data is loaded from disk."""
        if self._data is not None:
            return self._data

        if os.path.exists(self._file_path):
            try:
                with open(self._file_path) as f:
                    raw_data = json.load(f)

                # Convert raw dict entries to StorageEntry objects
                entries: dict[str, StorageEntry] = {}
                for key, entry_data in raw_data.get("entries", {}).items():
                    entries[key] = StorageEntry(
                        value=entry_data.get("value"),
                        created_at=entry_data.get("created_at", 0),
                        expires_at=entry_data.get("expires_at"),
                    )

                self._data = StorageData(
                    entries=entries,
                    trik_id=raw_data.get("metadata", {}).get("trik_id", self._trik_id),
                    created_at=raw_data.get("metadata", {}).get("created_at", 0),
                    updated_at=raw_data.get("metadata", {}).get("updated_at", 0),
                    total_size=raw_data.get("metadata", {}).get("total_size", 0),
                )
            except Exception:
                # Corrupted file, start fresh
                self._data = self._create_empty_data()
        else:
            self._data = self._create_empty_data()

        # Clean up expired entries on load
        await self._cleanup_expired()

        return self._data

    async def _cleanup_expired(self) -> None:
        """Clean up expired entries."""
        if self._data is None:
            return

        now = self._current_time_ms()
        changed = False

        expired_keys = [
            key
            for key, entry in self._data.entries.items()
            if entry.expires_at is not None and entry.expires_at < now
        ]

        for key in expired_keys:
            del self._data.entries[key]
            changed = True

        if changed:
            self._dirty = True
            await self._schedule_save()

    async def _schedule_save(self) -> None:
        """Schedule a debounced save operation."""
        if self._save_task is not None:
            return  # Already scheduled

        async def delayed_save() -> None:
            await asyncio.sleep(0.1)  # 100ms debounce
            self._save_task = None
            await self._flush()

        self._save_task = asyncio.create_task(delayed_save())

    async def _flush(self) -> None:
        """Flush data to disk."""
        if not self._dirty or self._data is None:
            return

        # Ensure directory exists
        dir_path = os.path.dirname(self._file_path)
        if not os.path.exists(dir_path):
            os.makedirs(dir_path, exist_ok=True)

        # Prepare data for serialization
        entries_dict = {
            key: {
                "value": entry.value,
                "created_at": entry.created_at,
                "expires_at": entry.expires_at,
            }
            for key, entry in self._data.entries.items()
        }

        output = {
            "entries": entries_dict,
            "metadata": {
                "trik_id": self._data.trik_id,
                "created_at": self._data.created_at,
                "updated_at": self._current_time_ms(),
                "total_size": 0,  # Will be updated below
            },
        }

        content = json.dumps(output, indent=2)
        output["metadata"]["total_size"] = len(content.encode("utf-8"))
        self._data.total_size = output["metadata"]["total_size"]
        self._data.updated_at = output["metadata"]["updated_at"]

        with open(self._file_path, "w") as f:
            json.dump(output, f, indent=2)

        self._dirty = False

    async def get(self, key: str) -> Any | None:
        """Get a value by key."""
        data = await self._ensure_loaded()
        entry = data.entries.get(key)

        if entry is None:
            return None

        # Check expiration
        if entry.expires_at is not None and entry.expires_at < self._current_time_ms():
            del data.entries[key]
            self._dirty = True
            await self._schedule_save()
            return None

        return entry.value

    async def set(self, key: str, value: Any, ttl: int | None = None) -> None:
        """Set a value by key."""
        data = await self._ensure_loaded()

        # Check size limit before adding
        value_size = len(json.dumps(value).encode("utf-8"))
        current_size = data.total_size

        if current_size + value_size > self._max_size_bytes:
            raise ValueError(
                f"Storage quota exceeded. Current: {current_size} bytes, "
                f"Adding: {value_size} bytes, Max: {self._max_size_bytes} bytes"
            )

        entry = StorageEntry(
            value=value,
            created_at=self._current_time_ms(),
            expires_at=self._current_time_ms() + ttl if ttl is not None and ttl > 0 else None,
        )

        data.entries[key] = entry
        self._dirty = True
        await self._schedule_save()

    async def delete(self, key: str) -> bool:
        """Delete a key."""
        data = await self._ensure_loaded()

        if key not in data.entries:
            return False

        del data.entries[key]
        self._dirty = True
        await self._schedule_save()
        return True

    async def list(self, prefix: str | None = None) -> list[str]:
        """List all keys, optionally filtered by prefix."""
        data = await self._ensure_loaded()
        keys = list(data.entries.keys())

        if prefix:
            keys = [k for k in keys if k.startswith(prefix)]

        return keys

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

    async def force_save(self) -> None:
        """Force save any pending changes."""
        if self._save_task is not None:
            self._save_task.cancel()
            self._save_task = None
        await self._flush()

    async def get_usage(self) -> int:
        """Get current storage usage in bytes."""
        data = await self._ensure_loaded()
        return data.total_size

    async def clear(self) -> None:
        """Clear all data."""
        self._data = self._create_empty_data()
        self._dirty = True
        await self._flush()


# ============================================================================
# JSON File Storage Provider
# ============================================================================


class JsonFileStorageProvider(StorageProvider):
    """
    JSON file-based storage provider.
    Stores data in ~/.trikhub/storage/@scope/trik-name/data.json
    """

    def __init__(self, base_dir: str | None = None) -> None:
        self._base_dir = base_dir or str(Path.home() / ".trikhub" / "storage")
        self._contexts: dict[str, JsonFileStorageContext] = {}

    def _get_file_path(self, trik_id: str) -> str:
        """Get the file path for a trik's storage."""
        # Convert @scope/name to @scope/name/data.json
        normalized_id = trik_id.lstrip("@")
        return os.path.join(self._base_dir, f"@{normalized_id}", "data.json")

    def for_trik(
        self, trik_id: str, capabilities: StorageCapabilities | None = None
    ) -> TrikStorageContext:
        """Get a storage context for a specific trik."""
        # Return cached context if available
        if trik_id in self._contexts:
            return self._contexts[trik_id]

        file_path = self._get_file_path(trik_id)
        max_size = (
            capabilities.maxSizeBytes
            if capabilities and capabilities.maxSizeBytes
            else DEFAULT_MAX_SIZE_BYTES
        )

        context = JsonFileStorageContext(file_path, trik_id, max_size)
        self._contexts[trik_id] = context

        return context

    async def get_usage(self, trik_id: str) -> int:
        """Get the current storage usage for a trik in bytes."""
        context = self._contexts.get(trik_id)
        if context:
            return await context.get_usage()

        # Check if file exists
        file_path = self._get_file_path(trik_id)
        if not os.path.exists(file_path):
            return 0

        try:
            return os.path.getsize(file_path)
        except Exception:
            return 0

    async def clear(self, trik_id: str) -> None:
        """Clear all storage for a trik."""
        context = self._contexts.get(trik_id)
        if context:
            await context.clear()
            return

        # Delete file if it exists
        file_path = self._get_file_path(trik_id)
        if os.path.exists(file_path):
            os.unlink(file_path)

    async def list_triks(self) -> list[str]:
        """List all triks with stored data."""
        if not os.path.exists(self._base_dir):
            return []

        triks: list[str] = []

        try:
            for entry in os.scandir(self._base_dir):
                if not entry.is_dir():
                    continue

                if entry.name.startswith("@"):
                    # Scoped triks: @scope/name
                    scope_path = entry.path
                    for scoped_entry in os.scandir(scope_path):
                        if scoped_entry.is_dir():
                            data_file = os.path.join(scoped_entry.path, "data.json")
                            if os.path.exists(data_file):
                                triks.append(f"{entry.name}/{scoped_entry.name}")
                else:
                    # Unscoped triks
                    data_file = os.path.join(entry.path, "data.json")
                    if os.path.exists(data_file):
                        triks.append(entry.name)
        except Exception:
            pass

        return triks

    def get_base_dir(self) -> str:
        """Get the base directory path (for debugging)."""
        return self._base_dir


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
