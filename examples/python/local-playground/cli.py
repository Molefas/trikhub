#!/usr/bin/env python3
"""
CLI interface for the LangGraph agent with TrikHub integration.

Run with: python cli.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from dotenv import load_dotenv
from langchain_core.messages import HumanMessage, AIMessage

# Load environment variables
load_dotenv()

# Add trikhub to path for local development
repo_root = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(repo_root / "packages" / "python"))

from agent import initialize_agent, get_last_passthrough


def print_welcome(provider: str, tools_result: "AllToolsResult") -> None:
    """Print welcome message with agent info."""
    print()
    print("=" * 60)
    print("LangGraph Agent CLI with TrikHub Support")
    print("=" * 60)
    print()
    print(f"LLM: {provider}")
    print(f"Built-in tools: get_weather, calculate, search_web")

    if tools_result.loaded_triks:
        print(f"Triks: {', '.join(tools_result.loaded_triks)}")

    print(f"Total tools: {len(tools_result.all_tools)}")
    print()
    print('Type "/tools" to list all tools, "exit" or "quit" to exit.')
    print()


def print_tools(tools_result: "AllToolsResult") -> None:
    """Print all available tools."""
    print("\nAvailable tools:")
    print("-" * 40)
    for tool in tools_result.all_tools:
        print(f"  - {tool.name}: {tool.description}")
    print()


async def main() -> None:
    """Main CLI loop."""
    print("Loading...")

    try:
        graph, tools_result, provider = await initialize_agent()
    except Exception as e:
        print(f"\nError initializing agent: {e}")
        print("\nMake sure you have set up your API key in .env file:")
        print("  ANTHROPIC_API_KEY=your_key_here")
        print("  # or OPENAI_API_KEY=your_key_here")
        print("  # or GOOGLE_API_KEY=your_key_here")
        sys.exit(1)

    print_welcome(provider, tools_result)

    # Conversation state
    messages: list = []
    thread_id = f"cli-{int(asyncio.get_event_loop().time() * 1000)}"

    while True:
        try:
            user_input = input("You: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\n\nGoodbye!")
            break

        if not user_input:
            continue

        # Handle special commands
        if user_input.lower() in ("exit", "quit"):
            print("\nGoodbye!")
            break

        if user_input == "/tools":
            print_tools(tools_result)
            continue

        # Add user message
        messages.append(HumanMessage(content=user_input))

        try:
            # Run the agent
            result = await graph.ainvoke(
                {"messages": messages},
                config={"configurable": {"thread_id": thread_id}},
            )

            # Check for passthrough content FIRST
            passthrough = get_last_passthrough()
            if passthrough:
                print()
                print(f"--- Direct Content ({passthrough.contentType}) ---")
                print(passthrough.content)
                print("--- End ---")
                print()

            # Get the assistant response
            result_messages = result.get("messages", [])
            if result_messages:
                last_message = result_messages[-1]
                if isinstance(last_message, AIMessage):
                    print(f"\nAssistant: {last_message.content}\n")

            # Update conversation history
            messages = list(result_messages)

        except Exception as e:
            print(f"\nError: {e}\n")


if __name__ == "__main__":
    # Import here to avoid circular imports
    from tools import AllToolsResult

    asyncio.run(main())
