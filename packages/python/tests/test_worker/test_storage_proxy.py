"""Tests for the storage proxy."""

import asyncio
import json

import pytest

from trikhub.worker.storage_proxy import StorageProxy


@pytest.fixture
def captured_lines():
    return []


@pytest.fixture
def proxy(captured_lines):
    return StorageProxy(captured_lines.append)


def _extract_request(captured_lines: list[str]) -> dict:
    """Parse the last captured JSON-RPC request."""
    assert len(captured_lines) > 0
    return json.loads(captured_lines[-1])


async def _send_and_respond(proxy: StorageProxy, captured_lines: list[str], result):
    """Helper: start a storage call, respond to it, return the result."""
    # We need to start the coroutine, let it send the request,
    # then simulate the gateway responding.
    task = asyncio.create_task(proxy.get("test-key"))
    # Give the task a chance to run and send the request
    await asyncio.sleep(0.01)
    req = _extract_request(captured_lines)
    proxy.handle_response(req["id"], result=result)
    return await task


async def test_get_sends_correct_request(proxy, captured_lines):
    task = asyncio.create_task(proxy.get("mykey"))
    await asyncio.sleep(0.01)
    req = _extract_request(captured_lines)
    assert req["method"] == "storage.get"
    assert req["params"]["key"] == "mykey"
    assert req["jsonrpc"] == "2.0"
    # Respond to unblock the task
    proxy.handle_response(req["id"], result={"value": "hello"})
    result = await task
    assert result == "hello"


async def test_get_returns_none_when_missing(proxy, captured_lines):
    task = asyncio.create_task(proxy.get("missing"))
    await asyncio.sleep(0.01)
    req = _extract_request(captured_lines)
    proxy.handle_response(req["id"], result={"value": None})
    result = await task
    assert result is None


async def test_set_sends_correct_request(proxy, captured_lines):
    task = asyncio.create_task(proxy.set("k", "v", ttl=5000))
    await asyncio.sleep(0.01)
    req = _extract_request(captured_lines)
    assert req["method"] == "storage.set"
    assert req["params"]["key"] == "k"
    assert req["params"]["value"] == "v"
    assert req["params"]["ttl"] == 5000
    proxy.handle_response(req["id"], result={"success": True})
    await task


async def test_set_without_ttl(proxy, captured_lines):
    task = asyncio.create_task(proxy.set("k", "v"))
    await asyncio.sleep(0.01)
    req = _extract_request(captured_lines)
    assert "ttl" not in req["params"]
    proxy.handle_response(req["id"], result={"success": True})
    await task


async def test_delete_sends_correct_request(proxy, captured_lines):
    task = asyncio.create_task(proxy.delete("k"))
    await asyncio.sleep(0.01)
    req = _extract_request(captured_lines)
    assert req["method"] == "storage.delete"
    proxy.handle_response(req["id"], result={"deleted": True})
    result = await task
    assert result is True


async def test_list_sends_correct_request(proxy, captured_lines):
    task = asyncio.create_task(proxy.list("prefix:"))
    await asyncio.sleep(0.01)
    req = _extract_request(captured_lines)
    assert req["method"] == "storage.list"
    assert req["params"]["prefix"] == "prefix:"
    proxy.handle_response(req["id"], result={"keys": ["prefix:a", "prefix:b"]})
    result = await task
    assert result == ["prefix:a", "prefix:b"]


async def test_list_without_prefix(proxy, captured_lines):
    task = asyncio.create_task(proxy.list())
    await asyncio.sleep(0.01)
    req = _extract_request(captured_lines)
    assert "prefix" not in req["params"]
    proxy.handle_response(req["id"], result={"keys": []})
    result = await task
    assert result == []


async def test_get_many_sends_correct_request(proxy, captured_lines):
    task = asyncio.create_task(proxy.get_many(["a", "b"]))
    await asyncio.sleep(0.01)
    req = _extract_request(captured_lines)
    assert req["method"] == "storage.getMany"
    assert req["params"]["keys"] == ["a", "b"]
    proxy.handle_response(req["id"], result={"values": {"a": 1, "b": 2}})
    result = await task
    assert result == {"a": 1, "b": 2}


async def test_set_many_sends_correct_request(proxy, captured_lines):
    task = asyncio.create_task(proxy.set_many({"x": 1, "y": 2}))
    await asyncio.sleep(0.01)
    req = _extract_request(captured_lines)
    assert req["method"] == "storage.setMany"
    assert req["params"]["entries"] == {"x": 1, "y": 2}
    proxy.handle_response(req["id"], result={"success": True})
    await task


async def test_error_response_raises(proxy, captured_lines):
    task = asyncio.create_task(proxy.get("fail"))
    await asyncio.sleep(0.01)
    req = _extract_request(captured_lines)
    proxy.handle_response(req["id"], error={"code": 1006, "message": "DB error"})
    with pytest.raises(RuntimeError, match="Storage error: DB error"):
        await task


async def test_handle_response_returns_false_for_unknown_id(proxy):
    result = proxy.handle_response("nonexistent", result={"value": "x"})
    assert result is False
