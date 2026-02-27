"""Tests for the transfer_back tool."""

from trikhub.sdk.transfer_back import (
    TRANSFER_BACK_TOOL_NAME,
    transfer_back_tool,
)


def test_transfer_back_tool_name():
    assert TRANSFER_BACK_TOOL_NAME == "transfer_back"


def test_transfer_back_tool_has_correct_name():
    assert transfer_back_tool.name == "transfer_back"


def test_transfer_back_tool_has_description():
    assert "transfer" in transfer_back_tool.description.lower()
    assert "main agent" in transfer_back_tool.description.lower()


async def test_transfer_back_tool_returns_message():
    result = await transfer_back_tool.ainvoke({"reason": "user done"})
    assert result == "Transferring back to main agent."


async def test_transfer_back_tool_reason_is_optional():
    result = await transfer_back_tool.ainvoke({})
    assert result == "Transferring back to main agent."
