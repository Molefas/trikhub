"""Tests for v2 template generators."""

from __future__ import annotations

import json

import pytest

from trikhub.cli.templates.python import (
    PyTemplateConfig,
    generate_python_project,
)
from trikhub.cli.templates.typescript import (
    TsTemplateConfig,
    generate_typescript_project,
)


def _make_py_config(**overrides) -> PyTemplateConfig:
    defaults = {
        "name": "test-trik",
        "display_name": "Test Trik",
        "description": "A test trik",
        "author_name": "Test User",
        "author_github": "testuser",
        "category": "utilities",
        "enable_storage": False,
        "enable_config": False,
        "agent_mode": "conversational",
        "handoff_description": "A conversational test trik",
        "domain_tags": ["testing"],
        "tool_names": [],
    }
    defaults.update(overrides)
    return PyTemplateConfig(**defaults)


def _make_ts_config(**overrides) -> TsTemplateConfig:
    defaults = {
        "name": "test-trik",
        "display_name": "Test Trik",
        "description": "A test trik",
        "author_name": "Test User",
        "author_github": "testuser",
        "category": "utilities",
        "enable_storage": False,
        "enable_config": False,
        "agent_mode": "conversational",
        "handoff_description": "A conversational test trik",
        "domain_tags": ["testing"],
        "tool_names": [],
    }
    defaults.update(overrides)
    return TsTemplateConfig(**defaults)


class TestPythonTemplateConversational:
    def test_generates_expected_files(self):
        config = _make_py_config()
        files = generate_python_project(config)
        paths = {f.path for f in files}

        assert "manifest.json" in paths
        assert "trikhub.json" in paths
        assert "pyproject.toml" in paths
        assert "test.py" in paths
        assert ".gitignore" in paths
        assert "src/agent.py" in paths
        assert "src/tools/example.py" in paths
        assert "src/prompts/system.md" in paths

    def test_manifest_schema_version_2(self):
        config = _make_py_config()
        files = generate_python_project(config)
        manifest_file = next(f for f in files if f.path == "manifest.json")
        manifest = json.loads(manifest_file.content)

        assert manifest["schemaVersion"] == 2
        assert manifest["id"] == "test-trik"
        assert manifest["agent"]["mode"] == "conversational"
        assert "handoffDescription" in manifest["agent"]
        assert manifest["agent"]["domain"] == ["testing"]
        assert manifest["entry"]["runtime"] == "python"
        assert manifest["entry"]["module"] == "./src/agent.py"
        assert manifest["limits"]["maxTurnTimeMs"] == 30000

    def test_manifest_with_storage(self):
        config = _make_py_config(enable_storage=True)
        files = generate_python_project(config)
        manifest = json.loads(next(f for f in files if f.path == "manifest.json").content)

        assert manifest["capabilities"]["storage"]["enabled"] is True

    def test_manifest_with_config(self):
        config = _make_py_config(enable_config=True)
        files = generate_python_project(config)
        manifest = json.loads(next(f for f in files if f.path == "manifest.json").content)

        assert manifest["config"]["required"][0]["key"] == "API_KEY"

    def test_agent_uses_wrap_agent(self):
        config = _make_py_config()
        files = generate_python_project(config)
        agent = next(f for f in files if f.path == "src/agent.py")

        assert "wrap_agent" in agent.content
        assert "transfer_back_tool" in agent.content
        assert "create_react_agent" in agent.content

    def test_pyproject_has_langchain_deps(self):
        config = _make_py_config()
        files = generate_python_project(config)
        pyproject = next(f for f in files if f.path == "pyproject.toml")

        assert "trikhub-sdk" in pyproject.content
        assert "langchain-anthropic" in pyproject.content
        assert "langgraph" in pyproject.content

    def test_trikhub_json(self):
        config = _make_py_config()
        files = generate_python_project(config)
        trikhub = json.loads(next(f for f in files if f.path == "trikhub.json").content)

        assert trikhub["displayName"] == "Test Trik"
        assert trikhub["author"]["github"] == "testuser"


class TestPythonTemplateTool:
    def test_generates_tool_mode_files(self):
        config = _make_py_config(
            agent_mode="tool",
            tool_names=["getWeather", "getForecast"],
        )
        files = generate_python_project(config)
        paths = {f.path for f in files}

        assert "src/agent.py" in paths
        # Tool mode should NOT have tools/ or prompts/
        assert "src/tools/example.py" not in paths
        assert "src/prompts/system.md" not in paths

    def test_manifest_tool_mode(self):
        config = _make_py_config(
            agent_mode="tool",
            tool_names=["getWeather"],
        )
        files = generate_python_project(config)
        manifest = json.loads(next(f for f in files if f.path == "manifest.json").content)

        assert manifest["agent"]["mode"] == "tool"
        assert "handoffDescription" not in manifest["agent"]
        assert "getWeather" in manifest["tools"]
        assert "outputTemplate" in manifest["tools"]["getWeather"]
        assert "outputSchema" in manifest["tools"]["getWeather"]

    def test_agent_uses_wrap_tool_handlers(self):
        config = _make_py_config(
            agent_mode="tool",
            tool_names=["getWeather"],
        )
        files = generate_python_project(config)
        agent = next(f for f in files if f.path == "src/agent.py")

        assert "wrap_tool_handlers" in agent.content
        assert "getWeather" in agent.content
        assert "handle_get_weather" in agent.content

    def test_pyproject_no_langchain_deps(self):
        config = _make_py_config(agent_mode="tool", tool_names=["exampleTool"])
        files = generate_python_project(config)
        pyproject = next(f for f in files if f.path == "pyproject.toml")

        assert "trikhub-sdk" in pyproject.content
        assert "langchain-anthropic" not in pyproject.content


class TestTypescriptTemplate:
    def test_generates_expected_files(self):
        config = _make_ts_config()
        files = generate_typescript_project(config)
        paths = {f.path for f in files}

        assert "manifest.json" in paths
        assert "package.json" in paths
        assert "tsconfig.json" in paths
        assert "src/agent.ts" in paths

    def test_manifest_schema_version_2(self):
        config = _make_ts_config()
        files = generate_typescript_project(config)
        manifest = json.loads(next(f for f in files if f.path == "manifest.json").content)

        assert manifest["schemaVersion"] == 2
        assert manifest["entry"]["runtime"] == "node"
        assert manifest["entry"]["module"] == "./dist/agent.js"

    def test_package_json_deps(self):
        config = _make_ts_config()
        files = generate_typescript_project(config)
        pkg = json.loads(next(f for f in files if f.path == "package.json").content)

        assert "@trikhub/sdk" in pkg["dependencies"]
        assert "@langchain/anthropic" in pkg["dependencies"]

    def test_tool_mode_no_langchain(self):
        config = _make_ts_config(agent_mode="tool", tool_names=["exampleTool"])
        files = generate_typescript_project(config)
        pkg = json.loads(next(f for f in files if f.path == "package.json").content)

        assert "@trikhub/sdk" in pkg["dependencies"]
        assert "@langchain/anthropic" not in pkg["dependencies"]

    def test_tool_mode_uses_wrap_tool_handlers(self):
        config = _make_ts_config(agent_mode="tool", tool_names=["getWeather"])
        files = generate_typescript_project(config)
        agent = next(f for f in files if f.path == "src/agent.ts")

        assert "wrapToolHandlers" in agent.content
        assert "getWeather" in agent.content

    def test_conversational_uses_wrap_agent(self):
        config = _make_ts_config()
        files = generate_typescript_project(config)
        agent = next(f for f in files if f.path == "src/agent.ts")

        assert "wrapAgent" in agent.content
        assert "transferBackTool" in agent.content
