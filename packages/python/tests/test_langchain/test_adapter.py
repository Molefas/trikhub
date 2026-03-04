"""Tests for LangChain adapter — enhance(), routing, handoff interception."""

import json
import os
import tempfile

import pytest
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage

from trikhub.manifest import (
    TrikContext,
    TrikResponse,
    ToolExecutionResult,
)
from trikhub.gateway import (
    TrikGateway,
    TrikGatewayConfig,
    InMemoryConfigStore,
    InMemoryStorageProvider,
    InMemorySessionStorage,
)
from trikhub.langchain.adapter import (
    EnhancedAgent,
    EnhancedResponse,
    EnhanceOptions,
    enhance,
    get_handoff_tools_for_agent,
    get_exposed_tools_for_agent,
    _extract_text_content,
    _extract_last_ai_message,
    _find_handoff_tool_call,
    HANDOFF_TOOL_PREFIX,
)


# ============================================================================
# Helpers — mock agent and trik directory
# ============================================================================


class MockAgent:
    """A mock LangGraph agent that returns canned responses."""

    def __init__(self, responses: list[list[BaseMessage]] | None = None):
        self._responses = responses or [[AIMessage(content="Hello from agent!")]]
        self._call_count = 0
        self.last_messages: list[BaseMessage] | None = None

    async def ainvoke(self, input: dict, config=None) -> dict:
        self.last_messages = input.get("messages", [])
        idx = min(self._call_count, len(self._responses) - 1)
        result = self._responses[idx]
        self._call_count += 1
        return {"messages": result}


class MockAgentWithHandoff:
    """A mock agent that returns a talk_to_X tool call."""

    def __init__(self, trik_id: str, context: str = "User needs help"):
        self._trik_id = trik_id
        self._context = context

    async def ainvoke(self, input: dict, config=None) -> dict:
        messages = input.get("messages", [])
        return {
            "messages": messages + [
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": f"talk_to_local__{self._trik_id}",
                            "args": {"context": self._context},
                            "id": "call_handoff_1",
                        }
                    ],
                )
            ]
        }


def _create_trik_dir(
    tmpdir: str,
    trik_id: str,
    mode: str = "conversational",
    runtime: str = "python",
    response_message: str = "Hello from trik!",
    transfer_back: bool = False,
    tools: dict | None = None,
) -> str:
    """Create a trik directory with manifest and a simple agent module."""
    trik_dir = os.path.join(tmpdir, trik_id)
    os.makedirs(trik_dir, exist_ok=True)

    manifest: dict = {
        "schemaVersion": 2,
        "id": trik_id,
        "name": trik_id,
        "description": f"Test trik {trik_id}",
        "version": "0.1.0",
        "agent": {
            "mode": mode,
            "domain": ["test"],
        },
        "entry": {
            "module": "./agent.py",
            "export": "agent",
            "runtime": runtime,
        },
    }

    if mode == "conversational":
        manifest["agent"]["handoffDescription"] = f"Talk to {trik_id}"
        manifest["agent"]["systemPrompt"] = f"You are {trik_id}."

    if tools:
        manifest["tools"] = tools

    with open(os.path.join(trik_dir, "manifest.json"), "w") as f:
        json.dump(manifest, f)

    if mode == "conversational":
        agent_code = f"""
from trikhub.manifest import TrikResponse, TrikContext

class Agent:
    async def process_message(self, message: str, context: TrikContext) -> TrikResponse:
        return TrikResponse(
            message={response_message!r},
            transferBack={transfer_back!r},
        )

agent = Agent()
"""
    else:
        agent_code = """
from trikhub.manifest import ToolExecutionResult, TrikContext

class Agent:
    async def execute_tool(self, tool_name: str, input: dict, context: TrikContext) -> ToolExecutionResult:
        return ToolExecutionResult(output={"result": f"executed {tool_name}"})

agent = Agent()
"""

    with open(os.path.join(trik_dir, "agent.py"), "w") as f:
        f.write(agent_code)

    return trik_dir


def _make_gateway_config() -> TrikGatewayConfig:
    return TrikGatewayConfig(
        config_store=InMemoryConfigStore(),
        storage_provider=InMemoryStorageProvider(),
        session_storage=InMemorySessionStorage(),
    )


# ============================================================================
# Tests — enhance() basic flow
# ============================================================================


class TestEnhanceBasic:
    async def test_enhance_returns_enhanced_agent(self):
        agent = MockAgent()
        gateway = TrikGateway(_make_gateway_config())
        await gateway.initialize()

        app = await enhance(
            agent, EnhanceOptions(gateway_instance=gateway)
        )
        assert isinstance(app, EnhancedAgent)
        assert app.gateway is gateway

    async def test_process_message_routes_to_main(self):
        agent = MockAgent([
            [HumanMessage(content="hi"), AIMessage(content="Hello back!")]
        ])
        gateway = TrikGateway(_make_gateway_config())
        await gateway.initialize()

        app = await enhance(
            agent, EnhanceOptions(gateway_instance=gateway)
        )
        response = await app.process_message("hi")
        assert response.source == "main"
        assert response.message == "Hello back!"

    async def test_get_loaded_triks_empty(self):
        agent = MockAgent()
        gateway = TrikGateway(_make_gateway_config())
        await gateway.initialize()

        app = await enhance(
            agent, EnhanceOptions(gateway_instance=gateway)
        )
        assert app.get_loaded_triks() == []


# ============================================================================
# Tests — routing with loaded triks
# ============================================================================


class TestRoutingWithTriks:
    async def test_handoff_tool_call_starts_handoff(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            _create_trik_dir(tmpdir, "helper-trik", response_message="I can help!")

            config = _make_gateway_config()
            gateway = TrikGateway(config)
            await gateway.initialize()
            await gateway.load_trik(os.path.join(tmpdir, "helper-trik"))

            agent = MockAgentWithHandoff("helper-trik", "User needs assistance")

            app = await enhance(
                agent, EnhanceOptions(gateway_instance=gateway)
            )
            response = await app.process_message("help me")
            assert response.source == "local/helper-trik"
            assert response.message == "I can help!"

    async def test_active_handoff_routes_to_trik(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            _create_trik_dir(tmpdir, "chat-trik", response_message="Still chatting!")

            config = _make_gateway_config()
            gateway = TrikGateway(config)
            await gateway.initialize()
            await gateway.load_trik(os.path.join(tmpdir, "chat-trik"))

            agent = MockAgentWithHandoff("chat-trik")

            app = await enhance(
                agent, EnhanceOptions(gateway_instance=gateway)
            )

            # First message triggers handoff
            r1 = await app.process_message("start")
            assert r1.source == "local/chat-trik"

            # Second message goes to trik (active handoff)
            r2 = await app.process_message("continue")
            assert r2.source == "local/chat-trik"
            assert r2.message == "Still chatting!"

    async def test_transfer_back_returns_to_main(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            _create_trik_dir(
                tmpdir,
                "done-trik",
                response_message="All done!",
                transfer_back=True,
            )

            config = _make_gateway_config()
            gateway = TrikGateway(config)
            await gateway.initialize()
            await gateway.load_trik(os.path.join(tmpdir, "done-trik"))

            agent = MockAgentWithHandoff("done-trik")

            app = await enhance(
                agent, EnhanceOptions(gateway_instance=gateway)
            )

            # Handoff triggers but trik immediately transfers back
            response = await app.process_message("do something")
            assert response.source == "local/done-trik"
            assert response.message == "All done!"

    async def test_force_back_via_slash_back(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            _create_trik_dir(tmpdir, "stuck-trik", response_message="...")

            config = _make_gateway_config()
            gateway = TrikGateway(config)
            await gateway.initialize()
            await gateway.load_trik(os.path.join(tmpdir, "stuck-trik"))

            agent = MockAgentWithHandoff("stuck-trik")

            app = await enhance(
                agent, EnhanceOptions(gateway_instance=gateway)
            )

            # Start handoff
            await app.process_message("start")

            # Force back
            response = await app.process_message("/back")
            assert response.source == "system"
            assert response.message == "[Returned to main agent]"


# ============================================================================
# Tests — session message history
# ============================================================================


class TestSessionHistory:
    async def test_separate_sessions_have_separate_history(self):
        call_count = 0

        class CountingAgent:
            async def ainvoke(self, input: dict, config=None) -> dict:
                nonlocal call_count
                call_count += 1
                messages = input.get("messages", [])
                return {
                    "messages": messages
                    + [AIMessage(content=f"Response {call_count}")]
                }

        gateway = TrikGateway(_make_gateway_config())
        await gateway.initialize()

        app = await enhance(
            CountingAgent(), EnhanceOptions(gateway_instance=gateway)
        )

        r1 = await app.process_message("hello", session_id="session-a")
        r2 = await app.process_message("hello", session_id="session-b")

        assert r1.message == "Response 1"
        assert r2.message == "Response 2"


# ============================================================================
# Tests — handoff tool generation
# ============================================================================


class TestHandoffTools:
    async def test_get_handoff_tools_for_agent(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            _create_trik_dir(tmpdir, "my-trik")

            config = _make_gateway_config()
            gateway = TrikGateway(config)
            await gateway.initialize()
            await gateway.load_trik(os.path.join(tmpdir, "my-trik"))

            tools = get_handoff_tools_for_agent(gateway)
            assert len(tools) == 1
            assert tools[0].name == "talk_to_local__my-trik"
            assert "Talk to my-trik" in tools[0].description

    async def test_no_handoff_tools_for_tool_mode_triks(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            _create_trik_dir(
                tmpdir,
                "tool-trik",
                mode="tool",
                tools={
                    "searchItems": {
                        "description": "Search items",
                        "inputSchema": {
                            "type": "object",
                            "properties": {"query": {"type": "string"}},
                            "required": ["query"],
                        },
                        "outputSchema": {
                            "type": "object",
                            "properties": {
                                "result": {
                                    "type": "string",
                                    "enum": ["found", "not_found"],
                                }
                            },
                            "required": ["result"],
                        },
                        "outputTemplate": "Result: {{result}}",
                    }
                },
            )

            config = _make_gateway_config()
            gateway = TrikGateway(config)
            await gateway.initialize()
            await gateway.load_trik(os.path.join(tmpdir, "tool-trik"))

            handoff_tools = get_handoff_tools_for_agent(gateway)
            assert len(handoff_tools) == 0


# ============================================================================
# Tests — exposed tools
# ============================================================================


class TestExposedTools:
    async def test_get_exposed_tools_for_agent(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            _create_trik_dir(
                tmpdir,
                "tool-trik",
                mode="tool",
                tools={
                    "searchItems": {
                        "description": "Search items",
                        "inputSchema": {
                            "type": "object",
                            "properties": {"query": {"type": "string"}},
                            "required": ["query"],
                        },
                        "outputSchema": {
                            "type": "object",
                            "properties": {
                                "result": {
                                    "type": "string",
                                    "enum": ["found", "not_found"],
                                }
                            },
                            "required": ["result"],
                        },
                        "outputTemplate": "Result: {{result}}",
                    }
                },
            )

            config = _make_gateway_config()
            gateway = TrikGateway(config)
            await gateway.initialize()
            await gateway.load_trik(os.path.join(tmpdir, "tool-trik"))

            tools = get_exposed_tools_for_agent(gateway)
            assert len(tools) == 1
            assert tools[0].name == "searchItems"
            assert tools[0].description == "Search items"


# ============================================================================
# Tests — message parsing helpers
# ============================================================================


class TestMessageHelpers:
    def test_extract_text_content_string(self):
        assert _extract_text_content("hello") == "hello"

    def test_extract_text_content_blocks(self):
        blocks = [
            {"type": "text", "text": "hello "},
            {"type": "text", "text": "world"},
        ]
        assert _extract_text_content(blocks) == "hello world"

    def test_extract_text_content_mixed_blocks(self):
        blocks = [
            {"type": "image", "url": "..."},
            {"type": "text", "text": "caption"},
        ]
        assert _extract_text_content(blocks) == "caption"

    def test_extract_text_content_non_string(self):
        assert _extract_text_content(12345) == ""

    def test_extract_last_ai_message(self):
        messages = [
            HumanMessage(content="hi"),
            AIMessage(content="hello"),
            HumanMessage(content="bye"),
        ]
        assert _extract_last_ai_message(messages) == "hello"

    def test_extract_last_ai_message_empty(self):
        messages = [HumanMessage(content="hi")]
        assert _extract_last_ai_message(messages) == ""

    def test_find_handoff_tool_call_present(self):
        messages: list[BaseMessage] = [
            HumanMessage(content="help"),
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "talk_to_my-trik",
                        "args": {"context": "needs help"},
                        "id": "call_1",
                    }
                ],
            ),
        ]
        result = _find_handoff_tool_call(messages, 0)
        assert result is not None
        assert result["tool_name"] == "talk_to_my-trik"
        assert result["context"] == "needs help"

    def test_find_handoff_tool_call_absent(self):
        messages: list[BaseMessage] = [
            HumanMessage(content="help"),
            AIMessage(content="I'll help you directly"),
        ]
        result = _find_handoff_tool_call(messages, 0)
        assert result is None

    def test_find_handoff_ignores_non_handoff_tools(self):
        messages: list[BaseMessage] = [
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "web_search",
                        "args": {"query": "test"},
                        "id": "call_1",
                    }
                ],
            ),
        ]
        result = _find_handoff_tool_call(messages, 0)
        assert result is None


# ============================================================================
# Tests — debug/verbose logging
# ============================================================================


class TestDebugLogging:
    async def test_debug_mode_doesnt_crash(self):
        agent = MockAgent([
            [HumanMessage(content="hi"), AIMessage(content="debug test")]
        ])
        gateway = TrikGateway(_make_gateway_config())
        await gateway.initialize()

        app = await enhance(
            agent, EnhanceOptions(gateway_instance=gateway, debug=True)
        )
        response = await app.process_message("hi")
        assert response.message == "debug test"

    async def test_verbose_mode_doesnt_crash(self):
        agent = MockAgent([
            [HumanMessage(content="hi"), AIMessage(content="verbose test")]
        ])
        gateway = TrikGateway(_make_gateway_config())
        await gateway.initialize()

        app = await enhance(
            agent, EnhanceOptions(gateway_instance=gateway, verbose=True)
        )
        response = await app.process_message("hi")
        assert response.message == "verbose test"


# ============================================================================
# Tests — triks_directory option
# ============================================================================


class TestTriksDirectory:
    async def test_loads_triks_from_directory(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            _create_trik_dir(tmpdir, "auto-trik", response_message="auto-loaded!")

            agent = MockAgent()
            app = await enhance(
                agent,
                EnhanceOptions(
                    gateway=_make_gateway_config(),
                    triks_directory=tmpdir,
                ),
            )
            assert "local/auto-trik" in app.get_loaded_triks()
