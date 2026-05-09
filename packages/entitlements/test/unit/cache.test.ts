import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryCache } from '../../src/core/cache';

describe('MemoryCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores and returns values', async () => {
    const cache = new MemoryCache({ defaultTtlMs: 0 });
    await cache.set('k', { v: 1 });
    await expect(cache.get<{ v: number }>('k')).resolves.toEqual({ v: 1 });
  });

  it('expires values after the default TTL', async () => {
    const cache = new MemoryCache({ defaultTtlMs: 100 });
    await cache.set('k', 'v');
    vi.advanceTimersByTime(99);
    await expect(cache.get('k')).resolves.toBe('v');
    vi.advanceTimersByTime(2);
    await expect(cache.get('k')).resolves.toBeUndefined();
  });

  it('honors per-entry TTL overriding the default', async () => {
    const cache = new MemoryCache({ defaultTtlMs: 1000 });
    await cache.set('k', 'v', 50);
    vi.advanceTimersByTime(51);
    await expect(cache.get('k')).resolves.toBeUndefined();
  });

  it('treats ttl=0 as never expiring', async () => {
    const cache = new MemoryCache({ defaultTtlMs: 50 });
    await cache.set('k', 'v', 0);
    vi.advanceTimersByTime(1_000_000);
    await expect(cache.get('k')).resolves.toBe('v');
  });

  it('delete() removes a single key, clear() wipes everything', async () => {
    const cache = new MemoryCache();
    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.delete('a');
    await expect(cache.get('a')).resolves.toBeUndefined();
    await expect(cache.get<number>('b')).resolves.toBe(2);
    await cache.clear();
    await expect(cache.get('b')).resolves.toBeUndefined();
  });
});
