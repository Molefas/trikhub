"""
Tool definitions for the agent.

Includes both built-in tools and dynamically loaded trik tools from trik-server.
"""

from typing import Callable, Optional
from langchain_core.tools import tool, StructuredTool

from trik_client import load_trik_tools, TrikClient


# ============================================================================
# Built-in Tools (same as original trikhub-playground)
# ============================================================================

@tool
def request_refund(order_id: str, reason: str) -> str:
    """Process a refund request. Use when a user wants their money back.

    Args:
        order_id: The order ID to refund. It must start with 'ORD'
        reason: A specific reason for the refund. Something that answers the question: 'Why?'
    """
    print(f"Processing refund for order: {order_id}")
    print(f"   Reason: {reason}")
    return f"Refund request submitted for order {order_id}. Our team will process this within 3-5 business days."


@tool
def find_order(description: str) -> str:
    """Finds an order based on its description.

    Args:
        description: The description of the order
    """
    print(f"Finding order: {description}")
    return f"Found order with description: {description}. Order ID is ORD123456."


@tool
def get_project_details(question: str) -> str:
    """Get project information. Use when user asks about the project.

    Args:
        question: The question about the project
    """
    print(f"Looking up: {question}")
    return """Project: TrikHub Server Playground
Tech Stack: Python, LangGraph, LangChain, OpenAI, trik-server
Status: Active development
Features: Tool calling via HTTP API, Type-directed privilege separation, Passthrough content delivery"""


# List of built-in tools
BUILT_IN_TOOLS = [request_refund, find_order, get_project_details]


# ============================================================================
# Tool Loading
# ============================================================================

class ToolLoader:
    """Handles loading and combining tools from different sources."""

    def __init__(
        self,
        server_url: str = "http://localhost:3002",
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
                print(f"[Triks] Loaded {len(self.loaded_triks)} triks: {', '.join(self.loaded_triks)}")
            else:
                print("[Triks] No triks configured on server.")

            return tools

        except Exception as e:
            print(f"[Triks] Error loading triks from server: {e}")
            print("[Triks] Make sure trik-server is running at", self.server_url)
            return []

    def get_all_tools(self) -> list:
        """Get all tools: built-in + trik tools."""
        trik_tools = self.load_trik_tools()
        return BUILT_IN_TOOLS + trik_tools

    def get_client(self) -> Optional[TrikClient]:
        """Get the trik client instance (for session management)."""
        return self.trik_client


def load_all_tools(
    server_url: str = "http://localhost:3002",
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
