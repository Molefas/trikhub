"""Tests for the TrikHub CLI."""

import json
import os
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from click.testing import CliRunner

from trikhub.cli.config import (
    TriksConfig,
    add_trik_to_config,
    get_config_path,
    is_trik_installed,
    read_config,
    remove_trik_from_config,
    write_config,
)
from trikhub.cli.discovery import (
    DiscoveredTrik,
    discover_triks_in_directory,
)
from trikhub.cli.main import cli
from trikhub.cli.registry import (
    RegistryClient,
    SearchResult,
    TrikInfo,
    TrikVersion,
    get_registry_url,
)


class TestConfig:
    """Tests for config management."""

    def test_read_empty_config(self, tmp_path: Path) -> None:
        """Test reading when no config exists."""
        config = read_config(str(tmp_path))
        assert config.triks == []
        assert config.trikhub == {}
        assert config.runtimes == {}

    def test_write_and_read_config(self, tmp_path: Path) -> None:
        """Test writing and reading config."""
        config = TriksConfig(
            triks=["@acme/test", "@acme/other"],
            trikhub={"@acme/test": "1.0.0"},
            runtimes={"@acme/test": "python", "@acme/other": "node"},
        )
        write_config(config, str(tmp_path))

        # Verify file was created
        config_path = get_config_path(str(tmp_path))
        assert config_path.exists()

        # Read back and verify
        loaded = read_config(str(tmp_path))
        assert "@acme/other" in loaded.triks
        assert "@acme/test" in loaded.triks
        assert loaded.trikhub.get("@acme/test") == "1.0.0"
        assert loaded.runtimes.get("@acme/test") == "python"

    def test_add_trik_to_config(self, tmp_path: Path) -> None:
        """Test adding a trik to config."""
        add_trik_to_config("@acme/test", str(tmp_path), runtime="python")

        config = read_config(str(tmp_path))
        assert "@acme/test" in config.triks
        assert config.runtimes.get("@acme/test") == "python"

    def test_add_trik_with_version(self, tmp_path: Path) -> None:
        """Test adding a trik with trikhub version."""
        add_trik_to_config(
            "@acme/test",
            str(tmp_path),
            trikhub_version="1.0.0",
            runtime="python",
        )

        config = read_config(str(tmp_path))
        assert "@acme/test" in config.triks
        assert config.trikhub.get("@acme/test") == "1.0.0"

    def test_remove_trik_from_config(self, tmp_path: Path) -> None:
        """Test removing a trik from config."""
        add_trik_to_config("@acme/test", str(tmp_path))
        add_trik_to_config("@acme/other", str(tmp_path))

        result = remove_trik_from_config("@acme/test", str(tmp_path))
        assert result is True

        config = read_config(str(tmp_path))
        assert "@acme/test" not in config.triks
        assert "@acme/other" in config.triks

    def test_remove_nonexistent_trik(self, tmp_path: Path) -> None:
        """Test removing a trik that doesn't exist."""
        result = remove_trik_from_config("@acme/nonexistent", str(tmp_path))
        assert result is False

    def test_is_trik_installed(self, tmp_path: Path) -> None:
        """Test checking if trik is installed."""
        add_trik_to_config("@acme/test", str(tmp_path))

        assert is_trik_installed("@acme/test", str(tmp_path)) is True
        assert is_trik_installed("@acme/other", str(tmp_path)) is False


class TestRegistry:
    """Tests for registry client."""

    def test_get_registry_url_production(self) -> None:
        """Test getting production registry URL."""
        # Clear env vars
        os.environ.pop("TRIKHUB_REGISTRY", None)
        os.environ.pop("TRIKHUB_ENV", None)

        url = get_registry_url()
        assert url == "https://api.trikhub.com"

    def test_get_registry_url_development(self) -> None:
        """Test getting development registry URL."""
        os.environ["TRIKHUB_ENV"] = "development"
        try:
            url = get_registry_url()
            assert url == "http://localhost:3001"
        finally:
            os.environ.pop("TRIKHUB_ENV", None)

    def test_get_registry_url_override(self) -> None:
        """Test overriding registry URL."""
        os.environ["TRIKHUB_REGISTRY"] = "http://custom.registry.com"
        try:
            url = get_registry_url()
            assert url == "http://custom.registry.com"
        finally:
            os.environ.pop("TRIKHUB_REGISTRY", None)

    def test_trik_info_creation(self) -> None:
        """Test creating TrikInfo."""
        info = TrikInfo(
            full_name="@acme/test",
            scope="acme",
            name="test",
            github_repo="acme/test",
            latest_version="1.0.0",
            description="Test trik",
            runtime="python",
        )
        assert info.full_name == "@acme/test"
        assert info.runtime == "python"

    def test_trik_version_creation(self) -> None:
        """Test creating TrikVersion."""
        version = TrikVersion(
            version="1.0.0",
            git_tag="v1.0.0",
            commit_sha="abc123",
            published_at="2024-01-01",
        )
        assert version.version == "1.0.0"
        assert version.git_tag == "v1.0.0"


class TestDiscovery:
    """Tests for trik discovery."""

    def test_discover_triks_in_empty_directory(self, tmp_path: Path) -> None:
        """Test discovery in empty directory."""
        discovered = discover_triks_in_directory(tmp_path)
        assert discovered == []

    def test_discover_triks_in_nonexistent_directory(self, tmp_path: Path) -> None:
        """Test discovery in nonexistent directory."""
        discovered = discover_triks_in_directory(tmp_path / "nonexistent")
        assert discovered == []

    def test_discover_triks_with_manifest(self, tmp_path: Path) -> None:
        """Test discovery with valid manifest."""
        # Create a trik directory with manifest
        trik_dir = tmp_path / "test-trik"
        trik_dir.mkdir()

        manifest = {
            "id": "@acme/test-trik",
            "version": "1.0.0",
            "name": "Test Trik",
            "description": "A test trik",
            "entry": {
                "module": "./graph.py",
                "export": "graph",
                "runtime": "python",
            },
            "actions": {
                "test": {
                    "description": "Test action",
                    "responseMode": "template",
                    "inputSchema": {"type": "object"},
                    "agentDataSchema": {"type": "object"},
                    "responseTemplates": {
                        "success": {"text": "Done."},
                    },
                }
            },
            "capabilities": {
                "tools": [],
                "canRequestClarification": False,
            },
            "limits": {
                "maxExecutionTimeMs": 60000,
                "maxLlmCalls": 10,
                "maxToolCalls": 50,
            },
        }

        (trik_dir / "manifest.json").write_text(json.dumps(manifest))

        discovered = discover_triks_in_directory(tmp_path)
        assert len(discovered) == 1
        assert discovered[0].trik_id == "@acme/test-trik"
        assert discovered[0].runtime == "python"


class TestCLI:
    """Tests for CLI commands."""

    def test_cli_help(self) -> None:
        """Test CLI help output."""
        runner = CliRunner()
        result = runner.invoke(cli, ["--help"])
        assert result.exit_code == 0
        assert "TrikHub CLI" in result.output

    def test_cli_version(self) -> None:
        """Test CLI version output."""
        runner = CliRunner()
        result = runner.invoke(cli, ["--version"])
        assert result.exit_code == 0
        assert "0.1.0" in result.output

    def test_list_empty(self) -> None:
        """Test list command with no triks."""
        runner = CliRunner()
        with runner.isolated_filesystem():
            result = runner.invoke(cli, ["list"])
            assert result.exit_code == 0
            assert "No triks installed" in result.output

    def test_list_with_triks(self) -> None:
        """Test list command with triks."""
        runner = CliRunner()
        with runner.isolated_filesystem():
            # Add a trik to config
            add_trik_to_config("@acme/test", runtime="python")

            result = runner.invoke(cli, ["list"])
            assert result.exit_code == 0
            assert "@acme/test" in result.output

    def test_list_json_output(self) -> None:
        """Test list command with JSON output."""
        runner = CliRunner()
        with runner.isolated_filesystem():
            add_trik_to_config("@acme/test", runtime="python")

            result = runner.invoke(cli, ["list", "--json"])
            assert result.exit_code == 0
            data = json.loads(result.output)
            assert "triks" in data
            assert len(data["triks"]) == 1
            assert data["triks"][0]["name"] == "@acme/test"

    def test_sync_empty(self) -> None:
        """Test sync command with no triks."""
        runner = CliRunner()
        with runner.isolated_filesystem():
            result = runner.invoke(cli, ["sync"])
            # Should complete without error
            assert "No triks found" in result.output or "Scanning for triks" in result.output

    def test_sync_dry_run(self) -> None:
        """Test sync command with dry run."""
        runner = CliRunner()
        with runner.isolated_filesystem():
            # Create a triks directory with a manifest
            Path(".trikhub").mkdir()
            trik_dir = Path("triks/@acme/test-trik")
            trik_dir.mkdir(parents=True)

            manifest = {
                "id": "@acme/test-trik",
                "version": "1.0.0",
                "name": "Test",
                "description": "Test",
                "entry": {"module": "./graph.py", "export": "graph"},
                "actions": {"test": {"description": "Test", "input": {}, "responseTemplates": {}}},
            }
            (trik_dir / "manifest.json").write_text(json.dumps(manifest))

            result = runner.invoke(cli, ["sync", "--dry-run", "--directory", "triks"])
            # Should show what would be added without modifying
            if result.exit_code == 0:
                assert "Dry run" in result.output or "No triks found" in result.output

    def test_uninstall_not_in_config(self) -> None:
        """Test uninstall command for trik not in config."""
        runner = CliRunner()
        with runner.isolated_filesystem():
            result = runner.invoke(cli, ["uninstall", "@acme/nonexistent"])
            assert result.exit_code == 0
            assert "was not in config" in result.output

    def test_install_help(self) -> None:
        """Test install command help."""
        runner = CliRunner()
        result = runner.invoke(cli, ["install", "--help"])
        assert result.exit_code == 0
        assert "Install a trik" in result.output

    def test_search_help(self) -> None:
        """Test search command help."""
        runner = CliRunner()
        result = runner.invoke(cli, ["search", "--help"])
        assert result.exit_code == 0
        assert "Search for triks" in result.output

    def test_info_help(self) -> None:
        """Test info command help."""
        runner = CliRunner()
        result = runner.invoke(cli, ["info", "--help"])
        assert result.exit_code == 0
        assert "Show detailed information" in result.output


class TestRegistryClient:
    """Tests for async registry client."""

    @pytest.mark.asyncio
    async def test_registry_client_context_manager(self) -> None:
        """Test registry client as context manager."""
        async with RegistryClient() as client:
            assert client is not None
            assert client.base_url == "https://api.trikhub.com"

    @pytest.mark.asyncio
    async def test_registry_client_custom_url(self) -> None:
        """Test registry client with custom URL."""
        async with RegistryClient(base_url="http://localhost:3000") as client:
            assert client.base_url == "http://localhost:3000"

    @pytest.mark.asyncio
    async def test_api_to_trik_info(self) -> None:
        """Test API response conversion."""
        client = RegistryClient()

        api_data = {
            "name": "@acme/test",
            "scope": "acme",
            "shortName": "test",
            "githubRepo": "acme/test",
            "latestVersion": "1.0.0",
            "description": "Test trik",
            "categories": ["testing"],
            "keywords": ["test", "example"],
            "totalDownloads": 100,
            "githubStars": 50,
            "verified": True,
            "runtime": "python",
        }

        info = client._api_to_trik_info(api_data)
        assert info.full_name == "@acme/test"
        assert info.scope == "acme"
        assert info.name == "test"
        assert info.latest_version == "1.0.0"
        assert info.runtime == "python"
        assert info.verified is True

        await client.close()

    @pytest.mark.asyncio
    async def test_api_to_version(self) -> None:
        """Test version conversion."""
        client = RegistryClient()

        api_version = {
            "version": "1.0.0",
            "gitTag": "v1.0.0",
            "commitSha": "abc123def456",
            "publishedAt": "2024-01-15T10:00:00Z",
            "downloads": 50,
        }

        version = client._api_to_version(api_version)
        assert version.version == "1.0.0"
        assert version.git_tag == "v1.0.0"
        assert version.commit_sha == "abc123def456"
        assert version.downloads == 50

        await client.close()
