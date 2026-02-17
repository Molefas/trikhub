"""
Config Store for TrikHub Gateway

Mirrors packages/trik-gateway/src/config-store.ts
Provides configuration management (API keys, tokens, etc.) for triks.
"""

from __future__ import annotations

import json
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from trikhub.manifest import TrikManifest


# ============================================================================
# Types
# ============================================================================


@dataclass
class SecretsFile:
    """Structure of the secrets file (~/.trikhub/secrets.json)."""

    # Config values keyed by trik ID
    secrets: dict[str, dict[str, str]] = field(default_factory=dict)


# ============================================================================
# Config Context Interface
# ============================================================================


class TrikConfigContext(ABC):
    """
    Configuration context passed to triks in graph input.
    Provides access to user-configured values (API keys, tokens, etc.).
    """

    @abstractmethod
    def get(self, key: str) -> str | None:
        """
        Get a configuration value by key.
        Returns None if the key is not configured.
        """
        ...

    @abstractmethod
    def has(self, key: str) -> bool:
        """Check if a configuration key is set."""
        ...

    @abstractmethod
    def keys(self) -> list[str]:
        """Get all configured keys (without values, for debugging)."""
        ...


# ============================================================================
# Config Context Implementation
# ============================================================================


class ConfigContext(TrikConfigContext):
    """Implementation of TrikConfigContext that wraps a config dict."""

    def __init__(
        self,
        config: dict[str, str],
        defaults: dict[str, str] | None = None,
    ) -> None:
        self._config = config
        self._defaults = defaults or {}

    def get(self, key: str) -> str | None:
        """Get a configuration value by key."""
        return self._config.get(key) or self._defaults.get(key)

    def has(self, key: str) -> bool:
        """Check if a configuration key is set."""
        return key in self._config or key in self._defaults

    def keys(self) -> list[str]:
        """Get all configured keys (without values, for debugging)."""
        all_keys = set(self._config.keys()) | set(self._defaults.keys())
        return list(all_keys)


class EmptyConfigContext(TrikConfigContext):
    """Empty config context for triks that don't have any config."""

    def get(self, key: str) -> str | None:
        return None

    def has(self, key: str) -> bool:
        return False

    def keys(self) -> list[str]:
        return []


# Singleton empty context
EMPTY_CONFIG_CONTEXT = EmptyConfigContext()


# ============================================================================
# Config Store Interface
# ============================================================================


class ConfigStore(ABC):
    """Interface for configuration storage implementations."""

    @abstractmethod
    async def load(self) -> None:
        """
        Load secrets from configured paths.
        Should be called before getting config for any trik.
        """
        ...

    @abstractmethod
    async def reload(self) -> None:
        """Reload secrets from disk."""
        ...

    @abstractmethod
    def get_for_trik(self, trik_id: str) -> TrikConfigContext:
        """
        Get the config context for a specific trik.
        The returned context only exposes values for that trik.
        """
        ...

    @abstractmethod
    def validate_config(self, manifest: TrikManifest) -> list[str]:
        """
        Validate that all required config values are present for a trik.
        Returns an array of missing required keys, or empty array if all present.
        """
        ...

    @abstractmethod
    def get_configured_triks(self) -> list[str]:
        """Get all configured trik IDs."""
        ...


# ============================================================================
# File Config Store
# ============================================================================


@dataclass
class ConfigStoreOptions:
    """Options for creating a ConfigStore."""

    global_secrets_path: str | None = None
    local_secrets_path: str | None = None
    allow_local_override: bool = True


class FileConfigStore(ConfigStore):
    """
    File-based ConfigStore implementation.
    Loads secrets from global (~/.trikhub/secrets.json) and local (.trikhub/secrets.json) files.
    Local secrets override global secrets when both are present.
    """

    def __init__(self, options: ConfigStoreOptions | None = None) -> None:
        options = options or ConfigStoreOptions()

        self._global_path = options.global_secrets_path or str(
            Path.home() / ".trikhub" / "secrets.json"
        )
        self._local_path = options.local_secrets_path or str(
            Path.cwd() / ".trikhub" / "secrets.json"
        )
        self._allow_local_override = options.allow_local_override

        self._global_secrets: dict[str, dict[str, str]] = {}
        self._local_secrets: dict[str, dict[str, str]] = {}
        self._loaded = False

    async def load(self) -> None:
        """Load secrets from configured paths."""
        # Load global secrets
        if os.path.exists(self._global_path):
            try:
                with open(self._global_path) as f:
                    self._global_secrets = json.load(f)
            except Exception as e:
                print(
                    f"[ConfigStore] Failed to load global secrets from {self._global_path}: {e}"
                )
                self._global_secrets = {}

        # Load local secrets
        if self._allow_local_override and os.path.exists(self._local_path):
            try:
                with open(self._local_path) as f:
                    self._local_secrets = json.load(f)
            except Exception as e:
                print(
                    f"[ConfigStore] Failed to load local secrets from {self._local_path}: {e}"
                )
                self._local_secrets = {}

        self._loaded = True

    async def reload(self) -> None:
        """Reload secrets from disk."""
        self._global_secrets = {}
        self._local_secrets = {}
        self._loaded = False
        await self.load()

    def get_for_trik(self, trik_id: str) -> TrikConfigContext:
        """Get the config context for a specific trik."""
        if not self._loaded:
            print("[ConfigStore] Secrets not loaded. Call load() before get_for_trik().")
            return EMPTY_CONFIG_CONTEXT

        global_config = self._global_secrets.get(trik_id, {})
        local_config = (
            self._local_secrets.get(trik_id, {}) if self._allow_local_override else {}
        )

        # Merge global and local, with local taking precedence
        merged_config = {**global_config, **local_config}

        if not merged_config:
            return EMPTY_CONFIG_CONTEXT

        return ConfigContext(merged_config)

    def validate_config(self, manifest: TrikManifest) -> list[str]:
        """Validate that all required config values are present for a trik."""
        missing_keys: list[str] = []

        if not manifest.config or not manifest.config.required:
            return missing_keys

        config_context = self.get_for_trik(manifest.id)

        for requirement in manifest.config.required:
            if not config_context.has(requirement.key):
                missing_keys.append(requirement.key)

        return missing_keys

    def get_configured_triks(self) -> list[str]:
        """Get all configured trik IDs."""
        trik_ids = set(self._global_secrets.keys()) | set(self._local_secrets.keys())
        return list(trik_ids)

    def get_paths(self) -> dict[str, str]:
        """Get the paths being used (for debugging)."""
        return {"global": self._global_path, "local": self._local_path}


# ============================================================================
# In-Memory Config Store
# ============================================================================


class InMemoryConfigStore(ConfigStore):
    """In-memory ConfigStore for testing or programmatic configuration."""

    def __init__(self, initial_secrets: dict[str, dict[str, str]] | None = None) -> None:
        self._secrets = initial_secrets.copy() if initial_secrets else {}
        self._defaults: dict[str, dict[str, str]] = {}

    async def load(self) -> None:
        """No-op for in-memory store."""
        pass

    async def reload(self) -> None:
        """No-op for in-memory store."""
        pass

    def set_for_trik(self, trik_id: str, config: dict[str, str]) -> None:
        """Set secrets for a specific trik."""
        self._secrets[trik_id] = config.copy()

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

    def get_for_trik(self, trik_id: str) -> TrikConfigContext:
        """Get the config context for a specific trik."""
        config = self._secrets.get(trik_id, {})
        defaults = self._defaults.get(trik_id, {})

        if not config and not defaults:
            return EMPTY_CONFIG_CONTEXT

        return ConfigContext(config, defaults)

    def validate_config(self, manifest: TrikManifest) -> list[str]:
        """Validate that all required config values are present for a trik."""
        missing_keys: list[str] = []

        if not manifest.config or not manifest.config.required:
            return missing_keys

        config_context = self.get_for_trik(manifest.id)

        for requirement in manifest.config.required:
            if not config_context.has(requirement.key):
                missing_keys.append(requirement.key)

        return missing_keys

    def get_configured_triks(self) -> list[str]:
        """Get all configured trik IDs."""
        return list(self._secrets.keys())

    def clear(self) -> None:
        """Clear all secrets."""
        self._secrets = {}
        self._defaults = {}
