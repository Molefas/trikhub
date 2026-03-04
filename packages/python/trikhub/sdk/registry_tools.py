"""
LangChain tool wrappers for trik registry management.

When a trik declares trikManagement capability, these tools are
created and can be added to the LangGraph agent's tool list.
The tools delegate to the TrikRegistryContext provided by the gateway.

Usage:
    from trikhub.sdk import get_registry_tools

    def my_factory(context):
        llm = ChatAnthropic(...)
        tools = [*my_tools, transfer_back_tool, *get_registry_tools(context)]
        return create_react_agent(llm, tools)

    export = wrap_agent(my_factory)

Mirrors packages/js/sdk/src/registry-tools.ts
"""

from __future__ import annotations

import json
from typing import Any

from langchain_core.tools import tool
from pydantic import BaseModel, Field

from trikhub.manifest import TrikCapabilities, TrikContext

# The set of tool names that are registry-injected (used for output filtering)
REGISTRY_TOOL_NAMES: set[str] = {
    "search_triks",
    "list_installed_triks",
    "install_trik",
    "uninstall_trik",
    "upgrade_trik",
    "get_trik_info",
}

# System prompt appendix for registry tools
REGISTRY_SYSTEM_PROMPT = """## Trik Management Tools
You have access to trik management tools for the TrikHub registry.
- Use search_triks to find triks matching a search query
- Use list_installed_triks to see all currently installed triks
- Use install_trik to install a trik from the registry
- Use uninstall_trik to remove an installed trik
- Use upgrade_trik to upgrade an installed trik to a newer version
- Use get_trik_info to get detailed information about a trik"""


# ============================================================================
# Pydantic input schemas for LangChain tools
# ============================================================================


class SearchTriksInput(BaseModel):
    query: str = Field(description="Search query")
    page: int | None = Field(default=None, description="Page number (default 1)")
    page_size: int | None = Field(
        default=None, description="Results per page (default 10)"
    )


class InstallTrikInput(BaseModel):
    trik_id: str = Field(description="Full trik ID (e.g. @scope/name)")
    version: str | None = Field(
        default=None, description="Specific version to install (default: latest)"
    )


class UninstallTrikInput(BaseModel):
    trik_id: str = Field(description="Full trik ID to uninstall")


class UpgradeTrikInput(BaseModel):
    trik_id: str = Field(description="Full trik ID to upgrade")
    version: str | None = Field(
        default=None, description="Target version (default: latest)"
    )


class GetTrikInfoInput(BaseModel):
    trik_id: str = Field(description="Full trik ID to look up")


# ============================================================================
# LangChain tool creation
# ============================================================================


def _create_registry_langchain_tools(registry: Any) -> list[Any]:
    """Create LangChain tools for trik registry management."""

    @tool("search_triks", args_schema=SearchTriksInput)
    async def search_triks(
        query: str, page: int | None = None, page_size: int | None = None
    ) -> str:
        """Search the TrikHub registry for triks matching a query."""
        result = await registry.search(
            query, page=page or 1, page_size=page_size or 10
        )
        return json.dumps(result.model_dump() if hasattr(result, "model_dump") else result)

    @tool("list_installed_triks")
    async def list_installed_triks() -> str:
        """List all currently installed triks with their capabilities."""
        result = await registry.list()
        items = [
            item.model_dump() if hasattr(item, "model_dump") else item
            for item in result
        ]
        return json.dumps(items)

    @tool("install_trik", args_schema=InstallTrikInput)
    async def install_trik(trik_id: str, version: str | None = None) -> str:
        """Install a trik from the TrikHub registry."""
        result = await registry.install(trik_id, version)
        return json.dumps(result.model_dump() if hasattr(result, "model_dump") else result)

    @tool("uninstall_trik", args_schema=UninstallTrikInput)
    async def uninstall_trik(trik_id: str) -> str:
        """Uninstall a trik."""
        result = await registry.uninstall(trik_id)
        return json.dumps(result.model_dump() if hasattr(result, "model_dump") else result)

    @tool("upgrade_trik", args_schema=UpgradeTrikInput)
    async def upgrade_trik(trik_id: str, version: str | None = None) -> str:
        """Upgrade an installed trik to a newer version."""
        result = await registry.upgrade(trik_id, version)
        return json.dumps(result.model_dump() if hasattr(result, "model_dump") else result)

    @tool("get_trik_info", args_schema=GetTrikInfoInput)
    async def get_trik_info(trik_id: str) -> str:
        """Get detailed information about a trik from the registry."""
        result = await registry.get_info(trik_id)
        if result is None:
            return json.dumps(None)
        return json.dumps(result.model_dump() if hasattr(result, "model_dump") else result)

    return [
        search_triks,
        list_installed_triks,
        install_trik,
        uninstall_trik,
        upgrade_trik,
        get_trik_info,
    ]


def get_registry_tools(context: TrikContext) -> list[Any]:
    """Get LangChain tools for trik registry management based on the trik's capabilities.

    Returns an empty array if no registry context is available.
    Include the returned tools in your LangGraph agent's tool list.

    Args:
        context: The TrikContext (must have registry populated by the gateway)

    Returns:
        List of LangChain tool instances
    """
    if context.registry is None:
        return []

    return _create_registry_langchain_tools(context.registry)


def get_active_registry_tool_names(
    capabilities: TrikCapabilities | None = None,
) -> set[str]:
    """Get the set of registry tool names that are active for the given capabilities.

    Used internally by wrap_agent to filter these from ToolCallRecord output.
    """
    if capabilities is None:
        return set()

    if (
        capabilities.trikManagement is not None
        and capabilities.trikManagement.enabled
    ):
        return set(REGISTRY_TOOL_NAMES)

    return set()
