import { beforeEach, describe, expect, it } from 'vitest';

import { createMemoryAdapter } from '../../src/adapters/persistence/memory';
import { createEntitlements } from '../../src/core/create-entitlements';
import { InvalidInputError, PlanNotFoundError } from '../../src/core/errors';
import { ACTIVE_SUB, PRO_PLAN, planResolver } from '../fixtures';

describe('saveSubscription — security boundary', () => {
  let adapter: ReturnType<typeof createMemoryAdapter>;

  beforeEach(() => {
    adapter = createMemoryAdapter();
  });

  it('replaces caller-supplied entitlements with plan.features', async () => {
    const ent = createEntitlements({ persistence: adapter, planResolver });

    await ent.saveSubscription({
      ...ACTIVE_SUB,
      // Attacker tries to inject privileges not defined on the plan
      entitlements: {
        'crm.export': true,
        'projects.max': null, // unlimited — not what the plan says
        'ai.tokens.monthly': 999_999_999
      }
    });

    const saved = await adapter.getActiveSubscription({ userId: ACTIVE_SUB.userId });
    expect(saved?.entitlements).toStrictEqual(PRO_PLAN.features);
  });

  it('persists plan.features even when caller passes an empty entitlements map', async () => {
    const ent = createEntitlements({ persistence: adapter, planResolver });

    await ent.saveSubscription({ ...ACTIVE_SUB, entitlements: {} });

    const saved = await adapter.getActiveSubscription({ userId: ACTIVE_SUB.userId });
    expect(saved?.entitlements).toStrictEqual(PRO_PLAN.features);
  });

  it('throws PlanNotFoundError for an unrecognised planId and does not persist', async () => {
    const ent = createEntitlements({ persistence: adapter, planResolver });

    await expect(
      ent.saveSubscription({
        ...ACTIVE_SUB,
        planId: 'enterprise_unlimited',
        entitlements: { 'crm.export': true, 'projects.max': null, 'ai.tokens.monthly': 999_999_999 }
      })
    ).rejects.toBeInstanceOf(PlanNotFoundError);

    // Nothing must have been written to the store
    const saved = await adapter.getActiveSubscription({ userId: ACTIVE_SUB.userId });
    expect(saved).toBeNull();
  });

  it('throws InvalidInputError for a malformed subscription shape', async () => {
    const ent = createEntitlements({ persistence: adapter, planResolver });

    await expect(
      ent.saveSubscription({
        // Missing required `userId`
        planId: 'pro_monthly',
        status: 'active',
        provider: 'stripe',
        startedAt: new Date(),
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(),
        entitlements: {}
      } as never)
    ).rejects.toBeInstanceOf(InvalidInputError);
  });

  it('throws InvalidInputError for unknown top-level fields (strict schema)', async () => {
    const ent = createEntitlements({ persistence: adapter, planResolver });

    await expect(
      ent.saveSubscription({
        ...ACTIVE_SUB,
        // Extra field not in the schema
        isAdmin: true
      } as never)
    ).rejects.toBeInstanceOf(InvalidInputError);
  });

  it('grants only plan-defined features after a safe save', async () => {
    const ent = createEntitlements({ persistence: adapter, planResolver });

    await ent.saveSubscription({
      ...ACTIVE_SUB,
      entitlements: { 'crm.export': true, 'projects.max': null, 'ai.tokens.monthly': 999_999_999 }
    });

    const svc = ent.for({ userId: ACTIVE_SUB.userId });

    // Feature is true on the plan — allowed
    await expect(svc.has('crm.export')).resolves.toBe(true);

    // Feature is false on the plan — denied, regardless of injected value
    await expect(svc.has('reports.advanced')).resolves.toBe(false);

    // Numeric limit comes from the plan (100_000), not the injected 999_999_999
    await expect(svc.limit('ai.tokens.monthly')).resolves.toBe(100_000);

    // projects.max is 10 on the plan, not null (unlimited)
    await expect(svc.limit('projects.max')).resolves.toBe(10);
  });
});
