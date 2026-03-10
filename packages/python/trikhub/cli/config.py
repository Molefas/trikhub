"""Configuration management for TrikHub CLI.

Manages .trikhub/config.json for tracking installed triks
and ~/.trikhub/config.json for auth tokens.
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

GLOBAL_CONFIG_DIR = Path.home() / ".trikhub"
GLOBAL_CONFIG_FILE = "config.json"
DEFAULTS_FILE = "defaults.json"


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
    trikhub: dict[str, str] = field(default_factory=dict)
    runtimes: dict[str, str] = field(default_factory=dict)


@dataclass
class TrikDefaults:
    """Trik init defaults — persisted across sessions."""

    author_name: str | None = None
    author_github: str | None = None


# ============================================================================
# Local Config (.trikhub/config.json)
# ============================================================================


def get_config_dir(base_dir: str | None = None) -> Path:
    base = Path(base_dir) if base_dir else Path.cwd()
    return base / CONFIG_DIR


def get_config_path(base_dir: str | None = None) -> Path:
    return get_config_dir(base_dir) / CONFIG_FILE


def read_config(base_dir: str | None = None) -> TriksConfig:
    config_path = get_config_path(base_dir)
    if not config_path.exists():
        return TriksConfig()
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
        return TriksConfig(
            triks=data.get("triks", []) if isinstance(data.get("triks"), list) else [],
            trikhub=data.get("trikhub", {}),
            runtimes=data.get("runtimes", {}),
        )
    except (json.JSONDecodeError, OSError):
        return TriksConfig()


def write_config(config: TriksConfig, base_dir: str | None = None) -> None:
    config_path = get_config_path(base_dir)
    config_path.parent.mkdir(parents=True, exist_ok=True)
    data: dict[str, Any] = {"triks": sorted(config.triks)}
    if config.trikhub:
        data["trikhub"] = config.trikhub
    if config.runtimes:
        data["runtimes"] = config.runtimes
    config_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def add_trik_to_config(
    package_name: str,
    base_dir: str | None = None,
    trikhub_version: str | None = None,
    runtime: str = "python",
) -> None:
    config = read_config(base_dir)
    if package_name not in config.triks:
        config.triks.append(package_name)
    if trikhub_version:
        config.trikhub[package_name] = trikhub_version
    config.runtimes[package_name] = runtime
    write_config(config, base_dir)


def remove_trik_from_config(package_name: str, base_dir: str | None = None) -> bool:
    config = read_config(base_dir)
    if package_name not in config.triks:
        return False
    config.triks = [t for t in config.triks if t != package_name]
    config.trikhub.pop(package_name, None)
    config.runtimes.pop(package_name, None)
    write_config(config, base_dir)
    return True


# ============================================================================
# Global Config (~/.trikhub/config.json)
# ============================================================================


def get_global_config_path() -> Path:
    return GLOBAL_CONFIG_DIR / GLOBAL_CONFIG_FILE


def read_global_config() -> GlobalConfig:
    config_path = get_global_config_path()
    if not config_path.exists():
        return GlobalConfig()
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
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
    config_path = get_global_config_path()
    config_path.parent.mkdir(parents=True, exist_ok=True)
    data: dict[str, Any] = {
        "triksDirectory": config.triks_directory,
        "analytics": config.analytics,
    }
    if config.auth_token:
        data["authToken"] = config.auth_token
    if config.auth_expires_at:
        data["authExpiresAt"] = config.auth_expires_at
    if config.publisher_username:
        data["publisherUsername"] = config.publisher_username
    config_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def is_auth_expired(config: GlobalConfig) -> bool:
    if not config.auth_expires_at:
        return True
    try:
        expires_at = datetime.fromisoformat(config.auth_expires_at.replace("Z", "+00:00"))
        return expires_at < datetime.now(expires_at.tzinfo)
    except (ValueError, TypeError):
        return True


# ============================================================================
# Secrets
# ============================================================================


def get_secrets_path(base_dir: str | None = None) -> Path:
    return get_config_dir(base_dir) / SECRETS_FILE


def read_secrets(base_dir: str | None = None) -> dict[str, dict[str, str]]:
    secrets_path = get_secrets_path(base_dir)
    if not secrets_path.exists():
        return {}
    try:
        return json.loads(secrets_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def remove_trik_storage(package_name: str) -> bool:
    """Remove a trik's data from the storage database (~/.trikhub/storage/storage.db)."""
    db_path = Path.home() / ".trikhub" / "storage" / "storage.db"
    if not db_path.exists():
        return False
    try:
        import sqlite3

        conn = sqlite3.connect(str(db_path))
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM storage WHERE trik_id = ?", (package_name,))
            conn.commit()
            return cursor.rowcount > 0
        finally:
            conn.close()
    except Exception:
        return False


def remove_trik_secrets(package_name: str, base_dir: str | None = None) -> bool:
    """Remove a trik's entry from .trikhub/secrets.json."""
    secrets_path = get_secrets_path(base_dir)
    if not secrets_path.exists():
        return False
    try:
        secrets = json.loads(secrets_path.read_text(encoding="utf-8"))
        if package_name not in secrets:
            return False
        del secrets[package_name]
        secrets_path.write_text(
            json.dumps(secrets, indent=2) + "\n", encoding="utf-8"
        )
        return True
    except (json.JSONDecodeError, OSError):
        return False


# ============================================================================
# Defaults (~/.trikhub/defaults.json)
# ============================================================================


def get_defaults_path() -> Path:
    return GLOBAL_CONFIG_DIR / DEFAULTS_FILE


def load_defaults() -> TrikDefaults:
    defaults_path = get_defaults_path()
    if not defaults_path.exists():
        return TrikDefaults()
    try:
        data = json.loads(defaults_path.read_text(encoding="utf-8"))
        return TrikDefaults(
            author_name=data.get("authorName"),
            author_github=data.get("authorGithub"),
        )
    except (json.JSONDecodeError, OSError):
        return TrikDefaults()


def save_defaults(defaults: TrikDefaults) -> None:
    defaults_path = get_defaults_path()
    defaults_path.parent.mkdir(parents=True, exist_ok=True)
    data: dict[str, Any] = {}
    if defaults.author_name:
        data["authorName"] = defaults.author_name
    if defaults.author_github:
        data["authorGithub"] = defaults.author_github
    defaults_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
