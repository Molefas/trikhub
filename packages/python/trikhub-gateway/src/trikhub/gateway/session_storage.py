"""
Session storage for handoff sessions.

Mirrors packages/js/gateway/src/session-storage.ts
"""

from __future__ import annotations

import time
import uuid
from typing import Protocol

from trikhub.manifest import HandoffLogEntry, HandoffSession


class SessionStorage(Protocol):
    """Interface for session storage implementations."""

    def create_session(self, trik_id: str) -> HandoffSession: ...
    def get_session(self, session_id: str) -> HandoffSession | None: ...
    def append_log(self, session_id: str, entry: HandoffLogEntry) -> None: ...
    def close_session(self, session_id: str) -> None: ...


class InMemorySessionStorage:
    """
    In-memory session storage.
    Sessions are lost on process restart — suitable for development and testing.
    """

    def __init__(self) -> None:
        self._sessions: dict[str, HandoffSession] = {}

    def create_session(self, trik_id: str) -> HandoffSession:
        now = int(time.time() * 1000)
        session = HandoffSession(
            sessionId=str(uuid.uuid4()),
            trikId=trik_id,
            log=[],
            createdAt=now,
            lastActivityAt=now,
        )
        self._sessions[session.sessionId] = session
        return session

    def get_session(self, session_id: str) -> HandoffSession | None:
        return self._sessions.get(session_id)

    def append_log(self, session_id: str, entry: HandoffLogEntry) -> None:
        session = self._sessions.get(session_id)
        if session is None:
            raise ValueError(f'Session "{session_id}" not found')
        session.log.append(entry)
        session.lastActivityAt = int(time.time() * 1000)

    def close_session(self, session_id: str) -> None:
        session = self._sessions.get(session_id)
        if session is None:
            raise ValueError(f'Session "{session_id}" not found')
        session.lastActivityAt = int(time.time() * 1000)
