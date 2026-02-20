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
import time
from dotenv import load_dotenv

from langchain_core.messages import HumanMessage, BaseMessage

from agent import initialize_agent_with_triks, get_last_passthrough_content
from llm import get_provider_info, API_KEY_MAP


def main():
    # Load environment variables from .env file
    load_dotenv()

    # Check for required API key based on detected provider
    provider_info = get_provider_info()
    if not provider_info["has_key"]:
        provider = provider_info["provider"]
        key_name = API_KEY_MAP.get(provider, "API_KEY")
        print(f"Error: {key_name} environment variable not set.")
        print(f"Create a .env file with: {key_name}=your-key")
        print("\nOr set LLM_PROVIDER to use a different provider.")
        sys.exit(1)

    print("LangGraph Agent CLI with TrikHub Support")
    print("Loading...\n")

    # Initialize agent with triks from server
    try:
        result = initialize_agent_with_triks(
            server_url=os.environ.get("TRIK_SERVER_URL", "http://localhost:3000"),
        )
    except Exception as e:
        print(f"Error connecting to trik-server: {e}")
        print("Make sure trik-server is running: cd server && ./start.sh")
        sys.exit(1)

    graph = result["graph"]
    tools = result["tools"]
    loaded_triks = result["loaded_triks"]
    provider = result["provider"]

    print(f"LLM: {provider['provider']} ({provider['model']})")
    print("Built-in tools: get_weather, calculate, search_web")
    if loaded_triks:
        print(f"Triks: {', '.join(loaded_triks)}")
    print(f"Total tools: {len(tools)}")
    print('Type "/tools" to list all, "exit" to quit.\n')

    messages: list[BaseMessage] = []
    thread_id = f"cli-python-{int(time.time())}"

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
