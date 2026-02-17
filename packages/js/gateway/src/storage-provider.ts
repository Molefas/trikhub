import { readFile, writeFile, mkdir, readdir, unlink, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
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
 * Storage data file structure
 */
interface StorageData {
  entries: Record<string, StorageEntry>;
  metadata: {
    trikId: string;
    createdAt: number;
    updatedAt: number;
    totalSize: number;
  };
}

/**
 * JSON file-based storage context for a single trik
 */
class JsonFileStorageContext implements TrikStorageContext {
  private data: StorageData | null = null;
  private dirty = false;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor(
    private readonly filePath: string,
    private readonly trikId: string,
    private readonly maxSizeBytes: number
  ) {}

  private async ensureLoaded(): Promise<StorageData> {
    if (this.data) {
      return this.data;
    }

    let data: StorageData;
    if (existsSync(this.filePath)) {
      try {
        const content = await readFile(this.filePath, 'utf-8');
        data = JSON.parse(content);
      } catch {
        // Corrupted file, start fresh
        data = this.createEmptyData();
      }
    } else {
      data = this.createEmptyData();
    }

    this.data = data;

    // Clean up expired entries on load
    await this.cleanupExpired();

    return data;
  }

  private createEmptyData(): StorageData {
    return {
      entries: {},
      metadata: {
        trikId: this.trikId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        totalSize: 0,
      },
    };
  }

  private async cleanupExpired(): Promise<void> {
    if (!this.data) return;

    const now = Date.now();
    let changed = false;

    for (const [key, entry] of Object.entries(this.data.entries)) {
      if (entry.expiresAt && entry.expiresAt < now) {
        delete this.data.entries[key];
        changed = true;
      }
    }

    if (changed) {
      this.dirty = true;
      await this.scheduleSave();
    }
  }

  private async scheduleSave(): Promise<void> {
    if (this.saveTimeout) {
      return; // Already scheduled
    }

    this.saveTimeout = setTimeout(async () => {
      this.saveTimeout = null;
      await this.flush();
    }, 100); // Debounce writes by 100ms
  }

  private async flush(): Promise<void> {
    if (!this.dirty || !this.data) {
      return;
    }

    // Ensure directory exists
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    // Calculate and update total size
    const content = JSON.stringify(this.data, null, 2);
    this.data.metadata.totalSize = Buffer.byteLength(content, 'utf-8');
    this.data.metadata.updatedAt = Date.now();

    await writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    this.dirty = false;
  }

  async get(key: string): Promise<unknown | null> {
    const data = await this.ensureLoaded();
    const entry = data.entries[key];

    if (!entry) {
      return null;
    }

    // Check expiration
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      delete data.entries[key];
      this.dirty = true;
      await this.scheduleSave();
      return null;
    }

    return entry.value;
  }

  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    const data = await this.ensureLoaded();

    // Check size limit before adding
    const valueSize = Buffer.byteLength(JSON.stringify(value), 'utf-8');
    const currentSize = data.metadata.totalSize;

    if (currentSize + valueSize > this.maxSizeBytes) {
      throw new Error(
        `Storage quota exceeded. Current: ${currentSize} bytes, ` +
          `Adding: ${valueSize} bytes, Max: ${this.maxSizeBytes} bytes`
      );
    }

    const entry: StorageEntry = {
      value,
      createdAt: Date.now(),
    };

    if (ttl !== undefined && ttl > 0) {
      entry.expiresAt = Date.now() + ttl;
    }

    data.entries[key] = entry;
    this.dirty = true;
    await this.scheduleSave();
  }

  async delete(key: string): Promise<boolean> {
    const data = await this.ensureLoaded();

    if (!(key in data.entries)) {
      return false;
    }

    delete data.entries[key];
    this.dirty = true;
    await this.scheduleSave();
    return true;
  }

  async list(prefix?: string): Promise<string[]> {
    const data = await this.ensureLoaded();
    const keys = Object.keys(data.entries);

    if (prefix) {
      return keys.filter((key) => key.startsWith(prefix));
    }

    return keys;
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
   * Force save any pending changes
   */
  async forceSave(): Promise<void> {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    await this.flush();
  }

  /**
   * Get current storage usage in bytes
   */
  async getUsage(): Promise<number> {
    const data = await this.ensureLoaded();
    return data.metadata.totalSize;
  }

  /**
   * Clear all data
   */
  async clear(): Promise<void> {
    this.data = this.createEmptyData();
    this.dirty = true;
    await this.flush();
  }
}

/**
 * JSON file-based storage provider.
 * Stores data in ~/.trikhub/storage/@scope/trik-name/data.json
 */
export class JsonFileStorageProvider implements StorageProvider {
  private readonly baseDir: string;
  private contexts = new Map<string, JsonFileStorageContext>();

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? join(homedir(), '.trikhub', 'storage');
  }

  private getFilePath(trikId: string): string {
    // Convert @scope/name to @scope/name/data.json
    // Handle both scoped (@scope/name) and unscoped (name) trik IDs
    const normalizedId = trikId.replace(/^@/, '');
    return join(this.baseDir, `@${normalizedId}`, 'data.json');
  }

  forTrik(trikId: string, capabilities?: StorageCapabilities): TrikStorageContext {
    // Return cached context if available
    const existing = this.contexts.get(trikId);
    if (existing) {
      return existing;
    }

    const filePath = this.getFilePath(trikId);
    const maxSize = capabilities?.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;

    const context = new JsonFileStorageContext(filePath, trikId, maxSize);
    this.contexts.set(trikId, context);

    return context;
  }

  async getUsage(trikId: string): Promise<number> {
    const context = this.contexts.get(trikId);
    if (context) {
      return context.getUsage();
    }

    // Check if file exists
    const filePath = this.getFilePath(trikId);
    if (!existsSync(filePath)) {
      return 0;
    }

    try {
      const stats = await stat(filePath);
      return stats.size;
    } catch {
      return 0;
    }
  }

  async clear(trikId: string): Promise<void> {
    const context = this.contexts.get(trikId);
    if (context) {
      await context.clear();
      return;
    }

    // Delete file if it exists
    const filePath = this.getFilePath(trikId);
    if (existsSync(filePath)) {
      await unlink(filePath);
    }
  }

  async listTriks(): Promise<string[]> {
    if (!existsSync(this.baseDir)) {
      return [];
    }

    const triks: string[] = [];

    try {
      const entries = await readdir(this.baseDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const scopePath = join(this.baseDir, entry.name);

        if (entry.name.startsWith('@')) {
          // Scoped triks: @scope/name
          const scopedEntries = await readdir(scopePath, { withFileTypes: true });
          for (const scopedEntry of scopedEntries) {
            if (scopedEntry.isDirectory()) {
              const dataFile = join(scopePath, scopedEntry.name, 'data.json');
              if (existsSync(dataFile)) {
                triks.push(`${entry.name}/${scopedEntry.name}`);
              }
            }
          }
        } else {
          // Unscoped triks
          const dataFile = join(scopePath, 'data.json');
          if (existsSync(dataFile)) {
            triks.push(entry.name);
          }
        }
      }
    } catch {
      // Directory doesn't exist or isn't readable
    }

    return triks;
  }

  /**
   * Get the base directory path (for debugging)
   */
  getBaseDir(): string {
    return this.baseDir;
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
