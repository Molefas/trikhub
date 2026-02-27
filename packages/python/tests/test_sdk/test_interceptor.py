"""Tests for the message interceptor."""

import json

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from trikhub.sdk.interceptor import extract_tool_info, ExtractedToolInfo


def _ai_msg(content: str, tool_calls: list | None = None) -> AIMessage:
    """Create an AI message, optionally with tool calls."""
    if tool_calls:
        return AIMessage(content=content, tool_calls=tool_calls)
    return AIMessage(content=content)


def _tool_msg(content: str, tool_call_id: str) -> ToolMessage:
    """Create a tool result message."""
    return ToolMessage(content=content, tool_call_id=tool_call_id)


# --- Basic extraction ---


def test_empty_messages():
    result = extract_tool_info([], 0)
    assert result.tool_calls == []
    assert result.transfer_back is False
    assert result.response_message == ""


def test_simple_ai_response():
    messages = [
        HumanMessage(content="hello"),
        AIMessage(content="Hi there!"),
    ]
    result = extract_tool_info(messages, 0)
    assert result.response_message == "Hi there!"
    assert result.tool_calls == []
    assert result.transfer_back is False


def test_start_index_skips_history():
    messages = [
        HumanMessage(content="old message"),
        AIMessage(content="old response"),
        HumanMessage(content="new message"),
        AIMessage(content="new response"),
    ]
    result = extract_tool_info(messages, 2)
    assert result.response_message == "new response"


def test_last_ai_text_wins():
    messages = [
        AIMessage(content="first response"),
        AIMessage(content="second response"),
    ]
    result = extract_tool_info(messages, 0)
    assert result.response_message == "second response"


# --- Tool call extraction ---


def test_tool_call_with_result():
    messages = [
        _ai_msg("Let me search.", tool_calls=[
            {"name": "search", "args": {"query": "python"}, "id": "tc1"}
        ]),
        _tool_msg(json.dumps({"results": ["item1"]}), "tc1"),
        AIMessage(content="Found results."),
    ]
    result = extract_tool_info(messages, 0)
    assert len(result.tool_calls) == 1
    assert result.tool_calls[0].tool == "search"
    assert result.tool_calls[0].input == {"query": "python"}
    assert result.tool_calls[0].output == {"results": ["item1"]}
    assert result.response_message == "Found results."


def test_tool_call_without_result():
    messages = [
        _ai_msg("Calling tool.", tool_calls=[
            {"name": "search", "args": {"q": "test"}, "id": "tc1"}
        ]),
        AIMessage(content="Done."),
    ]
    result = extract_tool_info(messages, 0)
    assert len(result.tool_calls) == 1
    assert result.tool_calls[0].output == {}


def test_non_json_tool_result_wrapped():
    messages = [
        _ai_msg("", tool_calls=[
            {"name": "fetch", "args": {}, "id": "tc1"}
        ]),
        _tool_msg("plain text result", "tc1"),
        AIMessage(content="Got it."),
    ]
    result = extract_tool_info(messages, 0)
    assert result.tool_calls[0].output == {"result": "plain text result"}


def test_non_dict_json_result_wrapped():
    messages = [
        _ai_msg("", tool_calls=[
            {"name": "count", "args": {}, "id": "tc1"}
        ]),
        _tool_msg("42", "tc1"),
        AIMessage(content="The count is 42."),
    ]
    result = extract_tool_info(messages, 0)
    assert result.tool_calls[0].output == {"result": "42"}


def test_multiple_tool_calls():
    messages = [
        _ai_msg("", tool_calls=[
            {"name": "tool_a", "args": {"x": 1}, "id": "tc1"},
            {"name": "tool_b", "args": {"y": 2}, "id": "tc2"},
        ]),
        _tool_msg(json.dumps({"a": 1}), "tc1"),
        _tool_msg(json.dumps({"b": 2}), "tc2"),
        AIMessage(content="Both done."),
    ]
    result = extract_tool_info(messages, 0)
    assert len(result.tool_calls) == 2
    assert result.tool_calls[0].tool == "tool_a"
    assert result.tool_calls[1].tool == "tool_b"


# --- Transfer back ---


def test_transfer_back_detected():
    messages = [
        _ai_msg("Transferring.", tool_calls=[
            {"name": "transfer_back", "args": {"reason": "done"}, "id": "tc1"}
        ]),
        _tool_msg("Transferring back to main agent.", "tc1"),
    ]
    result = extract_tool_info(messages, 0)
    assert result.transfer_back is True
    assert result.tool_calls == []  # transfer_back excluded from tool_calls


def test_transfer_back_with_other_tools():
    messages = [
        _ai_msg("", tool_calls=[
            {"name": "search", "args": {"q": "test"}, "id": "tc1"},
            {"name": "transfer_back", "args": {}, "id": "tc2"},
        ]),
        _tool_msg(json.dumps({"results": []}), "tc1"),
        _tool_msg("Transferring back.", "tc2"),
        AIMessage(content="Done, transferring back."),
    ]
    result = extract_tool_info(messages, 0)
    assert result.transfer_back is True
    assert len(result.tool_calls) == 1
    assert result.tool_calls[0].tool == "search"


# --- Content block handling ---


def test_multipart_content():
    """AI message with list-of-blocks content."""
    messages = [
        AIMessage(content=[
            {"type": "text", "text": "Hello "},
            {"type": "text", "text": "world"},
        ]),
    ]
    result = extract_tool_info(messages, 0)
    assert result.response_message == "Hello world"


def test_mixed_content_blocks():
    """Non-text blocks are filtered out."""
    messages = [
        AIMessage(content=[
            {"type": "tool_use", "id": "x"},
            {"type": "text", "text": "response text"},
        ]),
    ]
    result = extract_tool_info(messages, 0)
    assert result.response_message == "response text"
