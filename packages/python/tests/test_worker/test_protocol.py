"""Tests for the JSON-RPC protocol module."""

from trikhub.worker.protocol import (
    ErrorCode,
    JsonRpcError,
    JsonRpcRequest,
    JsonRpcResponse,
    create_request,
    error_response,
    is_request,
    is_response,
    parse_error_object,
    success_response,
)


def test_success_response_serialization():
    resp = success_response("req-1", {"status": "ok"})
    d = resp.to_dict()
    assert d["jsonrpc"] == "2.0"
    assert d["id"] == "req-1"
    assert d["result"] == {"status": "ok"}
    assert "error" not in d


def test_error_response_serialization():
    resp = error_response("req-2", ErrorCode.PARSE_ERROR, "bad json")
    d = resp.to_dict()
    assert d["id"] == "req-2"
    assert d["error"]["code"] == -32700
    assert d["error"]["message"] == "bad json"
    assert "result" not in d


def test_error_response_with_data():
    resp = error_response("req-3", ErrorCode.INTERNAL_ERROR, "fail", {"extra": True})
    d = resp.to_dict()
    assert d["error"]["data"] == {"extra": True}


def test_request_serialization():
    req = create_request("health")
    d = req.to_dict()
    assert d["jsonrpc"] == "2.0"
    assert d["method"] == "health"
    assert "params" not in d  # None params omitted


def test_request_with_params():
    req = create_request("processMessage", {"trikPath": "/tmp/trik"})
    d = req.to_dict()
    assert d["params"]["trikPath"] == "/tmp/trik"


def test_is_request():
    assert is_request({"method": "health", "id": "1", "jsonrpc": "2.0"}) is True
    assert is_request({"result": "ok", "id": "1", "jsonrpc": "2.0"}) is False


def test_is_response():
    assert is_response({"result": "ok", "id": "1", "jsonrpc": "2.0"}) is True
    assert is_response({"error": {"code": 1, "message": "x"}, "id": "1", "jsonrpc": "2.0"}) is True
    assert is_response({"method": "health", "id": "1", "jsonrpc": "2.0"}) is False


def test_parse_error_object():
    err = parse_error_object({"code": -32700, "message": "parse error", "data": "extra"})
    assert err.code == -32700
    assert err.message == "parse error"
    assert err.data == "extra"


def test_request_id_auto_generated():
    req1 = create_request("health")
    req2 = create_request("health")
    assert req1.id != req2.id


def test_error_code_values():
    assert ErrorCode.PARSE_ERROR == -32700
    assert ErrorCode.TRIK_NOT_FOUND == 1001
    assert ErrorCode.STORAGE_ERROR == 1006
