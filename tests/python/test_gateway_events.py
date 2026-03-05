"""Tests for gateway lifecycle event emissions."""
import pytest
from unittest.mock import AsyncMock, MagicMock
from dataclasses import dataclass

from trikhub.gateway.gateway import TrikGateway, TrikGatewayConfig, _LoadedTrik
from trikhub.gateway.session_storage import InMemorySessionStorage
from trikhub.gateway.config_store import InMemoryConfigStore
from trikhub.gateway.storage_provider import InMemoryStorageProvider
from trikhub.manifest import TrikManifest, TrikResponse, TrikRuntime


def _make_gateway_and_trik(*, transfer_on: str | None = None, raise_on: str | None = None):
    """Create a gateway with a fake conversational trik loaded."""
    gw = TrikGateway(TrikGatewayConfig(
        config_store=InMemoryConfigStore(),
        storage_provider=InMemoryStorageProvider(),
        session_storage=InMemorySessionStorage(),
    ))

    async def _process_message(msg, ctx):
        if raise_on and msg == raise_on:
            raise RuntimeError("boom")
        return TrikResponse(
            message="hello back",
            transferBack=(msg == transfer_on) if transfer_on else False,
        )

    fake_agent = MagicMock()
    fake_agent.process_message = AsyncMock(side_effect=_process_message)

    manifest = TrikManifest.model_validate({
        "schemaVersion": 2,
        "id": "test-trik",
        "name": "Test Trik",
        "version": "1.0.0",
        "description": "test",
        "author": "test",
        "agent": {
            "mode": "conversational",
            "domain": ["testing"],
            "handoffDescription": "Test",
            "systemPrompt": "You are a test trik.",
        },
        "entry": {"module": "agent.py", "export": "agent"},
    })

    gw._triks["@test/test-trik"] = _LoadedTrik(
        manifest=manifest,
        agent=fake_agent,
        path="/tmp/fake",
        runtime=TrikRuntime.PYTHON,
        scoped_name="@test/test-trik",
    )
    return gw


@pytest.mark.asyncio
async def test_emits_handoff_start():
    gw = _make_gateway_and_trik()
    events = []
    gw.on("handoff:start", lambda e: events.append(e))

    await gw.start_handoff("@test/test-trik", "hello", "sess-1")

    assert len(events) == 1
    assert events[0]["trikName"] == "Test Trik"


@pytest.mark.asyncio
async def test_emits_thinking_before_message():
    gw = _make_gateway_and_trik()
    order = []
    gw.on("handoff:thinking", lambda _: order.append("thinking"))
    gw.on("handoff:message", lambda _: order.append("message"))

    await gw.start_handoff("@test/test-trik", "hello", "sess-1")

    assert order == ["thinking", "message"]


@pytest.mark.asyncio
async def test_emits_voluntary_transfer_back():
    gw = _make_gateway_and_trik(transfer_on="bye")
    events = []
    gw.on("handoff:transfer_back", lambda e: events.append(e))

    await gw.start_handoff("@test/test-trik", "hello", "sess-1")
    await gw.route_message("bye", "sess-1")

    assert len(events) == 1
    assert events[0]["reason"] == "voluntary"


@pytest.mark.asyncio
async def test_emits_force_transfer_back():
    gw = _make_gateway_and_trik()
    events = []
    gw.on("handoff:transfer_back", lambda e: events.append(e))

    await gw.start_handoff("@test/test-trik", "hello", "sess-1")
    await gw.route_message("/back", "sess-1")

    assert len(events) == 1
    assert events[0]["reason"] == "force"


@pytest.mark.asyncio
async def test_emits_error_on_trik_exception():
    gw = _make_gateway_and_trik(raise_on="crash")
    errors = []
    gw.on("handoff:error", lambda e: errors.append(e))

    await gw.start_handoff("@test/test-trik", "hello", "sess-1")
    await gw.route_message("crash", "sess-1")

    assert len(errors) == 1
    assert "boom" in errors[0]["error"]


@pytest.mark.asyncio
async def test_summary_emitted_before_transfer_back():
    gw = _make_gateway_and_trik(transfer_on="bye")
    order = []
    gw.on("handoff:summary", lambda _: order.append("summary"))
    gw.on("handoff:transfer_back", lambda _: order.append("transfer_back"))

    await gw.start_handoff("@test/test-trik", "hello", "sess-1")
    await gw.route_message("bye", "sess-1")

    assert order == ["summary", "transfer_back"]
