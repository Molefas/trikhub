"""Tests for TrikGateway — unit tests with mocked triks (no subprocess)."""

import json
import os
import tempfile

import pytest

from trikhub.manifest import (
    AgentDefinition,
    ToolCallRecord,
    ToolDeclaration,
    TrikContext,
    TrikEntry,
    TrikManifest,
    TrikResponse,
    ToolExecutionResult,
    JSONSchema,
)
from trikhub.gateway.gateway import (
    TrikGateway,
    TrikGatewayConfig,
    RouteToMain,
    RouteToTrik,
    RouteTransferBack,
    RouteForceBack,
)
from trikhub.gateway.config_store import InMemoryConfigStore
from trikhub.gateway.storage_provider import InMemoryStorageProvider
from trikhub.gateway.session_storage import InMemorySessionStorage


# ============================================================================
# Helpers — create mock trik directories
# ============================================================================


def _create_trik_dir(
    tmpdir: str,
    trik_id: str,
    mode: str = "conversational",
    runtime: str = "python",
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

    # Write a Python agent module
    if mode == "conversational":
        agent_code = """
from trikhub.manifest import TrikResponse, TrikContext

class _Agent:
    async def process_message(self, message: str, context: TrikContext) -> TrikResponse:
        return TrikResponse(
            message=f"Echo: {message}",
            transferBack=False,
        )

agent = _Agent()
"""
    else:
        agent_code = """
from trikhub.manifest import ToolExecutionResult, TrikContext

class _Agent:
    async def execute_tool(self, tool_name: str, input: dict, context: TrikContext) -> ToolExecutionResult:
        return ToolExecutionResult(output={"result": f"Executed {tool_name}"})

agent = _Agent()
"""
    with open(os.path.join(trik_dir, "agent.py"), "w") as f:
        f.write(agent_code)

    return trik_dir


def _create_transfer_back_trik(tmpdir: str, trik_id: str) -> str:
    """Create a conversational trik that always transfers back."""
    trik_dir = os.path.join(tmpdir, trik_id)
    os.makedirs(trik_dir, exist_ok=True)

    manifest = {
        "schemaVersion": 2,
        "id": trik_id,
        "name": trik_id,
        "description": f"Transfer-back trik",
        "version": "0.1.0",
        "agent": {
            "mode": "conversational",
            "handoffDescription": f"Talk to {trik_id}",
            "systemPrompt": "You transfer back.",
            "domain": ["test"],
        },
        "entry": {
            "module": "./agent.py",
            "export": "agent",
            "runtime": "python",
        },
    }
    with open(os.path.join(trik_dir, "manifest.json"), "w") as f:
        json.dump(manifest, f)

    agent_code = """
from trikhub.manifest import TrikResponse, TrikContext

class _Agent:
    async def process_message(self, message: str, context: TrikContext) -> TrikResponse:
        return TrikResponse(
            message="Done! Transferring back.",
            transferBack=True,
        )

agent = _Agent()
"""
    with open(os.path.join(trik_dir, "agent.py"), "w") as f:
        f.write(agent_code)

    return trik_dir


def _create_error_trik(tmpdir: str, trik_id: str) -> str:
    """Create a conversational trik that always raises."""
    trik_dir = os.path.join(tmpdir, trik_id)
    os.makedirs(trik_dir, exist_ok=True)

    manifest = {
        "schemaVersion": 2,
        "id": trik_id,
        "name": trik_id,
        "description": f"Error trik",
        "version": "0.1.0",
        "agent": {
            "mode": "conversational",
            "handoffDescription": f"Talk to {trik_id}",
            "systemPrompt": "You error.",
            "domain": ["test"],
        },
        "entry": {
            "module": "./agent.py",
            "export": "agent",
            "runtime": "python",
        },
    }
    with open(os.path.join(trik_dir, "manifest.json"), "w") as f:
        json.dump(manifest, f)

    agent_code = """
from trikhub.manifest import TrikResponse, TrikContext

class _Agent:
    async def process_message(self, message: str, context: TrikContext) -> TrikResponse:
        raise RuntimeError("Intentional test error")

agent = _Agent()
"""
    with open(os.path.join(trik_dir, "agent.py"), "w") as f:
        f.write(agent_code)

    return trik_dir


def _make_gateway() -> TrikGateway:
    return TrikGateway(TrikGatewayConfig(
        config_store=InMemoryConfigStore(),
        storage_provider=InMemoryStorageProvider(),
        session_storage=InMemorySessionStorage(),
    ))


# ============================================================================
# Tests: Loading
# ============================================================================


@pytest.mark.asyncio
async def test_load_python_trik():
    with tempfile.TemporaryDirectory() as tmpdir:
        trik_dir = _create_trik_dir(tmpdir, "test-trik")
        gw = _make_gateway()
        await gw.initialize()

        manifest = await gw.load_trik(trik_dir)
        assert manifest.id == "test-trik"
        assert gw.is_loaded("test-trik")


@pytest.mark.asyncio
async def test_load_trik_invalid_manifest():
    with tempfile.TemporaryDirectory() as tmpdir:
        trik_dir = os.path.join(tmpdir, "bad")
        os.makedirs(trik_dir)
        with open(os.path.join(trik_dir, "manifest.json"), "w") as f:
            json.dump({"bad": "manifest"}, f)

        gw = _make_gateway()
        await gw.initialize()

        with pytest.raises(ValueError, match="Invalid manifest"):
            await gw.load_trik(trik_dir)


@pytest.mark.asyncio
async def test_loaded_triks_query():
    with tempfile.TemporaryDirectory() as tmpdir:
        _create_trik_dir(tmpdir, "trik-a")
        _create_trik_dir(tmpdir, "trik-b")

        gw = _make_gateway()
        await gw.initialize()
        await gw.load_trik(os.path.join(tmpdir, "trik-a"))
        await gw.load_trik(os.path.join(tmpdir, "trik-b"))

        assert sorted(gw.get_loaded_triks()) == ["trik-a", "trik-b"]


@pytest.mark.asyncio
async def test_unload_trik():
    with tempfile.TemporaryDirectory() as tmpdir:
        trik_dir = _create_trik_dir(tmpdir, "test-trik")
        gw = _make_gateway()
        await gw.initialize()
        await gw.load_trik(trik_dir)

        assert gw.unload_trik("test-trik") is True
        assert gw.is_loaded("test-trik") is False
        assert gw.unload_trik("test-trik") is False


# ============================================================================
# Tests: Routing (no handoff)
# ============================================================================


@pytest.mark.asyncio
async def test_route_message_no_handoff():
    gw = _make_gateway()
    await gw.initialize()

    result = await gw.route_message("hello", "session-1")
    assert isinstance(result, RouteToMain)
    assert result.target == "main"


@pytest.mark.asyncio
async def test_handoff_tools():
    with tempfile.TemporaryDirectory() as tmpdir:
        _create_trik_dir(tmpdir, "trik-a")
        _create_trik_dir(tmpdir, "trik-b", mode="tool", tools={
            "search": {
                "description": "Search things",
                "inputSchema": {"type": "object", "properties": {"q": {"type": "string"}}, "required": ["q"]},
                "outputSchema": {"type": "object", "properties": {"result": {"type": "string", "maxLength": 500, "pattern": ".*"}}},
                "outputTemplate": "Found: {{result}}",
            }
        })

        gw = _make_gateway()
        await gw.initialize()
        await gw.load_trik(os.path.join(tmpdir, "trik-a"))
        await gw.load_trik(os.path.join(tmpdir, "trik-b"))

        handoff_tools = gw.get_handoff_tools()
        assert len(handoff_tools) == 1
        assert handoff_tools[0].name == "talk_to_trik-a"

        exposed_tools = gw.get_exposed_tools()
        assert len(exposed_tools) == 1
        assert exposed_tools[0].tool_name == "search"


# ============================================================================
# Tests: Handoff Flow
# ============================================================================


@pytest.mark.asyncio
async def test_start_handoff():
    with tempfile.TemporaryDirectory() as tmpdir:
        _create_trik_dir(tmpdir, "echo-trik")
        gw = _make_gateway()
        await gw.initialize()
        await gw.load_trik(os.path.join(tmpdir, "echo-trik"))

        result = await gw.start_handoff("echo-trik", "Hello!", "session-1")
        assert isinstance(result, RouteToTrik)
        assert result.trik_id == "echo-trik"
        assert "Echo: Hello!" in result.response.message

        # Now route_message should go to trik
        result2 = await gw.route_message("Follow-up", "session-1")
        assert isinstance(result2, RouteToTrik)
        assert "Echo: Follow-up" in result2.response.message


@pytest.mark.asyncio
async def test_transfer_back():
    with tempfile.TemporaryDirectory() as tmpdir:
        trik_dir = _create_transfer_back_trik(tmpdir, "done-trik")
        gw = _make_gateway()
        await gw.initialize()
        await gw.load_trik(trik_dir)

        result = await gw.start_handoff("done-trik", "Do it", "session-1")
        assert isinstance(result, RouteTransferBack)
        assert result.target == "transfer_back"
        assert "Done!" in result.message

        # After transfer back, routing goes to main
        result2 = await gw.route_message("hello again", "session-1")
        assert isinstance(result2, RouteToMain)


@pytest.mark.asyncio
async def test_force_back():
    with tempfile.TemporaryDirectory() as tmpdir:
        _create_trik_dir(tmpdir, "echo-trik")
        gw = _make_gateway()
        await gw.initialize()
        await gw.load_trik(os.path.join(tmpdir, "echo-trik"))

        await gw.start_handoff("echo-trik", "Hello", "session-1")

        result = await gw.route_message("/back", "session-1")
        assert isinstance(result, RouteForceBack)
        assert result.target == "force_back"

        # Now back to main
        result2 = await gw.route_message("hello", "session-1")
        assert isinstance(result2, RouteToMain)


@pytest.mark.asyncio
async def test_max_turns():
    with tempfile.TemporaryDirectory() as tmpdir:
        _create_trik_dir(tmpdir, "echo-trik")
        gw = TrikGateway(TrikGatewayConfig(
            config_store=InMemoryConfigStore(),
            storage_provider=InMemoryStorageProvider(),
            session_storage=InMemorySessionStorage(),
            max_turns_per_handoff=2,
        ))
        await gw.initialize()
        await gw.load_trik(os.path.join(tmpdir, "echo-trik"))

        # Start handoff (turn 1)
        await gw.start_handoff("echo-trik", "Hello", "session-1")
        # Turn 2
        await gw.route_message("msg2", "session-1")
        # Turn 3 — should auto-transfer-back
        result = await gw.route_message("msg3", "session-1")
        assert isinstance(result, RouteTransferBack)
        assert "Maximum turns" in result.message


@pytest.mark.asyncio
async def test_error_auto_transfer_back():
    with tempfile.TemporaryDirectory() as tmpdir:
        trik_dir = _create_error_trik(tmpdir, "error-trik")
        gw = _make_gateway()
        await gw.initialize()
        await gw.load_trik(trik_dir)

        result = await gw.start_handoff("error-trik", "trigger error", "session-1")
        assert isinstance(result, RouteTransferBack)
        assert "error" in result.message.lower()


@pytest.mark.asyncio
async def test_active_handoff_state():
    with tempfile.TemporaryDirectory() as tmpdir:
        _create_trik_dir(tmpdir, "echo-trik")
        gw = _make_gateway()
        await gw.initialize()
        await gw.load_trik(os.path.join(tmpdir, "echo-trik"))

        assert gw.get_active_handoff() is None
        await gw.start_handoff("echo-trik", "Hello", "session-1")

        state = gw.get_active_handoff()
        assert state is not None
        assert state["trikId"] == "echo-trik"
        assert state["turnCount"] == 1


# ============================================================================
# Tests: Tool Mode
# ============================================================================


@pytest.mark.asyncio
async def test_execute_exposed_tool():
    with tempfile.TemporaryDirectory() as tmpdir:
        trik_dir = _create_trik_dir(tmpdir, "tool-trik", mode="tool", tools={
            "search": {
                "description": "Search",
                "inputSchema": {"type": "object", "properties": {"q": {"type": "string"}}, "required": ["q"]},
                "outputSchema": {"type": "object", "properties": {"result": {"type": "string", "maxLength": 500, "pattern": ".*"}}},
                "outputTemplate": "Found: {{result}}",
            }
        })
        gw = _make_gateway()
        await gw.initialize()
        await gw.load_trik(trik_dir)

        output = await gw.execute_exposed_tool("tool-trik", "search", {"q": "test"})
        assert "Found: Executed search" in output


# ============================================================================
# Tests: Directory Loading
# ============================================================================


@pytest.mark.asyncio
async def test_load_from_directory():
    with tempfile.TemporaryDirectory() as tmpdir:
        _create_trik_dir(tmpdir, "trik-a")
        _create_trik_dir(tmpdir, "trik-b")

        gw = _make_gateway()
        await gw.initialize()
        manifests = await gw.load_triks_from_directory(tmpdir)

        assert len(manifests) == 2
        assert sorted(m.id for m in manifests) == ["trik-a", "trik-b"]


@pytest.mark.asyncio
async def test_load_from_scoped_directory():
    with tempfile.TemporaryDirectory() as tmpdir:
        scoped_dir = os.path.join(tmpdir, "@molefas")
        os.makedirs(scoped_dir)
        trik_dir = os.path.join(scoped_dir, "my-trik")
        os.makedirs(trik_dir)

        manifest = {
            "schemaVersion": 2,
            "id": "my-trik",
            "name": "My Trik",
            "description": "A scoped trik",
            "version": "0.1.0",
            "agent": {"mode": "conversational", "handoffDescription": "Talk to my-trik", "systemPrompt": "You are my-trik.", "domain": ["test"]},
            "entry": {"module": "./agent.py", "export": "agent", "runtime": "python"},
        }
        with open(os.path.join(trik_dir, "manifest.json"), "w") as f:
            json.dump(manifest, f)

        agent_code = """
from trikhub.manifest import TrikResponse, TrikContext
class _Agent:
    async def process_message(self, message: str, context: TrikContext) -> TrikResponse:
        return TrikResponse(message="hi", transferBack=False)
agent = _Agent()
"""
        with open(os.path.join(trik_dir, "agent.py"), "w") as f:
            f.write(agent_code)

        gw = _make_gateway()
        await gw.initialize()
        manifests = await gw.load_triks_from_directory(tmpdir)

        assert len(manifests) == 1
        assert manifests[0].id == "my-trik"


@pytest.mark.asyncio
async def test_load_from_missing_directory():
    gw = _make_gateway()
    await gw.initialize()
    manifests = await gw.load_triks_from_directory("/nonexistent")
    assert manifests == []


# ============================================================================
# Tests: Get Manifest
# ============================================================================


@pytest.mark.asyncio
async def test_load_from_config():
    with tempfile.TemporaryDirectory() as tmpdir:
        # Create .trikhub/config.json
        trikhub_dir = os.path.join(tmpdir, ".trikhub")
        os.makedirs(trikhub_dir)

        # Create a trik in .trikhub/triks/
        triks_dir = os.path.join(trikhub_dir, "triks")
        _create_trik_dir(triks_dir, "config-trik")

        config = {"triks": ["config-trik"]}
        config_path = os.path.join(trikhub_dir, "config.json")
        with open(config_path, "w") as f:
            json.dump(config, f)

        from trikhub.gateway.gateway import LoadFromConfigOptions

        gw = _make_gateway()
        await gw.initialize()
        manifests = await gw.load_triks_from_config(
            LoadFromConfigOptions(config_path=config_path)
        )

        assert len(manifests) == 1
        assert manifests[0].id == "config-trik"


@pytest.mark.asyncio
async def test_load_from_config_missing_file():
    from trikhub.gateway.gateway import LoadFromConfigOptions

    gw = _make_gateway()
    await gw.initialize()
    manifests = await gw.load_triks_from_config(
        LoadFromConfigOptions(config_path="/nonexistent/config.json")
    )
    assert manifests == []


@pytest.mark.asyncio
async def test_load_from_config_no_triks_array():
    with tempfile.TemporaryDirectory() as tmpdir:
        config_path = os.path.join(tmpdir, "config.json")
        with open(config_path, "w") as f:
            json.dump({"version": 1}, f)

        from trikhub.gateway.gateway import LoadFromConfigOptions

        gw = _make_gateway()
        await gw.initialize()
        manifests = await gw.load_triks_from_config(
            LoadFromConfigOptions(config_path=config_path)
        )
        assert manifests == []


# ============================================================================
# Tests: Get Manifest
# ============================================================================


@pytest.mark.asyncio
async def test_get_manifest():
    with tempfile.TemporaryDirectory() as tmpdir:
        _create_trik_dir(tmpdir, "test-trik")
        gw = _make_gateway()
        await gw.initialize()
        await gw.load_trik(os.path.join(tmpdir, "test-trik"))

        m = gw.get_manifest("test-trik")
        assert m is not None
        assert m.id == "test-trik"

        assert gw.get_manifest("nonexistent") is None
