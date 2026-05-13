import { CaslAuthorizationEngine } from '../adapters/authorization/casl-engine';
import type { AuthorizationEngine } from '../adapters/authorization/interface';
import type { SubscriptionPersistenceAdapter } from '../adapters/persistence/interface';
import { parseActiveSubscription } from '../validation/schemas';
import { MemoryCache } from './cache';
import type { CacheAdapter } from './cache';
import { CoreEntitlementsService } from './entitlements-service';
import type { EntitlementsService } from './entitlements-service';
import { InvalidInputError, PlanNotFoundError } from './errors';
import type {
  ActiveSubscription,
  EntitlementsContext,
  Logger,
  PlanDefinition,
  PlanResolver
} from './types';

export interface EntitlementsConfig {
  persistence: SubscriptionPersistenceAdapter;
  planResolver: PlanResolver;
  /** Defaults to `CaslAuthorizationEngine`. Swap to plug OPA/Cerbos/etc. */
  authorization?: AuthorizationEngine;
  /** Defaults to `MemoryCache` with 5s TTL. */
  cache?: CacheAdapter;
  /**
   * Cache TTL applied per resolved state. Default `5_000` ms. `0` disables caching.
   *
   * @remarks
   * The default `MemoryCache` is **process-local**. In multi-process / multi-pod
   * environments, each instance caches independently, so entitlement changes
   * propagate only after this TTL expires **per process**. Use `cacheTtlMs: 0`
   * for high-value gates, or supply a shared `CacheAdapter` (e.g. Redis).
   */
  cacheTtlMs?: number;
  /** Plan returned for users with no active subscription (e.g. anonymous / free tier). */
  fallbackPlan?: PlanDefinition;
  /**
   * When `planResolver` returns `null` for an active subscription's `planId`,
   * fall back to the entitlements snapshot stored in the subscription row.
   *
   * **Security warning:** Only enable if you fully control and trust the
   * integrity of your persistence layer. When disabled (the default),
   * a missing plan throws `PlanNotFoundError`, preventing stale or tampered
   * snapshots from granting unauthorised access.
   *
   * **Soft-revoke pattern (L1):** Instead of returning `null` for a deleted or
   * discontinued plan, have your `planResolver` return a plan object with an
   * empty `features` map — e.g. `{ id, name, features: {} }`. This silently
   * revokes all entitlements without throwing `PlanNotFoundError`, and works
   * regardless of whether `planSnapshotFallback` is enabled.
   *
   * @default false
   */
  planSnapshotFallback?: boolean;
  logger?: Logger;
}

/** Top-level handle returned by `createEntitlements`. */
export interface Entitlements {
  /** Build (or reuse) a per-context service. */
  for(context: EntitlementsContext): EntitlementsService;
  /** Persist a subscription and invalidate any cached state. */
  saveSubscription(subscription: ActiveSubscription): Promise<void>;
  /** Drop any cached resolved state. Safe to call from webhooks. */
  invalidate(context: EntitlementsContext): Promise<void>;
  /** Direct access to underlying adapters for advanced cases. */
  readonly config: Readonly<
    Required<Omit<EntitlementsConfig, 'logger' | 'fallbackPlan'>> &
      Pick<EntitlementsConfig, 'logger' | 'fallbackPlan'>
  >;
}

/**
 * Factory that wires a persistence adapter, a plan resolver, and the default
 * CASL authorization engine into a multi-context entitlements API.
 *
 * Mirrors the `createPayment` factory shape from `@idevconn/payment` so a
 * consumer of both packages experiences the same DX.
 */
export function createEntitlements(config: EntitlementsConfig): Entitlements {
  if (!config.persistence) {
    throw new InvalidInputError('createEntitlements: `persistence` is required');
  }
  if (!config.planResolver) {
    throw new InvalidInputError('createEntitlements: `planResolver` is required');
  }

  const resolved = {
    persistence: config.persistence,
    planResolver: config.planResolver,
    authorization: config.authorization ?? new CaslAuthorizationEngine(),
    cache: config.cache ?? new MemoryCache(),
    cacheTtlMs: config.cacheTtlMs ?? 5_000,
    planSnapshotFallback: config.planSnapshotFallback ?? false,
    ...(config.logger ? { logger: config.logger } : {}),
    ...(config.fallbackPlan ? { fallbackPlan: config.fallbackPlan } : {})
  } satisfies Entitlements['config'];

  const services = new Map<string, CoreEntitlementsService>();

  function keyFor(ctx: EntitlementsContext): string {
    return ctx.tenantId ? `${ctx.tenantId}:${ctx.userId}` : ctx.userId;
  }

  return {
    for(context) {
      const key = keyFor(context);
      let svc = services.get(key);
      if (!svc) {
        svc = new CoreEntitlementsService({
          context,
          persistence: resolved.persistence,
          planResolver: resolved.planResolver,
          authorization: resolved.authorization,
          cache: resolved.cache,
          cacheTtlMs: resolved.cacheTtlMs,
          planSnapshotFallback: resolved.planSnapshotFallback,
          ...(resolved.logger ? { logger: resolved.logger } : {}),
          ...(resolved.fallbackPlan ? { fallbackPlan: resolved.fallbackPlan } : {})
        });
        services.set(key, svc);
      }
      return svc;
    },

    async saveSubscription(subscription) {
      // 1. Validate shape at the engine boundary – rejects unknown fields and
      //    bad types before anything is persisted.
      const parsed = parseActiveSubscription(subscription);

      // 2. Re-resolve entitlements from the authoritative plan catalog.
      //    Caller-supplied entitlements are deliberately ignored so that a
      //    crafted webhook payload cannot elevate a user's privileges.
      const plan = await resolved.planResolver(parsed.planId);
      if (!plan) {
        throw new PlanNotFoundError(parsed.planId);
      }

      // 3. Persist with plan-derived features only (treat the column as a
      //    display cache, not an authoritative grants store).
      const safeSubscription: ActiveSubscription = { ...parsed, entitlements: plan.features };
      await resolved.persistence.saveSubscription(safeSubscription);

      const ctx: EntitlementsContext = {
        userId: safeSubscription.userId,
        ...(safeSubscription.tenantId ? { tenantId: safeSubscription.tenantId } : {})
      };
      const svc = services.get(keyFor(ctx));
      if (svc) await svc.invalidate();
    },

    async invalidate(context) {
      const svc = services.get(keyFor(context));
      if (svc) await svc.invalidate();
    },

    config: resolved
  };
}
