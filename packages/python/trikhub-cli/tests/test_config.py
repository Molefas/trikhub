"""Tests for CLI config management."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from trikhub.cli.config import (
    GlobalConfig,
    TrikDefaults,
    TriksConfig,
    add_trik_to_config,
    is_auth_expired,
    load_defaults,
    read_config,
    read_global_config,
    remove_trik_from_config,
    save_defaults,
    write_config,
    write_global_config,
)


class TestTriksConfig:
    def test_read_missing_config(self, tmp_path: Path):
        config = read_config(str(tmp_path))
        assert config.triks == []
        assert config.trikhub == {}
        assert config.runtimes == {}

    def test_write_and_read_config(self, tmp_path: Path):
        config = TriksConfig(
            triks=["@molefas/trik-hash", "@molefas/content-hoarder"],
            trikhub={"@molefas/trik-hash": "1.0.0"},
            runtimes={"@molefas/trik-hash": "node"},
        )
        write_config(config, str(tmp_path))
        loaded = read_config(str(tmp_path))

        assert sorted(loaded.triks) == sorted(config.triks)
        assert loaded.trikhub == config.trikhub
        assert loaded.runtimes == config.runtimes

    def test_triks_sorted_on_write(self, tmp_path: Path):
        config = TriksConfig(triks=["z-trik", "a-trik", "m-trik"])
        write_config(config, str(tmp_path))

        raw = json.loads((tmp_path / ".trikhub" / "config.json").read_text())
        assert raw["triks"] == ["a-trik", "m-trik", "z-trik"]

    def test_empty_trikhub_omitted(self, tmp_path: Path):
        config = TriksConfig(triks=["test-trik"])
        write_config(config, str(tmp_path))

        raw = json.loads((tmp_path / ".trikhub" / "config.json").read_text())
        assert "trikhub" not in raw
        assert "runtimes" not in raw

    def test_add_trik_to_config(self, tmp_path: Path):
        add_trik_to_config("@molefas/trik-hash", str(tmp_path), trikhub_version="1.0.0", runtime="node")
        config = read_config(str(tmp_path))

        assert "@molefas/trik-hash" in config.triks
        assert config.trikhub["@molefas/trik-hash"] == "1.0.0"
        assert config.runtimes["@molefas/trik-hash"] == "node"

    def test_add_duplicate_trik(self, tmp_path: Path):
        add_trik_to_config("test-trik", str(tmp_path))
        add_trik_to_config("test-trik", str(tmp_path))
        config = read_config(str(tmp_path))

        assert config.triks.count("test-trik") == 1

    def test_remove_trik(self, tmp_path: Path):
        add_trik_to_config("test-trik", str(tmp_path), trikhub_version="1.0.0")
        removed = remove_trik_from_config("test-trik", str(tmp_path))
        assert removed is True

        config = read_config(str(tmp_path))
        assert "test-trik" not in config.triks
        assert "test-trik" not in config.trikhub
        assert "test-trik" not in config.runtimes

    def test_remove_missing_trik(self, tmp_path: Path):
        removed = remove_trik_from_config("nonexistent", str(tmp_path))
        assert removed is False

    def test_read_corrupt_config(self, tmp_path: Path):
        config_dir = tmp_path / ".trikhub"
        config_dir.mkdir()
        (config_dir / "config.json").write_text("not json!!!")

        config = read_config(str(tmp_path))
        assert config.triks == []


class TestGlobalConfig:
    def test_read_missing_global_config(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr("trikhub.cli.config.GLOBAL_CONFIG_DIR", tmp_path / "nonexistent")
        config = read_global_config()
        assert config.auth_token is None
        assert config.analytics is True

    def test_write_and_read_global_config(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr("trikhub.cli.config.GLOBAL_CONFIG_DIR", tmp_path)
        config = GlobalConfig(
            auth_token="test-token",
            auth_expires_at="2030-01-01T00:00:00Z",
            publisher_username="testuser",
        )
        write_global_config(config)
        loaded = read_global_config()

        assert loaded.auth_token == "test-token"
        assert loaded.publisher_username == "testuser"

    def test_camel_case_keys(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr("trikhub.cli.config.GLOBAL_CONFIG_DIR", tmp_path)
        config = GlobalConfig(auth_token="tok")
        write_global_config(config)

        raw = json.loads((tmp_path / "config.json").read_text())
        assert "authToken" in raw
        assert "triksDirectory" in raw

    def test_auth_expired(self):
        config = GlobalConfig(auth_expires_at="2020-01-01T00:00:00Z")
        assert is_auth_expired(config) is True

    def test_auth_not_expired(self):
        config = GlobalConfig(auth_expires_at="2099-01-01T00:00:00Z")
        assert is_auth_expired(config) is False

    def test_auth_expired_no_token(self):
        config = GlobalConfig()
        assert is_auth_expired(config) is True


class TestDefaults:
    def test_load_missing_defaults(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr("trikhub.cli.config.GLOBAL_CONFIG_DIR", tmp_path / "nonexistent")
        defaults = load_defaults()
        assert defaults.author_name is None

    def test_save_and_load_defaults(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr("trikhub.cli.config.GLOBAL_CONFIG_DIR", tmp_path)
        save_defaults(TrikDefaults(author_name="Test User", author_github="testuser"))
        loaded = load_defaults()

        assert loaded.author_name == "Test User"
        assert loaded.author_github == "testuser"
