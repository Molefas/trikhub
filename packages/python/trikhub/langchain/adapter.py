"""
LangChain/LangGraph adapter — enhance() wraps an agent with TrikHub handoff routing.

Mirrors packages/js/gateway/src/langchain/adapter.ts

Usage:
    from langchain_core.messages import HumanMessage
    from langgraph.prebuilt import create_react_agent
    from trikhub.langchain import enhance, get_handoff_tools_for_agent

    agent = create_react_agent(model=model, tools=my_tools)
    app = await enhance(agent)
    response = await app.process_message("find me AI articles")
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol, runtime_checkable

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from trikhub.gateway import (
    HandoffToolDefinition,
    LoadFromConfigOptions,
    TrikGateway,
    TrikGatewayConfig,
)

from trikhub.langchain.schema_converter import json_schema_to_pydantic


# ============================================================================
# Types
# ============================================================================


@runtime_checkable
class InvokableAgent(Protocol):
    """Any agent with a LangGraph-compatible invoke method."""

    async def ainvoke(
        self, input: dict[str, Any], config: Any = None
    ) -> dict[str, Any]: ...


@dataclass
class EnhanceOptions:
    """Options for enhance()."""

    gateway: TrikGatewayConfig | None = None
    config: LoadFromConfigOptions | None = None
    triks_directory: str | None = None
    gateway_instance: TrikGateway | None = None
    debug: bool = False
    verbose: bool = False
    create_agent: Callable[[list[StructuredTool]], InvokableAgent] | None = None


@dataclass
class EnhancedResponse:
    """Response from the enhanced agent."""

    message: str
    """The message to show the user."""
    source: str
    """Where the response came from: "main", a trik ID, or "system"."""


class EnhancedAgent:
    """An enhanced agent with handoff routing."""

    def __init__(
        self,
        gateway: TrikGateway,
        _process_message: Any,
    ) -> None:
        self.gateway = gateway
        self._process_message = _process_message

    async def process_message(
        self, message: str, session_id: str = "default"
    ) -> EnhancedResponse:
        """Process a user message through the routing layer."""
        return await self._process_message(message, session_id)

    def get_loaded_triks(self) -> list[str]:
        """Get the list of loaded trik IDs."""
        return self.gateway.get_loaded_triks()


# ============================================================================
# Debug & Verbose Loggers
# ============================================================================


def _create_debug_logger(enabled: bool) -> Any:
    if not enabled:
        return lambda *args: None

    def _log(*args: Any) -> None:
        print("\033[36m[trikhub]\033[0m", *args, file=sys.stderr)

    return _log


def _create_verbose_logger(enabled: bool) -> Any:
    if not enabled:
        return lambda *args: None

    def _log(*args: Any) -> None:
        print("\033[35m[trikhub:verbose]\033[0m", *args, file=sys.stderr)

    return _log


def _dump_messages(
    verbose: Any, label: str, messages: list[BaseMessage]
) -> None:
    verbose(f"--- {label} ({len(messages)} messages) ---")
    for i, msg in enumerate(messages):
        msg_type = msg.type
        text = _extract_text_content(msg.content)
        truncated = text[:200] + "..." if len(text) > 200 else text

        tool_calls = getattr(msg, "tool_calls", None)
        if tool_calls:
            calls = ", ".join(tc["name"] for tc in tool_calls)
            verbose(f"  [{i}] {msg_type}: \"{truncated}\" [tool_calls: {calls}]")
        else:
            verbose(f'  [{i}] {msg_type}: "{truncated}"')
    verbose(f"--- end {label} ---")


# ============================================================================
# Constants
# ============================================================================

HANDOFF_TOOL_PREFIX = "talk_to_"


# ============================================================================
# enhance()
# ============================================================================


async def enhance(
    agent: InvokableAgent | None,
    options: EnhanceOptions | None = None,
) -> EnhancedAgent:
    """
    Wrap a LangGraph agent with handoff routing to triks.

    This is the main public API for host app developers. It:
    1. Creates a TrikGateway and loads triks
    2. Generates handoff tools (one per loaded trik) and adds them to the agent
    3. Returns an EnhancedAgent that handles the full routing lifecycle

    Recommended usage — pass create_agent to get dynamic tool refresh::

        from langgraph.prebuilt import create_react_agent
        from trikhub.langchain import enhance, EnhanceOptions

        app = await enhance(None, EnhanceOptions(
            create_agent=lambda trik_tools: create_react_agent(
                model=model, tools=[*my_tools, *trik_tools],
            ),
        ))
        response = await app.process_message("find me AI articles")
    """
    opts = options or EnhanceOptions()
    debug = _create_debug_logger(opts.debug or opts.verbose)
    verbose = _create_verbose_logger(opts.verbose)

    # Set up gateway
    gateway = opts.gateway_instance or TrikGateway(opts.gateway)
    await gateway.initialize()

    # Load triks (skip if a pre-built gateway was provided)
    if not opts.gateway_instance:
        if opts.config:
            await gateway.load_triks_from_config(opts.config)
        elif opts.triks_directory:
            await gateway.load_triks_from_directory(opts.triks_directory)

    # Mutable agent reference — updated when triks change (if create_agent is provided)
    current_agent: list[InvokableAgent] = []  # Use list for nonlocal mutability

    if opts.create_agent:
        # Factory mode: enhance() owns agent lifecycle
        def rebuild_agent():
            trik_tools = [
                *_build_handoff_tools(gateway.get_handoff_tools()),
                *_build_exposed_tools(gateway),
            ]
            current_agent.clear()
            current_agent.append(opts.create_agent(trik_tools))
            debug(f"Agent rebuilt with {len(trik_tools)} trik tool(s)")

        # Build initial agent with current tools
        rebuild_agent()

        # Rebuild automatically when triks change
        gateway.on("trik:loaded", lambda _: rebuild_agent())
        gateway.on("trik:unloaded", lambda _: rebuild_agent())
    elif agent is not None:
        # Legacy mode: caller manages agent, no dynamic refresh
        current_agent.append(agent)
    else:
        raise ValueError("enhance() requires either a create_agent factory or a pre-built agent")

    # Per-session message history for the main agent
    main_messages: dict[str, list[BaseMessage]] = {}

    async def _process_message(
        message: str, session_id: str = "default"
    ) -> EnhancedResponse:
        # Route through gateway first
        route = await gateway.route_message(message, session_id)

        if route.target == "trik":
            debug(f"Routed to trik: {route.trik_id} (turn in progress)")
            return EnhancedResponse(
                message=route.response.message,
                source=route.trik_id,
            )

        if route.target == "transfer_back":
            debug(f"Transfer back from: {route.trik_id}")
            debug(f"Transfer-back summary:\n{route.summary}")
            _inject_summary_into_history(
                main_messages, session_id, route.summary, debug
            )
            if route.message.strip():
                return EnhancedResponse(
                    message=route.message,
                    source=route.trik_id,
                )
            return EnhancedResponse(
                message="[Returned to main agent]",
                source="system",
            )

        if route.target == "force_back":
            debug(f"Force /back from: {route.trik_id}")
            debug(f"Force-back summary:\n{route.summary}")
            _inject_summary_into_history(
                main_messages, session_id, route.summary, debug
            )
            return EnhancedResponse(
                message="[Returned to main agent]",
                source="system",
            )

        # target == "main"
        debug("Routing to main agent")
        return await _invoke_main_agent(
            current_agent[0],
            gateway,
            main_messages,
            session_id,
            message,
            debug,
            verbose,
        )

    return EnhancedAgent(
        gateway=gateway,
        _process_message=_process_message,
    )


# ============================================================================
# Main Agent Invocation
# ============================================================================


async def _invoke_main_agent(
    agent: InvokableAgent,
    gateway: TrikGateway,
    main_messages: dict[str, list[BaseMessage]],
    session_id: str,
    message: str,
    debug: Any,
    verbose: Any,
) -> EnhancedResponse:
    """
    Invoke the main agent with the user's message.
    If the agent calls a talk_to_X handoff tool, intercept it and start a handoff.
    """
    # Get or create session message history
    messages = main_messages.get(session_id)
    if messages is None:
        messages = []
        main_messages[session_id] = messages

    # Add user message
    messages.append(HumanMessage(content=message))

    verbose(f"Main agent input (session: {session_id})")
    _dump_messages(verbose, "main agent messages", messages)

    # Invoke agent
    result = await agent.ainvoke({"messages": messages})
    new_messages: list[BaseMessage] = result["messages"]

    verbose("Main agent output")
    _dump_messages(verbose, "main agent result", new_messages)

    # Check for handoff tool calls in the response
    handoff_call = _find_handoff_tool_call(new_messages, len(messages) - 1)

    if handoff_call is not None:
        trik_id = handoff_call["tool_name"][len(HANDOFF_TOOL_PREFIX):].replace("__", "/", 1)
        context = handoff_call["context"]

        debug(
            f'Handoff detected → {trik_id} (context: "{context[:80]}{"..." if len(context) > 80 else ""}")'
        )

        handoff_result = await gateway.start_handoff(trik_id, context, session_id)

        if handoff_result.target == "transfer_back":
            debug(f"Immediate transfer back from: {trik_id}")
            debug(f"Transfer-back summary:\n{handoff_result.summary}")
            main_messages[session_id] = new_messages
            _inject_summary_into_history(
                main_messages, session_id, handoff_result.summary, debug
            )
            return EnhancedResponse(
                message=handoff_result.message,
                source=handoff_result.trik_id,
            )

        debug(f"Handoff active → {trik_id}")
        main_messages[session_id] = new_messages
        return EnhancedResponse(
            message=handoff_result.response.message,
            source=handoff_result.trik_id,
        )

    # No handoff — normal main agent response
    main_messages[session_id] = new_messages
    response_text = _extract_last_ai_message(new_messages)
    return EnhancedResponse(
        message=response_text,
        source="main",
    )


def _inject_summary_into_history(
    main_messages: dict[str, list[BaseMessage]],
    session_id: str,
    summary: str,
    debug: Any,
) -> None:
    """
    Inject a handoff session summary into the main agent's message history
    so it has context for future turns, without invoking the main agent.
    """
    messages = main_messages.get(session_id)
    if messages is None:
        messages = []
        main_messages[session_id] = messages

    messages.append(
        HumanMessage(
            content=f"[System: Trik handoff completed. Session summary:\n{summary}]"
        )
    )
    debug("Injected transfer-back summary into main agent history")


# ============================================================================
# Handoff Tool Building
# ============================================================================


class _HandoffInput(BaseModel):
    context: str = Field(description="Context about what the user needs from this agent")


def _build_handoff_tools(
    definitions: list[HandoffToolDefinition],
) -> list[StructuredTool]:
    """
    Convert gateway HandoffToolDefinitions into LangChain StructuredTools.
    These tools don't actually execute — they're intercepted by enhance().
    """
    tools: list[StructuredTool] = []
    for defn in definitions:

        async def _placeholder(context: str) -> str:
            return f"Handoff initiated with context: {context}"

        tools.append(
            StructuredTool.from_function(
                coroutine=_placeholder,
                name=defn.name,
                description=defn.description,
                args_schema=_HandoffInput,
            )
        )
    return tools


def get_handoff_tools_for_agent(gateway: TrikGateway) -> list[StructuredTool]:
    """
    Get handoff tools as a list for binding to agents.
    Call this after enhance() to get the tools that should be added to your agent.
    """
    return _build_handoff_tools(gateway.get_handoff_tools())


# ============================================================================
# Exposed Tool Building (tool-mode triks)
# ============================================================================


def _build_exposed_tools(gateway: TrikGateway) -> list[StructuredTool]:
    """
    Convert gateway ExposedToolDefinitions into LangChain StructuredTools.
    These tools call gateway.execute_exposed_tool() which returns a template-filled string.
    """
    definitions = gateway.get_exposed_tools()
    tools: list[StructuredTool] = []

    for defn in definitions:
        input_schema = defn.input_schema
        if hasattr(input_schema, "model_dump"):
            input_schema = input_schema.model_dump(by_alias=True, exclude_none=True)

        pydantic_model = json_schema_to_pydantic(input_schema, defn.tool_name + "Input")

        # Capture defn in closure
        _defn = defn
        _gw = gateway

        async def _execute(**kwargs: Any) -> str:
            return await _gw.execute_exposed_tool(
                _defn.trik_id, _defn.tool_name, kwargs
            )

        tools.append(
            StructuredTool.from_function(
                coroutine=_execute,
                name=defn.tool_name,
                description=defn.description,
                args_schema=pydantic_model,
            )
        )

    return tools


def get_exposed_tools_for_agent(gateway: TrikGateway) -> list[StructuredTool]:
    """
    Get exposed tools from tool-mode triks as a list for binding to agents.
    These appear as native tools on the main agent (no handoff, no session).
    """
    return _build_exposed_tools(gateway)


# ============================================================================
# Convenience: load_langchain_triks()
# ============================================================================


@dataclass
class LoadLangChainTriksOptions:
    """Options for load_langchain_triks()."""

    on_passthrough: Any = None
    debug: bool = False
    verbose: bool = False


@dataclass
class LoadLangChainTriksResult:
    """Result from load_langchain_triks()."""

    tools: list[StructuredTool]
    gateway: TrikGateway
    loaded_triks: list[str]


async def load_langchain_triks(
    options: LoadLangChainTriksOptions | None = None,
) -> LoadLangChainTriksResult:
    """
    Convenience function: create a gateway, load triks from .trikhub/config.json,
    and return all tools (handoff + exposed) ready for LangChain binding.

    Example::

        from trikhub.langchain import load_langchain_triks
        result = await load_langchain_triks()
        agent = create_react_agent(model=model, tools=[*my_tools, *result.tools])
    """
    opts = options or LoadLangChainTriksOptions()

    gateway = TrikGateway()
    await gateway.initialize()
    await gateway.load_triks_from_config()

    handoff_tools = get_handoff_tools_for_agent(gateway)
    exposed_tools = get_exposed_tools_for_agent(gateway)

    return LoadLangChainTriksResult(
        tools=[*handoff_tools, *exposed_tools],
        gateway=gateway,
        loaded_triks=gateway.get_loaded_triks(),
    )


# ============================================================================
# Message Parsing Helpers
# ============================================================================


def _find_handoff_tool_call(
    messages: list[BaseMessage],
    start_index: int,
) -> dict[str, str] | None:
    """Find a handoff tool call (talk_to_X) in new messages."""
    for i in range(start_index, len(messages)):
        msg = messages[i]
        if msg.type != "ai":
            continue

        tool_calls = getattr(msg, "tool_calls", None)
        if not tool_calls:
            continue

        for tc in tool_calls:
            name = tc.get("name", "")
            if name.startswith(HANDOFF_TOOL_PREFIX):
                return {
                    "tool_name": name,
                    "context": tc.get("args", {}).get("context", ""),
                    "tool_call_id": tc.get("id", ""),
                }

    return None


def _extract_text_content(content: Any) -> str:
    """Extract text from message content, handling both string and list-of-blocks formats."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                text = block.get("text", "")
                if isinstance(text, str):
                    parts.append(text)
        return "".join(parts)
    return ""


def _extract_last_ai_message(messages: list[BaseMessage]) -> str:
    """Extract the text content from the last AI message in a message list."""
    for msg in reversed(messages):
        if msg.type != "ai":
            continue
        text = _extract_text_content(msg.content)
        if text:
            return text
    return ""
