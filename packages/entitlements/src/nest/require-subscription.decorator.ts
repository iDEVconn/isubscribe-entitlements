import { SetMetadata } from '@nestjs/common';

import { REQUIRE_SUBSCRIPTION_METADATA } from './tokens';

export interface RequireSubscriptionMetadata {
  /** Single feature; equivalent to `{ all: [feature] }`. */
  feature?: string;
  /** All listed features must be granted. */
  all?: string[];
  /** At least one of the listed features must be granted. */
  any?: string[];
  /**
   * For metered features. When set, the guard performs a `check(feature, amount)`
   * call (no consumption). Pair with `ConsumeOnSuccessInterceptor` to consume
   * after a successful response.
   */
  amount?: number;
}

export type RequireSubscriptionInput = string | RequireSubscriptionMetadata;

/**
 * Method/class decorator that attaches a feature requirement to a Nest route.
 *
 * Examples:
 *
 *   `@RequireSubscription('crm.export')`
 *   `@RequireSubscription({ all: ['crm.export', 'crm.advanced'] })`
 *   `@RequireSubscription({ feature: 'ai.tokens.monthly', amount: 1 })`
 *
 * Combine with `EntitlementsGuard` (registered globally via `EntitlementsModule`).
 */
export function RequireSubscription(
  input: RequireSubscriptionInput
): MethodDecorator & ClassDecorator {
  const meta: RequireSubscriptionMetadata = typeof input === 'string' ? { feature: input } : input;
  return SetMetadata(REQUIRE_SUBSCRIPTION_METADATA, meta);
}
