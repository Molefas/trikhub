"""
Registry client for TrikHub.

Connects to the TrikHub registry API to search and fetch triks.
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
    """Get the registry base URL based on environment."""
    # Allow explicit override via env var
    if env_url := os.environ.get("TRIKHUB_REGISTRY"):
        return env_url

    # Use TRIKHUB_ENV to determine environment
    is_dev = os.environ.get("TRIKHUB_ENV") == "development"
    return REGISTRY_URLS["development"] if is_dev else REGISTRY_URLS["production"]


# ============================================================================
# Data Types
# ============================================================================


@dataclass
class TrikVersion:
    """Version information for a trik."""

    version: str
    git_tag: str
    commit_sha: str
    published_at: str
    downloads: int = 0


@dataclass
class TrikInfo:
    """Information about a trik from the registry."""

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
    discussions_url: str = ""
    versions: list[TrikVersion] = field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""
    runtime: str = "node"  # 'node' or 'python'


@dataclass
class SearchResult:
    """Search result from the registry."""

    total: int
    page: int
    per_page: int
    results: list[TrikInfo]


# ============================================================================
# Registry Client
# ============================================================================


class RegistryClient:
    """Client for the TrikHub registry API."""

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
        """Get the base URL (evaluated fresh each time)."""
        return self._explicit_base_url or get_registry_url()

    @property
    def auth_token(self) -> str | None:
        """Get the auth token."""
        if self._explicit_auth_token:
            return self._explicit_auth_token
        # TODO: Load from config file
        return None

    async def close(self) -> None:
        """Close the HTTP client."""
        await self._client.aclose()

    async def __aenter__(self) -> "RegistryClient":
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()

    async def _fetch(
        self,
        path: str,
        method: str = "GET",
        json_data: dict[str, Any] | None = None,
    ) -> Any:
        """Make an API request."""
        url = f"{self.base_url}{path}"
        headers: dict[str, str] = {"Content-Type": "application/json"}

        if self.auth_token:
            headers["Authorization"] = f"Bearer {self.auth_token}"

        try:
            response = await self._client.request(
                method,
                url,
                headers=headers,
                json=json_data,
            )
        except httpx.ConnectError as e:
            raise ConnectionError(
                f"Failed to connect to registry at {self.base_url}: {e}"
            ) from e

        if response.status_code == 401:
            raise PermissionError("Authentication failed. Please run `trikhub login`")
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

    def _api_to_trik_info(
        self,
        api: dict[str, Any],
        versions: list[TrikVersion] | None = None,
    ) -> TrikInfo:
        """Convert API response to TrikInfo."""
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
            discussions_url=f"https://github.com/{api.get('githubRepo', '')}/discussions",
            versions=versions or [],
            created_at=api.get("createdAt", ""),
            updated_at=api.get("updatedAt", ""),
            runtime=api.get("runtime", "node"),
        )

    def _api_to_version(self, api: dict[str, Any]) -> TrikVersion:
        """Convert API version to TrikVersion."""
        return TrikVersion(
            version=api["version"],
            git_tag=api.get("gitTag", ""),
            commit_sha=api.get("commitSha", ""),
            published_at=api.get("publishedAt", ""),
            downloads=api.get("downloads", 0),
        )

    async def search(
        self,
        query: str,
        page: int = 1,
        per_page: int = 10,
        runtime: str | None = None,
    ) -> SearchResult:
        """Search for triks in the registry."""
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
        """Get detailed information about a specific trik."""
        try:
            result = await self._fetch(f"/api/v1/triks/{full_name}")
            versions = [self._api_to_version(v) for v in result.get("versions", [])]
            return self._api_to_trik_info(result, versions)
        except FileNotFoundError:
            return None

    async def get_trik_version(
        self,
        full_name: str,
        version: str,
    ) -> TrikVersion | None:
        """Get a specific version of a trik."""
        trik = await self.get_trik(full_name)
        if not trik:
            return None

        for v in trik.versions:
            if v.version == version:
                return v
        return None

    async def list_triks(
        self,
        page: int = 1,
        per_page: int = 10,
        runtime: str | None = None,
    ) -> SearchResult:
        """List all available triks (paginated)."""
        params = f"page={page}&pageSize={per_page}"
        if runtime:
            params += f"&runtime={runtime}"

        result = await self._fetch(f"/api/v1/triks?{params}")

        return SearchResult(
            total=result.get("total", 0),
            page=result.get("page", 1),
            per_page=result.get("pageSize", per_page),
            results=[self._api_to_trik_info(t) for t in result.get("triks", [])],
        )

    async def report_download(self, full_name: str, version: str) -> None:
        """Report a download (for analytics)."""
        try:
            await self._fetch(
                f"/api/v1/triks/{full_name}/download",
                method="POST",
                json_data={"version": version},
            )
        except Exception:
            # Silently fail analytics - don't break the install
            pass


# Default registry client instance
_registry: RegistryClient | None = None


def get_registry() -> RegistryClient:
    """Get the default registry client instance."""
    global _registry
    if _registry is None:
        _registry = RegistryClient()
    return _registry
