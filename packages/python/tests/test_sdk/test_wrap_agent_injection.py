"""Tests for wrap_agent auto-injection of workspace tools.

Phase 3: Verifies that wrap_agent correctly:
- Prepends workspace system prompt when capabilities are present
- Filters workspace tool calls from ToolCallRecord output
- Works unchanged when no capabilities are present (regression)
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from trikhub.manifest import TrikCapabilities, TrikContext, FilesystemCapabilities, ShellCapabilities
from trikhub.sdk.workspace_tools import get_active_workspace_tool_names
from trikhub.sdk.wrap_agent import wrap_agent


# ============================================================================
# Helpers
# ============================================================================


def _make_context(
    session_id: str = "sess-1",
    capabilities: TrikCapabilities | None = None,
) -> TrikContext:
    return TrikContext(
        sessionId=session_id,
        config=None,
        storage=None,
        capabilities=capabilities,
    )


FILESYSTEM_CAPS = TrikCapabilities(
    filesystem=FilesystemCapabilities(enabled=True),
)

FILESYSTEM_AND_SHELL_CAPS = TrikCapabilities(
    filesystem=FilesystemCapabilities(enabled=True),
    shell=ShellCapabilities(enabled=True, timeoutMs=5000),
)


def _make_capturing_mock(response_content: str = "OK"):
    """Create a mock agent that captures messages and returns a fixed response."""
    captured: list[list[Any]] = []

    async def mock_ainvoke(input: dict, config: Any = None) -> dict:
        msgs = input["messages"]
        captured.append(list(msgs))
        return {"messages": msgs + [AIMessage(content=response_content)]}

    agent = AsyncMock()
    agent.ainvoke = mock_ainvoke
    return agent, captured


def _make_tool_calling_mock(
    tool_calls: list[dict],
):
    """Create a mock agent that returns AI messages with tool calls."""

    async def mock_ainvoke(input: dict, config: Any = None) -> dict:
        msgs = input["messages"]
        return {
            "messages": msgs
            + [AIMessage(content="Used some tools.", tool_calls=tool_calls)]
        }

    agent = AsyncMock()
    agent.ainvoke = mock_ainvoke
    return agent


# ============================================================================
# Tests: Regression (no capabilities)
# ============================================================================


class TestWrapAgentWithoutCapabilities:
    """Regression tests: wrap_agent unchanged when no capabilities present."""

    async def test_basic_response(self):
        agent, _ = _make_capturing_mock("Hello!")
        wrapped = wrap_agent(agent)
        ctx = _make_context()

        result = await wrapped.process_message("Hi", ctx)

        assert result.message == "Hello!"
        assert result.transferBack is False
        assert result.toolCalls is None

    async def test_no_system_prompt_without_capabilities(self):
        agent, captured = _make_capturing_mock()
        wrapped = wrap_agent(agent)
        ctx = _make_context()

        await wrapped.process_message("Hello", ctx)

        messages = captured[0]
        assert len(messages) == 1
        assert isinstance(messages[0], HumanMessage)

    async def test_no_tool_filtering_without_capabilities(self):
        agent = _make_tool_calling_mock([
            {"name": "read_file", "args": {"path": "test.txt"}, "id": "tc1"},
            {"name": "custom_tool", "args": {"q": "test"}, "id": "tc2"},
        ])
        wrapped = wrap_agent(agent)
        ctx = _make_context()

        result = await wrapped.process_message("Do something", ctx)

        assert result.toolCalls is not None
        assert len(result.toolCalls) == 2
        tool_names = [tc.tool for tc in result.toolCalls]
        assert tool_names == ["read_file", "custom_tool"]


# ============================================================================
# Tests: No system prompt injection (SystemMessage removed to avoid API errors)
# ============================================================================


class TestWrapAgentSystemPrompt:
    """Tests that wrap_agent does NOT inject SystemMessages."""

    async def test_no_system_prompt_with_filesystem_caps(self):
        agent, captured = _make_capturing_mock()
        wrapped = wrap_agent(agent)
        ctx = _make_context("sess-1", FILESYSTEM_CAPS)

        await wrapped.process_message("Hello", ctx)

        messages = captured[0]
        assert len(messages) == 1  # Only HumanMessage
        assert isinstance(messages[0], HumanMessage)

    async def test_no_system_messages_across_turns(self):
        agent, captured = _make_capturing_mock()
        wrapped = wrap_agent(agent)
        ctx = _make_context("sess-1", FILESYSTEM_CAPS)

        await wrapped.process_message("First", ctx)
        await wrapped.process_message("Second", ctx)

        all_system = [
            m for msgs in captured for m in msgs if isinstance(m, SystemMessage)
        ]
        assert len(all_system) == 0

    async def test_no_system_messages_across_sessions(self):
        agent, captured = _make_capturing_mock()
        wrapped = wrap_agent(agent)

        await wrapped.process_message(
            "Hello", _make_context("sess-a", FILESYSTEM_CAPS)
        )
        await wrapped.process_message(
            "Hello", _make_context("sess-b", FILESYSTEM_CAPS)
        )

        assert isinstance(captured[0][0], HumanMessage)
        assert isinstance(captured[1][0], HumanMessage)

    async def test_no_system_prompt_with_shell_caps(self):
        agent, captured = _make_capturing_mock()
        wrapped = wrap_agent(agent)
        ctx = _make_context("sess-1", FILESYSTEM_AND_SHELL_CAPS)

        await wrapped.process_message("Hello", ctx)

        messages = captured[0]
        assert len(messages) == 1  # Only HumanMessage
        assert isinstance(messages[0], HumanMessage)


# ============================================================================
# Tests: Tool call filtering
# ============================================================================


class TestWrapAgentToolFiltering:
    """Tests for workspace tool call filtering from output."""

    async def test_filters_filesystem_tool_calls(self):
        agent = _make_tool_calling_mock([
            {"name": "read_file", "args": {"path": "test.txt"}, "id": "tc1"},
            {"name": "custom_tool", "args": {"q": "test"}, "id": "tc2"},
        ])
        wrapped = wrap_agent(agent)
        ctx = _make_context("sess-1", FILESYSTEM_CAPS)

        result = await wrapped.process_message("Do something", ctx)

        assert result.toolCalls is not None
        assert len(result.toolCalls) == 1
        assert result.toolCalls[0].tool == "custom_tool"

    async def test_filters_all_workspace_tools(self):
        agent = _make_tool_calling_mock([
            {"name": "read_file", "args": {"path": "test.txt"}, "id": "tc1"},
            {"name": "write_file", "args": {"path": "out.txt", "content": "hi"}, "id": "tc2"},
            {"name": "execute_command", "args": {"command": "ls"}, "id": "tc3"},
            {"name": "custom_tool", "args": {}, "id": "tc4"},
        ])
        wrapped = wrap_agent(agent)
        ctx = _make_context("sess-1", FILESYSTEM_AND_SHELL_CAPS)

        result = await wrapped.process_message("Do things", ctx)

        assert result.toolCalls is not None
        assert len(result.toolCalls) == 1
        assert result.toolCalls[0].tool == "custom_tool"

    async def test_returns_none_when_all_filtered(self):
        agent = _make_tool_calling_mock([
            {"name": "read_file", "args": {"path": "test.txt"}, "id": "tc1"},
            {"name": "write_file", "args": {"path": "out.txt", "content": "hi"}, "id": "tc2"},
        ])
        wrapped = wrap_agent(agent)
        ctx = _make_context("sess-1", FILESYSTEM_CAPS)

        result = await wrapped.process_message("Do things", ctx)

        assert result.toolCalls is None

    async def test_execute_command_not_filtered_without_shell_cap(self):
        agent = _make_tool_calling_mock([
            {"name": "read_file", "args": {"path": "test.txt"}, "id": "tc1"},
            {"name": "execute_command", "args": {"command": "ls"}, "id": "tc2"},
        ])
        wrapped = wrap_agent(agent)
        ctx = _make_context("sess-1", TrikCapabilities(
            filesystem=FilesystemCapabilities(enabled=True),
            # shell NOT enabled
        ))

        result = await wrapped.process_message("Do things", ctx)

        assert result.toolCalls is not None
        assert len(result.toolCalls) == 1
        assert result.toolCalls[0].tool == "execute_command"


# ============================================================================
# Tests: get_active_workspace_tool_names
# ============================================================================


class TestGetActiveWorkspaceToolNames:
    def test_empty_for_none(self):
        assert len(get_active_workspace_tool_names()) == 0

    def test_filesystem_only(self):
        names = get_active_workspace_tool_names(FILESYSTEM_CAPS)
        assert len(names) == 8
        assert "read_file" in names
        assert "execute_command" not in names

    def test_filesystem_and_shell(self):
        names = get_active_workspace_tool_names(FILESYSTEM_AND_SHELL_CAPS)
        assert len(names) == 9
        assert "execute_command" in names


# ============================================================================
# Tests: get_workspace_tools
# ============================================================================


class TestGetWorkspaceTools:
    def test_returns_empty_without_capabilities(self):
        from trikhub.sdk.workspace_tools import get_workspace_tools

        ctx = _make_context()
        tools = get_workspace_tools(ctx)
        assert tools == []

    def test_returns_8_filesystem_tools(self, tmp_path):
        from trikhub.sdk.workspace_tools import get_workspace_tools

        ctx = _make_context("sess-1", FILESYSTEM_CAPS)
        tools = get_workspace_tools(ctx, str(tmp_path))
        assert len(tools) == 8

        names = [t.name for t in tools]
        assert "read_file" in names
        assert "write_file" in names
        assert "edit_file" in names
        assert "list_directory" in names
        assert "glob_files" in names
        assert "grep_files" in names
        assert "delete_file" in names
        assert "create_directory" in names

    def test_returns_9_tools_with_shell(self, tmp_path):
        from trikhub.sdk.workspace_tools import get_workspace_tools

        ctx = _make_context("sess-1", FILESYSTEM_AND_SHELL_CAPS)
        tools = get_workspace_tools(ctx, str(tmp_path))
        assert len(tools) == 9

        names = [t.name for t in tools]
        assert "execute_command" in names
