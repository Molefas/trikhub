"""
Session Storage for TrikHub Gateway

Mirrors packages/trik-gateway/src/session-storage.ts
Provides session management for multi-turn conversations.
"""

from __future__ import annotations

import secrets
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

from trikhub.manifest import SessionCapabilities, SessionHistoryEntry, TrikSession


# ============================================================================
# Default Configuration
# ============================================================================

DEFAULT_MAX_DURATION_MS = 30 * 60 * 1000  # 30 minutes
DEFAULT_MAX_HISTORY_ENTRIES = 20


# ============================================================================
# Session Storage Interface
# ============================================================================


class SessionStorage(ABC):
    """Interface for session storage implementations."""

    @abstractmethod
    async def create(
        self, trik_id: str, config: SessionCapabilities | None = None
    ) -> TrikSession:
        """Create a new session for a trik."""
        ...

    @abstractmethod
    async def get(self, session_id: str) -> TrikSession | None:
        """
        Get an existing session by ID.
        Returns None if session doesn't exist or is expired.
        """
        ...

    @abstractmethod
    async def add_history(
        self,
        session_id: str,
        action: str,
        input_data: Any,
        agent_data: Any,
        user_content: Any | None = None,
    ) -> None:
        """Add a history entry to a session."""
        ...

    @abstractmethod
    async def delete(self, session_id: str) -> None:
        """Delete a session."""
        ...

    @abstractmethod
    async def cleanup(self) -> int:
        """
        Clean up expired sessions.
        Returns the number of sessions cleaned up.
        """
        ...


# ============================================================================
# Helper Functions
# ============================================================================


def _generate_session_id() -> str:
    """Generate a random session ID."""
    timestamp = int(time.time() * 1000)
    random_part = secrets.token_hex(4)
    return f"sess_{timestamp}_{random_part}"


def _current_time_ms() -> int:
    """Get current time in milliseconds."""
    return int(time.time() * 1000)


# ============================================================================
# In-Memory Session Storage
# ============================================================================


class InMemorySessionStorage(SessionStorage):
    """
    In-memory session storage implementation.
    Sessions are lost when the process restarts.
    """

    def __init__(self) -> None:
        self._sessions: dict[str, TrikSession] = {}
        self._max_history: dict[str, int] = {}

    async def create(
        self, trik_id: str, config: SessionCapabilities | None = None
    ) -> TrikSession:
        """Create a new session for a trik."""
        now = _current_time_ms()
        max_duration_ms = (
            config.maxDurationMs if config and config.maxDurationMs else DEFAULT_MAX_DURATION_MS
        )
        max_history = (
            config.maxHistoryEntries
            if config and config.maxHistoryEntries
            else DEFAULT_MAX_HISTORY_ENTRIES
        )

        session = TrikSession(
            sessionId=_generate_session_id(),
            trikId=trik_id,
            createdAt=now,
            lastActivityAt=now,
            expiresAt=now + max_duration_ms,
            history=[],
        )

        self._sessions[session.sessionId] = session
        self._max_history[session.sessionId] = max_history

        return session

    async def get(self, session_id: str) -> TrikSession | None:
        """Get an existing session by ID."""
        session = self._sessions.get(session_id)

        if session is None:
            return None

        # Check if session has expired
        now = _current_time_ms()
        if now > session.expiresAt:
            del self._sessions[session_id]
            self._max_history.pop(session_id, None)
            return None

        # Update last activity
        session.lastActivityAt = now
        return session

    async def add_history(
        self,
        session_id: str,
        action: str,
        input_data: Any,
        agent_data: Any,
        user_content: Any | None = None,
    ) -> None:
        """Add a history entry to a session."""
        session = await self.get(session_id)
        if session is None:
            raise ValueError(f"Session {session_id} not found")

        # Create history entry
        entry = SessionHistoryEntry(
            timestamp=_current_time_ms(),
            action=action,
            input=input_data,
            agentData=agent_data,
            userContent=user_content,
        )

        session.history.append(entry)

        # Trim history if it exceeds the limit
        max_history = self._max_history.get(session_id, DEFAULT_MAX_HISTORY_ENTRIES)
        if len(session.history) > max_history:
            session.history = session.history[-max_history:]

    async def delete(self, session_id: str) -> None:
        """Delete a session."""
        self._sessions.pop(session_id, None)
        self._max_history.pop(session_id, None)

    async def cleanup(self) -> int:
        """Clean up expired sessions."""
        now = _current_time_ms()
        cleaned = 0

        expired = [
            session_id
            for session_id, session in self._sessions.items()
            if now > session.expiresAt
        ]

        for session_id in expired:
            del self._sessions[session_id]
            self._max_history.pop(session_id, None)
            cleaned += 1

        return cleaned

    def get_active_session_count(self) -> int:
        """Get the number of active sessions (for debugging/monitoring)."""
        return len(self._sessions)
