"""
Wrap a LangGraph agent into a TrikAgent with processMessage support.

Maintains per-session message history, lazy-initializes factory agents,
and extracts tool calls + transfer_back signals from the LangGraph response.
Mirrors packages/js/sdk/src/wrap-agent.ts.
"""

from __future__ import annotations

from typing import Any, Protocol, Union, runtime_checkable

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage

from trikhub.manifest import TrikContext, TrikResponse

from .interceptor import extract_tool_info
from .workspace_tools import WORKSPACE_SYSTEM_PROMPT, get_active_workspace_tool_names
from .registry_tools import REGISTRY_SYSTEM_PROMPT, get_active_registry_tool_names


@runtime_checkable
class InvokableAgent(Protocol):
    """A LangGraph agent that can be invoked with messages."""

    async def ainvoke(
        self, input: dict[str, Any], config: Any = None
    ) -> dict[str, Any]: ...


AgentFactory = Union[
    type["_Callable_AgentFactory"],
    Any,  # Callable[[TrikContext], InvokableAgent | Awaitable[InvokableAgent]]
]


class _Callable_AgentFactory(Protocol):
    """Protocol for agent factory callables."""

    def __call__(self, context: TrikContext) -> Any: ...


class _WrappedAgent:
    """TrikAgent implementation wrapping a LangGraph agent."""

    def __init__(self, agent_or_factory: Any) -> None:
        self._agent_or_factory = agent_or_factory
        self._resolved_agent: InvokableAgent | None = None
        self._session_messages: dict[str, list[BaseMessage]] = {}
        self._session_has_system_prompt: set[str] = set()

        # If it's already an invokable agent (has ainvoke), use it directly
        if hasattr(agent_or_factory, "ainvoke"):
            self._resolved_agent = agent_or_factory

    async def _get_agent(self, context: TrikContext) -> InvokableAgent:
        """Lazily resolve the agent from a factory if needed."""
        if self._resolved_agent is None:
            result = self._agent_or_factory(context)
            # Support async factories
            if hasattr(result, "__await__"):
                result = await result
            self._resolved_agent = result
        return self._resolved_agent

    async def process_message(self, message: str, context: TrikContext) -> TrikResponse:
        """Process a user message through the wrapped LangGraph agent.

        Maintains per-session message history and extracts tool calls
        from the agent's response. When capabilities are present,
        filters workspace tool calls from output and prepends system prompt.
        """
        agent = await self._get_agent(context)

        # Determine which internal tools are active (for output filtering)
        workspace_tool_names = get_active_workspace_tool_names(context.capabilities)
        registry_tool_names = get_active_registry_tool_names(context.capabilities)

        # Get or create session history
        session_id = context.sessionId
        messages = self._session_messages.get(session_id, [])

        # Prepend system prompts on first message of a session
        if session_id not in self._session_has_system_prompt:
            if workspace_tool_names:
                messages.append(SystemMessage(content=WORKSPACE_SYSTEM_PROMPT))
            if registry_tool_names:
                messages.append(SystemMessage(content=REGISTRY_SYSTEM_PROMPT))
            if workspace_tool_names or registry_tool_names:
                self._session_has_system_prompt.add(session_id)

        # Mark start of this turn for interceptor
        start_index = len(messages)

        # Append user message
        messages.append(HumanMessage(content=message))

        # Invoke the agent
        result = await agent.ainvoke({"messages": messages})

        # Update session history with full result
        result_messages: list[BaseMessage] = result.get("messages", messages)
        self._session_messages[session_id] = result_messages

        # Extract tool info from new messages only
        info = extract_tool_info(result_messages, start_index)

        # Filter out internal tool calls from the output (workspace + registry)
        internal_tool_names = workspace_tool_names | registry_tool_names
        if internal_tool_names:
            filtered_tool_calls = [
                tc for tc in info.tool_calls if tc.tool not in internal_tool_names
            ]
        else:
            filtered_tool_calls = info.tool_calls

        return TrikResponse(
            message=info.response_message,
            transferBack=info.transfer_back,
            toolCalls=filtered_tool_calls if filtered_tool_calls else None,
        )


def wrap_agent(agent_or_factory: Any) -> _WrappedAgent:
    """Wrap a LangGraph agent (or factory) into a TrikAgent.

    The agent can be:
    - A pre-built LangGraph agent with an `ainvoke` method
    - A factory function `(context: TrikContext) -> agent` (sync or async)
      The factory is called once lazily on first message, then cached.

    The returned object implements the TrikAgent protocol with `process_message()`.

    Args:
        agent_or_factory: A LangGraph agent instance or factory function

    Returns:
        A TrikAgent-compatible object with process_message()
    """
    return _WrappedAgent(agent_or_factory)
