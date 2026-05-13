import { describe, expect, it } from 'vitest';

import {
  EntitlementDeniedError,
  EntitlementsError,
  InvalidInputError,
  LimitExceededError,
  NoActiveSubscriptionError,
  PlanNotFoundError,
  UnknownFeatureError
} from '../../src/core/errors';

describe('EntitlementsError hierarchy', () => {
  it('all subclasses extend EntitlementsError', () => {
    expect(new EntitlementDeniedError('f')).toBeInstanceOf(EntitlementsError);
    expect(new LimitExceededError('f', 10, 5, 6)).toBeInstanceOf(EntitlementsError);
    expect(new NoActiveSubscriptionError('u')).toBeInstanceOf(EntitlementsError);
    expect(new UnknownFeatureError('f', 'p')).toBeInstanceOf(EntitlementsError);
    expect(new InvalidInputError('bad')).toBeInstanceOf(EntitlementsError);
    expect(new PlanNotFoundError('p')).toBeInstanceOf(EntitlementsError);
  });

  it('exposes feature/limit/used/requested on LimitExceededError', () => {
    const err = new LimitExceededError('ai.tokens.monthly', 100, 80, 30);
    expect(err.feature).toBe('ai.tokens.monthly');
    expect(err.limit).toBe(100);
    expect(err.used).toBe(80);
    expect(err.requested).toBe(30);
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('LIMIT_EXCEEDED');
    expect(err.toResponseBody()).toMatchObject({
      code: 'LIMIT_EXCEEDED',
      message: expect.stringContaining('ai.tokens.monthly'),
      details: expect.objectContaining({ remaining: 20 })
    });
  });

  it('NoActiveSubscriptionError uses 402 Payment Required', () => {
    const err = new NoActiveSubscriptionError('u-1', 't-1');
    expect(err.statusCode).toBe(402);
    expect(err.code).toBe('NO_ACTIVE_SUBSCRIPTION');
    expect(err.toResponseBody().details).toMatchObject({ userId: 'u-1', tenantId: 't-1' });
  });

  it('attaches feature on EntitlementDeniedError', () => {
    const err = new EntitlementDeniedError('crm.export');
    expect(err.feature).toBe('crm.export');
    expect(err.statusCode).toBe(403);
  });
});

describe('toResponseBody verbose flag (L2 — error detail exposure)', () => {
  it('includes details by default (verbose=true)', () => {
    const err = new NoActiveSubscriptionError('u-1', 't-1');
    const body = err.toResponseBody();
    expect(body.details).toBeDefined();
    expect((body.details as Record<string, unknown>).userId).toBe('u-1');
  });

  it('omits details when verbose=false', () => {
    const err = new NoActiveSubscriptionError('u-1', 't-1');
    const body = err.toResponseBody(false);
    expect(body.code).toBe('NO_ACTIVE_SUBSCRIPTION');
    expect(body.message).toBeDefined();
    expect(body.details).toBeUndefined();
  });

  it('omits details from LimitExceededError when verbose=false', () => {
    const err = new LimitExceededError('ai.tokens.monthly', 100, 80, 30);
    const body = err.toResponseBody(false);
    expect(body.code).toBe('LIMIT_EXCEEDED');
    expect(body.message).toBeDefined();
    expect(body.details).toBeUndefined();
  });

  it('omits details from EntitlementDeniedError when verbose=false', () => {
    const err = new EntitlementDeniedError('crm.export');
    const body = err.toResponseBody(false);
    expect(body.code).toBe('ENTITLEMENT_DENIED');
    expect(body.details).toBeUndefined();
  });

  it('explicit verbose=true behaves identically to the default', () => {
    const err = new LimitExceededError('x', 10, 5, 6);
    expect(err.toResponseBody(true)).toEqual(err.toResponseBody());
  });
});
