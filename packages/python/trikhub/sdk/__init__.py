"""
TrikHub v2 SDK for building Python triks.

Provides wrap_agent() and wrap_tool_handlers() for creating TrikAgent implementations.
Mirrors packages/js/sdk in TypeScript.
"""

from trikhub.sdk.wrap_agent import wrap_agent, InvokableAgent, AgentFactory
from trikhub.sdk.wrap_tool_handlers import wrap_tool_handlers, ToolHandler
from trikhub.sdk.transfer_back import transfer_back_tool, TRANSFER_BACK_TOOL_NAME
from trikhub.sdk.interceptor import extract_tool_info, ExtractedToolInfo

# Convenience re-exports from trikhub.manifest
from trikhub.manifest import (
    TrikAgent,
    TrikContext,
    TrikResponse,
    TrikConfigContext,
    TrikStorageContext,
    ToolCallRecord,
    ToolExecutionResult,
)

__all__ = [
    # Core API
    "wrap_agent",
    "InvokableAgent",
    "AgentFactory",
    # Tool-mode API
    "wrap_tool_handlers",
    "ToolHandler",
    # Transfer-back tool
    "transfer_back_tool",
    "TRANSFER_BACK_TOOL_NAME",
    # Advanced/internal
    "extract_tool_info",
    "ExtractedToolInfo",
    # Re-exports from manifest
    "TrikAgent",
    "TrikContext",
    "TrikResponse",
    "TrikConfigContext",
    "TrikStorageContext",
    "ToolCallRecord",
    "ToolExecutionResult",
]
