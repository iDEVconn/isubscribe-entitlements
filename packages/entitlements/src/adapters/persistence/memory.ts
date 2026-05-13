import type { ActiveSubscription, EntitlementsContext } from '../../core/types';
import type { SubscriptionPersistenceAdapter } from './interface';

export interface MemoryPersistenceAdapterOptions {
  /** Optional seed of subscriptions keyed by `composeKey(ctx)`. */
  subscriptions?: Iterable<readonly [string, ActiveSubscription]>;
}

/**
 * In-memory adapter. Useful for tests, demos, and the example app. Not safe
 * across processes; do not use in production.
 *
 * Re-exported as `@idevconn/entitlements/adapters/persistence/memory`.
 */
export class MemoryPersistenceAdapter implements SubscriptionPersistenceAdapter {
  private readonly subscriptions = new Map<string, ActiveSubscription>();
  private readonly usage = new Map<string, number>();

  constructor(options: MemoryPersistenceAdapterOptions = {}) {
    if (options.subscriptions) {
      for (const [key, sub] of options.subscriptions) {
        this.subscriptions.set(key, sub);
      }
    }
  }

  async getActiveSubscription(ctx: EntitlementsContext): Promise<ActiveSubscription | null> {
    return this.subscriptions.get(composeContextKey(ctx)) ?? null;
  }

  async saveSubscription(subscription: ActiveSubscription): Promise<void> {
    this.subscriptions.set(
      composeContextKey({
        userId: subscription.userId,
        ...(subscription.tenantId ? { tenantId: subscription.tenantId } : {})
      }),
      subscription
    );
  }

  async getUsage(ctx: EntitlementsContext, metric: string): Promise<number> {
    return this.usage.get(composeUsageKey(ctx, metric)) ?? 0;
  }

  async incrementUsage(ctx: EntitlementsContext, metric: string, amount: number): Promise<void> {
    const key = composeUsageKey(ctx, metric);
    this.usage.set(key, (this.usage.get(key) ?? 0) + amount);
  }

  /**
   * Optional capped increment — not implemented by default (falls back to the
   * non-atomic path in `consume()`). Tests can monkey-patch this property to
   * simulate the presence of the capped RPC.
   */
  incrementUsageCapped?: (
    ctx: EntitlementsContext,
    metric: string,
    amount: number,
    limit: number
  ) => Promise<void>;

  async resetUsage(ctx: EntitlementsContext, metric: string): Promise<void> {
    this.usage.delete(composeUsageKey(ctx, metric));
  }
}

export function createMemoryAdapter(
  options: MemoryPersistenceAdapterOptions = {}
): MemoryPersistenceAdapter {
  return new MemoryPersistenceAdapter(options);
}

export function composeContextKey(ctx: EntitlementsContext): string {
  return ctx.tenantId ? `${ctx.tenantId}:${ctx.userId}` : ctx.userId;
}

function composeUsageKey(ctx: EntitlementsContext, metric: string): string {
  return `${composeContextKey(ctx)}::${metric}`;
}
