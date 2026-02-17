"""
Tool definitions for the LangGraph agent.

Includes built-in demo tools and trik loading functionality.
"""

from __future__ import annotations

import random
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from langchain_core.tools import tool, StructuredTool

# Add trikhub to path for local development
repo_root = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(repo_root / "packages" / "python"))

from trikhub.gateway import TrikGateway
from trikhub.manifest import PassthroughContent


# ============================================================================
# Built-in Demo Tools
# ============================================================================


@tool
def get_weather(location: str) -> str:
    """Get the current weather for a location."""
    print(f"[Tool] Getting weather for: {location}")
    conditions = ["sunny", "cloudy", "rainy", "partly cloudy"]
    condition = random.choice(conditions)
    temp = random.randint(10, 40)
    return f"Weather in {location}: {condition}, {temp}°C"


@tool
def calculate(expression: str) -> str:
    """Evaluate a mathematical expression (e.g., '2 + 2', '10 * 5')."""
    print(f"[Tool] Calculating: {expression}")
    try:
        # Simple safe eval for basic math
        # Only allow digits, operators, parentheses, and spaces
        allowed = set("0123456789+-*/().  ")
        if not all(c in allowed for c in expression):
            return f"Error: Invalid characters in expression"
        result = eval(expression)  # Safe since we filtered characters
        return f"Result: {result}"
    except Exception as e:
        return f"Error: Could not evaluate '{expression}' - {e}"


@tool
def search_web(query: str) -> str:
    """Search the web for information."""
    print(f"[Tool] Searching for: {query}")
    return (
        f'Search results for "{query}":\n'
        f"1. Example result about {query}\n"
        f"2. Another article on {query}\n"
        f"3. {query} - Wikipedia"
    )


BUILT_IN_TOOLS = [get_weather, calculate, search_web]


# ============================================================================
# Trik Loading
# ============================================================================


@dataclass
class TrikLoaderResult:
    """Result from loading triks."""

    tools: list[StructuredTool]
    gateway: TrikGateway | None
    loaded_triks: list[str]


@dataclass
class AllToolsResult(TrikLoaderResult):
    """Result from loading all tools."""

    all_tools: list[Any]


async def load_triks(
    on_passthrough: Callable[[PassthroughContent], None] | None = None,
) -> TrikLoaderResult:
    """
    Load triks from the .trikhub/config.json file.

    Args:
        on_passthrough: Callback for passthrough content

    Returns:
        TrikLoaderResult with tools, gateway, and loaded trik IDs
    """
    try:
        from trikhub.langchain import load_langchain_triks, LoadLangChainTriksOptions

        result = await load_langchain_triks(
            LoadLangChainTriksOptions(
                on_passthrough=on_passthrough,
                debug=False,
            )
        )

        if len(result.loaded_triks) == 0:
            print("[Triks] No triks configured")
        else:
            print(f"[Triks] Loaded: {', '.join(result.loaded_triks)}")

        return TrikLoaderResult(
            tools=result.tools,
            gateway=result.gateway,
            loaded_triks=result.loaded_triks,
        )

    except Exception as e:
        print(f"[Triks] Error loading: {e}")
        return TrikLoaderResult(
            tools=[],
            gateway=None,
            loaded_triks=[],
        )


async def load_all_tools(
    on_passthrough: Callable[[PassthroughContent], None] | None = None,
) -> AllToolsResult:
    """
    Load all tools (built-in + triks).

    Args:
        on_passthrough: Callback for passthrough content

    Returns:
        AllToolsResult with all tools and trik info
    """
    trik_result = await load_triks(on_passthrough)

    return AllToolsResult(
        tools=trik_result.tools,
        gateway=trik_result.gateway,
        loaded_triks=trik_result.loaded_triks,
        all_tools=[*BUILT_IN_TOOLS, *trik_result.tools],
    )
