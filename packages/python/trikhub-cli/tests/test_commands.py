"""Tests for CLI commands (non-interactive, config-based)."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest
from click.testing import CliRunner

from trikhub.cli.config import add_trik_to_config, write_config, TriksConfig
from trikhub.cli.main import cli


@pytest.fixture
def runner():
    return CliRunner()


class TestListCommand:
    def test_list_empty(self, runner: CliRunner, tmp_path: Path):
        with runner.isolated_filesystem(temp_dir=tmp_path):
            result = runner.invoke(cli, ["list"])
            assert result.exit_code == 0
            assert "No triks installed" in result.output

    def test_list_with_triks(self, runner: CliRunner, tmp_path: Path):
        with runner.isolated_filesystem(temp_dir=tmp_path):
            add_trik_to_config("@molefas/trik-hash", trikhub_version="1.0.0", runtime="node")
            add_trik_to_config("test-py-trik", runtime="python")

            result = runner.invoke(cli, ["list"])
            assert result.exit_code == 0
            assert "@molefas/trik-hash" in result.output
            assert "test-py-trik" in result.output

    def test_list_json(self, runner: CliRunner, tmp_path: Path):
        with runner.isolated_filesystem(temp_dir=tmp_path):
            add_trik_to_config("test-trik", trikhub_version="1.0.0", runtime="python")

            result = runner.invoke(cli, ["list", "-j"])
            assert result.exit_code == 0
            data = json.loads(result.output)
            assert len(data) == 1
            assert data[0]["name"] == "test-trik"

    def test_list_filter_runtime(self, runner: CliRunner, tmp_path: Path):
        with runner.isolated_filesystem(temp_dir=tmp_path):
            add_trik_to_config("node-trik", runtime="node")
            add_trik_to_config("py-trik", runtime="python")

            result = runner.invoke(cli, ["list", "--runtime", "python"])
            assert result.exit_code == 0
            assert "py-trik" in result.output
            assert "node-trik" not in result.output


class TestSyncCommand:
    def test_sync_no_new_triks(self, runner: CliRunner, tmp_path: Path):
        with runner.isolated_filesystem(temp_dir=tmp_path):
            # Sync with empty site-packages (mocked)
            with patch("trikhub.cli.commands.list.discover_triks_in_site_packages", return_value=[]):
                result = runner.invoke(cli, ["sync"])
                assert result.exit_code == 0
                assert "already synced" in result.output

    def test_sync_dry_run(self, runner: CliRunner, tmp_path: Path):
        with runner.isolated_filesystem(temp_dir=tmp_path):
            with patch("trikhub.cli.commands.list.discover_triks_in_site_packages", return_value=[]):
                result = runner.invoke(cli, ["sync", "--dry-run"])
                assert result.exit_code == 0


class TestVersionFlag:
    def test_version(self, runner: CliRunner):
        result = runner.invoke(cli, ["--version"])
        assert result.exit_code == 0
        assert "0.1.0" in result.output


class TestDevFlag:
    def test_dev_flag(self, runner: CliRunner, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.delenv("TRIKHUB_ENV", raising=False)
        result = runner.invoke(cli, ["--dev", "--help"])
        assert result.exit_code == 0


class TestHelpOutput:
    def test_main_help(self, runner: CliRunner):
        result = runner.invoke(cli, ["--help"])
        assert result.exit_code == 0
        assert "init" in result.output
        assert "install" in result.output
        assert "publish" in result.output
        assert "login" in result.output
        assert "search" in result.output
        assert "list" in result.output

    def test_init_help(self, runner: CliRunner):
        result = runner.invoke(cli, ["init", "--help"])
        assert result.exit_code == 0
        assert "Scaffold" in result.output

    def test_install_help(self, runner: CliRunner):
        result = runner.invoke(cli, ["install", "--help"])
        assert result.exit_code == 0

    def test_publish_help(self, runner: CliRunner):
        result = runner.invoke(cli, ["publish", "--help"])
        assert result.exit_code == 0

    def test_search_help(self, runner: CliRunner):
        result = runner.invoke(cli, ["search", "--help"])
        assert result.exit_code == 0
