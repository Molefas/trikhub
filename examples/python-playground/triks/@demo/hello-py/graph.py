"""
Hello Python Trik - A simple Python trik demonstrating native execution.

This trik runs directly in-process within the Python gateway.
"""

from __future__ import annotations

import sys
from typing import Any


class HelloPythonGraph:
    """A simple Python trik that demonstrates native Python execution."""

    async def invoke(self, input_data: dict[str, Any]) -> dict[str, Any]:
        """
        Main invoke method - called by the TrikHub gateway.

        Args:
            input_data: The input from the gateway containing action and input.

        Returns:
            The result with responseMode and agentData.
        """
        action = input_data.get("action")
        action_input = input_data.get("input", {})

        if action == "greet":
            return self.greet(action_input)
        elif action == "reverse":
            return self.reverse(action_input)
        else:
            return {
                "responseMode": "template",
                "agentData": {
                    "template": "error",
                    "message": f"Unknown action: {action}",
                },
            }

    def greet(self, input_data: dict[str, Any]) -> dict[str, Any]:
        """Generate a greeting message."""
        name = input_data.get("name")

        if not name or not isinstance(name, str):
            return {
                "responseMode": "template",
                "agentData": {
                    "template": "error",
                    "message": "Name is required and must be a string",
                },
            }

        greeting = f"Hello, {name}! Welcome to TrikHub from Python!"
        python_version = f"Python {sys.version_info.major}.{sys.version_info.minor}"

        return {
            "responseMode": "template",
            "agentData": {
                "template": "success",
                "message": greeting,
                "language": python_version,
            },
        }

    def reverse(self, input_data: dict[str, Any]) -> dict[str, Any]:
        """Reverse a string."""
        text = input_data.get("text")

        if not text or not isinstance(text, str):
            return {
                "responseMode": "template",
                "agentData": {
                    "template": "error",
                    "message": "Text is required and must be a string",
                },
            }

        reversed_text = text[::-1]

        return {
            "responseMode": "template",
            "agentData": {
                "template": "result",
                "original": text,
                "reversed": reversed_text,
            },
        }


# Export the graph instance
graph = HelloPythonGraph()
