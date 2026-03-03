"""
TrikHub v2 SDK for building Python triks.

Provides wrap_agent() and wrap_tool_handlers() for creating TrikAgent implementations.
Mirrors packages/js/sdk in TypeScript.
"""

from trikhub.sdk.wrap_agent import wrap_agent, InvokableAgent, AgentFactory
from trikhub.sdk.wrap_tool_handlers import wrap_tool_handlers, ToolHandler
from trikhub.sdk.transfer_back import transfer_back_tool, TRANSFER_BACK_TOOL_NAME
from trikhub.sdk.interceptor import extract_tool_info, ExtractedToolInfo
from trikhub.sdk.workspace_tools import (
    get_workspace_tools,
    get_active_workspace_tool_names,
    WORKSPACE_TOOL_NAMES,
    WORKSPACE_SYSTEM_PROMPT,
)
from trikhub.sdk.registry_tools import (
    get_registry_tools,
    get_active_registry_tool_names,
    REGISTRY_TOOL_NAMES,
    REGISTRY_SYSTEM_PROMPT,
)
from trikhub.sdk.filesystem_tools import (
    FilesystemHandlers,
    create_filesystem_handlers,
    FILESYSTEM_TOOL_SCHEMAS,
)
from trikhub.sdk.shell_tools import (
    ShellHandlers,
    ShellDefaults,
    create_shell_handlers,
    SHELL_TOOL_SCHEMAS,
)

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
    # Workspace tools (filesystem + shell for containerized triks)
    "get_workspace_tools",
    "get_active_workspace_tool_names",
    "WORKSPACE_TOOL_NAMES",
    "WORKSPACE_SYSTEM_PROMPT",
    # Registry tools (trik management capability)
    "get_registry_tools",
    "get_active_registry_tool_names",
    "REGISTRY_TOOL_NAMES",
    "REGISTRY_SYSTEM_PROMPT",
    # Filesystem + shell tool handlers (low-level)
    "FilesystemHandlers",
    "create_filesystem_handlers",
    "FILESYSTEM_TOOL_SCHEMAS",
    "ShellHandlers",
    "ShellDefaults",
    "create_shell_handlers",
    "SHELL_TOOL_SCHEMAS",
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
