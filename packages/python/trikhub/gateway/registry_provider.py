"""
Gateway Registry Provider — implements TrikRegistryContext.

Provides search, install, uninstall, upgrade, list, and getInfo operations
by proxying to the TrikHub registry API and the local gateway.

Mirrors packages/js/gateway/src/registry-provider.ts.
"""

from __future__ import annotations

import asyncio
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol

import httpx

from trikhub.manifest.types import (
    InstalledTrikInfo,
    TrikDetailInfo,
    TrikInstallResult,
    TrikSearchResult,
    TrikSearchResultItem,
    TrikUninstallResult,
    TrikUpgradeResult,
)


class RegistryProviderGateway(Protocol):
    """Interface for gateway operations needed by the registry provider."""

    def get_loaded_triks(self) -> dict[str, Any]: ...
    async def load_trik(self, path: str) -> Any: ...
    def unload_trik(self, trik_id: str) -> bool: ...


class GatewayRegistryProvider:
    """Implements TrikRegistryContext — provides trik management operations."""

    def __init__(
        self,
        config_dir: str,
        gateway: RegistryProviderGateway,
        registry_base_url: str = "https://api.trikhub.com",
    ) -> None:
        self._base_url = registry_base_url
        self._config_dir = Path(config_dir)
        self._gateway = gateway

    async def search(
        self, query: str, page: int = 1, page_size: int = 10
    ) -> TrikSearchResult:
        url = f"{self._base_url}/api/v1/triks"
        params = {"q": query, "page": str(page), "pageSize": str(page_size)}

        async with httpx.AsyncClient() as client:
            res = await client.get(url, params=params)
            if res.status_code != 200:
                raise RuntimeError(f"Registry search failed: {res.status_code}")

            data = res.json()
            return TrikSearchResult(
                triks=[
                    TrikSearchResultItem(
                        name=t.get("name", ""),
                        description=t.get("description", "")[:200],
                        version=t.get("latestVersion", "0.0.0"),
                        downloads=t.get("totalDownloads", 0),
                        verified=t.get("verified", False),
                    )
                    for t in data.get("triks", [])
                ],
                total=data.get("total", 0),
                hasMore=data.get("hasMore", False),
            )

    async def list(self) -> list[InstalledTrikInfo]:
        triks = self._gateway.get_loaded_triks()
        result: list[InstalledTrikInfo] = []

        for trik_id, loaded in triks.items():
            m = loaded.manifest
            caps: list[str] = []
            if m.capabilities:
                if getattr(m.capabilities.session, "enabled", False):
                    caps.append("session")
                if getattr(m.capabilities.storage, "enabled", False):
                    caps.append("storage")
                if getattr(m.capabilities.filesystem, "enabled", False):
                    caps.append("filesystem")
                if getattr(m.capabilities.shell, "enabled", False):
                    caps.append("shell")
                if getattr(m.capabilities.trikManagement, "enabled", False):
                    caps.append("trikManagement")

            result.append(
                InstalledTrikInfo(
                    id=trik_id,
                    name=getattr(m, "name", trik_id) or trik_id,
                    version=getattr(m, "version", "0.0.0") or "0.0.0",
                    mode=getattr(getattr(m, "agent", None), "mode", "tool") or "tool",
                    description=(getattr(m, "description", "") or "")[:200],
                    capabilities=caps,
                )
            )

        return result

    async def install(
        self, trik_id: str, version: str | None = None
    ) -> TrikInstallResult:
        loaded_triks = self._gateway.get_loaded_triks()
        if trik_id in loaded_triks:
            existing = loaded_triks[trik_id]
            return TrikInstallResult(
                status="already_installed",
                trikId=trik_id,
                version=getattr(existing.manifest, "version", "0.0.0") or "0.0.0",
            )

        try:
            async with httpx.AsyncClient() as client:
                res = await client.get(
                    f"{self._base_url}/api/v1/triks/{trik_id}"
                )
                if res.status_code != 200:
                    return TrikInstallResult(
                        status="failed",
                        trikId=trik_id,
                        version="",
                        error=f"Trik not found: {trik_id}",
                    )
                trik_info = res.json()

            versions = trik_info.get("versions", [])
            target = None
            if version:
                target = next(
                    (v for v in versions if v["version"] == version), None
                )
            else:
                target = next(
                    (
                        v
                        for v in versions
                        if v["version"] == trik_info.get("latestVersion")
                    ),
                    None,
                )

            if not target:
                return TrikInstallResult(
                    status="failed",
                    trikId=trik_id,
                    version=version or "",
                    error="Version not found",
                )

            trik_dir = self._get_trik_dir(trik_id)
            trik_dir.mkdir(parents=True, exist_ok=True)

            git_url = f"https://github.com/{trik_info['githubRepo']}.git"
            proc = await asyncio.create_subprocess_exec(
                "git",
                "clone",
                "--depth",
                "1",
                "--branch",
                target["gitTag"],
                git_url,
                str(trik_dir),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await proc.communicate()
            if proc.returncode != 0:
                raise RuntimeError(
                    f"git clone failed: {stderr.decode()[:200]}"
                )

            git_dir = trik_dir / ".git"
            if git_dir.exists():
                shutil.rmtree(git_dir)

            # Write identity file for trusted scoped name
            identity_path = trik_dir / ".trikhub-identity.json"
            identity = {
                "scopedName": trik_id,
                "installedAt": datetime.now(timezone.utc).isoformat(),
            }
            identity_path.write_text(json.dumps(identity, indent=2))

            self._add_to_config(trik_id)
            await self._gateway.load_trik(str(trik_dir))

            return TrikInstallResult(
                status="installed",
                trikId=trik_id,
                version=target["version"],
            )
        except Exception as e:
            return TrikInstallResult(
                status="failed",
                trikId=trik_id,
                version=version or "",
                error=str(e)[:200],
            )

    async def uninstall(self, trik_id: str) -> TrikUninstallResult:
        if trik_id not in self._gateway.get_loaded_triks():
            return TrikUninstallResult(status="not_found", trikId=trik_id)

        try:
            self._gateway.unload_trik(trik_id)

            trik_dir = self._get_trik_dir(trik_id)
            if trik_dir.exists():
                shutil.rmtree(trik_dir)

            self._remove_from_config(trik_id)

            return TrikUninstallResult(status="uninstalled", trikId=trik_id)
        except Exception as e:
            return TrikUninstallResult(
                status="failed",
                trikId=trik_id,
                error=str(e)[:200],
            )

    async def upgrade(
        self, trik_id: str, version: str | None = None
    ) -> TrikUpgradeResult:
        loaded = self._gateway.get_loaded_triks().get(trik_id)
        if not loaded:
            return TrikUpgradeResult(
                status="not_found",
                trikId=trik_id,
                previousVersion="",
                newVersion="",
            )

        previous_version = getattr(loaded.manifest, "version", "0.0.0") or "0.0.0"

        try:
            async with httpx.AsyncClient() as client:
                res = await client.get(
                    f"{self._base_url}/api/v1/triks/{trik_id}"
                )
                if res.status_code != 200:
                    return TrikUpgradeResult(
                        status="failed",
                        trikId=trik_id,
                        previousVersion=previous_version,
                        newVersion="",
                        error="Registry fetch failed",
                    )
                trik_info = res.json()

            target_version = version or trik_info.get("latestVersion", "")

            if target_version == previous_version:
                return TrikUpgradeResult(
                    status="already_latest",
                    trikId=trik_id,
                    previousVersion=previous_version,
                    newVersion=previous_version,
                )

            # Uninstall then reinstall
            await self.uninstall(trik_id)
            install_result = await self.install(trik_id, target_version)

            if install_result.status == "failed":
                return TrikUpgradeResult(
                    status="failed",
                    trikId=trik_id,
                    previousVersion=previous_version,
                    newVersion=target_version,
                    error=install_result.error,
                )

            return TrikUpgradeResult(
                status="upgraded",
                trikId=trik_id,
                previousVersion=previous_version,
                newVersion=target_version,
            )
        except Exception as e:
            return TrikUpgradeResult(
                status="failed",
                trikId=trik_id,
                previousVersion=previous_version,
                newVersion=version or "",
                error=str(e)[:200],
            )

    async def get_info(self, trik_id: str) -> TrikDetailInfo | None:
        try:
            async with httpx.AsyncClient() as client:
                res = await client.get(
                    f"{self._base_url}/api/v1/triks/{trik_id}"
                )
                if res.status_code != 200:
                    return None

                data = res.json()
                return TrikDetailInfo(
                    name=data.get("name", ""),
                    description=data.get("description", "")[:200],
                    latestVersion=data.get("latestVersion", "0.0.0"),
                    versions=[v["version"] for v in data.get("versions", [])],
                    downloads=data.get("totalDownloads", 0),
                    verified=data.get("verified", False),
                    mode=data.get("versions", [{}])[0]
                    .get("manifest", {})
                    .get("agent", {})
                    .get("mode", "tool")
                    if data.get("versions")
                    else "tool",
                )
        except Exception:
            return None

    # --------------------------------------------------------------------------
    # Private helpers
    # --------------------------------------------------------------------------

    def _get_trik_dir(self, trik_id: str) -> Path:
        if trik_id.startswith("@"):
            scope, name = trik_id.split("/", 1)
            return self._config_dir / "triks" / scope / name
        return self._config_dir / "triks" / trik_id

    def _add_to_config(self, trik_id: str) -> None:
        config_path = self._config_dir / "config.json"
        if config_path.exists():
            config = json.loads(config_path.read_text())
        else:
            config = {"triks": []}

        if trik_id not in config["triks"]:
            config["triks"].append(trik_id)
        config_path.write_text(json.dumps(config, indent=2))

    def _remove_from_config(self, trik_id: str) -> None:
        config_path = self._config_dir / "config.json"
        if not config_path.exists():
            return

        config = json.loads(config_path.read_text())
        config["triks"] = [t for t in config.get("triks", []) if t != trik_id]
        config_path.write_text(json.dumps(config, indent=2))
