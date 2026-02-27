"""Tests for the trik loader."""

import json
import textwrap
from pathlib import Path

import pytest

from trikhub.worker.trik_loader import TrikLoader


@pytest.fixture
def tmp_trik(tmp_path):
    """Create a minimal trik directory with manifest and agent module."""
    manifest = {
        "schemaVersion": 2,
        "name": "test-trik",
        "displayName": "Test Trik",
        "description": "A test trik",
        "entry": {"module": "./agent.py", "export": "agent"},
        "agents": [{"id": "main", "mode": "conversational"}],
    }
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    (tmp_path / "agent.py").write_text(
        textwrap.dedent("""\
        class _Agent:
            async def process_message(self, message, context):
                from trikhub.manifest import TrikResponse
                return TrikResponse(message=f"echo: {message}", transferBack=False)

            async def execute_tool(self, tool_name, input, context):
                from trikhub.manifest import ToolExecutionResult
                return ToolExecutionResult(output={"tool": tool_name})

        agent = _Agent()
        """)
    )
    return tmp_path


@pytest.fixture
def tmp_trik_tool_only(tmp_path):
    """Create a trik that only implements execute_tool."""
    trik_dir = tmp_path / "tool-trik"
    trik_dir.mkdir()
    manifest = {
        "schemaVersion": 2,
        "name": "tool-trik",
        "displayName": "Tool Trik",
        "description": "A tool-only trik",
        "entry": {"module": "./handler.py", "export": "agent"},
        "agents": [{"id": "main", "mode": "tool"}],
    }
    (trik_dir / "manifest.json").write_text(json.dumps(manifest))
    (trik_dir / "handler.py").write_text(
        textwrap.dedent("""\
        class _Agent:
            async def execute_tool(self, tool_name, input, context):
                from trikhub.manifest import ToolExecutionResult
                return ToolExecutionResult(output={"result": "ok"})

        agent = _Agent()
        """)
    )
    return trik_dir


def test_load_trik(tmp_trik):
    loader = TrikLoader()
    agent = loader.load(str(tmp_trik))
    assert callable(getattr(agent, "process_message", None))
    assert callable(getattr(agent, "execute_tool", None))


def test_load_trik_caches(tmp_trik):
    loader = TrikLoader()
    agent1 = loader.load(str(tmp_trik))
    agent2 = loader.load(str(tmp_trik))
    assert agent1 is agent2


def test_load_missing_manifest(tmp_path):
    loader = TrikLoader()
    with pytest.raises(FileNotFoundError, match="Manifest not found"):
        loader.load(str(tmp_path / "nonexistent"))


def test_load_missing_module(tmp_path):
    manifest = {
        "schemaVersion": 2,
        "name": "broken",
        "entry": {"module": "./missing.py", "export": "agent"},
    }
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    loader = TrikLoader()
    with pytest.raises(FileNotFoundError, match="Module not found"):
        loader.load(str(tmp_path))


def test_load_missing_export(tmp_path):
    manifest = {
        "schemaVersion": 2,
        "name": "no-export",
        "entry": {"module": "./mod.py", "export": "agent"},
    }
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    (tmp_path / "mod.py").write_text("x = 1\n")
    loader = TrikLoader()
    with pytest.raises(ImportError, match="does not export 'agent'"):
        loader.load(str(tmp_path))


def test_load_invalid_agent(tmp_path):
    manifest = {
        "schemaVersion": 2,
        "name": "bad-agent",
        "entry": {"module": "./mod.py", "export": "agent"},
    }
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    (tmp_path / "mod.py").write_text("agent = 'not an agent'\n")
    loader = TrikLoader()
    with pytest.raises(TypeError, match="not a valid TrikAgent"):
        loader.load(str(tmp_path))


def test_load_tool_only_trik(tmp_trik_tool_only):
    loader = TrikLoader()
    agent = loader.load(str(tmp_trik_tool_only))
    assert callable(getattr(agent, "execute_tool", None))


def test_default_entry_values(tmp_path):
    """When manifest has no entry, defaults to ./graph.py and 'agent' export."""
    manifest = {"schemaVersion": 2, "name": "default-entry"}
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    (tmp_path / "graph.py").write_text(
        textwrap.dedent("""\
        class _Agent:
            async def process_message(self, message, context):
                from trikhub.manifest import TrikResponse
                return TrikResponse(message="default", transferBack=False)

        agent = _Agent()
        """)
    )
    loader = TrikLoader()
    agent = loader.load(str(tmp_path))
    assert callable(getattr(agent, "process_message", None))
