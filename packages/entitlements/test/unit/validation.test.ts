import { describe, expect, it } from 'vitest';

import { InvalidInputError } from '../../src/core/errors';
import { parseActiveSubscription, parsePlanDefinition } from '../../src/validation/schemas';
import { ACTIVE_SUB, PRO_PLAN } from '../fixtures';

describe('zod validation helpers', () => {
  it('parsePlanDefinition accepts a valid plan', () => {
    expect(parsePlanDefinition(PRO_PLAN)).toEqual(PRO_PLAN);
  });

  it('parsePlanDefinition rejects malformed plans', () => {
    expect(() => parsePlanDefinition({ id: '', name: 'x', features: {} })).toThrow(
      InvalidInputError
    );
    expect(() => parsePlanDefinition({ name: 'x', features: {} })).toThrow(InvalidInputError);
    expect(() =>
      parsePlanDefinition({ id: 'a', name: 'b', features: { foo: { bad: 'shape' } } })
    ).toThrow(InvalidInputError);
  });

  it('parseActiveSubscription accepts a valid subscription', () => {
    const result = parseActiveSubscription(ACTIVE_SUB);
    expect(result.userId).toBe(ACTIVE_SUB.userId);
    expect(result.status).toBe('active');
    expect(result.startedAt).toBeInstanceOf(Date);
  });

  it('parseActiveSubscription coerces ISO strings to Dates', () => {
    const sub = parseActiveSubscription({
      ...ACTIVE_SUB,
      startedAt: ACTIVE_SUB.startedAt.toISOString(),
      currentPeriodStart: ACTIVE_SUB.currentPeriodStart.toISOString(),
      currentPeriodEnd: ACTIVE_SUB.currentPeriodEnd.toISOString()
    });
    expect(sub.startedAt).toBeInstanceOf(Date);
    expect(sub.currentPeriodStart).toBeInstanceOf(Date);
    expect(sub.currentPeriodEnd).toBeInstanceOf(Date);
  });

  it('parseActiveSubscription rejects unknown status values', () => {
    expect(() => parseActiveSubscription({ ...ACTIVE_SUB, status: 'frozen' })).toThrow(
      InvalidInputError
    );
  });
});
