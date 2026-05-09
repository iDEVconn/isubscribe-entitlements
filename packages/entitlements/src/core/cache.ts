/**
 * Pluggable cache contract. The default implementation is an in-memory TTL
 * map; consumers can plug Redis or any other store. Keys are scoped per user
 * (and tenant) inside the service.
 */
export interface CacheAdapter {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

export interface MemoryCacheOptions {
  /** Default TTL applied when `set()` does not specify one. `0` disables expiry. */
  defaultTtlMs?: number;
}

/** In-memory cache with optional per-entry TTL. Process-local; not multi-instance safe. */
export class MemoryCache implements CacheAdapter {
  private readonly store = new Map<string, { value: unknown; expiresAt: number }>();
  private readonly defaultTtlMs: number;

  constructor(options: MemoryCacheOptions = {}) {
    this.defaultTtlMs = options.defaultTtlMs ?? 5_000;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== 0 && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const ttl = ttlMs ?? this.defaultTtlMs;
    this.store.set(key, {
      value,
      expiresAt: ttl > 0 ? Date.now() + ttl : 0
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

export function createMemoryCache(options: MemoryCacheOptions = {}): MemoryCache {
  return new MemoryCache(options);
}
