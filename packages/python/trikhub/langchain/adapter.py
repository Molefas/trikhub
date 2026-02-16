"""
LangChain adapter for TrikHub.

This module provides utilities for converting TrikHub tools to LangChain tools,
making it easy to integrate triks with LangChain-based agents.

Mirrors packages/js/gateway/src/langchain/adapter.ts
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable

from langchain_core.tools import StructuredTool

from trikhub.gateway import (
    TrikGateway,
    TrikGatewayConfig,
    ToolDefinition,
    ExecuteTrikOptions,
    LoadFromConfigOptions,
    GatewayResultWithSession,
)
from trikhub.manifest import (
    PassthroughContent,
    GatewaySuccessTemplate,
    GatewaySuccessPassthrough,
    GatewayError,
)
from trikhub.langchain.schema_converter import json_schema_to_pydantic


@dataclass
class LangChainAdapterOptions:
    """Options for creating LangChain tools from a gateway."""

    # Get session ID for a trik (for multi-turn conversations)
    get_session_id: Callable[[str], str | None] | None = None
    # Store session ID for a trik
    set_session_id: Callable[[str, str], None] | None = None
    # Callback when passthrough content is delivered
    on_passthrough: Callable[[PassthroughContent], None] | None = None
    # Enable debug logging
    debug: bool = False


@dataclass
class LoadLangChainTriksOptions:
    """Options for the simplified load_langchain_triks function."""

    # Callback when passthrough content is delivered
    # Passthrough content bypasses the agent and goes directly to the user
    on_passthrough: Callable[[PassthroughContent], None] | None = None
    # Enable debug logging
    debug: bool = False
    # Path to the .trikhub/config.json file
    config_path: str | None = None
    # Base directory for resolving trik paths
    base_dir: str | None = None


@dataclass
class LangChainTriksResult:
    """Result from load_langchain_triks."""

    # LangChain tools ready to bind to a model
    tools: list[StructuredTool]
    # The gateway instance for advanced operations
    gateway: TrikGateway
    # List of loaded trik IDs (for logging/display)
    loaded_triks: list[str]


def _fill_template(template: str, data: dict[str, Any]) -> str:
    """Fill a template string with data values."""

    def replace_fn(match: re.Match[str]) -> str:
        key = match.group(1)
        return str(data.get(key, f"{{{{{key}}}}}"))

    return re.sub(r"\{\{(\w+)\}\}", replace_fn, template)


def _to_tool_name(gateway_name: str) -> str:
    """
    Convert a gateway tool name to a LangChain-compatible tool name.

    LangChain tool names must be valid Python identifiers.
    Example: "@molefas/article-search:list" -> "@molefas_article_search__list"
    """
    return gateway_name.replace("/", "_").replace("-", "_").replace(":", "__")


def parse_tool_name(tool_name: str) -> tuple[str, str]:
    """
    Parse a LangChain tool name back to trik ID and action name.

    Args:
        tool_name: The LangChain tool name (e.g., "@molefas_article_search__list")

    Returns:
        Tuple of (trik_id, action_name)

    Raises:
        ValueError: If the tool name format is invalid
    """
    parts = tool_name.split("__")
    if len(parts) != 2:
        raise ValueError(f"Invalid tool name format: {tool_name}")

    return parts[0], parts[1]


def _create_tool_from_definition(
    tool_def: ToolDefinition,
    gateway: TrikGateway,
    options: LangChainAdapterOptions,
) -> StructuredTool:
    """Create a LangChain StructuredTool from a gateway tool definition."""
    get_session_id = options.get_session_id
    set_session_id = options.set_session_id
    on_passthrough = options.on_passthrough
    debug = options.debug

    langchain_name = _to_tool_name(tool_def.name)

    # Parse trik ID and action name from "trik-id:action-name"
    parts = tool_def.name.split(":")
    trik_id = parts[0]
    action_name = parts[1] if len(parts) > 1 else parts[0]

    # Convert JSON Schema to Pydantic model for LangChain
    pydantic_model = json_schema_to_pydantic(
        tool_def.input_schema, model_name=f"{langchain_name}_Input"
    )

    async def tool_func(**kwargs: Any) -> str:
        """Execute the trik action and return the result."""
        if debug:
            print(f"[Tool] {tool_def.name}: {json.dumps(kwargs)}")

        session_id = get_session_id(trik_id) if get_session_id else None
        result = await gateway.execute(
            trik_id,
            action_name,
            kwargs,
            ExecuteTrikOptions(session_id=session_id),
        )

        inner = result.result

        # Handle errors
        if isinstance(inner, GatewayError):
            return json.dumps({"success": False, "error": inner.error})

        # Track session
        if result.session_id and set_session_id:
            set_session_id(trik_id, result.session_id)
            if debug:
                print(f"[Tool] Session tracked: {result.session_id}")

        # Handle passthrough responses
        if isinstance(inner, GatewaySuccessPassthrough):
            delivery = gateway.deliver_content(inner.userContentRef)

            if not delivery:
                return json.dumps(
                    {"success": False, "error": "Content not found or expired"}
                )

            content, receipt = delivery

            if debug:
                print(
                    f"[Tool] Auto-delivered passthrough content: {receipt.contentType}"
                )

            if on_passthrough:
                on_passthrough(content)

            return json.dumps(
                {"success": True, "response": "Delivered directly to the user"}
            )

        # Handle template responses
        if isinstance(inner, GatewaySuccessTemplate):
            response = (
                _fill_template(inner.templateText, inner.agentData)
                if inner.templateText
                else json.dumps(inner.agentData)
            )

            if debug:
                print(f"[Tool] Auto-filled template response: {response}")

            return json.dumps({"success": True, "response": response})

        # Unknown response type
        return json.dumps({"success": False, "error": "Unknown response type"})

    return StructuredTool.from_function(
        coroutine=tool_func,
        name=langchain_name,
        description=tool_def.description,
        args_schema=pydantic_model,
    )


def create_langchain_tools(
    gateway: TrikGateway,
    options: LangChainAdapterOptions | None = None,
) -> list[StructuredTool]:
    """
    Create LangChain tools from a TrikGateway.

    Args:
        gateway: An initialized TrikGateway with loaded triks
        options: Adapter options for session management and callbacks

    Returns:
        List of LangChain StructuredTool objects
    """
    options = options or LangChainAdapterOptions()
    debug = options.debug
    tool_defs = gateway.get_tool_definitions()

    if debug:
        print(f"[LangChainAdapter] Creating {len(tool_defs)} tools from gateway:")
        for td in tool_defs:
            print(f"  - {td.name} ({td.response_mode})")

    return [
        _create_tool_from_definition(td, gateway, options) for td in tool_defs
    ]


def get_tool_name_map(gateway: TrikGateway) -> dict[str, str]:
    """
    Get a mapping from LangChain tool names to gateway tool names.

    Useful for debugging and logging.

    Args:
        gateway: An initialized TrikGateway

    Returns:
        Dict mapping LangChain names to gateway names
    """
    tool_defs = gateway.get_tool_definitions()
    return {_to_tool_name(td.name): td.name for td in tool_defs}


async def load_langchain_triks(
    options: LoadLangChainTriksOptions | None = None,
) -> LangChainTriksResult:
    """
    Load triks and create LangChain tools with minimal boilerplate.

    This is the recommended way to integrate Triks with LangChain.
    For more control, use create_langchain_tools() directly.

    Example:
        ```python
        result = await load_langchain_triks(
            LoadLangChainTriksOptions(
                on_passthrough=lambda c: print(f"Passthrough: {c.content}"),
                debug=True,
            )
        )

        model = ChatAnthropic().bind_tools(result.tools)
        ```

    Args:
        options: Loading and adapter options

    Returns:
        LangChainTriksResult with tools, gateway, and loaded trik IDs
    """
    options = options or LoadLangChainTriksOptions()
    on_passthrough = options.on_passthrough
    debug = options.debug
    config_path = options.config_path
    base_dir = options.base_dir

    # Create gateway and initialize (loads secrets from .trikhub/secrets.json)
    gateway = TrikGateway()
    await gateway.initialize()

    # Load triks from config
    manifests = await gateway.load_triks_from_config(
        LoadFromConfigOptions(config_path=config_path, base_dir=base_dir)
    )

    loaded_triks = [m.id for m in manifests]

    if debug:
        print(
            f"[load_langchain_triks] Loaded {len(loaded_triks)} triks: {', '.join(loaded_triks)}"
        )

    # Internal session management
    sessions: dict[str, str] = {}

    # Create LangChain tools with internal session management
    adapter_options = LangChainAdapterOptions(
        get_session_id=lambda trik_id: sessions.get(trik_id),
        set_session_id=lambda trik_id, session_id: sessions.__setitem__(
            trik_id, session_id
        ),
        on_passthrough=on_passthrough,
        debug=debug,
    )

    tools = create_langchain_tools(gateway, adapter_options)

    if debug:
        print(f"[load_langchain_triks] Created {len(tools)} tools")

    return LangChainTriksResult(
        tools=tools,
        gateway=gateway,
        loaded_triks=loaded_triks,
    )
