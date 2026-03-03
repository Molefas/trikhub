"""Tests for GatewayRegistryProvider — implements TrikRegistryContext."""

import json
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from trikhub.gateway.registry_provider import GatewayRegistryProvider


# ============================================================================
# Helpers
# ============================================================================


def create_mock_gateway(loaded_triks: dict | None = None):
    """Create a mock gateway with optional pre-loaded triks."""
    gateway = MagicMock()
    gateway.get_loaded_triks.return_value = loaded_triks or {}
    gateway.load_trik = AsyncMock()
    gateway.unload_trik = MagicMock(return_value=True)
    return gateway


def mock_httpx_response(data: dict, status_code: int = 200) -> httpx.Response:
    """Create a mock httpx Response."""
    return httpx.Response(
        status_code=status_code,
        json=data,
        request=httpx.Request("GET", "https://api.trikhub.com"),
    )


# ============================================================================
# search
# ============================================================================


@pytest.mark.asyncio
async def test_search_returns_results():
    with tempfile.TemporaryDirectory() as config_dir:
        gateway = create_mock_gateway()
        provider = GatewayRegistryProvider(
            config_dir=config_dir,
            gateway=gateway,
            registry_base_url="https://api.trikhub.com",
        )

        mock_response = mock_httpx_response(
            {
                "triks": [
                    {
                        "name": "@test/trik",
                        "description": "A test trik",
                        "latestVersion": "1.0.0",
                        "totalDownloads": 100,
                        "verified": True,
                    }
                ],
                "total": 1,
                "hasMore": False,
            }
        )

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = await provider.search("test")
            assert len(result.triks) == 1
            assert result.triks[0].name == "@test/trik"
            assert result.triks[0].version == "1.0.0"
            assert result.triks[0].downloads == 100
            assert result.triks[0].verified is True
            assert result.total == 1
            assert result.hasMore is False


@pytest.mark.asyncio
async def test_search_raises_on_error():
    with tempfile.TemporaryDirectory() as config_dir:
        gateway = create_mock_gateway()
        provider = GatewayRegistryProvider(
            config_dir=config_dir,
            gateway=gateway,
        )

        mock_response = mock_httpx_response({}, status_code=500)

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            with pytest.raises(RuntimeError, match="Registry search failed: 500"):
                await provider.search("test")


@pytest.mark.asyncio
async def test_search_truncates_long_descriptions():
    with tempfile.TemporaryDirectory() as config_dir:
        gateway = create_mock_gateway()
        provider = GatewayRegistryProvider(
            config_dir=config_dir,
            gateway=gateway,
        )

        mock_response = mock_httpx_response(
            {
                "triks": [
                    {
                        "name": "@test/long",
                        "description": "x" * 500,
                        "latestVersion": "1.0.0",
                        "totalDownloads": 0,
                        "verified": False,
                    }
                ],
                "total": 1,
                "hasMore": False,
            }
        )

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = await provider.search("long")
            assert len(result.triks[0].description) == 200


# ============================================================================
# list
# ============================================================================


@pytest.mark.asyncio
async def test_list_returns_loaded_triks():
    with tempfile.TemporaryDirectory() as config_dir:
        manifest = SimpleNamespace(
            name="My Trik",
            version="2.1.0",
            description="A nice trik",
            agent=SimpleNamespace(mode="conversational"),
            capabilities=SimpleNamespace(
                session=SimpleNamespace(enabled=True),
                storage=SimpleNamespace(enabled=True, maxSizeBytes=1024),
                filesystem=None,
                shell=None,
                trikManagement=None,
            ),
        )
        loaded = SimpleNamespace(manifest=manifest, path="/some/path")
        gateway = create_mock_gateway({"@scope/my-trik": loaded})
        provider = GatewayRegistryProvider(
            config_dir=config_dir,
            gateway=gateway,
        )

        result = await provider.list()
        assert len(result) == 1
        assert result[0].id == "@scope/my-trik"
        assert result[0].name == "My Trik"
        assert result[0].version == "2.1.0"
        assert result[0].mode == "conversational"
        assert result[0].capabilities == ["session", "storage"]


@pytest.mark.asyncio
async def test_list_returns_empty_when_no_triks():
    with tempfile.TemporaryDirectory() as config_dir:
        gateway = create_mock_gateway()
        provider = GatewayRegistryProvider(
            config_dir=config_dir,
            gateway=gateway,
        )

        result = await provider.list()
        assert result == []


@pytest.mark.asyncio
async def test_list_includes_trik_management_capability():
    with tempfile.TemporaryDirectory() as config_dir:
        manifest = SimpleNamespace(
            name="Manager",
            version="1.0.0",
            description="Manages triks",
            agent=SimpleNamespace(mode="conversational"),
            capabilities=SimpleNamespace(
                session=None,
                storage=None,
                filesystem=None,
                shell=None,
                trikManagement=SimpleNamespace(enabled=True),
            ),
        )
        loaded = SimpleNamespace(manifest=manifest, path="/some/path")
        gateway = create_mock_gateway({"mgmt-trik": loaded})
        provider = GatewayRegistryProvider(
            config_dir=config_dir,
            gateway=gateway,
        )

        result = await provider.list()
        assert "trikManagement" in result[0].capabilities


# ============================================================================
# install
# ============================================================================


@pytest.mark.asyncio
async def test_install_returns_already_installed():
    with tempfile.TemporaryDirectory() as config_dir:
        manifest = SimpleNamespace(version="1.0.0")
        loaded = SimpleNamespace(manifest=manifest, path="/some/path")
        gateway = create_mock_gateway({"@test/trik": loaded})
        provider = GatewayRegistryProvider(
            config_dir=config_dir,
            gateway=gateway,
        )

        result = await provider.install("@test/trik")
        assert result.status == "already_installed"
        assert result.trikId == "@test/trik"
        assert result.version == "1.0.0"


@pytest.mark.asyncio
async def test_install_returns_failed_when_not_found():
    with tempfile.TemporaryDirectory() as config_dir:
        gateway = create_mock_gateway()
        provider = GatewayRegistryProvider(
            config_dir=config_dir,
            gateway=gateway,
        )

        mock_response = mock_httpx_response({}, status_code=404)

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = await provider.install("@test/unknown")
            assert result.status == "failed"
            assert "Trik not found" in (result.error or "")


@pytest.mark.asyncio
async def test_install_returns_failed_when_version_not_found():
    with tempfile.TemporaryDirectory() as config_dir:
        gateway = create_mock_gateway()
        provider = GatewayRegistryProvider(
            config_dir=config_dir,
            gateway=gateway,
        )

        mock_response = mock_httpx_response(
            {
                "latestVersion": "1.0.0",
                "versions": [{"version": "1.0.0", "gitTag": "v1.0.0"}],
            }
        )

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = await provider.install("@test/trik", "2.0.0")
            assert result.status == "failed"
            assert result.error == "Version not found"


# ============================================================================
# uninstall
# ============================================================================


@pytest.mark.asyncio
async def test_uninstall_returns_not_found():
    with tempfile.TemporaryDirectory() as config_dir:
        gateway = create_mock_gateway()
        provider = GatewayRegistryProvider(
            config_dir=config_dir,
            gateway=gateway,
        )

        result = await provider.uninstall("@test/unknown")
        assert result.status == "not_found"
        assert result.trikId == "@test/unknown"


@pytest.mark.asyncio
async def test_uninstall_removes_trik():
    with tempfile.TemporaryDirectory() as config_dir:
        config_path = Path(config_dir) / "config.json"
        config_path.write_text(json.dumps({"triks": ["@test/trik"]}))

        trik_dir = Path(config_dir) / "triks" / "@test" / "trik"
        trik_dir.mkdir(parents=True)
        (trik_dir / "manifest.json").write_text("{}")

        manifest = SimpleNamespace(version="1.0.0")
        loaded = SimpleNamespace(manifest=manifest, path=str(trik_dir))
        gateway = create_mock_gateway({"@test/trik": loaded})
        provider = GatewayRegistryProvider(
            config_dir=config_dir,
            gateway=gateway,
        )

        result = await provider.uninstall("@test/trik")
        assert result.status == "uninstalled"
        assert result.trikId == "@test/trik"
        gateway.unload_trik.assert_called_once_with("@test/trik")

        # Verify config updated
        config = json.loads(config_path.read_text())
        assert "@test/trik" not in config["triks"]

        # Verify directory removed
        assert not trik_dir.exists()


# ============================================================================
# upgrade
# ============================================================================


@pytest.mark.asyncio
async def test_upgrade_returns_not_found():
    with tempfile.TemporaryDirectory() as config_dir:
        gateway = create_mock_gateway()
        provider = GatewayRegistryProvider(
            config_dir=config_dir,
            gateway=gateway,
        )

        result = await provider.upgrade("@test/unknown")
        assert result.status == "not_found"
        assert result.previousVersion == ""
        assert result.newVersion == ""


@pytest.mark.asyncio
async def test_upgrade_returns_already_latest():
    with tempfile.TemporaryDirectory() as config_dir:
        manifest = SimpleNamespace(version="1.0.0")
        loaded = SimpleNamespace(manifest=manifest, path="/some/path")
        gateway = create_mock_gateway({"@test/trik": loaded})
        provider = GatewayRegistryProvider(
            config_dir=config_dir,
            gateway=gateway,
        )

        mock_response = mock_httpx_response({"latestVersion": "1.0.0"})

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = await provider.upgrade("@test/trik")
            assert result.status == "already_latest"
            assert result.previousVersion == "1.0.0"
            assert result.newVersion == "1.0.0"


@pytest.mark.asyncio
async def test_upgrade_returns_failed_on_registry_error():
    with tempfile.TemporaryDirectory() as config_dir:
        manifest = SimpleNamespace(version="1.0.0")
        loaded = SimpleNamespace(manifest=manifest, path="/some/path")
        gateway = create_mock_gateway({"@test/trik": loaded})
        provider = GatewayRegistryProvider(
            config_dir=config_dir,
            gateway=gateway,
        )

        mock_response = mock_httpx_response({}, status_code=500)

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = await provider.upgrade("@test/trik")
            assert result.status == "failed"
            assert result.error == "Registry fetch failed"


# ============================================================================
# get_info
# ============================================================================


@pytest.mark.asyncio
async def test_get_info_returns_trik_info():
    with tempfile.TemporaryDirectory() as config_dir:
        gateway = create_mock_gateway()
        provider = GatewayRegistryProvider(
            config_dir=config_dir,
            gateway=gateway,
        )

        mock_response = mock_httpx_response(
            {
                "name": "@test/trik",
                "description": "A test trik",
                "latestVersion": "2.0.0",
                "totalDownloads": 500,
                "verified": True,
                "versions": [
                    {
                        "version": "2.0.0",
                        "manifest": {"agent": {"mode": "conversational"}},
                    },
                    {
                        "version": "1.0.0",
                        "manifest": {"agent": {"mode": "conversational"}},
                    },
                ],
            }
        )

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = await provider.get_info("@test/trik")
            assert result is not None
            assert result.name == "@test/trik"
            assert result.latestVersion == "2.0.0"
            assert result.versions == ["2.0.0", "1.0.0"]
            assert result.downloads == 500
            assert result.verified is True
            assert result.mode == "conversational"


@pytest.mark.asyncio
async def test_get_info_returns_none_on_404():
    with tempfile.TemporaryDirectory() as config_dir:
        gateway = create_mock_gateway()
        provider = GatewayRegistryProvider(
            config_dir=config_dir,
            gateway=gateway,
        )

        mock_response = mock_httpx_response({}, status_code=404)

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = await provider.get_info("@test/unknown")
            assert result is None


@pytest.mark.asyncio
async def test_get_info_returns_none_on_exception():
    with tempfile.TemporaryDirectory() as config_dir:
        gateway = create_mock_gateway()
        provider = GatewayRegistryProvider(
            config_dir=config_dir,
            gateway=gateway,
        )

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get.side_effect = Exception("Network error")
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = await provider.get_info("@test/trik")
            assert result is None
