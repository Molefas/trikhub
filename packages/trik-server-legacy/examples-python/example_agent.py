"""
Example LangGraph Agent with Skill Gateway Integration

This demonstrates how to build a LangGraph agent that uses the Skill Gateway
for tool execution with prompt injection protection.
"""

import os
from typing import Annotated, TypedDict

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode

from gateway_client import GatewayClient
from langgraph_tools import create_gateway_tools


# Agent state
class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    passthrough_content: list[str]  # Content delivered directly to user


def create_agent(gateway_url: str, auth_token: str | None = None):
    """Create a LangGraph agent connected to the Skill Gateway."""

    # Initialize gateway client and track passthrough content
    client = GatewayClient(gateway_url, auth_token)
    passthrough_buffer: list[str] = []

    # Create tools from gateway
    tools = create_gateway_tools(client, on_passthrough=lambda c, _: passthrough_buffer.append(c))

    if not tools:
        raise ValueError("No tools available from gateway")

    # Create LLM with tools
    llm = ChatAnthropic(
        model="claude-sonnet-4-20250514",
        api_key=os.environ.get("ANTHROPIC_API_KEY"),
    ).bind_tools(tools)

    # Define nodes
    def agent_node(state: AgentState) -> dict:
        """The agent decides what to do."""
        response = llm.invoke(state["messages"])
        return {"messages": [response]}

    def should_continue(state: AgentState) -> str:
        """Determine if we should continue or end."""
        last_message = state["messages"][-1]
        if hasattr(last_message, "tool_calls") and last_message.tool_calls:
            return "tools"
        return END

    def collect_passthrough(state: AgentState) -> dict:
        """Collect any passthrough content after tool execution."""
        content = passthrough_buffer.copy()
        passthrough_buffer.clear()
        return {"passthrough_content": state.get("passthrough_content", []) + content}

    # Build graph
    graph = StateGraph(AgentState)

    graph.add_node("agent", agent_node)
    graph.add_node("tools", ToolNode(tools))
    graph.add_node("collect", collect_passthrough)

    graph.set_entry_point("agent")
    graph.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
    graph.add_edge("tools", "collect")
    graph.add_edge("collect", "agent")

    return graph.compile()


def run_conversation(agent, user_input: str):
    """Run a conversation turn and return the response."""
    result = agent.invoke({
        "messages": [HumanMessage(content=user_input)],
        "passthrough_content": [],
    })

    # Get the final AI response
    ai_messages = [m for m in result["messages"] if isinstance(m, AIMessage) and m.content]
    response = ai_messages[-1].content if ai_messages else ""

    # Get any passthrough content
    passthrough = result.get("passthrough_content", [])

    return response, passthrough


# Example usage
if __name__ == "__main__":
    import sys

    gateway_url = os.environ.get("GATEWAY_URL", "http://localhost:3000")
    auth_token = os.environ.get("GATEWAY_AUTH_TOKEN")

    print(f"Connecting to gateway at {gateway_url}...")

    try:
        agent = create_agent(gateway_url, auth_token)
    except Exception as e:
        print(f"Error creating agent: {e}")
        sys.exit(1)

    print("Agent ready! Type 'quit' to exit.\n")

    while True:
        try:
            user_input = input("You: ").strip()
            if user_input.lower() in ("quit", "exit"):
                break
            if not user_input:
                continue

            response, passthrough = run_conversation(agent, user_input)

            print(f"\nAssistant: {response}")

            if passthrough:
                print("\n--- Content ---")
                for content in passthrough:
                    print(content)
                print("--- End ---")

            print()

        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"Error: {e}\n")

    print("Goodbye!")
