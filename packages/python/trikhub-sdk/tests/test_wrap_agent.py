"""Tests for wrap_agent."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

from langchain_core.messages import AIMessage, HumanMessage

from trikhub.manifest import TrikContext
from trikhub.sdk.wrap_agent import wrap_agent


def _make_context(session_id: str = "sess-1") -> TrikContext:
    """Create a minimal TrikContext for testing."""
    return TrikContext(sessionId=session_id, config=None, storage=None)


def _make_mock_agent(responses: list[list[Any]]) -> AsyncMock:
    """Create a mock agent that returns predetermined message sequences.

    Each call to ainvoke pops the first response list and returns it
    as the full message history (input messages + response messages).
    """
    agent = AsyncMock()
    call_count = 0

    async def mock_invoke(input: dict, config: Any = None) -> dict:
        nonlocal call_count
        # Return input messages + new AI response messages
        input_messages = input["messages"]
        new_messages = responses[call_count] if call_count < len(responses) else []
        call_count += 1
        return {"messages": input_messages + new_messages}

    agent.ainvoke = mock_invoke
    return agent


# --- Basic wrapping ---


async def test_wrap_agent_basic():
    mock = _make_mock_agent([
        [AIMessage(content="Hello back!")],
    ])
    agent = wrap_agent(mock)
    ctx = _make_context()

    result = await agent.process_message("Hello", ctx)

    assert result.message == "Hello back!"
    assert result.transferBack is False
    assert result.toolCalls is None


async def test_wrap_agent_preserves_session_history():
    """Second call should include first turn's messages."""
    call_messages: list[list[Any]] = []
    mock = AsyncMock()

    async def capture_invoke(input: dict, config: Any = None) -> dict:
        msgs = input["messages"]
        call_messages.append(list(msgs))
        return {"messages": msgs + [AIMessage(content=f"Response {len(call_messages)}")]}

    mock.ainvoke = capture_invoke
    agent = wrap_agent(mock)
    ctx = _make_context()

    await agent.process_message("First", ctx)
    await agent.process_message("Second", ctx)

    # Second call should have 3 messages: Human1, AI1, Human2
    assert len(call_messages[1]) == 3
    assert call_messages[1][0].content == "First"
    assert call_messages[1][1].content == "Response 1"
    assert call_messages[1][2].content == "Second"


async def test_wrap_agent_separate_sessions():
    """Different session IDs maintain separate histories."""
    mock = _make_mock_agent([
        [AIMessage(content="R1")],
        [AIMessage(content="R2")],
    ])
    agent = wrap_agent(mock)

    r1 = await agent.process_message("A", _make_context("sess-a"))
    r2 = await agent.process_message("B", _make_context("sess-b"))

    assert r1.message == "R1"
    assert r2.message == "R2"


# --- Factory pattern ---


async def test_wrap_agent_factory():
    """Agent factory is called lazily on first message."""
    factory_calls = 0
    mock = _make_mock_agent([
        [AIMessage(content="From factory agent")],
    ])

    def factory(context: TrikContext) -> Any:
        nonlocal factory_calls
        factory_calls += 1
        return mock

    agent = wrap_agent(factory)

    # Factory not called yet
    assert factory_calls == 0

    result = await agent.process_message("Hello", _make_context())
    assert factory_calls == 1
    assert result.message == "From factory agent"


async def test_wrap_agent_async_factory():
    """Async factory is awaited correctly."""
    mock = _make_mock_agent([
        [AIMessage(content="Async factory result")],
    ])

    async def async_factory(context: TrikContext) -> Any:
        return mock

    agent = wrap_agent(async_factory)
    result = await agent.process_message("Hi", _make_context())
    assert result.message == "Async factory result"


async def test_wrap_agent_factory_called_once():
    """Factory is only called once, then cached."""
    factory_calls = 0

    async def mock_invoke(input: dict, config: Any = None) -> dict:
        return {"messages": input["messages"] + [AIMessage(content="ok")]}

    mock = AsyncMock()
    mock.ainvoke = mock_invoke

    def factory(context: TrikContext) -> Any:
        nonlocal factory_calls
        factory_calls += 1
        return mock

    agent = wrap_agent(factory)
    await agent.process_message("A", _make_context())
    await agent.process_message("B", _make_context())

    assert factory_calls == 1


# --- Tool calls and transfer_back ---


async def test_wrap_agent_extracts_tool_calls():
    mock = AsyncMock()

    async def invoke_with_tools(input: dict, config: Any = None) -> dict:
        msgs = input["messages"]
        return {"messages": msgs + [
            AIMessage(
                content="Used a tool.",
                tool_calls=[{"name": "search", "args": {"q": "test"}, "id": "tc1"}],
            ),
        ]}

    mock.ainvoke = invoke_with_tools
    agent = wrap_agent(mock)

    result = await agent.process_message("Search for test", _make_context())
    assert result.toolCalls is not None
    assert len(result.toolCalls) == 1
    assert result.toolCalls[0].tool == "search"


async def test_wrap_agent_detects_transfer_back():
    mock = AsyncMock()

    async def invoke_transfer(input: dict, config: Any = None) -> dict:
        msgs = input["messages"]
        return {"messages": msgs + [
            AIMessage(
                content="Transferring back.",
                tool_calls=[{"name": "transfer_back", "args": {}, "id": "tc1"}],
            ),
        ]}

    mock.ainvoke = invoke_transfer
    agent = wrap_agent(mock)

    result = await agent.process_message("I'm done", _make_context())
    assert result.transferBack is True
    assert result.toolCalls is None  # transfer_back excluded
