"""Tests for the Python worker main module.

Tests the PythonWorker class by calling its internal message handler directly,
bypassing the stdin/stdout loop (which requires real file descriptors).
"""

import json
import textwrap

import pytest

from trikhub.worker.main import PythonWorker, _ConfigContext
from trikhub.worker.protocol import ErrorCode


# ============================================================================
# ConfigContext tests
# ============================================================================


def test_config_context_get():
    ctx = _ConfigContext({"api_key": "secret"})
    assert ctx.get("api_key") == "secret"
    assert ctx.get("missing") is None


def test_config_context_has():
    ctx = _ConfigContext({"api_key": "secret"})
    assert ctx.has("api_key") is True
    assert ctx.has("missing") is False


def test_config_context_keys():
    ctx = _ConfigContext({"a": "1", "b": "2"})
    assert sorted(ctx.keys()) == ["a", "b"]


# ============================================================================
# Worker handler tests — call _handle_request directly
# ============================================================================


@pytest.fixture
def worker():
    """Create a PythonWorker and capture its stdout writes."""
    w = PythonWorker()
    w._output_lines = []
    original_write_line = w._write_line

    def capture_write(line):
        w._output_lines.append(line)

    w._write_line = capture_write
    return w


@pytest.fixture
def conversational_trik(tmp_path):
    """Create a simple conversational trik."""
    manifest = {
        "schemaVersion": 2,
        "name": "echo-trik",
        "displayName": "Echo Trik",
        "description": "Echoes messages back",
        "entry": {"module": "./agent.py", "export": "agent"},
        "agents": [{"id": "main", "mode": "conversational"}],
    }
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    (tmp_path / "agent.py").write_text(
        textwrap.dedent("""\
        from trikhub.manifest import TrikResponse

        class _Agent:
            async def process_message(self, message, context):
                return TrikResponse(message=f"echo: {message}", transferBack=False)

            async def execute_tool(self, tool_name, input, context):
                raise NotImplementedError

        agent = _Agent()
        """)
    )
    return tmp_path


@pytest.fixture
def tool_trik(tmp_path):
    """Create a simple tool-mode trik."""
    trik_dir = tmp_path / "tool-trik"
    trik_dir.mkdir()
    manifest = {
        "schemaVersion": 2,
        "name": "hash-trik",
        "displayName": "Hash Trik",
        "description": "Hashes input",
        "entry": {"module": "./agent.py", "export": "agent"},
        "agents": [{"id": "main", "mode": "tool"}],
    }
    (trik_dir / "manifest.json").write_text(json.dumps(manifest))
    (trik_dir / "agent.py").write_text(
        textwrap.dedent("""\
        from trikhub.manifest import ToolExecutionResult

        class _Agent:
            async def process_message(self, message, context):
                raise NotImplementedError

            async def execute_tool(self, tool_name, input, context):
                return ToolExecutionResult(output={"hash": "abc123", "tool": tool_name})

        agent = _Agent()
        """)
    )
    return trik_dir


async def _call_handler(worker: PythonWorker, method: str, params=None, request_id="test-1"):
    """Helper: build a JSON-RPC request dict and call _handle_request."""
    msg = {"jsonrpc": "2.0", "id": request_id, "method": method}
    if params is not None:
        msg["params"] = params
    resp = await worker._handle_request(msg)
    return resp.to_dict()


# -- Health & Shutdown --------------------------------------------------------


async def test_health_request(worker):
    resp = await _call_handler(worker, "health", request_id="h1")
    assert resp["id"] == "h1"
    assert resp["result"]["status"] == "ok"
    assert resp["result"]["runtime"] == "python"
    assert "version" in resp["result"]
    assert "uptime" in resp["result"]


async def test_shutdown_request(worker):
    resp = await _call_handler(worker, "shutdown", request_id="s1")
    assert resp["id"] == "s1"
    assert resp["result"]["acknowledged"] is True
    assert worker._running is False


# -- Error cases --------------------------------------------------------------


async def test_unknown_method(worker):
    resp = await _call_handler(worker, "bogus", request_id="u1")
    assert resp["error"]["code"] == ErrorCode.METHOD_NOT_FOUND
    assert "bogus" in resp["error"]["message"]


# -- processMessage -----------------------------------------------------------


async def test_process_message(worker, conversational_trik):
    resp = await _call_handler(worker, "processMessage", {
        "trikPath": str(conversational_trik),
        "message": "hello world",
        "sessionId": "sess-1",
        "config": {},
        "storageNamespace": "test",
    }, request_id="pm1")
    assert resp["id"] == "pm1"
    assert resp["result"]["message"] == "echo: hello world"
    assert resp["result"]["transferBack"] is False


async def test_process_message_missing_trik_path(worker):
    resp = await _call_handler(worker, "processMessage", {
        "message": "hi",
    }, request_id="pm2")
    assert resp["error"]["code"] == ErrorCode.INVALID_PARAMS
    assert "trikPath" in resp["error"]["message"]


async def test_process_message_missing_message(worker, conversational_trik):
    resp = await _call_handler(worker, "processMessage", {
        "trikPath": str(conversational_trik),
    }, request_id="pm3")
    assert resp["error"]["code"] == ErrorCode.INVALID_PARAMS
    assert "message" in resp["error"]["message"]


async def test_process_message_trik_not_found(worker):
    resp = await _call_handler(worker, "processMessage", {
        "trikPath": "/nonexistent/path",
        "message": "hello",
        "sessionId": "sess-1",
        "config": {},
        "storageNamespace": "test",
    }, request_id="nf1")
    assert resp["error"]["code"] == ErrorCode.TRIK_NOT_FOUND


# -- executeTool --------------------------------------------------------------


async def test_execute_tool(worker, tool_trik):
    resp = await _call_handler(worker, "executeTool", {
        "trikPath": str(tool_trik),
        "toolName": "hash",
        "input": {"text": "hello"},
        "sessionId": "sess-1",
        "config": {},
        "storageNamespace": "test",
    }, request_id="et1")
    assert resp["id"] == "et1"
    assert resp["result"]["output"]["hash"] == "abc123"
    assert resp["result"]["output"]["tool"] == "hash"


async def test_execute_tool_missing_trik_path(worker):
    resp = await _call_handler(worker, "executeTool", {
        "toolName": "hash",
    }, request_id="et2")
    assert resp["error"]["code"] == ErrorCode.INVALID_PARAMS
    assert "trikPath" in resp["error"]["message"]


async def test_execute_tool_missing_tool_name(worker, conversational_trik):
    resp = await _call_handler(worker, "executeTool", {
        "trikPath": str(conversational_trik),
    }, request_id="et3")
    assert resp["error"]["code"] == ErrorCode.INVALID_PARAMS
    assert "toolName" in resp["error"]["message"]


async def test_execute_tool_trik_not_found(worker):
    resp = await _call_handler(worker, "executeTool", {
        "trikPath": "/nonexistent/path",
        "toolName": "hash",
        "input": {},
        "sessionId": "sess-1",
        "config": {},
        "storageNamespace": "test",
    }, request_id="nf2")
    assert resp["error"]["code"] == ErrorCode.TRIK_NOT_FOUND


# -- Message routing (the _handle_message method) -----------------------------


async def test_handle_message_invalid_json(worker):
    await worker._handle_message("not json at all")
    assert len(worker._output_lines) == 1
    resp = json.loads(worker._output_lines[0])
    assert resp["error"]["code"] == ErrorCode.PARSE_ERROR


async def test_handle_message_invalid_jsonrpc(worker):
    await worker._handle_message(json.dumps({"id": "x", "method": "health"}))
    assert len(worker._output_lines) == 1
    resp = json.loads(worker._output_lines[0])
    assert resp["error"]["code"] == ErrorCode.INVALID_REQUEST


async def test_handle_message_routes_request(worker):
    msg = json.dumps({"jsonrpc": "2.0", "id": "r1", "method": "health"})
    await worker._handle_message(msg)
    assert len(worker._output_lines) == 1
    resp = json.loads(worker._output_lines[0])
    assert resp["result"]["status"] == "ok"


async def test_handle_message_routes_storage_response(worker):
    """Verify responses (from storage proxy) are routed to the proxy."""
    # Simulate a pending storage request
    import asyncio
    loop = asyncio.get_running_loop()
    future = loop.create_future()
    worker._storage_proxy._pending["stor-1"] = future

    msg = json.dumps({"jsonrpc": "2.0", "id": "stor-1", "result": {"value": "hello"}})
    await worker._handle_message(msg)

    assert future.done()
    assert future.result() == {"value": "hello"}


# -- Config context in trik ---------------------------------------------------


async def test_config_passed_to_trik(tmp_path):
    """Verify config context is correctly built and available in trik."""
    manifest = {
        "schemaVersion": 2,
        "name": "config-trik",
        "entry": {"module": "./agent.py", "export": "agent"},
    }
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    (tmp_path / "agent.py").write_text(
        textwrap.dedent("""\
        from trikhub.manifest import TrikResponse

        class _Agent:
            async def process_message(self, message, context):
                api_key = context.config.get("API_KEY")
                return TrikResponse(message=f"key={api_key}", transferBack=False)

            async def execute_tool(self, tool_name, input, context):
                raise NotImplementedError

        agent = _Agent()
        """)
    )

    w = PythonWorker()
    resp = await _call_handler(w, "processMessage", {
        "trikPath": str(tmp_path),
        "message": "check config",
        "sessionId": "s1",
        "config": {"API_KEY": "sk-123"},
        "storageNamespace": "test",
    })
    assert resp["result"]["message"] == "key=sk-123"
