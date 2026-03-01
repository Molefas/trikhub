"""Tests for the create-agent template generators."""

from __future__ import annotations

import json

import pytest

from trikhub.cli.templates.agent_typescript import (
    CreateAgentConfig,
    generate_agent_typescript_project,
)
from trikhub.cli.templates.agent_python import generate_agent_python_project


PROVIDERS = ["openai", "anthropic", "google"]


# ============================================================================
# TypeScript target
# ============================================================================


class TestAgentTypescriptProject:
    def test_generates_all_expected_files(self) -> None:
        files = generate_agent_typescript_project(
            CreateAgentConfig(name="my-agent", provider="openai")
        )
        paths = [f.path for f in files]

        assert "package.json" in paths
        assert "tsconfig.json" in paths
        assert ".env.example" in paths
        assert ".gitignore" in paths
        assert ".trikhub/config.json" in paths
        assert "src/agent.ts" in paths
        assert "src/cli.ts" in paths
        assert len(files) == 7

    def test_empty_trikhub_config(self) -> None:
        files = generate_agent_typescript_project(
            CreateAgentConfig(name="my-agent", provider="openai")
        )
        config_file = next(f for f in files if f.path == ".trikhub/config.json")
        config = json.loads(config_file.content)
        assert config == {"triks": []}

    @pytest.mark.parametrize("provider", PROVIDERS)
    def test_correct_imports_per_provider(self, provider: str) -> None:
        files = generate_agent_typescript_project(
            CreateAgentConfig(name="test-agent", provider=provider)
        )
        agent = next(f for f in files if f.path == "src/agent.ts").content

        if provider == "openai":
            assert "@langchain/openai" in agent
            assert "ChatOpenAI" in agent
            assert "gpt-4o-mini" in agent
        elif provider == "anthropic":
            assert "@langchain/anthropic" in agent
            assert "ChatAnthropic" in agent
            assert "claude-sonnet-4-20250514" in agent
        elif provider == "google":
            assert "@langchain/google-genai" in agent
            assert "ChatGoogleGenerativeAI" in agent
            assert "gemini-2.0-flash" in agent

    @pytest.mark.parametrize("provider", PROVIDERS)
    def test_correct_package_json_deps(self, provider: str) -> None:
        files = generate_agent_typescript_project(
            CreateAgentConfig(name="test-agent", provider=provider)
        )
        pkg = json.loads(next(f for f in files if f.path == "package.json").content)
        deps = pkg["dependencies"]

        assert "@trikhub/gateway" in deps
        assert "dotenv" in deps
        assert "@langchain/core" in deps
        assert "@langchain/langgraph" in deps

        if provider == "openai":
            assert "@langchain/openai" in deps
        elif provider == "anthropic":
            assert "@langchain/anthropic" in deps
        elif provider == "google":
            assert "@langchain/google-genai" in deps

    @pytest.mark.parametrize("provider", PROVIDERS)
    def test_correct_env_example(self, provider: str) -> None:
        files = generate_agent_typescript_project(
            CreateAgentConfig(name="test-agent", provider=provider)
        )
        env = next(f for f in files if f.path == ".env.example").content

        if provider == "openai":
            assert "OPENAI_API_KEY" in env
        elif provider == "anthropic":
            assert "ANTHROPIC_API_KEY" in env
        elif provider == "google":
            assert "GOOGLE_API_KEY" in env

    def test_uses_project_name(self) -> None:
        files = generate_agent_typescript_project(
            CreateAgentConfig(name="cool-agent", provider="openai")
        )
        pkg = json.loads(next(f for f in files if f.path == "package.json").content)
        assert pkg["name"] == "cool-agent"

    def test_includes_gateway_imports(self) -> None:
        files = generate_agent_typescript_project(
            CreateAgentConfig(name="my-agent", provider="openai")
        )
        agent = next(f for f in files if f.path == "src/agent.ts").content

        assert "@trikhub/gateway" in agent
        assert "@trikhub/gateway/langchain" in agent
        assert "TrikGateway" in agent
        assert "enhance" in agent
        assert "getHandoffToolsForAgent" in agent
        assert "getExposedToolsForAgent" in agent


# ============================================================================
# Python target
# ============================================================================


class TestAgentPythonProject:
    def test_generates_all_expected_files(self) -> None:
        files = generate_agent_python_project(
            CreateAgentConfig(name="my-agent", provider="openai")
        )
        paths = [f.path for f in files]

        assert "pyproject.toml" in paths
        assert ".env.example" in paths
        assert ".gitignore" in paths
        assert ".trikhub/config.json" in paths
        assert "agent.py" in paths
        assert "cli.py" in paths
        assert len(files) == 6

    def test_empty_trikhub_config(self) -> None:
        files = generate_agent_python_project(
            CreateAgentConfig(name="my-agent", provider="openai")
        )
        config_file = next(f for f in files if f.path == ".trikhub/config.json")
        config = json.loads(config_file.content)
        assert config == {"triks": []}

    @pytest.mark.parametrize("provider", PROVIDERS)
    def test_correct_imports_per_provider(self, provider: str) -> None:
        files = generate_agent_python_project(
            CreateAgentConfig(name="test-agent", provider=provider)
        )
        agent = next(f for f in files if f.path == "agent.py").content

        if provider == "openai":
            assert "from langchain_openai import ChatOpenAI" in agent
            assert "gpt-4o-mini" in agent
        elif provider == "anthropic":
            assert "from langchain_anthropic import ChatAnthropic" in agent
            assert "claude-sonnet-4-20250514" in agent
        elif provider == "google":
            assert "from langchain_google_genai import ChatGoogleGenerativeAI" in agent
            assert "gemini-2.0-flash" in agent

    @pytest.mark.parametrize("provider", PROVIDERS)
    def test_correct_pyproject_deps(self, provider: str) -> None:
        files = generate_agent_python_project(
            CreateAgentConfig(name="test-agent", provider=provider)
        )
        toml = next(f for f in files if f.path == "pyproject.toml").content

        assert "trikhub" in toml
        assert "python-dotenv" in toml
        assert "langgraph" in toml

        if provider == "openai":
            assert "langchain-openai" in toml
        elif provider == "anthropic":
            assert "langchain-anthropic" in toml
        elif provider == "google":
            assert "langchain-google-genai" in toml

    @pytest.mark.parametrize("provider", PROVIDERS)
    def test_correct_env_example(self, provider: str) -> None:
        files = generate_agent_python_project(
            CreateAgentConfig(name="test-agent", provider=provider)
        )
        env = next(f for f in files if f.path == ".env.example").content

        if provider == "openai":
            assert "OPENAI_API_KEY" in env
        elif provider == "anthropic":
            assert "ANTHROPIC_API_KEY" in env
        elif provider == "google":
            assert "GOOGLE_API_KEY" in env

    def test_uses_project_name(self) -> None:
        files = generate_agent_python_project(
            CreateAgentConfig(name="cool-agent", provider="openai")
        )
        toml = next(f for f in files if f.path == "pyproject.toml").content
        assert 'name = "cool-agent"' in toml

    def test_includes_gateway_imports(self) -> None:
        files = generate_agent_python_project(
            CreateAgentConfig(name="my-agent", provider="openai")
        )
        agent = next(f for f in files if f.path == "agent.py").content

        assert "from trikhub.gateway import TrikGateway" in agent
        assert "from trikhub.langchain import enhance" in agent
        assert "get_handoff_tools_for_agent" in agent
        assert "get_exposed_tools_for_agent" in agent

    def test_cli_includes_process_message(self) -> None:
        files = generate_agent_python_project(
            CreateAgentConfig(name="my-agent", provider="openai")
        )
        cli = next(f for f in files if f.path == "cli.py").content

        assert "process_message" in cli
        assert "from dotenv import load_dotenv" in cli
        assert "asyncio" in cli
