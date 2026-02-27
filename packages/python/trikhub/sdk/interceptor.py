"""
Message interceptor for extracting tool call information from LangGraph messages.

Two-pass scan over message history: first builds a tool result map,
then scans AI messages for tool calls and response text.
Mirrors packages/js/sdk/src/interceptor.ts.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from langchain_core.messages import BaseMessage

from trikhub.manifest import ToolCallRecord

from .transfer_back import TRANSFER_BACK_TOOL_NAME


@dataclass
class ExtractedToolInfo:
    """Extracted tool information from a LangGraph message sequence."""

    tool_calls: list[ToolCallRecord] = field(default_factory=list)
    transfer_back: bool = False
    response_message: str = ""


def _extract_text_content(content: Any) -> str:
    """Extract text from message content (string or list of content blocks)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
        return "".join(parts)
    return ""


def _parse_tool_output(raw: str) -> dict[str, Any]:
    """Parse tool output string into a dict. Wraps non-dict values as {result: raw}."""
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
        return {"result": raw}
    except (json.JSONDecodeError, TypeError):
        return {"result": raw}


def extract_tool_info(
    messages: list[BaseMessage],
    start_index: int = 0,
) -> ExtractedToolInfo:
    """Extract tool calls, transfer_back signal, and response message from messages.

    Uses duck-typed message detection via msg.type attribute (not isinstance)
    to avoid cross-package identity issues, matching the JS SDK pattern.

    Args:
        messages: Full LangGraph message history
        start_index: Index to start scanning from (skip prior history)

    Returns:
        ExtractedToolInfo with tool_calls, transfer_back flag, and response_message
    """
    result = ExtractedToolInfo()

    # Pass 1: Build tool result map from ToolMessages
    tool_results: dict[str, str] = {}
    for msg in messages[start_index:]:
        if getattr(msg, "type", None) == "tool":
            tool_call_id = getattr(msg, "tool_call_id", None)
            if tool_call_id is not None:
                content = msg.content
                if not isinstance(content, str):
                    content = str(content)
                tool_results[tool_call_id] = content

    # Pass 2: Scan AI messages for tool calls and response text
    for msg in messages[start_index:]:
        if getattr(msg, "type", None) != "ai":
            continue

        # Extract tool calls
        msg_tool_calls = getattr(msg, "tool_calls", None)
        if msg_tool_calls:
            for tc in msg_tool_calls:
                name = tc.get("name", "") if isinstance(tc, dict) else getattr(tc, "name", "")
                tc_id = tc.get("id", "") if isinstance(tc, dict) else getattr(tc, "id", "")
                args = tc.get("args", {}) if isinstance(tc, dict) else getattr(tc, "args", {})

                if name == TRANSFER_BACK_TOOL_NAME:
                    result.transfer_back = True
                    continue

                # Look up tool result
                raw_result = tool_results.get(tc_id, "")
                output = _parse_tool_output(raw_result) if raw_result else {}

                result.tool_calls.append(ToolCallRecord(
                    tool=name,
                    input=args if isinstance(args, dict) else {},
                    output=output,
                ))

        # Extract text content (last AI text wins)
        text = _extract_text_content(msg.content)
        if text:
            result.response_message = text

    return result
