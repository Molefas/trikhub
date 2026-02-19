"""
Configuration management for TrikHub CLI.

Manages the .trikhub/config.json file for tracking installed triks.
Also handles global config at ~/.trikhub/config.json for auth tokens.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any


# ============================================================================
# Constants
# ============================================================================

CONFIG_DIR = ".trikhub"
CONFIG_FILE = "config.json"
SECRETS_FILE = "secrets.json"

# Global config directory (for auth tokens)
GLOBAL_CONFIG_DIR = Path.home() / ".trikhub"
GLOBAL_CONFIG_FILE = "config.json"


# ============================================================================
# Data Types
# ============================================================================


@dataclass
class GlobalConfig:
    """Global CLI configuration (auth tokens, settings).

    Stored at ~/.trikhub/config.json. Matches JS TrikConfig type.
    """

    triks_directory: str = "~/.trikhub/triks"
    analytics: bool = True
    auth_token: str | None = None
    auth_expires_at: str | None = None
    publisher_username: str | None = None


@dataclass
class TriksConfig:
    """Configuration for installed triks."""

    triks: list[str] = field(default_factory=list)
    # Packages installed from TrikHub registry (not pip) - track versions for sync
    trikhub: dict[str, str] = field(default_factory=dict)
    # Python-specific: track which triks are Python vs Node
    runtimes: dict[str, str] = field(default_factory=dict)


@dataclass
class InstalledTrik:
    """Information about an installed trik."""

    name: str
    version: str
    runtime: str  # 'python' or 'node'
    path: str | None = None
    description: str | None = None
    exists: bool = True


# ============================================================================
# Config Management
# ============================================================================


def get_config_dir(base_dir: str | None = None) -> Path:
    """Get the path to the .trikhub directory."""
    base = Path(base_dir) if base_dir else Path.cwd()
    return base / CONFIG_DIR


def get_config_path(base_dir: str | None = None) -> Path:
    """Get the path to the config.json file."""
    return get_config_dir(base_dir) / CONFIG_FILE


def get_secrets_path(base_dir: str | None = None) -> Path:
    """Get the path to the secrets.json file."""
    return get_config_dir(base_dir) / SECRETS_FILE


def read_config(base_dir: str | None = None) -> TriksConfig:
    """Read the trik config from .trikhub/config.json."""
    config_path = get_config_path(base_dir)

    if not config_path.exists():
        return TriksConfig()

    try:
        content = config_path.read_text(encoding="utf-8")
        data = json.loads(content)
        return TriksConfig(
            triks=data.get("triks", []) if isinstance(data.get("triks"), list) else [],
            trikhub=data.get("trikhub", {}),
            runtimes=data.get("runtimes", {}),
        )
    except (json.JSONDecodeError, OSError):
        return TriksConfig()


def write_config(config: TriksConfig, base_dir: str | None = None) -> None:
    """Write the trik config to .trikhub/config.json."""
    config_path = get_config_path(base_dir)
    config_dir = config_path.parent

    # Ensure directory exists
    config_dir.mkdir(parents=True, exist_ok=True)

    # Build config dict, only including non-empty fields
    data: dict[str, Any] = {"triks": sorted(config.triks)}
    if config.trikhub:
        data["trikhub"] = config.trikhub
    if config.runtimes:
        data["runtimes"] = config.runtimes

    config_path.write_text(
        json.dumps(data, indent=2) + "\n",
        encoding="utf-8",
    )


def add_trik_to_config(
    package_name: str,
    base_dir: str | None = None,
    trikhub_version: str | None = None,
    runtime: str = "python",
) -> None:
    """Add a trik to the config."""
    config = read_config(base_dir)

    if package_name not in config.triks:
        config.triks.append(package_name)

    # Track TrikHub source for reinstallation
    if trikhub_version:
        config.trikhub[package_name] = trikhub_version

    # Track runtime
    config.runtimes[package_name] = runtime

    write_config(config, base_dir)


def remove_trik_from_config(
    package_name: str,
    base_dir: str | None = None,
) -> bool:
    """Remove a trik from the config. Returns True if it was in the config."""
    config = read_config(base_dir)

    if package_name not in config.triks:
        return False

    config.triks = [t for t in config.triks if t != package_name]
    config.trikhub.pop(package_name, None)
    config.runtimes.pop(package_name, None)

    write_config(config, base_dir)
    return True


def is_trik_installed(package_name: str, base_dir: str | None = None) -> bool:
    """Check if a trik is in the config."""
    config = read_config(base_dir)
    return package_name in config.triks


# ============================================================================
# Global Config Management (for auth tokens)
# ============================================================================


def get_global_config_path() -> Path:
    """Get the path to the global config file."""
    return GLOBAL_CONFIG_DIR / GLOBAL_CONFIG_FILE


def read_global_config() -> GlobalConfig:
    """Read the global config from ~/.trikhub/config.json."""
    config_path = get_global_config_path()

    if not config_path.exists():
        return GlobalConfig()

    try:
        content = config_path.read_text(encoding="utf-8")
        data = json.loads(content)
        return GlobalConfig(
            triks_directory=data.get("triksDirectory", "~/.trikhub/triks"),
            analytics=data.get("analytics", True),
            auth_token=data.get("authToken"),
            auth_expires_at=data.get("authExpiresAt"),
            publisher_username=data.get("publisherUsername"),
        )
    except (json.JSONDecodeError, OSError):
        return GlobalConfig()


def write_global_config(config: GlobalConfig) -> None:
    """Write the global config to ~/.trikhub/config.json."""
    config_path = get_global_config_path()
    config_dir = config_path.parent

    # Ensure directory exists
    config_dir.mkdir(parents=True, exist_ok=True)

    # Build config dict (use camelCase to match JS)
    data: dict[str, Any] = {
        "triksDirectory": config.triks_directory,
        "analytics": config.analytics,
    }

    # Only include auth fields if set
    if config.auth_token:
        data["authToken"] = config.auth_token
    if config.auth_expires_at:
        data["authExpiresAt"] = config.auth_expires_at
    if config.publisher_username:
        data["publisherUsername"] = config.publisher_username

    config_path.write_text(
        json.dumps(data, indent=2) + "\n",
        encoding="utf-8",
    )


def is_auth_expired(config: GlobalConfig) -> bool:
    """Check if the auth token is expired."""
    if not config.auth_expires_at:
        return True
    try:
        expires_at = datetime.fromisoformat(config.auth_expires_at.replace("Z", "+00:00"))
        return expires_at < datetime.now(expires_at.tzinfo)
    except (ValueError, TypeError):
        return True


# ============================================================================
# Secrets Management
# ============================================================================


def read_secrets(base_dir: str | None = None) -> dict[str, dict[str, str]]:
    """Read secrets from .trikhub/secrets.json."""
    secrets_path = get_secrets_path(base_dir)

    if not secrets_path.exists():
        return {}

    try:
        content = secrets_path.read_text(encoding="utf-8")
        return json.loads(content)
    except (json.JSONDecodeError, OSError):
        return {}


def write_secrets(secrets: dict[str, dict[str, str]], base_dir: str | None = None) -> None:
    """Write secrets to .trikhub/secrets.json."""
    secrets_path = get_secrets_path(base_dir)
    secrets_dir = secrets_path.parent

    # Ensure directory exists
    secrets_dir.mkdir(parents=True, exist_ok=True)

    secrets_path.write_text(
        json.dumps(secrets, indent=2) + "\n",
        encoding="utf-8",
    )


def get_trik_secrets(trik_id: str, base_dir: str | None = None) -> dict[str, str]:
    """Get secrets for a specific trik."""
    secrets = read_secrets(base_dir)
    return secrets.get(trik_id, {})


def set_trik_secrets(
    trik_id: str,
    trik_secrets: dict[str, str],
    base_dir: str | None = None,
) -> None:
    """Set secrets for a specific trik."""
    secrets = read_secrets(base_dir)
    secrets[trik_id] = trik_secrets
    write_secrets(secrets, base_dir)


# ============================================================================
# Defaults Storage (for trik init)
# ============================================================================

DEFAULTS_FILE = "defaults.json"


@dataclass
class TrikDefaults:
    """Trik init defaults - persisted across sessions."""

    author_name: str | None = None
    author_github: str | None = None


def get_defaults_path() -> Path:
    """Get the path to the defaults.json file."""
    return GLOBAL_CONFIG_DIR / DEFAULTS_FILE


def load_defaults() -> TrikDefaults:
    """Load saved defaults for trik init."""
    defaults_path = get_defaults_path()

    if not defaults_path.exists():
        return TrikDefaults()

    try:
        content = defaults_path.read_text(encoding="utf-8")
        data = json.loads(content)
        return TrikDefaults(
            author_name=data.get("authorName"),
            author_github=data.get("authorGithub"),
        )
    except (json.JSONDecodeError, OSError):
        return TrikDefaults()


def save_defaults(defaults: TrikDefaults) -> None:
    """Save defaults for trik init."""
    defaults_path = get_defaults_path()
    defaults_dir = defaults_path.parent

    # Ensure directory exists
    defaults_dir.mkdir(parents=True, exist_ok=True)

    data: dict[str, Any] = {}
    if defaults.author_name:
        data["authorName"] = defaults.author_name
    if defaults.author_github:
        data["authorGithub"] = defaults.author_github

    defaults_path.write_text(
        json.dumps(data, indent=2) + "\n",
        encoding="utf-8",
    )
