"""
Transfer-back tool for conversational triks.

Agents call this tool to signal they want to transfer the conversation
back to the main agent. Mirrors packages/js/sdk/src/transfer-back.ts.
"""

from __future__ import annotations

from langchain_core.tools import tool
from pydantic import BaseModel, Field


TRANSFER_BACK_TOOL_NAME = "transfer_back"


class TransferBackInput(BaseModel):
    """Input schema for the transfer_back tool."""

    reason: str | None = Field(
        default=None,
        description="Brief reason for transferring back",
    )


@tool("transfer_back", args_schema=TransferBackInput)
def transfer_back_tool(reason: str | None = None) -> str:
    """Transfer the conversation back to the main agent.

    Use when the user's request is outside your domain or when they're done
    with your capabilities.
    """
    return "Transferring back to main agent."
