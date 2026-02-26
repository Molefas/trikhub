"""Tests for registry client."""

from __future__ import annotations

import pytest

from trikhub.cli.registry import (
    RegistryClient,
    get_registry_url,
)


class TestRegistryUrl:
    def test_default_production(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.delenv("TRIKHUB_REGISTRY", raising=False)
        monkeypatch.delenv("TRIKHUB_ENV", raising=False)
        assert get_registry_url() == "https://api.trikhub.com"

    def test_development(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.delenv("TRIKHUB_REGISTRY", raising=False)
        monkeypatch.setenv("TRIKHUB_ENV", "development")
        assert get_registry_url() == "http://localhost:3001"

    def test_explicit_override(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("TRIKHUB_REGISTRY", "https://custom.example.com")
        assert get_registry_url() == "https://custom.example.com"


class TestRegistryClient:
    def test_base_url_default(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.delenv("TRIKHUB_REGISTRY", raising=False)
        monkeypatch.delenv("TRIKHUB_ENV", raising=False)
        client = RegistryClient()
        assert client.base_url == "https://api.trikhub.com"

    def test_base_url_explicit(self):
        client = RegistryClient(base_url="https://custom.test")
        assert client.base_url == "https://custom.test"

    def test_auth_token_explicit(self):
        client = RegistryClient(auth_token="test-token")
        assert client.auth_token == "test-token"

    def test_extract_runtime_from_top_level(self):
        client = RegistryClient()
        assert client._extract_runtime({"runtime": "python"}) == "python"

    def test_extract_runtime_from_manifest(self):
        client = RegistryClient()
        api = {
            "versions": [{"manifest": {"entry": {"runtime": "python"}}}],
        }
        assert client._extract_runtime(api) == "python"

    def test_extract_runtime_default_node(self):
        client = RegistryClient()
        assert client._extract_runtime({}) == "node"

    def test_api_to_trik_info(self):
        client = RegistryClient()
        info = client._api_to_trik_info({
            "name": "@testuser/test-trik",
            "scope": "testuser",
            "shortName": "test-trik",
            "githubRepo": "testuser/test-trik",
            "latestVersion": "1.0.0",
            "description": "A test trik",
            "totalDownloads": 42,
        })

        assert info.full_name == "@testuser/test-trik"
        assert info.latest_version == "1.0.0"
        assert info.downloads == 42

    def test_api_to_version(self):
        client = RegistryClient()
        version = client._api_to_version({
            "version": "1.0.0",
            "gitTag": "v1.0.0",
            "commitSha": "abc123",
            "publishedAt": "2026-01-01T00:00:00Z",
            "downloads": 10,
        })

        assert version.version == "1.0.0"
        assert version.git_tag == "v1.0.0"
        assert version.commit_sha == "abc123"
