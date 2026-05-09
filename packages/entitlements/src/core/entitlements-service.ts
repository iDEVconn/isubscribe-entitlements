import type { AuthorizationEngine, CompiledRules } from '../adapters/authorization/interface';
import type { SubscriptionPersistenceAdapter } from '../adapters/persistence/interface';
import type { CacheAdapter } from './cache';
import {
  EntitlementDeniedError,
  LimitExceededError,
  NoActiveSubscriptionError,
  PlanNotFoundError
} from './errors';
import type {
  ActivePlan,
  ActiveSubscription,
  EntitlementsContext,
  FeatureValue,
  Logger,
  PlanDefinition,
  PlanResolver
} from './types';

/** Public service contract — exactly what the spec mandates. */
export interface EntitlementsService {
  has(feature: string): Promise<boolean>;
  require(feature: string): Promise<void>;

  limit(feature: string): Promise<number | null>;
  usage(feature: string): Promise<number>;

  check(feature: string, amount?: number): Promise<boolean>;
  consume(feature: string, amount?: number): Promise<void>;

  getPlan(): Promise<ActivePlan>;
  getSubscription(): Promise<ActiveSubscription>;
  getEntitlements(): Promise<Record<string, FeatureValue>>;
}

export interface EntitlementsServiceDeps {
  context: EntitlementsContext;
  persistence: SubscriptionPersistenceAdapter;
  planResolver: PlanResolver;
  authorization: AuthorizationEngine;
  cache: CacheAdapter;
  fallbackPlan?: PlanDefinition;
  cacheTtlMs?: number;
  logger?: Logger;
}

interface ResolvedState {
  plan: ActivePlan;
  subscription: ActiveSubscription | null;
  rules: CompiledRules;
}

const SUBSCRIPTION_CACHE_PREFIX = 'sub:';
const RESOLVED_CACHE_PREFIX = 'state:';

/**
 * Per-context implementation. Build one per request (server-side) or per
 * client session (browser). Heavy-lifting lives here:
 *
 *   - resolves the active subscription via the persistence adapter,
 *   - resolves the plan via the consumer-provided `planResolver`,
 *   - delegates rule compilation to `AuthorizationEngine` (CASL by default),
 *   - caches the compiled state for `cacheTtlMs` (defaults to 5s),
 *   - invalidates the cache on `consume()`/`saveSubscription()`.
 */
export class CoreEntitlementsService implements EntitlementsService {
  constructor(private readonly deps: EntitlementsServiceDeps) {}

  async has(feature: string): Promise<boolean> {
    const { rules } = await this.resolve();
    return rules.can(feature);
  }

  async require(feature: string): Promise<void> {
    const { rules, subscription } = await this.resolve();
    if (rules.can(feature)) return;

    if (subscription === null && !this.deps.fallbackPlan) {
      throw new NoActiveSubscriptionError(this.deps.context.userId, this.deps.context.tenantId);
    }
    throw new EntitlementDeniedError(feature, this.contextDetails());
  }

  async limit(feature: string): Promise<number | null> {
    const { rules } = await this.resolve();
    const value = rules.limit(feature);
    return value === undefined ? null : value;
  }

  async usage(feature: string): Promise<number> {
    return this.deps.persistence.getUsage(this.deps.context, feature);
  }

  async check(feature: string, amount = 1): Promise<boolean> {
    if (amount < 0) return false;

    const { rules } = await this.resolve();
    if (!rules.can(feature)) return false;

    const limit = rules.limit(feature);
    if (limit === null) return true; // unlimited
    if (limit === undefined) return false; // not declared on plan

    const used = await this.deps.persistence.getUsage(this.deps.context, feature);
    return used + amount <= limit;
  }

  async consume(feature: string, amount = 1): Promise<void> {
    if (amount < 0) {
      throw new EntitlementDeniedError(feature, { reason: 'negative_amount', amount });
    }

    const { rules, subscription } = await this.resolve();
    if (!rules.can(feature)) {
      if (subscription === null && !this.deps.fallbackPlan) {
        throw new NoActiveSubscriptionError(this.deps.context.userId, this.deps.context.tenantId);
      }
      throw new EntitlementDeniedError(feature, this.contextDetails());
    }

    const limit = rules.limit(feature);
    if (limit !== null && limit !== undefined) {
      const used = await this.deps.persistence.getUsage(this.deps.context, feature);
      if (used + amount > limit) {
        throw new LimitExceededError(feature, limit, used, amount);
      }
    }

    await this.deps.persistence.incrementUsage(this.deps.context, feature, amount);
    await this.deps.cache.delete(this.resolvedKey());
  }

  async getPlan(): Promise<ActivePlan> {
    return (await this.resolve()).plan;
  }

  async getSubscription(): Promise<ActiveSubscription> {
    const { subscription } = await this.resolve();
    if (!subscription) {
      throw new NoActiveSubscriptionError(this.deps.context.userId, this.deps.context.tenantId);
    }
    return subscription;
  }

  async getEntitlements(): Promise<Record<string, FeatureValue>> {
    const { rules } = await this.resolve();
    return rules.snapshot();
  }

  /** Public hook for the React/Nest layers to nuke cache after writes. */
  async invalidate(): Promise<void> {
    await Promise.all([
      this.deps.cache.delete(this.resolvedKey()),
      this.deps.cache.delete(this.subscriptionKey())
    ]);
  }

  private async resolve(): Promise<ResolvedState> {
    const cached = await this.deps.cache.get<ResolvedState>(this.resolvedKey());
    if (cached) return cached;

    const subscription = await this.deps.persistence.getActiveSubscription(this.deps.context);
    const plan = await this.resolvePlan(subscription);
    const rules = this.deps.authorization.build(plan, subscription);
    const state: ResolvedState = { plan, subscription, rules };

    await this.deps.cache.set(this.resolvedKey(), state, this.deps.cacheTtlMs);
    return state;
  }

  private async resolvePlan(subscription: ActiveSubscription | null): Promise<ActivePlan> {
    if (subscription) {
      const live = await this.deps.planResolver(subscription.planId);
      if (live) {
        return { ...live, source: 'subscription' };
      }
      // Live lookup failed: fall back to the snapshot stored on the subscription.
      this.deps.logger?.warn?.('plan resolver returned null; using subscription snapshot', {
        planId: subscription.planId
      });
      return {
        id: subscription.planId,
        name: subscription.planId,
        features: subscription.entitlements,
        source: 'subscription'
      };
    }

    if (this.deps.fallbackPlan) {
      return { ...this.deps.fallbackPlan, source: 'fallback' };
    }

    return {
      id: '__no_plan__',
      name: 'No plan',
      features: {},
      source: 'fallback'
    };
  }

  private resolvedKey(): string {
    return `${RESOLVED_CACHE_PREFIX}${this.composeContextKey()}`;
  }

  private subscriptionKey(): string {
    return `${SUBSCRIPTION_CACHE_PREFIX}${this.composeContextKey()}`;
  }

  private composeContextKey(): string {
    const { userId, tenantId } = this.deps.context;
    return tenantId ? `${tenantId}:${userId}` : userId;
  }

  private contextDetails(): Record<string, unknown> {
    const { userId, tenantId } = this.deps.context;
    return tenantId ? { userId, tenantId } : { userId };
  }
}

export { PlanNotFoundError };
