import type { ActiveSubscription, EntitlementsContext } from '../../core/types';

/**
 * Pluggable persistence layer. Consumers own the database; the package only
 * needs these primitives. Increment must be **atomic** at the database level
 * to avoid races between concurrent `consume()` calls.
 */
export interface SubscriptionPersistenceAdapter {
  getActiveSubscription(ctx: EntitlementsContext): Promise<ActiveSubscription | null>;
  saveSubscription(subscription: ActiveSubscription): Promise<void>;

  getUsage(ctx: EntitlementsContext, metric: string): Promise<number>;
  /**
   * Atomically increment the per-period usage counter for `metric`.
   *
   * Implementations are expected to scope the counter by the user's current
   * billing period (e.g. include `currentPeriodStart` in the row key) so that
   * counters reset automatically when the period rolls over.
   */
  incrementUsage(ctx: EntitlementsContext, metric: string, amount: number): Promise<void>;

  /**
   * Atomically increment usage **and** enforce the cap inside a single
   * database transaction, eliminating the TOCTOU race that exists when
   * `getUsage` and `incrementUsage` are called separately.
   *
   * When implemented, `consume()` will prefer this method over the non-atomic
   * fallback path. Throw `LimitExceededError` when the increment would push
   * usage above `limit`.
   *
   * Optional: adapters that do not implement this fall back to the non-atomic
   * `getUsage → compare → incrementUsage` sequence.
   */
  incrementUsageCapped?(
    ctx: EntitlementsContext,
    metric: string,
    amount: number,
    limit: number
  ): Promise<void>;

  /** Optional: hard-reset a counter (admin / period rollover hook). */
  resetUsage?(ctx: EntitlementsContext, metric: string): Promise<void>;
}
