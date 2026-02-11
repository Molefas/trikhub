#!/usr/bin/env python3
"""
Interactive CLI for the LangGraph agent with TrikHub support.

Usage:
    python cli.py

Commands:
    /tools  - List available tools
    exit    - Exit the CLI
    quit    - Exit the CLI
"""

import os
import sys
from dotenv import load_dotenv

from langchain_core.messages import HumanMessage, BaseMessage

from agent import initialize_agent_with_triks, get_last_passthrough_content


def main():
    # Load environment variables from .env file
    load_dotenv()

    # Check for OpenAI API key
    if not os.environ.get("OPENAI_API_KEY"):
        print("Error: OPENAI_API_KEY environment variable not set.")
        print("Create a .env file with: OPENAI_API_KEY=your-key")
        sys.exit(1)

    print("LangGraph Agent CLI with TrikHub Support (Python)")
    print("Loading triks from trik-server...\n")

    # Initialize agent with triks from server
    try:
        result = initialize_agent_with_triks(
            server_url=os.environ.get("TRIK_SERVER_URL", "http://localhost:3002"),
        )
    except Exception as e:
        print(f"Error connecting to trik-server: {e}")
        print("Make sure trik-server is running: cd server && ./start.sh")
        sys.exit(1)

    graph = result["graph"]
    tools = result["tools"]
    loaded_triks = result["loaded_triks"]

    print(f"\nBuilt-in tools: request_refund, find_order, get_project_details")
    if loaded_triks:
        print(f"Loaded triks: {', '.join(loaded_triks)}")
    else:
        print("No triks loaded from server.")

    print(f"\nTotal tools available: {len(tools)}")
    print('Type "/tools" to list tools, "exit" or "quit" to end.\n')

    messages: list[BaseMessage] = []
    thread_id = f"cli-python-{int(__import__('time').time())}"

    while True:
        try:
            user_input = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n\nGoodbye!")
            break

        if not user_input:
            continue

        if user_input.lower() in ("exit", "quit"):
            print("\nGoodbye!")
            break

        # Handle special commands
        if user_input.lower() == "/tools":
            print("\nAvailable tools:")
            for tool in tools:
                desc = getattr(tool, "description", "No description")
                print(f"  - {tool.name}: {desc}")
            print()
            continue

        messages.append(HumanMessage(content=user_input))

        try:
            result = graph.invoke(
                {"messages": messages},
                {"configurable": {"thread_id": thread_id}}
            )

            # Check for passthrough content (direct output from trik)
            passthrough = get_last_passthrough_content()
            if passthrough:
                content, metadata = passthrough
                content_type = metadata.get("contentType", "content")
                print(f"\n--- Direct Content ({content_type}) ---")
                print(content)
                print("--- End ---\n")

            # Show assistant message
            assistant_message = result["messages"][-1]
            content = getattr(assistant_message, "content", str(assistant_message))
            print(f"\nAssistant: {content}\n")

            # Update messages with the full conversation history
            messages.clear()
            messages.extend(result["messages"])

        except Exception as e:
            print(f"\nError: {e}")
            print("Please try again.\n")


if __name__ == "__main__":
    main()
