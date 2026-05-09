import { CaslAuthorizationEngine } from '../adapters/authorization/casl-engine';
import type { AuthorizationEngine } from '../adapters/authorization/interface';
import type { SubscriptionPersistenceAdapter } from '../adapters/persistence/interface';
import { MemoryCache } from './cache';
import type { CacheAdapter } from './cache';
import { CoreEntitlementsService } from './entitlements-service';
import type { EntitlementsService } from './entitlements-service';
import { InvalidInputError } from './errors';
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
  /** Cache TTL applied per resolved state. Default `5_000`. `0` disables caching. */
  cacheTtlMs?: number;
  /** Plan returned for users with no active subscription (e.g. anonymous / free tier). */
  fallbackPlan?: PlanDefinition;
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
          ...(resolved.logger ? { logger: resolved.logger } : {}),
          ...(resolved.fallbackPlan ? { fallbackPlan: resolved.fallbackPlan } : {})
        });
        services.set(key, svc);
      }
      return svc;
    },

    async saveSubscription(subscription) {
      await resolved.persistence.saveSubscription(subscription);
      const ctx: EntitlementsContext = {
        userId: subscription.userId,
        ...(subscription.tenantId ? { tenantId: subscription.tenantId } : {})
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
