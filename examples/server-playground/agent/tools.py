"""
Tool definitions for the agent.

Includes both built-in demo tools and dynamically loaded trik tools from trik-server.
"""

import random
from typing import Callable, Optional
from langchain_core.tools import tool, StructuredTool

from trik_client import load_trik_tools, TrikClient


# ============================================================================
# Built-in Demo Tools
# ============================================================================

@tool
def get_weather(location: str) -> str:
    """Get the current weather for a location.

    Args:
        location: The city or location to get weather for
    """
    print(f"[Tool] Getting weather for: {location}")
    conditions = ["sunny", "cloudy", "rainy", "partly cloudy"]
    condition = random.choice(conditions)
    temp = random.randint(10, 40)
    return f"Weather in {location}: {condition}, {temp}°C"


@tool
def calculate(expression: str) -> str:
    """Evaluate a mathematical expression.

    Args:
        expression: The math expression to evaluate (e.g., "2 + 2", "10 * 5")
    """
    print(f"[Tool] Calculating: {expression}")
    # Simple safe eval for basic math
    allowed = set("0123456789+-*/(). ")
    if not all(c in allowed for c in expression):
        return "Error: Invalid characters in expression"
    try:
        result = eval(expression)
        return f"Result: {result}"
    except Exception:
        return f"Error: Could not evaluate '{expression}'"


@tool
def search_web(query: str) -> str:
    """Search the web for information.

    Args:
        query: The search query
    """
    print(f"[Tool] Searching for: {query}")
    return f'Search results for "{query}":\n1. Example result about {query}\n2. Another article on {query}\n3. {query} - Wikipedia'


# List of built-in tools
BUILT_IN_TOOLS = [get_weather, calculate, search_web]


# ============================================================================
# Tool Loading
# ============================================================================

class ToolLoader:
    """Handles loading and combining tools from different sources."""

    def __init__(
        self,
        server_url: str = "http://localhost:3000",
        on_passthrough: Optional[Callable[[str, dict], None]] = None,
    ):
        self.server_url = server_url
        self.on_passthrough = on_passthrough
        self.trik_client: Optional[TrikClient] = None
        self.trik_tools: list[StructuredTool] = []
        self.loaded_triks: list[str] = []

    def load_trik_tools(self) -> list[StructuredTool]:
        """Load tools from trik-server."""
        try:
            tools, client = load_trik_tools(
                self.server_url,
                on_passthrough=self.on_passthrough,
            )
            self.trik_client = client
            self.trik_tools = tools

            # Get loaded trik names
            tools_response = client.get_tools()
            triks = tools_response.get("triks", [])
            self.loaded_triks = [t["id"] for t in triks]

            if self.loaded_triks:
                print(f"[Triks] Loaded: {', '.join(self.loaded_triks)}")
            else:
                print("[Triks] No triks configured on server")

            return tools

        except Exception as e:
            print(f"[Triks] Error loading from server: {e}")
            print(f"[Triks] Make sure trik-server is running at {self.server_url}")
            return []

    def get_all_tools(self) -> list:
        """Get all tools: built-in + trik tools."""
        trik_tools = self.load_trik_tools()
        return BUILT_IN_TOOLS + trik_tools

    def get_client(self) -> Optional[TrikClient]:
        """Get the trik client instance (for session management)."""
        return self.trik_client


def load_all_tools(
    server_url: str = "http://localhost:3000",
    on_passthrough: Optional[Callable[[str, dict], None]] = None,
) -> tuple[list, ToolLoader]:
    """
    Load all tools: built-in + trik tools from server.

    Args:
        server_url: URL of the trik-server
        on_passthrough: Callback for passthrough content

    Returns:
        Tuple of (all_tools, loader)
    """
    loader = ToolLoader(server_url, on_passthrough)
    all_tools = loader.get_all_tools()
    return all_tools, loader
