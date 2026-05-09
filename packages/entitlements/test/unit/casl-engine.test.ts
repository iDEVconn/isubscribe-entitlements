import { describe, expect, it } from 'vitest';

import { CaslAuthorizationEngine } from '../../src/adapters/authorization/casl-engine';
import { ACTIVE_SUB, CANCELED_SUB, PRO_PLAN, TRIALING_SUB } from '../fixtures';

const engine = new CaslAuthorizationEngine();

describe('CaslAuthorizationEngine', () => {
  it('grants boolean features set to true', () => {
    const rules = engine.build(PRO_PLAN, ACTIVE_SUB);
    expect(rules.can('crm.export')).toBe(true);
    expect(rules.can('ai.search')).toBe(true);
  });

  it('denies boolean features set to false', () => {
    const rules = engine.build(PRO_PLAN, ACTIVE_SUB);
    expect(rules.can('reports.advanced')).toBe(false);
  });

  it('denies undeclared features by default', () => {
    const rules = engine.build(PRO_PLAN, ACTIVE_SUB);
    expect(rules.can('not.declared')).toBe(false);
    expect(rules.limit('not.declared')).toBeUndefined();
  });

  it('treats positive numeric features as granted with a limit', () => {
    const rules = engine.build(PRO_PLAN, ACTIVE_SUB);
    expect(rules.can('projects.max')).toBe(true);
    expect(rules.limit('projects.max')).toBe(10);
  });

  it('treats null numeric features as granted with unlimited', () => {
    const rules = engine.build(PRO_PLAN, ACTIVE_SUB);
    expect(rules.can('storage.gb')).toBe(true);
    expect(rules.limit('storage.gb')).toBeNull();
  });

  it('grants entitlements for trialing subscriptions', () => {
    const rules = engine.build(PRO_PLAN, TRIALING_SUB);
    expect(rules.can('crm.export')).toBe(true);
  });

  it('denies all features when subscription is canceled', () => {
    const rules = engine.build(PRO_PLAN, CANCELED_SUB);
    expect(rules.can('crm.export')).toBe(false);
    expect(rules.can('projects.max')).toBe(false);
    expect(rules.snapshot()).toEqual({});
  });

  it('grants the resolved plan when subscription is null (resolver decides plan)', () => {
    // The resolver substitutes a fallback plan or an empty placeholder; the
    // engine simply trusts whatever plan it is given.
    const rules = engine.build(PRO_PLAN, null);
    expect(rules.can('crm.export')).toBe(true);
    expect(rules.snapshot()).toEqual(PRO_PLAN.features);
  });

  it('denies everything when the resolved plan is empty (no fallback)', () => {
    const emptyPlan = { id: '__no_plan__', name: 'No plan', features: {} };
    const rules = engine.build(emptyPlan, null);
    expect(rules.can('crm.export')).toBe(false);
    expect(rules.snapshot()).toEqual({});
  });

  it('exposes a copy of the effective entitlements via snapshot()', () => {
    const rules = engine.build(PRO_PLAN, ACTIVE_SUB);
    const snap = rules.snapshot();
    expect(snap).toEqual(PRO_PLAN.features);
    snap['crm.export'] = false;
    expect(rules.can('crm.export')).toBe(true);
  });

  it('returns raw feature values', () => {
    const rules = engine.build(PRO_PLAN, ACTIVE_SUB);
    expect(rules.raw('projects.max')).toBe(10);
    expect(rules.raw('storage.gb')).toBeNull();
    expect(rules.raw('crm.export')).toBe(true);
    expect(rules.raw('not.there')).toBeUndefined();
  });
});
