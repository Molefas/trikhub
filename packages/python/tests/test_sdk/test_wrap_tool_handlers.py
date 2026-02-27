"""Tests for wrap_tool_handlers."""

from __future__ import annotations

import pytest

from trikhub.manifest import TrikContext
from trikhub.sdk.wrap_tool_handlers import wrap_tool_handlers


def _make_context() -> TrikContext:
    """Create a minimal TrikContext for testing."""
    return TrikContext(sessionId="sess-1", config=None, storage=None)


# --- Basic dispatch ---


async def test_sync_handler():
    def my_tool(input: dict, context: TrikContext) -> dict:
        return {"sum": input["a"] + input["b"]}

    agent = wrap_tool_handlers({"add": my_tool})
    result = await agent.execute_tool("add", {"a": 1, "b": 2}, _make_context())
    assert result.output == {"sum": 3}


async def test_async_handler():
    async def my_tool(input: dict, context: TrikContext) -> dict:
        return {"greeting": f"hello {input['name']}"}

    agent = wrap_tool_handlers({"greet": my_tool})
    result = await agent.execute_tool("greet", {"name": "world"}, _make_context())
    assert result.output == {"greeting": "hello world"}


async def test_multiple_handlers():
    handlers = {
        "add": lambda i, c: {"result": i["a"] + i["b"]},
        "mul": lambda i, c: {"result": i["a"] * i["b"]},
    }
    agent = wrap_tool_handlers(handlers)

    r1 = await agent.execute_tool("add", {"a": 2, "b": 3}, _make_context())
    r2 = await agent.execute_tool("mul", {"a": 2, "b": 3}, _make_context())
    assert r1.output == {"result": 5}
    assert r2.output == {"result": 6}


# --- Error handling ---


async def test_unknown_tool_raises():
    agent = wrap_tool_handlers({"known": lambda i, c: {}})
    with pytest.raises(ValueError, match="Unknown tool 'missing'"):
        await agent.execute_tool("missing", {}, _make_context())


async def test_unknown_tool_lists_available():
    agent = wrap_tool_handlers({"alpha": lambda i, c: {}, "beta": lambda i, c: {}})
    with pytest.raises(ValueError, match="alpha, beta"):
        await agent.execute_tool("gamma", {}, _make_context())


# --- Context passing ---


async def test_context_passed_to_handler():
    received_context = []

    def handler(input: dict, context: TrikContext) -> dict:
        received_context.append(context)
        return {}

    agent = wrap_tool_handlers({"test": handler})
    ctx = _make_context()
    await agent.execute_tool("test", {}, ctx)

    assert len(received_context) == 1
    assert received_context[0].sessionId == "sess-1"
