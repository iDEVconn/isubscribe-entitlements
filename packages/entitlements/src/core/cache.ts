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

/**
 * In-memory cache with optional per-entry TTL.
 *
 * @remarks
 * **Process-local — not safe for multi-process or multi-pod deployments.**
 * When running more than one server instance (e.g. a load-balanced cluster or
 * a serverless environment), each process holds its own isolated cache. A write
 * on instance A is invisible to instance B, so resolved plans can stay stale
 * for up to `cacheTtlMs` after a subscription change.
 *
 * Mitigations:
 * - Set `cacheTtlMs: 0` to disable caching for high-value entitlement gates.
 * - Replace with a shared `CacheAdapter` implementation (e.g. Redis/Valkey)
 *   and pass it as `cache` in `EntitlementsConfig`.
 */
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
