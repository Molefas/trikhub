"""
Configuration store for trik secrets (API keys, tokens, etc.).

Mirrors packages/js/gateway/src/config-store.ts
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Protocol

from trikhub.manifest import TrikConfigContext, TrikManifest


# ============================================================================
# Protocol
# ============================================================================


class ConfigStore(Protocol):
    """Interface for configuration storage implementations."""

    async def load(self) -> None: ...
    async def reload(self) -> None: ...
    def get_for_trik(self, trik_id: str) -> TrikConfigContext: ...
    def validate_config(self, manifest: TrikManifest) -> list[str]: ...
    def get_configured_triks(self) -> list[str]: ...


# ============================================================================
# Config Context Wrapper
# ============================================================================


class _ConfigContext:
    """Implementation of TrikConfigContext that wraps a config dict."""

    def __init__(
        self, config: dict[str, str], defaults: dict[str, str] | None = None
    ) -> None:
        self._config = config
        self._defaults = defaults or {}

    def get(self, key: str) -> str | None:
        return self._config.get(key) or self._defaults.get(key)

    def has(self, key: str) -> bool:
        return key in self._config or key in self._defaults

    def keys(self) -> list[str]:
        all_keys = set(self._config.keys()) | set(self._defaults.keys())
        return list(all_keys)


_EMPTY_CONFIG: TrikConfigContext = _ConfigContext({})


# ============================================================================
# File-Based Config Store
# ============================================================================


class FileConfigStore:
    """
    File-based ConfigStore.
    Loads secrets from global (~/.trikhub/secrets.json) and local
    (.trikhub/secrets.json) files. Local secrets override global.
    """

    def __init__(
        self,
        *,
        global_secrets_path: str | None = None,
        local_secrets_path: str | None = None,
        allow_local_override: bool = True,
    ) -> None:
        home = Path.home()
        self._global_path = global_secrets_path or str(
            home / ".trikhub" / "secrets.json"
        )
        self._local_path = local_secrets_path or str(
            Path.cwd() / ".trikhub" / "secrets.json"
        )
        self._allow_local_override = allow_local_override
        self._global_secrets: dict[str, dict[str, str]] = {}
        self._local_secrets: dict[str, dict[str, str]] = {}
        self._loaded = False

    async def load(self) -> None:
        self._global_secrets = self._read_json(self._global_path)
        if self._allow_local_override:
            self._local_secrets = self._read_json(self._local_path)
        self._loaded = True

    async def reload(self) -> None:
        self._global_secrets = {}
        self._local_secrets = {}
        self._loaded = False
        await self.load()

    def get_for_trik(self, trik_id: str) -> TrikConfigContext:
        if not self._loaded:
            return _EMPTY_CONFIG

        global_cfg = self._global_secrets.get(trik_id, {})
        local_cfg = (
            self._local_secrets.get(trik_id, {})
            if self._allow_local_override
            else {}
        )
        merged = {**global_cfg, **local_cfg}
        if not merged:
            return _EMPTY_CONFIG
        return _ConfigContext(merged)

    def validate_config(self, manifest: TrikManifest) -> list[str]:
        missing: list[str] = []
        if not manifest.config or not manifest.config.required:
            return missing
        ctx = self.get_for_trik(manifest.id)
        for req in manifest.config.required:
            if not ctx.has(req.key):
                missing.append(req.key)
        return missing

    def get_configured_triks(self) -> list[str]:
        ids = set(self._global_secrets.keys()) | set(self._local_secrets.keys())
        return list(ids)

    @staticmethod
    def _read_json(path: str) -> dict[str, Any]:
        if not os.path.isfile(path):
            return {}
        try:
            with open(path) as f:
                return json.load(f)
        except Exception:
            return {}


# ============================================================================
# In-Memory Config Store (for testing)
# ============================================================================


class InMemoryConfigStore:
    """In-memory ConfigStore for testing or programmatic configuration."""

    def __init__(
        self, initial_secrets: dict[str, dict[str, str]] | None = None
    ) -> None:
        self._secrets: dict[str, dict[str, str]] = dict(initial_secrets or {})
        self._defaults: dict[str, dict[str, str]] = {}

    async def load(self) -> None:
        pass

    async def reload(self) -> None:
        pass

    def set_for_trik(self, trik_id: str, config: dict[str, str]) -> None:
        self._secrets[trik_id] = dict(config)

    def get_for_trik(self, trik_id: str) -> TrikConfigContext:
        cfg = self._secrets.get(trik_id, {})
        defaults = self._defaults.get(trik_id, {})
        if not cfg and not defaults:
            return _EMPTY_CONFIG
        return _ConfigContext(cfg, defaults)

    def validate_config(self, manifest: TrikManifest) -> list[str]:
        missing: list[str] = []
        if not manifest.config or not manifest.config.required:
            return missing
        ctx = self.get_for_trik(manifest.id)
        for req in manifest.config.required:
            if not ctx.has(req.key):
                missing.append(req.key)
        return missing

    def set_defaults_from_manifest(self, manifest: TrikManifest) -> None:
        """Set defaults from manifest (optional configs with default values)."""
        if not manifest.config or not manifest.config.optional:
            return

        defaults: dict[str, str] = {}
        for opt in manifest.config.optional:
            if opt.default is not None:
                defaults[opt.key] = opt.default

        if defaults:
            self._defaults[manifest.id] = defaults

    def get_configured_triks(self) -> list[str]:
        return list(self._secrets.keys())

    def clear(self) -> None:
        self._secrets.clear()
        self._defaults.clear()
