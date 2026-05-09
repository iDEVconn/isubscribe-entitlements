import { describe, expect, it } from 'vitest';

import { createMemoryAdapter } from '../../src/adapters/persistence/memory';
import { ACTIVE_SUB } from '../fixtures';

describe('MemoryPersistenceAdapter', () => {
  it('returns null when no subscription exists', async () => {
    const adapter = createMemoryAdapter();
    await expect(adapter.getActiveSubscription({ userId: 'ghost' })).resolves.toBeNull();
  });

  it('round-trips a subscription via saveSubscription', async () => {
    const adapter = createMemoryAdapter();
    await adapter.saveSubscription(ACTIVE_SUB);
    const result = await adapter.getActiveSubscription({ userId: ACTIVE_SUB.userId });
    expect(result).toEqual(ACTIVE_SUB);
  });

  it('keeps tenants isolated', async () => {
    const adapter = createMemoryAdapter();
    const subA = { ...ACTIVE_SUB, userId: 'u', tenantId: 'a' };
    const subB = { ...ACTIVE_SUB, userId: 'u', tenantId: 'b', planId: 'free' };
    await adapter.saveSubscription(subA);
    await adapter.saveSubscription(subB);

    await expect(adapter.getActiveSubscription({ userId: 'u', tenantId: 'a' })).resolves.toEqual(
      subA
    );
    await expect(adapter.getActiveSubscription({ userId: 'u', tenantId: 'b' })).resolves.toEqual(
      subB
    );
  });

  it('tracks usage per metric', async () => {
    const adapter = createMemoryAdapter();
    const ctx = { userId: 'u' };
    await adapter.incrementUsage(ctx, 'tokens', 10);
    await adapter.incrementUsage(ctx, 'tokens', 5);
    await adapter.incrementUsage(ctx, 'requests', 2);

    await expect(adapter.getUsage(ctx, 'tokens')).resolves.toBe(15);
    await expect(adapter.getUsage(ctx, 'requests')).resolves.toBe(2);
    await expect(adapter.getUsage(ctx, 'unknown')).resolves.toBe(0);
  });

  it('resetUsage zeroes a counter', async () => {
    const adapter = createMemoryAdapter();
    const ctx = { userId: 'u' };
    await adapter.incrementUsage(ctx, 'tokens', 100);
    await adapter.resetUsage(ctx, 'tokens');
    await expect(adapter.getUsage(ctx, 'tokens')).resolves.toBe(0);
  });

  it('accepts a seed of subscriptions', async () => {
    const adapter = createMemoryAdapter({
      subscriptions: [['user_1', ACTIVE_SUB]]
    });
    await expect(adapter.getActiveSubscription({ userId: 'user_1' })).resolves.toEqual(ACTIVE_SUB);
  });
});
