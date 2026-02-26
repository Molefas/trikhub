"""Registry client for TrikHub.

Connects to the TrikHub registry API to search, install, and publish triks.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any

import httpx


# ============================================================================
# Constants
# ============================================================================

REGISTRY_URLS = {
    "production": "https://api.trikhub.com",
    "development": "http://localhost:3001",
}


def get_registry_url() -> str:
    if env_url := os.environ.get("TRIKHUB_REGISTRY"):
        return env_url
    is_dev = os.environ.get("TRIKHUB_ENV") == "development"
    return REGISTRY_URLS["development"] if is_dev else REGISTRY_URLS["production"]


# ============================================================================
# Data Types
# ============================================================================


@dataclass
class TrikVersion:
    version: str
    git_tag: str
    commit_sha: str
    published_at: str
    downloads: int = 0


@dataclass
class TrikInfo:
    full_name: str
    scope: str
    name: str
    github_repo: str
    latest_version: str
    description: str = ""
    categories: list[str] = field(default_factory=list)
    keywords: list[str] = field(default_factory=list)
    downloads: int = 0
    stars: int = 0
    verified: bool = False
    versions: list[TrikVersion] = field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""
    runtime: str = "node"


@dataclass
class SearchResult:
    total: int
    page: int
    per_page: int
    results: list[TrikInfo]


@dataclass
class DeviceAuthResponse:
    device_code: str
    user_code: str
    verification_url: str
    expires_in: int
    interval: int


@dataclass
class Publisher:
    id: int
    username: str
    display_name: str
    avatar_url: str
    verified: bool
    created_at: str


@dataclass
class AuthResult:
    access_token: str
    expires_at: str
    publisher: Publisher


# ============================================================================
# Registry Client
# ============================================================================


class RegistryClient:

    def __init__(
        self,
        base_url: str | None = None,
        auth_token: str | None = None,
    ):
        self._explicit_base_url = base_url
        self._explicit_auth_token = auth_token
        self._client = httpx.AsyncClient(timeout=30.0)

    @property
    def base_url(self) -> str:
        return self._explicit_base_url or get_registry_url()

    @property
    def auth_token(self) -> str | None:
        if self._explicit_auth_token:
            return self._explicit_auth_token
        from .config import read_global_config

        config = read_global_config()
        return config.auth_token

    async def close(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> RegistryClient:
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()

    async def _fetch(
        self,
        path: str,
        method: str = "GET",
        json_data: dict[str, Any] | None = None,
    ) -> Any:
        url = f"{self.base_url}{path}"
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self.auth_token:
            headers["Authorization"] = f"Bearer {self.auth_token}"
        try:
            response = await self._client.request(
                method, url, headers=headers, json=json_data,
            )
        except httpx.ConnectError as e:
            raise ConnectionError(
                f"Failed to connect to registry at {self.base_url}: {e}"
            ) from e

        if response.status_code == 401:
            raise PermissionError("Authentication failed. Please run `trik login`")
        if response.status_code == 404:
            raise FileNotFoundError(f"Not found: {path}")
        if not response.is_success:
            try:
                data = response.json()
                message = data.get("error", response.text)
            except Exception:
                message = response.text
            raise RuntimeError(f"Registry API error: {response.status_code} - {message}")
        return response.json()

    def _extract_runtime(self, api: dict[str, Any]) -> str:
        if runtime := api.get("runtime"):
            return runtime
        versions = api.get("versions", [])
        if versions:
            manifest = versions[0].get("manifest", {})
            entry = manifest.get("entry", {})
            if runtime := entry.get("runtime"):
                return runtime
        return "node"

    def _api_to_trik_info(
        self, api: dict[str, Any], versions: list[TrikVersion] | None = None,
    ) -> TrikInfo:
        return TrikInfo(
            full_name=api["name"],
            scope=api.get("scope", ""),
            name=api.get("shortName", api["name"]),
            github_repo=api.get("githubRepo", ""),
            latest_version=api.get("latestVersion", "0.0.0"),
            description=api.get("description", ""),
            categories=api.get("categories", []),
            keywords=api.get("keywords", []),
            downloads=api.get("totalDownloads", 0),
            stars=api.get("githubStars", 0),
            verified=api.get("verified", False),
            versions=versions or [],
            created_at=api.get("createdAt", ""),
            updated_at=api.get("updatedAt", ""),
            runtime=self._extract_runtime(api),
        )

    def _api_to_version(self, api: dict[str, Any]) -> TrikVersion:
        return TrikVersion(
            version=api["version"],
            git_tag=api.get("gitTag", ""),
            commit_sha=api.get("commitSha", ""),
            published_at=api.get("publishedAt", ""),
            downloads=api.get("downloads", 0),
        )

    # -- Search / Info -------------------------------------------------------

    async def search(
        self, query: str, page: int = 1, per_page: int = 10, runtime: str | None = None,
    ) -> SearchResult:
        params = f"q={query}&page={page}&pageSize={per_page}"
        if runtime:
            params += f"&runtime={runtime}"
        result = await self._fetch(f"/api/v1/triks?{params}")
        return SearchResult(
            total=result.get("total", 0),
            page=result.get("page", 1),
            per_page=result.get("pageSize", per_page),
            results=[self._api_to_trik_info(t) for t in result.get("triks", [])],
        )

    async def get_trik(self, full_name: str) -> TrikInfo | None:
        try:
            result = await self._fetch(f"/api/v1/triks/{full_name}")
            versions = [self._api_to_version(v) for v in result.get("versions", [])]
            return self._api_to_trik_info(result, versions)
        except FileNotFoundError:
            return None

    async def report_download(self, full_name: str, version: str) -> None:
        try:
            await self._fetch(
                f"/api/v1/triks/{full_name}/download",
                method="POST",
                json_data={"version": version},
            )
        except Exception:
            pass

    # -- Auth ----------------------------------------------------------------

    async def start_device_auth(self) -> DeviceAuthResponse:
        try:
            response = await self._client.get(f"{self.base_url}/auth/device")
        except httpx.ConnectError as e:
            raise ConnectionError(
                f"Failed to connect to registry at {self.base_url}: {e}"
            ) from e
        if not response.is_success:
            try:
                data = response.json()
                message = data.get("error") or data.get("message") or response.text
            except Exception:
                message = response.text
            raise RuntimeError(
                f"Failed to start authentication: {response.status_code} - {message}"
            )
        data = response.json()
        return DeviceAuthResponse(
            device_code=data["deviceCode"],
            user_code=data["userCode"],
            verification_url=data["verificationUrl"],
            expires_in=data["expiresIn"],
            interval=data.get("interval", 5),
        )

    async def poll_device_auth(self, device_code: str) -> AuthResult | None:
        try:
            response = await self._client.post(
                f"{self.base_url}/auth/device/poll",
                json={"deviceCode": device_code},
            )
        except httpx.ConnectError as e:
            raise ConnectionError(
                f"Failed to connect to registry at {self.base_url}: {e}"
            ) from e
        if response.status_code == 202:
            return None
        if not response.is_success:
            try:
                data = response.json()
                message = data.get("error") or response.text
            except Exception:
                message = response.text
            raise RuntimeError(f"Authentication failed: {response.status_code} - {message}")
        data = response.json()
        pub = data["publisher"]
        return AuthResult(
            access_token=data["accessToken"],
            expires_at=data["expiresAt"],
            publisher=Publisher(
                id=pub["id"],
                username=pub["username"],
                display_name=pub["displayName"],
                avatar_url=pub["avatarUrl"],
                verified=pub.get("verified", False),
                created_at=pub["createdAt"],
            ),
        )

    async def get_current_user(self) -> Publisher:
        if not self.auth_token:
            raise PermissionError("Not authenticated. Please run `trik login`")
        data = await self._fetch("/auth/me")
        return Publisher(
            id=data["id"],
            username=data["username"],
            display_name=data["displayName"],
            avatar_url=data["avatarUrl"],
            verified=data.get("verified", False),
            created_at=data["createdAt"],
        )

    async def logout(self) -> None:
        if not self.auth_token:
            return
        try:
            await self._fetch("/auth/logout", method="POST")
        except Exception:
            pass

    # -- Publishing ----------------------------------------------------------

    async def register_trik(
        self,
        github_repo: str,
        name: str | None = None,
        description: str | None = None,
        categories: list[str] | None = None,
        keywords: list[str] | None = None,
    ) -> TrikInfo:
        if not self.auth_token:
            raise PermissionError("Not authenticated. Please run `trik login`")
        json_data: dict[str, Any] = {"githubRepo": github_repo}
        if name:
            json_data["name"] = name
        if description:
            json_data["description"] = description
        if categories:
            json_data["categories"] = categories
        if keywords:
            json_data["keywords"] = keywords
        result = await self._fetch("/api/v1/triks", method="POST", json_data=json_data)
        return self._api_to_trik_info(result)

    async def publish_version(
        self,
        full_name: str,
        version: str,
        git_tag: str,
        commit_sha: str,
        manifest: dict[str, Any],
    ) -> TrikVersion:
        if not self.auth_token:
            raise PermissionError("Not authenticated. Please run `trik login`")
        result = await self._fetch(
            f"/api/v1/triks/{full_name}/versions",
            method="POST",
            json_data={
                "version": version,
                "gitTag": git_tag,
                "commitSha": commit_sha,
                "manifest": manifest,
            },
        )
        return self._api_to_version(result)

    async def delete_trik(self, full_name: str) -> None:
        if not self.auth_token:
            raise PermissionError("Not authenticated. Please run `trik login`")
        await self._fetch(f"/api/v1/triks/{full_name}", method="DELETE")


_registry: RegistryClient | None = None


def get_registry() -> RegistryClient:
    global _registry
    if _registry is None:
        _registry = RegistryClient()
    return _registry
