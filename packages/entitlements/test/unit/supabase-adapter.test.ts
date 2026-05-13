import { describe, expect, it, vi } from 'vitest';

import {
  SupabasePersistenceAdapter,
  type SupabaseClientLike
} from '../../src/adapters/persistence/supabase';
import { InvalidInputError } from '../../src/core/errors';

/** Minimal client stub — methods are not called during constructor validation. */
const stubClient: SupabaseClientLike = {
  from: vi.fn(),
  rpc: vi.fn()
};

describe('SupabasePersistenceAdapter constructor — identifier validation (M5)', () => {
  it('accepts valid snake_case identifiers', () => {
    expect(
      () =>
        new SupabasePersistenceAdapter({
          client: stubClient,
          subscriptionsTable: 'my_subscriptions',
          usageTable: 'my_usage',
          incrementRpc: 'my_increment_fn',
          incrementRpcCapped: 'my_increment_fn_capped'
        })
    ).not.toThrow();
  });

  it('accepts mixed-case identifiers (Postgres folds to lowercase but allows)', () => {
    expect(
      () =>
        new SupabasePersistenceAdapter({
          client: stubClient,
          subscriptionsTable: 'MySubscriptions'
        })
    ).not.toThrow();
  });

  it('accepts identifiers with digits after the first character', () => {
    expect(
      () =>
        new SupabasePersistenceAdapter({
          client: stubClient,
          usageTable: 'usage_v2'
        })
    ).not.toThrow();
  });

  it.each([
    ['subscriptionsTable', 'users; DROP TABLE subs --'],
    ['subscriptionsTable', '1_invalid_start'],
    ['subscriptionsTable', '-invalid'],
    ['usageTable', 'usage table'],
    ['usageTable', 'usage.table'],
    ['incrementRpc', 'fn(); DROP TABLE--'],
    ['incrementRpc', 'fn name'],
    ['incrementRpcCapped', 'bad-name'],
    ['incrementRpcCapped', "'; SELECT 1; --"]
  ])('throws InvalidInputError for bad %s value "%s"', (optionKey: string, value: string) => {
    expect(
      () =>
        new SupabasePersistenceAdapter({
          client: stubClient,
          [optionKey]: value
        })
    ).toThrow(InvalidInputError);
  });

  it('does not validate default identifier strings (only caller-supplied ones)', () => {
    // Constructor with no optional identifier overrides should never throw.
    expect(
      () =>
        new SupabasePersistenceAdapter({
          client: stubClient
        })
    ).not.toThrow();
  });
});
