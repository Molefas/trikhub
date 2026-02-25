import { v4 as uuidv4 } from 'uuid';
import type { HandoffLogEntry, HandoffSession } from '@trikhub/manifest';

// ============================================================================
// Session Storage Interface
// ============================================================================

/**
 * Interface for session storage implementations.
 * Manages HandoffSession lifecycle for the gateway.
 */
export interface SessionStorage {
  /** Create a new handoff session for a trik */
  createSession(trikId: string): HandoffSession;
  /** Get an existing session by ID */
  getSession(sessionId: string): HandoffSession | null;
  /** Append a log entry to a session */
  appendLog(sessionId: string, entry: HandoffLogEntry): void;
  /** Close a session (marks it as ended) */
  closeSession(sessionId: string): void;
}

// ============================================================================
// In-Memory Implementation
// ============================================================================

/**
 * In-memory session storage.
 * Sessions are lost on process restart — suitable for development and testing.
 */
export class InMemorySessionStorage implements SessionStorage {
  private sessions = new Map<string, HandoffSession>();

  createSession(trikId: string): HandoffSession {
    const now = Date.now();
    const session: HandoffSession = {
      sessionId: uuidv4(),
      trikId,
      log: [],
      createdAt: now,
      lastActivityAt: now,
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  getSession(sessionId: string): HandoffSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  appendLog(sessionId: string, entry: HandoffLogEntry): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" not found`);
    }
    session.log.push(entry);
    session.lastActivityAt = Date.now();
  }

  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" not found`);
    }
    session.lastActivityAt = Date.now();
  }
}
