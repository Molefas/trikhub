"""Tests for InMemorySessionStorage."""

import pytest

from trikhub.manifest import HandoffLogEntry
from trikhub.gateway.session_storage import InMemorySessionStorage


def test_create_session():
    storage = InMemorySessionStorage()
    session = storage.create_session("trik-1")

    assert session.trikId == "trik-1"
    assert session.sessionId  # non-empty UUID
    assert session.log == []
    assert session.createdAt > 0
    assert session.lastActivityAt == session.createdAt


def test_get_session():
    storage = InMemorySessionStorage()
    session = storage.create_session("trik-1")

    retrieved = storage.get_session(session.sessionId)
    assert retrieved is not None
    assert retrieved.sessionId == session.sessionId


def test_get_session_not_found():
    storage = InMemorySessionStorage()
    assert storage.get_session("nonexistent") is None


def test_append_log():
    storage = InMemorySessionStorage()
    session = storage.create_session("trik-1")

    entry = HandoffLogEntry(timestamp=1234567890, type="handoff_start", summary="test")
    storage.append_log(session.sessionId, entry)

    retrieved = storage.get_session(session.sessionId)
    assert retrieved is not None
    assert len(retrieved.log) == 1
    assert retrieved.log[0].summary == "test"


def test_append_log_not_found():
    storage = InMemorySessionStorage()
    entry = HandoffLogEntry(timestamp=1234567890, type="handoff_start", summary="test")

    with pytest.raises(ValueError, match="not found"):
        storage.append_log("nonexistent", entry)


def test_close_session():
    storage = InMemorySessionStorage()
    session = storage.create_session("trik-1")
    original_time = session.lastActivityAt

    import time
    time.sleep(0.01)
    storage.close_session(session.sessionId)

    retrieved = storage.get_session(session.sessionId)
    assert retrieved is not None
    assert retrieved.lastActivityAt >= original_time


def test_close_session_not_found():
    storage = InMemorySessionStorage()
    with pytest.raises(ValueError, match="not found"):
        storage.close_session("nonexistent")


def test_multiple_sessions():
    storage = InMemorySessionStorage()
    s1 = storage.create_session("trik-1")
    s2 = storage.create_session("trik-2")

    assert s1.sessionId != s2.sessionId
    assert storage.get_session(s1.sessionId) is not None
    assert storage.get_session(s2.sessionId) is not None
