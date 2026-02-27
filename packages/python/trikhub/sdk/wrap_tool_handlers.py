"""
Wrap tool handler functions into a TrikAgent with executeTool support.

Simple dispatch: looks up the handler by tool name, calls it, wraps the result.
Mirrors packages/js/sdk/src/wrap-tool-handlers.ts.
"""

from __future__ import annotations

import asyncio
from typing import Any, Callable, Union

from trikhub.manifest import TrikContext, ToolExecutionResult

ToolHandler = Callable[
    [dict[str, Any], TrikContext],
    Union[dict[str, Any], Any],  # sync or async
]


class _WrappedToolHandlers:
    """TrikAgent implementation wrapping tool handler functions."""

    def __init__(self, handlers: dict[str, ToolHandler]) -> None:
        self._handlers = handlers

    async def execute_tool(
        self,
        tool_name: str,
        input: dict[str, Any],
        context: TrikContext,
    ) -> ToolExecutionResult:
        """Execute a tool by name.

        Args:
            tool_name: Name of the tool to execute
            input: Tool input parameters
            context: Trik execution context

        Returns:
            ToolExecutionResult with the tool's output

        Raises:
            ValueError: If tool_name is not in the handlers dict
        """
        handler = self._handlers.get(tool_name)
        if handler is None:
            available = ", ".join(sorted(self._handlers.keys()))
            raise ValueError(
                f"Unknown tool '{tool_name}'. Available tools: {available}"
            )

        result = handler(input, context)
        # Support async handlers
        if asyncio.iscoroutine(result):
            result = await result

        return ToolExecutionResult(output=result)


def wrap_tool_handlers(handlers: dict[str, ToolHandler]) -> _WrappedToolHandlers:
    """Wrap a dict of tool handler functions into a TrikAgent.

    Each handler receives (input, context) and returns a dict output.
    Handlers can be sync or async.

    The returned object implements the TrikAgent protocol with `execute_tool()`.

    Args:
        handlers: Dict mapping tool names to handler functions

    Returns:
        A TrikAgent-compatible object with execute_tool()
    """
    return _WrappedToolHandlers(handlers)
