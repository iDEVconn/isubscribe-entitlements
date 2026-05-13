import { beforeEach, describe, expect, it } from 'vitest';

import { createMemoryAdapter } from '../../src/adapters/persistence/memory';
import { createEntitlements } from '../../src/core/create-entitlements';
import {
  EntitlementDeniedError,
  LimitExceededError,
  NoActiveSubscriptionError,
  PlanNotFoundError
} from '../../src/core/errors';
import { ACTIVE_SUB, CANCELED_SUB, FREE_PLAN, PRO_PLAN, planResolver } from '../fixtures';

describe('EntitlementsService (core)', () => {
  let adapter: ReturnType<typeof createMemoryAdapter>;

  beforeEach(() => {
    adapter = createMemoryAdapter();
  });

  it('answers `has` correctly for boolean / numeric / unlimited features', async () => {
    await adapter.saveSubscription(ACTIVE_SUB);
    const ent = createEntitlements({ persistence: adapter, planResolver });
    const svc = ent.for({ userId: ACTIVE_SUB.userId });

    await expect(svc.has('crm.export')).resolves.toBe(true);
    await expect(svc.has('reports.advanced')).resolves.toBe(false);
    await expect(svc.has('projects.max')).resolves.toBe(true);
    await expect(svc.has('storage.gb')).resolves.toBe(true);
    await expect(svc.has('unknown')).resolves.toBe(false);
  });

  it('require() throws EntitlementDeniedError for denied features', async () => {
    await adapter.saveSubscription(ACTIVE_SUB);
    const svc = createEntitlements({ persistence: adapter, planResolver }).for({
      userId: ACTIVE_SUB.userId
    });

    await expect(svc.require('reports.advanced')).rejects.toBeInstanceOf(EntitlementDeniedError);
    await expect(svc.require('crm.export')).resolves.toBeUndefined();
  });

  it('limit() returns numeric, null (unlimited), or null for unknown', async () => {
    await adapter.saveSubscription(ACTIVE_SUB);
    const svc = createEntitlements({ persistence: adapter, planResolver }).for({
      userId: ACTIVE_SUB.userId
    });

    await expect(svc.limit('projects.max')).resolves.toBe(10);
    await expect(svc.limit('storage.gb')).resolves.toBeNull();
    await expect(svc.limit('unknown')).resolves.toBeNull();
  });

  it('check() returns true while remaining quota is available', async () => {
    await adapter.saveSubscription(ACTIVE_SUB);
    const svc = createEntitlements({ persistence: adapter, planResolver }).for({
      userId: ACTIVE_SUB.userId
    });

    await expect(svc.check('ai.tokens.monthly', 50_000)).resolves.toBe(true);
    await svc.consume('ai.tokens.monthly', 50_000);
    await expect(svc.check('ai.tokens.monthly', 50_000)).resolves.toBe(true);
    await expect(svc.check('ai.tokens.monthly', 50_001)).resolves.toBe(false);
  });

  it('check() always returns true for unlimited features', async () => {
    await adapter.saveSubscription(ACTIVE_SUB);
    const svc = createEntitlements({ persistence: adapter, planResolver }).for({
      userId: ACTIVE_SUB.userId
    });

    await expect(svc.check('storage.gb', 9_999_999)).resolves.toBe(true);
  });

  it('consume() increments usage and refuses to overshoot the limit', async () => {
    await adapter.saveSubscription(ACTIVE_SUB);
    const ent = createEntitlements({ persistence: adapter, planResolver });
    const svc = ent.for({ userId: ACTIVE_SUB.userId });

    await svc.consume('ai.tokens.monthly', 99_000);
    await expect(svc.usage('ai.tokens.monthly')).resolves.toBe(99_000);

    await expect(svc.consume('ai.tokens.monthly', 5_000)).rejects.toBeInstanceOf(
      LimitExceededError
    );
    await expect(svc.usage('ai.tokens.monthly')).resolves.toBe(99_000);

    await svc.consume('ai.tokens.monthly', 1_000);
    await expect(svc.usage('ai.tokens.monthly')).resolves.toBe(100_000);
  });

  it('consume() throws EntitlementDeniedError for unknown / denied features', async () => {
    await adapter.saveSubscription(ACTIVE_SUB);
    const svc = createEntitlements({ persistence: adapter, planResolver }).for({
      userId: ACTIVE_SUB.userId
    });

    await expect(svc.consume('reports.advanced')).rejects.toBeInstanceOf(EntitlementDeniedError);
    await expect(svc.consume('unknown.metric', 5)).rejects.toBeInstanceOf(EntitlementDeniedError);
  });

  it('rejects negative consume amounts', async () => {
    await adapter.saveSubscription(ACTIVE_SUB);
    const svc = createEntitlements({ persistence: adapter, planResolver }).for({
      userId: ACTIVE_SUB.userId
    });

    await expect(svc.consume('ai.tokens.monthly', -1)).rejects.toBeInstanceOf(
      EntitlementDeniedError
    );
  });

  it('falls back to fallbackPlan when there is no active subscription', async () => {
    const ent = createEntitlements({
      persistence: adapter,
      planResolver,
      fallbackPlan: FREE_PLAN
    });
    const svc = ent.for({ userId: 'anon' });

    await expect(svc.has('crm.export')).resolves.toBe(false);
    await expect(svc.has('projects.max')).resolves.toBe(true);
    await expect(svc.limit('projects.max')).resolves.toBe(1);

    const plan = await svc.getPlan();
    expect(plan.id).toBe('free');
    expect(plan.source).toBe('fallback');
  });

  it('denies everything when the subscription is canceled and no fallback is set', async () => {
    await adapter.saveSubscription(CANCELED_SUB);
    const svc = createEntitlements({ persistence: adapter, planResolver }).for({
      userId: CANCELED_SUB.userId
    });

    await expect(svc.has('crm.export')).resolves.toBe(false);
    await expect(svc.getEntitlements()).resolves.toEqual({});
  });

  it('getSubscription() throws NoActiveSubscriptionError when missing', async () => {
    const svc = createEntitlements({ persistence: adapter, planResolver }).for({ userId: 'ghost' });
    await expect(svc.getSubscription()).rejects.toBeInstanceOf(NoActiveSubscriptionError);
  });

  it('saveSubscription() invalidates the cached resolved state', async () => {
    const ent = createEntitlements({ persistence: adapter, planResolver });
    const svc = ent.for({ userId: ACTIVE_SUB.userId });

    await expect(svc.has('crm.export')).resolves.toBe(false);
    await ent.saveSubscription(ACTIVE_SUB);
    await expect(svc.has('crm.export')).resolves.toBe(true);
  });

  it('throws PlanNotFoundError when planResolver returns null (default safe behaviour)', async () => {
    // Seed the adapter directly so we can test resolvePlan with an unresolvable planId
    await adapter.saveSubscription({ ...ACTIVE_SUB, planId: 'deleted_plan' });
    const svc = createEntitlements({ persistence: adapter, planResolver }).for({
      userId: ACTIVE_SUB.userId
    });

    await expect(svc.has('crm.export')).rejects.toBeInstanceOf(PlanNotFoundError);
    await expect(svc.getPlan()).rejects.toBeInstanceOf(PlanNotFoundError);
  });

  it('falls back to snapshot when planResolver returns null and planSnapshotFallback is true', async () => {
    await adapter.saveSubscription({ ...ACTIVE_SUB, planId: 'legacy_plan' });
    const ent = createEntitlements({
      persistence: adapter,
      planResolver,
      planSnapshotFallback: true
    });
    const svc = ent.for({ userId: ACTIVE_SUB.userId });

    const plan = await svc.getPlan();
    expect(plan.id).toBe('legacy_plan');
    expect(plan.source).toBe('subscription');
    expect(plan.features).toEqual(ACTIVE_SUB.entitlements);
  });

  it('isolates state per tenant', async () => {
    const subA = { ...ACTIVE_SUB, userId: 'u', tenantId: 'tenant-a' };
    const subB = {
      ...ACTIVE_SUB,
      userId: 'u',
      tenantId: 'tenant-b',
      planId: 'free',
      entitlements: FREE_PLAN.features
    };
    await adapter.saveSubscription(subA);
    await adapter.saveSubscription(subB);

    const ent = createEntitlements({ persistence: adapter, planResolver });
    await expect(ent.for({ userId: 'u', tenantId: 'tenant-a' }).has('crm.export')).resolves.toBe(
      true
    );
    await expect(ent.for({ userId: 'u', tenantId: 'tenant-b' }).has('crm.export')).resolves.toBe(
      false
    );
  });

  it('exposes the full entitlements snapshot via getEntitlements()', async () => {
    await adapter.saveSubscription(ACTIVE_SUB);
    const svc = createEntitlements({ persistence: adapter, planResolver }).for({
      userId: ACTIVE_SUB.userId
    });
    await expect(svc.getEntitlements()).resolves.toEqual(PRO_PLAN.features);
  });
});

describe('consume() — incrementUsageCapped (M2)', () => {
  it('calls incrementUsageCapped when the adapter provides it', async () => {
    const cappedAdapter = createMemoryAdapter();
    await cappedAdapter.saveSubscription(ACTIVE_SUB);

    const cappedCalls: { metric: string; amount: number; limit: number }[] = [];
    cappedAdapter.incrementUsageCapped = async (ctx, metric, amount, limit) => {
      cappedCalls.push({ metric, amount, limit });
      await cappedAdapter.incrementUsage(ctx, metric, amount);
    };

    const svc = createEntitlements({ persistence: cappedAdapter, planResolver }).for({
      userId: ACTIVE_SUB.userId
    });

    await svc.consume('ai.tokens.monthly', 1_000);

    expect(cappedCalls).toHaveLength(1);
    expect(cappedCalls[0]).toMatchObject({
      metric: 'ai.tokens.monthly',
      amount: 1_000,
      limit: 100_000
    });
    await expect(
      cappedAdapter.getUsage({ userId: ACTIVE_SUB.userId }, 'ai.tokens.monthly')
    ).resolves.toBe(1_000);
  });

  it('does not call incrementUsageCapped when adapter does not provide it', async () => {
    // Standard MemoryPersistenceAdapter has no incrementUsageCapped — the
    // non-atomic fallback path should be used transparently.
    const fallbackAdapter = createMemoryAdapter();
    await fallbackAdapter.saveSubscription(ACTIVE_SUB);
    expect(fallbackAdapter.incrementUsageCapped).toBeUndefined();

    const svc = createEntitlements({ persistence: fallbackAdapter, planResolver }).for({
      userId: ACTIVE_SUB.userId
    });

    await svc.consume('ai.tokens.monthly', 2_000);
    await expect(
      fallbackAdapter.getUsage({ userId: ACTIVE_SUB.userId }, 'ai.tokens.monthly')
    ).resolves.toBe(2_000);
  });

  it('propagates LimitExceededError thrown by incrementUsageCapped', async () => {
    const cappedAdapter = createMemoryAdapter();
    await cappedAdapter.saveSubscription(ACTIVE_SUB);

    cappedAdapter.incrementUsageCapped = async () => {
      // Simulate DB-side cap enforcement rejecting the increment
      throw new LimitExceededError('ai.tokens.monthly', 100_000, 99_500, 1_000);
    };

    const svc = createEntitlements({ persistence: cappedAdapter, planResolver }).for({
      userId: ACTIVE_SUB.userId
    });

    await expect(svc.consume('ai.tokens.monthly', 1_000)).rejects.toBeInstanceOf(
      LimitExceededError
    );
  });

  it('skips the non-atomic getUsage check when incrementUsageCapped is present', async () => {
    const cappedAdapter = createMemoryAdapter();
    await cappedAdapter.saveSubscription(ACTIVE_SUB);

    let getUsageCalled = false;
    const originalGetUsage = cappedAdapter.getUsage.bind(cappedAdapter);
    cappedAdapter.getUsage = async (ctx, metric) => {
      getUsageCalled = true;
      return originalGetUsage(ctx, metric);
    };
    cappedAdapter.incrementUsageCapped = async (ctx, metric, amount) => {
      await cappedAdapter.incrementUsage(ctx, metric, amount);
    };

    const svc = createEntitlements({ persistence: cappedAdapter, planResolver }).for({
      userId: ACTIVE_SUB.userId
    });

    await svc.consume('ai.tokens.monthly', 500);

    // getUsage should not have been called for the limit check because the
    // capped RPC path handles it atomically inside the DB.
    expect(getUsageCalled).toBe(false);
  });
});
