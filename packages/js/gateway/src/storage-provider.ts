import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';
import type { Database as DatabaseType, Statement } from 'better-sqlite3';
import type { TrikStorageContext, StorageCapabilities } from '@trikhub/manifest';

/**
 * Default storage configuration
 */
const DEFAULT_MAX_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

/**
 * Interface for storage provider implementations
 */
export interface StorageProvider {
  /**
   * Get a storage context for a specific trik.
   * The context is scoped to that trik's namespace.
   */
  forTrik(trikId: string, capabilities?: StorageCapabilities): TrikStorageContext;

  /**
   * Get the current storage usage for a trik in bytes.
   */
  getUsage(trikId: string): Promise<number>;

  /**
   * Clear all storage for a trik.
   */
  clear(trikId: string): Promise<void>;

  /**
   * List all triks with stored data.
   */
  listTriks(): Promise<string[]>;
}

/**
 * Storage entry with metadata
 */
interface StorageEntry {
  value: unknown;
  createdAt: number;
  expiresAt?: number;
}

/**
 * SQLite-based storage context for a single trik
 */
class SqliteStorageContext implements TrikStorageContext {
  private readonly getStmt: Statement;
  private readonly setStmt: Statement;
  private readonly deleteStmt: Statement;
  private readonly listStmt: Statement;
  private readonly listPrefixStmt: Statement;
  private readonly cleanupStmt: Statement;
  private readonly usageStmt: Statement;
  private readonly clearStmt: Statement;

  constructor(
    private readonly db: DatabaseType,
    private readonly trikId: string,
    private readonly maxSizeBytes: number
  ) {
    // Prepare statements for performance
    this.getStmt = db.prepare('SELECT value, expires_at FROM storage WHERE trik_id = ? AND key = ?');
    this.setStmt = db.prepare(
      'INSERT OR REPLACE INTO storage (trik_id, key, value, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    );
    this.deleteStmt = db.prepare('DELETE FROM storage WHERE trik_id = ? AND key = ?');
    this.listStmt = db.prepare('SELECT key FROM storage WHERE trik_id = ?');
    this.listPrefixStmt = db.prepare('SELECT key FROM storage WHERE trik_id = ? AND key LIKE ?');
    this.cleanupStmt = db.prepare(
      'DELETE FROM storage WHERE trik_id = ? AND expires_at IS NOT NULL AND expires_at < ?'
    );
    this.usageStmt = db.prepare(
      'SELECT COALESCE(SUM(LENGTH(value)), 0) as total FROM storage WHERE trik_id = ?'
    );
    this.clearStmt = db.prepare('DELETE FROM storage WHERE trik_id = ?');
  }

  async get(key: string): Promise<unknown | null> {
    // Clean up expired entries for this trik
    this.cleanupStmt.run(this.trikId, Date.now());

    const row = this.getStmt.get(this.trikId, key) as
      | { value: string; expires_at: number | null }
      | undefined;

    if (!row) {
      return null;
    }

    // Double-check expiration (in case cleanup missed it)
    if (row.expires_at !== null && row.expires_at < Date.now()) {
      this.deleteStmt.run(this.trikId, key);
      return null;
    }

    return JSON.parse(row.value);
  }

  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    const valueJson = JSON.stringify(value);
    const valueSize = Buffer.byteLength(valueJson, 'utf-8');

    // Get current usage excluding this key (for updates)
    const currentRow = this.getStmt.get(this.trikId, key) as { value: string } | undefined;
    const currentKeySize = currentRow ? Buffer.byteLength(currentRow.value, 'utf-8') : 0;

    const usage = (this.usageStmt.get(this.trikId) as { total: number }).total - currentKeySize;

    if (usage + valueSize > this.maxSizeBytes) {
      throw new Error(
        `Storage quota exceeded. Current: ${usage} bytes, ` +
          `Adding: ${valueSize} bytes, Max: ${this.maxSizeBytes} bytes`
      );
    }

    const now = Date.now();
    const expiresAt = ttl !== undefined && ttl > 0 ? now + ttl : null;

    this.setStmt.run(this.trikId, key, valueJson, now, expiresAt);
  }

  async delete(key: string): Promise<boolean> {
    const result = this.deleteStmt.run(this.trikId, key);
    return result.changes > 0;
  }

  async list(prefix?: string): Promise<string[]> {
    // Clean up expired entries first
    this.cleanupStmt.run(this.trikId, Date.now());

    let rows: { key: string }[];
    if (prefix) {
      // Escape special LIKE characters and add wildcard
      const escapedPrefix = prefix.replace(/[%_]/g, '\\$&') + '%';
      rows = this.listPrefixStmt.all(this.trikId, escapedPrefix) as { key: string }[];
    } else {
      rows = this.listStmt.all(this.trikId) as { key: string }[];
    }

    return rows.map((row) => row.key);
  }

  async getMany(keys: string[]): Promise<Map<string, unknown>> {
    const result = new Map<string, unknown>();

    for (const key of keys) {
      const value = await this.get(key);
      if (value !== null) {
        result.set(key, value);
      }
    }

    return result;
  }

  async setMany(entries: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(entries)) {
      await this.set(key, value);
    }
  }

  /**
   * Get current storage usage in bytes
   */
  async getUsage(): Promise<number> {
    return (this.usageStmt.get(this.trikId) as { total: number }).total;
  }

  /**
   * Clear all data for this trik
   */
  async clear(): Promise<void> {
    this.clearStmt.run(this.trikId);
  }
}

/**
 * SQLite-based storage provider.
 * Stores all trik data in a single database at ~/.trikhub/storage/storage.db
 */
export class SqliteStorageProvider implements StorageProvider {
  private readonly db: DatabaseType;
  private readonly contexts = new Map<string, SqliteStorageContext>();
  private readonly dbPath: string;

  constructor(baseDir?: string) {
    const storageDir = baseDir ?? join(homedir(), '.trikhub', 'storage');

    // Ensure directory exists
    if (!existsSync(storageDir)) {
      mkdirSync(storageDir, { recursive: true });
    }

    this.dbPath = join(storageDir, 'storage.db');
    this.db = new Database(this.dbPath);

    // Configure for concurrency and durability
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');

    // Initialize schema
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS storage (
        trik_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        PRIMARY KEY (trik_id, key)
      );

      CREATE INDEX IF NOT EXISTS idx_storage_trik ON storage(trik_id);
      CREATE INDEX IF NOT EXISTS idx_storage_expires ON storage(expires_at)
        WHERE expires_at IS NOT NULL;
    `);
  }

  forTrik(trikId: string, capabilities?: StorageCapabilities): TrikStorageContext {
    // Return cached context if available
    const existing = this.contexts.get(trikId);
    if (existing) {
      return existing;
    }

    const maxSize = capabilities?.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;
    const context = new SqliteStorageContext(this.db, trikId, maxSize);
    this.contexts.set(trikId, context);

    return context;
  }

  async getUsage(trikId: string): Promise<number> {
    const context = this.contexts.get(trikId);
    if (context) {
      return context.getUsage();
    }

    // Query directly if no cached context
    const stmt = this.db.prepare(
      'SELECT COALESCE(SUM(LENGTH(value)), 0) as total FROM storage WHERE trik_id = ?'
    );
    const row = stmt.get(trikId) as { total: number };
    return row.total;
  }

  async clear(trikId: string): Promise<void> {
    const context = this.contexts.get(trikId);
    if (context) {
      await context.clear();
      return;
    }

    // Delete directly if no cached context
    const stmt = this.db.prepare('DELETE FROM storage WHERE trik_id = ?');
    stmt.run(trikId);
  }

  async listTriks(): Promise<string[]> {
    const stmt = this.db.prepare('SELECT DISTINCT trik_id FROM storage');
    const rows = stmt.all() as { trik_id: string }[];
    return rows.map((row) => row.trik_id);
  }

  /**
   * Get the database file path (for debugging)
   */
  getDbPath(): string {
    return this.dbPath;
  }

  /**
   * Close the database connection.
   * Call this for graceful shutdown.
   */
  close(): void {
    this.contexts.clear();
    this.db.close();
  }
}

/**
 * In-memory storage provider for testing
 */
export class InMemoryStorageProvider implements StorageProvider {
  private storage = new Map<string, Map<string, StorageEntry>>();

  forTrik(trikId: string, _capabilities?: StorageCapabilities): TrikStorageContext {
    if (!this.storage.has(trikId)) {
      this.storage.set(trikId, new Map());
    }

    const trikStorage = this.storage.get(trikId)!;

    return {
      get: async (key: string) => {
        const entry = trikStorage.get(key);
        if (!entry) return null;
        if (entry.expiresAt && entry.expiresAt < Date.now()) {
          trikStorage.delete(key);
          return null;
        }
        return entry.value;
      },

      set: async (key: string, value: unknown, ttl?: number) => {
        const entry: StorageEntry = {
          value,
          createdAt: Date.now(),
        };
        if (ttl !== undefined && ttl > 0) {
          entry.expiresAt = Date.now() + ttl;
        }
        trikStorage.set(key, entry);
      },

      delete: async (key: string) => {
        return trikStorage.delete(key);
      },

      list: async (prefix?: string) => {
        const keys = Array.from(trikStorage.keys());
        if (prefix) {
          return keys.filter((k) => k.startsWith(prefix));
        }
        return keys;
      },

      getMany: async (keys: string[]) => {
        const result = new Map<string, unknown>();
        for (const key of keys) {
          const entry = trikStorage.get(key);
          if (entry && (!entry.expiresAt || entry.expiresAt >= Date.now())) {
            result.set(key, entry.value);
          }
        }
        return result;
      },

      setMany: async (entries: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(entries)) {
          trikStorage.set(key, { value, createdAt: Date.now() });
        }
      },
    };
  }

  async getUsage(trikId: string): Promise<number> {
    const trikStorage = this.storage.get(trikId);
    if (!trikStorage) return 0;

    let size = 0;
    for (const entry of trikStorage.values()) {
      size += Buffer.byteLength(JSON.stringify(entry.value), 'utf-8');
    }
    return size;
  }

  async clear(trikId: string): Promise<void> {
    this.storage.delete(trikId);
  }

  async listTriks(): Promise<string[]> {
    return Array.from(this.storage.keys());
  }

  /**
   * Clear all storage
   */
  clearAll(): void {
    this.storage.clear();
  }
}
