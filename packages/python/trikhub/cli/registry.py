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
# Auth Data Types
# ============================================================================


@dataclass
class DeviceAuthResponse:
    """Device authorization response from registry."""

    device_code: str
    user_code: str
    verification_url: str
    expires_in: int
    interval: int


@dataclass
class Publisher:
    """Publisher information from the registry."""

    id: int
    username: str
    display_name: str
    avatar_url: str
    verified: bool
    created_at: str


@dataclass
class AuthResult:
    """Auth result after successful device flow."""

    access_token: str
    expires_at: str
    publisher: Publisher


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
        # Load from global config
        from .config import read_global_config
        config = read_global_config()
        return config.auth_token

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

    def _extract_runtime(self, api: dict[str, Any]) -> str:
        """Extract runtime from API response, checking manifest if needed."""
        # Check top-level runtime first
        if runtime := api.get("runtime"):
            return runtime

        # Check manifest.entry.runtime in versions (latest version first)
        versions = api.get("versions", [])
        if versions:
            manifest = versions[0].get("manifest", {})
            entry = manifest.get("entry", {})
            if runtime := entry.get("runtime"):
                return runtime

        return "node"  # Default fallback

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
            runtime=self._extract_runtime(api),
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

    # ========================================================================
    # Authentication Methods
    # ========================================================================

    async def start_device_auth(self) -> DeviceAuthResponse:
        """Start device authorization flow.

        Returns device_code for polling and user_code for user to enter.
        """
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
            raise RuntimeError(f"Failed to start authentication: {response.status_code} - {message}")

        data = response.json()
        return DeviceAuthResponse(
            device_code=data["deviceCode"],
            user_code=data["userCode"],
            verification_url=data["verificationUrl"],
            expires_in=data["expiresIn"],
            interval=data.get("interval", 5),
        )

    async def poll_device_auth(self, device_code: str) -> AuthResult | None:
        """Poll for device authorization completion.

        Returns None if still pending, AuthResult when complete.
        """
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
            # Still pending
            return None

        if not response.is_success:
            try:
                data = response.json()
                message = data.get("error") or response.text
            except Exception:
                message = response.text
            raise RuntimeError(f"Authentication failed: {response.status_code} - {message}")

        data = response.json()
        publisher_data = data["publisher"]
        return AuthResult(
            access_token=data["accessToken"],
            expires_at=data["expiresAt"],
            publisher=Publisher(
                id=publisher_data["id"],
                username=publisher_data["username"],
                display_name=publisher_data["displayName"],
                avatar_url=publisher_data["avatarUrl"],
                verified=publisher_data.get("verified", False),
                created_at=publisher_data["createdAt"],
            ),
        )

    async def get_current_user(self) -> Publisher:
        """Get the current authenticated user."""
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
        """Logout (invalidate session)."""
        if not self.auth_token:
            return
        await self._fetch("/auth/logout", method="POST")

    # ========================================================================
    # Publishing Methods
    # ========================================================================

    async def register_trik(
        self,
        github_repo: str,
        name: str | None = None,
        description: str | None = None,
        categories: list[str] | None = None,
        keywords: list[str] | None = None,
    ) -> TrikInfo:
        """Register a new trik in the registry."""
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
        """Publish a new version of a trik."""
        if not self.auth_token:
            raise PermissionError("Not authenticated. Please run `trik login`")

        json_data = {
            "version": version,
            "gitTag": git_tag,
            "commitSha": commit_sha,
            "manifest": manifest,
        }

        result = await self._fetch(
            f"/api/v1/triks/{full_name}/versions",
            method="POST",
            json_data=json_data,
        )
        return self._api_to_version(result)

    async def delete_trik(self, full_name: str) -> None:
        """Delete a trik from the registry (unpublish).

        Args:
            full_name: Full trik name (e.g., "@scope/name")

        Raises:
            PermissionError: If not authenticated
            FileNotFoundError: If trik not found
            RuntimeError: On API errors
        """
        if not self.auth_token:
            raise PermissionError("Not authenticated. Please run `trik login`")

        await self._fetch(f"/api/v1/triks/{full_name}", method="DELETE")


# Default registry client instance
_registry: RegistryClient | None = None


def get_registry() -> RegistryClient:
    """Get the default registry client instance."""
    global _registry
    if _registry is None:
        _registry = RegistryClient()
    return _registry
