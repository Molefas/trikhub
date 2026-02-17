"""
LangGraph agent with TrikHub integration.

This module creates a ReAct-style agent using LangGraph that can use
both built-in tools and TrikHub triks.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Literal

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langgraph.graph import StateGraph, MessagesState, START, END
from langgraph.prebuilt import ToolNode

# Add trikhub to path for local development
repo_root = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(repo_root / "packages" / "python"))

from trikhub.manifest import PassthroughContent

from llm_factory import get_llm
from tools import load_all_tools, AllToolsResult


# Global for passthrough content (simple pattern matching JS)
_last_passthrough: PassthroughContent | None = None


def get_last_passthrough() -> PassthroughContent | None:
    """Get and clear the last passthrough content."""
    global _last_passthrough
    content = _last_passthrough
    _last_passthrough = None
    return content


def _handle_passthrough(content: PassthroughContent) -> None:
    """Store passthrough content for retrieval."""
    global _last_passthrough
    _last_passthrough = content


SYSTEM_PROMPT = """You are a helpful AI assistant with access to various tools.

When using tools, follow these guidelines:

1. **Article Search Tools**: When using article search tools, the "list" and "details"
   actions deliver content directly to the user (passthrough mode). You don't need to
   repeat this content - just acknowledge it was shown.

2. **Built-in Tools**: Weather, calculator, and web search return results you can share
   directly with the user.

3. **General**: Be concise and helpful. If a tool returns an error, explain what went wrong.

Available tools will be shown in your tool list."""


async def create_agent(
    tools_result: AllToolsResult,
) -> tuple[Any, str]:
    """
    Create and return the LangGraph agent.

    Args:
        tools_result: Result from load_all_tools()

    Returns:
        Tuple of (compiled_graph, provider_name)
    """
    llm, provider = get_llm()
    tools = tools_result.all_tools

    # Bind tools to the LLM
    llm_with_tools = llm.bind_tools(tools)

    async def call_model(state: MessagesState) -> dict[str, Any]:
        """Call the model with the current messages."""
        messages = state["messages"]

        # Add system prompt if not present
        if not messages or not isinstance(messages[0], SystemMessage):
            messages = [SystemMessage(content=SYSTEM_PROMPT)] + list(messages)

        response = await llm_with_tools.ainvoke(messages)
        return {"messages": [response]}

    def should_continue(state: MessagesState) -> Literal["tools", "__end__"]:
        """Determine if we should continue to tools or end."""
        messages = state["messages"]
        last_message = messages[-1]

        if isinstance(last_message, AIMessage) and last_message.tool_calls:
            return "tools"
        return "__end__"

    # Create the graph
    workflow = StateGraph(MessagesState)

    # Add nodes
    workflow.add_node("agent", call_model)
    workflow.add_node("tools", ToolNode(tools))

    # Add edges
    workflow.add_edge(START, "agent")
    workflow.add_conditional_edges("agent", should_continue, ["tools", END])
    workflow.add_edge("tools", "agent")

    # Compile the graph
    graph = workflow.compile()

    return graph, provider


async def initialize_agent() -> tuple[Any, AllToolsResult, str]:
    """
    Initialize the agent with tools and triks.

    Returns:
        Tuple of (graph, tools_result, provider_name)
    """
    # Load all tools with passthrough handler
    tools_result = await load_all_tools(on_passthrough=_handle_passthrough)

    # Create the agent
    graph, provider = await create_agent(tools_result)

    return graph, tools_result, provider
