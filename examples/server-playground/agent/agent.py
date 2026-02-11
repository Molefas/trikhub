"""
LangGraph agent with refund validation workflow.

This agent demonstrates:
- Tool calling with both built-in tools and trik tools
- Validation node that checks refund reasons before execution
- Passthrough content handling for trik responses
"""

import os
from typing import Annotated, Optional, Callable
from pydantic import BaseModel, Field

from langchain_openai import ChatOpenAI
from langchain_core.messages import AIMessage, ToolMessage, HumanMessage
from langgraph.graph import StateGraph, MessagesState, START, END
from langgraph.prebuilt import ToolNode

from tools import load_all_tools, BUILT_IN_TOOLS, ToolLoader


# ============================================================================
# Validation Schema
# ============================================================================

class ReasonValidation(BaseModel):
    """Schema for refund reason validation."""
    is_valid: bool = Field(description="Whether the refund reason is specific enough to process")
    feedback: str = Field(description="If invalid, explain what information is missing")


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
# Graph Factory
# ============================================================================

def create_agent_graph(tools: list, model_name: str = "gpt-4o-mini"):
    """
    Create a LangGraph workflow with refund validation.

    Args:
        tools: List of tools to bind to the model
        model_name: OpenAI model to use

    Returns:
        Compiled graph
    """
    # Main model with tools bound
    model = ChatOpenAI(
        model=model_name,
        temperature=0,
    ).bind_tools(tools)

    # Validator model with structured output
    validator = ChatOpenAI(
        model=model_name,
        temperature=0,
    ).with_structured_output(ReasonValidation)

    # --------------------------------------------------------------------------
    # Nodes
    # --------------------------------------------------------------------------

    def call_model(state: MessagesState) -> dict:
        """Agent node - calls the LLM with tools."""
        response = model.invoke(state["messages"])
        return {"messages": [response]}

    def validate_refund(state: MessagesState) -> dict:
        """Validation node - checks refund reason quality using LLM."""
        last_message = state["messages"][-1]

        if not isinstance(last_message, AIMessage):
            return {"messages": []}

        tool_calls = last_message.tool_calls or []
        refund_call = next(
            (tc for tc in tool_calls if tc["name"] == "request_refund"),
            None
        )

        if not refund_call:
            return {"messages": []}

        reason = refund_call["args"].get("reason", "")

        # Use LLM to evaluate the reason
        evaluation = validator.invoke([
            {
                "role": "system",
                "content": """You evaluate refund reasons for a customer service system.
A valid reason should explain WHY the customer wants a refund.

Valid examples: "product arrived damaged", "wrong size delivered", "item doesn't match description", "received wrong color"
Invalid examples: "I want a refund", "refund please", "money back", "return", "don't want it"

Be reasonable - if there's a clear problem stated, it's valid."""
            },
            {
                "role": "user",
                "content": f'Evaluate this refund reason: "{reason}"'
            }
        ])

        print(f"Reason validation: {'Valid' if evaluation.is_valid else 'Invalid'}")

        if not evaluation.is_valid:
            # Return a ToolMessage to satisfy requirement that every tool_call gets a response
            return {
                "messages": [
                    ToolMessage(
                        tool_call_id=refund_call["id"],
                        content=(
                            f"VALIDATION FAILED: {evaluation.feedback} "
                            "Please ask the customer for a more specific reason before trying again!"
                        ),
                    )
                ]
            }

        return {"messages": []}

    # --------------------------------------------------------------------------
    # Routing Functions
    # --------------------------------------------------------------------------

    def route_after_agent(state: MessagesState) -> str:
        """Decide next step after agent node."""
        last_message = state["messages"][-1]

        if not isinstance(last_message, AIMessage):
            return END

        tool_calls = last_message.tool_calls or []

        if not tool_calls:
            return END

        # Check if there's a refund request that needs validation
        has_refund_call = any(tc["name"] == "request_refund" for tc in tool_calls)
        if has_refund_call:
            return "validate_refund"

        return "tools"

    def route_after_validation(state: MessagesState) -> str:
        """Decide next step after validation node."""
        last_message = state["messages"][-1]

        # If validation added a ToolMessage (rejection), go back to agent
        if isinstance(last_message, ToolMessage):
            return "agent"

        # Validation passed, proceed to execute tools
        return "tools"

    # --------------------------------------------------------------------------
    # Build Graph
    # --------------------------------------------------------------------------

    workflow = StateGraph(MessagesState)

    # Add nodes
    workflow.add_node("agent", call_model)
    workflow.add_node("validate_refund", validate_refund)
    workflow.add_node("tools", ToolNode(tools))

    # Add edges
    workflow.add_edge(START, "agent")
    workflow.add_conditional_edges(
        "agent",
        route_after_agent,
        {"validate_refund": "validate_refund", "tools": "tools", END: END}
    )
    workflow.add_conditional_edges(
        "validate_refund",
        route_after_validation,
        {"agent": "agent", "tools": "tools"}
    )
    workflow.add_edge("tools", "agent")

    return workflow.compile()


# ============================================================================
# Initialization
# ============================================================================

def initialize_agent_with_triks(
    server_url: str = "http://localhost:3002",
    model_name: str = "gpt-4o-mini",
) -> dict:
    """
    Initialize the agent with triks loaded from trik-server.

    Args:
        server_url: URL of the trik-server
        model_name: OpenAI model to use

    Returns:
        Dict with graph, tools, loader, and loaded_triks
    """
    all_tools, loader = load_all_tools(
        server_url=server_url,
        on_passthrough=handle_passthrough,
    )

    graph = create_agent_graph(all_tools, model_name)

    return {
        "graph": graph,
        "tools": all_tools,
        "loader": loader,
        "loaded_triks": loader.loaded_triks,
    }


# Note: Don't create graph at module level - it requires OPENAI_API_KEY
# Use initialize_agent_with_triks() instead which is called after load_dotenv()
