import type {
  TrikSession,
  SessionHistoryEntry,
  SessionCapabilities,
} from '@trikhub/manifest';

/**
 * Interface for session storage implementations
 */
export interface SessionStorage {
  /**
   * Create a new session for a trik
   */
  create(trikId: string, config?: SessionCapabilities): Promise<TrikSession>;

  /**
   * Get an existing session by ID
   * Returns null if session doesn't exist or is expired
   */
  get(sessionId: string): Promise<TrikSession | null>;

  /**
   * Add a history entry to a session
   */
  addHistory(
    sessionId: string,
    entry: Omit<SessionHistoryEntry, 'timestamp'>
  ): Promise<void>;

  /**
   * Delete a session
   */
  delete(sessionId: string): Promise<void>;

  /**
   * Clean up expired sessions
   * Returns the number of sessions cleaned up
   */
  cleanup(): Promise<number>;
}

/**
 * Generate a random session ID
 */
function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Default values for session configuration
 */
const DEFAULT_MAX_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_MAX_HISTORY_ENTRIES = 20;

/**
 * In-memory session storage implementation.
 * Sessions are lost when the process restarts.
 */
export class InMemorySessionStorage implements SessionStorage {
  private sessions = new Map<string, TrikSession>();

  async create(trikId: string, config?: SessionCapabilities): Promise<TrikSession> {
    const now = Date.now();
    const maxDurationMs = config?.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;

    const session: TrikSession = {
      sessionId: generateSessionId(),
      trikId,
      createdAt: now,
      lastActivityAt: now,
      expiresAt: now + maxDurationMs,
      history: [],
    };

    this.sessions.set(session.sessionId, session);
    return session;
  }

  async get(sessionId: string): Promise<TrikSession | null> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return null;
    }

    // Check if session has expired
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }

    // Update last activity
    session.lastActivityAt = Date.now();
    return session;
  }

  async addHistory(
    sessionId: string,
    entry: Omit<SessionHistoryEntry, 'timestamp'>
  ): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Add the history entry with timestamp
    const historyEntry: SessionHistoryEntry = {
      ...entry,
      timestamp: Date.now(),
    };

    session.history.push(historyEntry);

    // Trim history if it exceeds the limit
    // We use DEFAULT_MAX_HISTORY_ENTRIES since we don't store the config
    if (session.history.length > DEFAULT_MAX_HISTORY_ENTRIES) {
      session.history = session.history.slice(-DEFAULT_MAX_HISTORY_ENTRIES);
    }
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async cleanup(): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions) {
      if (now > session.expiresAt) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Get the number of active sessions (for debugging/monitoring)
   */
  getActiveSessionCount(): number {
    return this.sessions.size;
  }
}
