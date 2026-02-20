"""
LangGraph agent with tool calling via trik-server.

This agent demonstrates:
- Tool calling with both built-in tools and trik tools
- Passthrough content handling for trik responses
- Multi-provider LLM support (OpenAI, Anthropic, Google)
"""

from typing import Optional

from langchain_core.messages import AIMessage, SystemMessage
from langgraph.graph import StateGraph, MessagesState, START, END
from langgraph.prebuilt import ToolNode

from tools import load_all_tools
from llm import create_llm, get_provider_info


# ============================================================================
# Passthrough Content Tracking
# ============================================================================

_last_passthrough_content: Optional[tuple[str, dict]] = None


def get_last_passthrough_content() -> Optional[tuple[str, dict]]:
    """Get and clear the last passthrough content."""
    global _last_passthrough_content
    content = _last_passthrough_content
    _last_passthrough_content = None
    return content


def handle_passthrough(content: str, metadata: dict):
    """Store passthrough content for later display."""
    global _last_passthrough_content
    _last_passthrough_content = (content, metadata)


# ============================================================================
# System Prompt
# ============================================================================

SYSTEM_PROMPT = """You are a helpful assistant with access to various tools.

IMPORTANT: Some tools deliver content directly to the user through a separate channel (passthrough). When a tool response says "delivered directly to the user" or similar, the user has already seen the content. In this case:
- Do NOT repeat or summarize the content
- Simply acknowledge briefly or ask if they need anything else
- The user can see this content and may ask follow-up questions about it
"""


# ============================================================================
# Graph Factory
# ============================================================================

def create_agent_graph(tools: list, model=None):
    """
    Create a LangGraph workflow for agent execution.

    Args:
        tools: List of tools to bind to the model
        model: LangChain chat model instance (optional, defaults to create_llm())

    Returns:
        Compiled graph
    """
    if model is None:
        model = create_llm()

    # Bind tools to the model
    bound_model = model.bind_tools(tools)

    # --------------------------------------------------------------------------
    # Nodes
    # --------------------------------------------------------------------------

    def call_model(state: MessagesState) -> dict:
        """Agent node - calls the LLM with tools."""
        messages_with_system = [SystemMessage(content=SYSTEM_PROMPT)] + state["messages"]
        response = bound_model.invoke(messages_with_system)
        return {"messages": [response]}

    # --------------------------------------------------------------------------
    # Routing
    # --------------------------------------------------------------------------

    def should_continue(state: MessagesState) -> str:
        """Decide whether to continue to tools or end."""
        last_message = state["messages"][-1]

        if not isinstance(last_message, AIMessage):
            return END

        tool_calls = last_message.tool_calls or []
        if not tool_calls:
            return END

        return "tools"

    # --------------------------------------------------------------------------
    # Build Graph
    # --------------------------------------------------------------------------

    workflow = StateGraph(MessagesState)

    # Add nodes
    workflow.add_node("agent", call_model)
    workflow.add_node("tools", ToolNode(tools))

    # Add edges
    workflow.add_edge(START, "agent")
    workflow.add_conditional_edges(
        "agent",
        should_continue,
        {"tools": "tools", END: END}
    )
    workflow.add_edge("tools", "agent")

    return workflow.compile()


# ============================================================================
# Initialization
# ============================================================================

def initialize_agent_with_triks(
    server_url: str = "http://localhost:3000",
) -> dict:
    """
    Initialize the agent with triks loaded from trik-server.

    Args:
        server_url: URL of the trik-server

    Returns:
        Dict with graph, tools, loader, loaded_triks, and provider info
    """
    all_tools, loader = load_all_tools(
        server_url=server_url,
        on_passthrough=handle_passthrough,
    )

    model = create_llm()
    graph = create_agent_graph(all_tools, model)
    provider_info = get_provider_info()

    return {
        "graph": graph,
        "tools": all_tools,
        "loader": loader,
        "loaded_triks": loader.loaded_triks,
        "provider": provider_info,
    }
