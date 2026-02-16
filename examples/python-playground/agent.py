#!/usr/bin/env python3
"""
TrikHub Python Gateway Example

This example demonstrates the Python gateway executing both:
- Python triks (native, in-process execution)
- JavaScript triks (via Node.js worker subprocess)

This is the dual-gateway architecture where Python users get first-class
support for both ecosystems.
"""

from __future__ import annotations

import asyncio
import shutil
import sys
from pathlib import Path
from typing import Any

# Add the python package to the path for local development
repo_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(repo_root / "python"))

from trikhub.gateway import (
    TrikGateway,
    TrikGatewayConfig,
    NodeWorkerConfig,
    GatewayResultWithSession,
)


def get_agent_data(result: GatewayResultWithSession) -> Any:
    """Extract agentData from a gateway result."""
    inner = result.result
    if hasattr(inner, "agentData"):
        return inner.agentData
    return None


def get_template_text(result: GatewayResultWithSession) -> str | None:
    """Extract templateText from a gateway result."""
    inner = result.result
    if hasattr(inner, "templateText"):
        return inner.templateText
    return None


def check_nodejs_available() -> bool:
    """Check if Node.js is available."""
    return shutil.which("node") is not None


async def main() -> None:
    """Run the example demonstrating cross-language trik execution."""

    print("=" * 60)
    print("TrikHub Python Gateway - Cross-Language Trik Execution")
    print("=" * 60)
    print()

    # Check if Node.js is available
    nodejs_available = check_nodejs_available()
    if not nodejs_available:
        print("[Warning] Node.js is not installed. JavaScript triks will not work.")
        print("          Install Node.js 18+ to enable cross-language execution.")
        print()

    # Get the triks directory (relative to this script)
    triks_dir = Path(__file__).parent / "triks"

    # Configure the gateway
    config = TrikGatewayConfig(
        triks_directory=str(triks_dir),
        # Enable Node.js worker for JavaScript triks
        node_worker_config=NodeWorkerConfig(
            debug=True,  # Print debug info
        ),
    )

    # Create the gateway
    gateway = TrikGateway(config)

    try:
        # Initialize the gateway
        print("[Gateway] Initializing...")
        await gateway.initialize()

        # Load triks from the directory
        print(f"[Gateway] Loading triks from: {triks_dir}")
        manifests = await gateway.load_triks_from_directory(str(triks_dir))

        print(f"[Gateway] Loaded {len(manifests)} triks:")
        for manifest in manifests:
            runtime = manifest.entry.runtime if manifest.entry else "unknown"
            print(f"  - {manifest.id} (runtime: {runtime})")

        # Get tool definitions
        tools = gateway.get_tool_definitions()
        print(f"\n[Gateway] Available tools ({len(tools)}):")
        for tool in tools:
            print(f"  - {tool.name}: {tool.description}")

        print()
        print("-" * 60)
        print("Demo: Executing Triks")
        print("-" * 60)

        # ================================================================
        # Demo 1: Execute Python trik (native, in-process)
        # ================================================================
        print("\n[Demo 1] Python Trik - Native Execution")
        print("-" * 40)

        result = await gateway.execute(
            trik_id="@demo/hello-py",
            action_name="greet",
            input_data={"name": "World"},
        )

        print(f"  Action: @demo/hello-py:greet")
        print(f"  Input:  {{'name': 'World'}}")
        print(f"  Result: {get_agent_data(result)}")
        print(f"  Text:   {get_template_text(result)}")

        # Try the reverse action
        result = await gateway.execute(
            trik_id="@demo/hello-py",
            action_name="reverse",
            input_data={"text": "TrikHub"},
        )

        print(f"\n  Action: @demo/hello-py:reverse")
        print(f"  Input:  {{'text': 'TrikHub'}}")
        print(f"  Result: {get_agent_data(result)}")
        print(f"  Text:   {get_template_text(result)}")

        # ================================================================
        # Demo 2: Execute JavaScript trik (via Node.js worker)
        # ================================================================
        if nodejs_available:
            print("\n[Demo 2] JavaScript Trik - Node.js Worker Execution")
            print("-" * 40)

            try:
                result = await gateway.execute(
                    trik_id="@demo/hello-js",
                    action_name="greet",
                    input_data={"name": "Python"},
                )

                print(f"  Action: @demo/hello-js:greet")
                print(f"  Input:  {{'name': 'Python'}}")
                print(f"  Result: {get_agent_data(result)}")
                print(f"  Text:   {get_template_text(result)}")

                # Try the calculate action
                result = await gateway.execute(
                    trik_id="@demo/hello-js",
                    action_name="calculate",
                    input_data={"operation": "multiply", "a": 7, "b": 6},
                )

                print(f"\n  Action: @demo/hello-js:calculate")
                print(f"  Input:  {{'operation': 'multiply', 'a': 7, 'b': 6}}")
                print(f"  Result: {get_agent_data(result)}")
                print(f"  Text:   {get_template_text(result)}")

            except Exception as e:
                print(f"  [Error] JavaScript trik execution failed: {e}")
                print(f"  Make sure Node.js 18+ is installed and the worker is built.")

            # ================================================================
            # Demo 3: Mixed execution showing both runtimes
            # ================================================================
            print("\n[Demo 3] Mixed Execution - Both Runtimes")
            print("-" * 40)

            try:
                # Python calculation
                py_result = await gateway.execute(
                    trik_id="@demo/hello-py",
                    action_name="reverse",
                    input_data={"text": "hello"},
                )

                # JavaScript calculation
                js_result = await gateway.execute(
                    trik_id="@demo/hello-js",
                    action_name="calculate",
                    input_data={"operation": "add", "a": 10, "b": 20},
                )

                py_data = get_agent_data(py_result) or {}
                js_data = get_agent_data(js_result) or {}

                print(f"  Python (reverse 'hello'):  {py_data.get('reversed')}")
                print(f"  JavaScript (10 + 20):      {js_data.get('result')}")

            except Exception as e:
                print(f"  [Error] Mixed execution failed: {e}")

        else:
            print("\n[Demo 2] JavaScript Trik - Skipped (Node.js not available)")
            print("-" * 40)
            print("  Install Node.js 18+ to run JavaScript triks.")

        print()
        print("=" * 60)
        if nodejs_available:
            print("SUCCESS! Both Python and JavaScript triks executed correctly.")
        else:
            print("SUCCESS! Python triks executed correctly.")
            print("         Install Node.js to also run JavaScript triks.")
        print("=" * 60)

    except Exception as e:
        print(f"\n[Error] {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    finally:
        # Cleanup
        print("\n[Gateway] Shutting down...")
        await gateway.shutdown()
        print("[Gateway] Done.")


if __name__ == "__main__":
    asyncio.run(main())
