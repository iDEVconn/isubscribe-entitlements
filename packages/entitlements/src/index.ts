/**
 * Public barrel for `@isubscribe/entitlements` (core).
 *
 * Subpath re-exports:
 *   - `@isubscribe/entitlements/react`
 *   - `@isubscribe/entitlements/nest`
 *   - `@isubscribe/entitlements/adapters/persistence/{memory,prisma,supabase,typeorm}`
 */

export { createEntitlements } from './core/create-entitlements';
export type { Entitlements, EntitlementsConfig } from './core/create-entitlements';

export { CoreEntitlementsService } from './core/entitlements-service';
export type { EntitlementsService } from './core/entitlements-service';

export {
  EntitlementsError,
  EntitlementDeniedError,
  LimitExceededError,
  NoActiveSubscriptionError,
  UnknownFeatureError,
  InvalidInputError,
  PlanNotFoundError
} from './core/errors';
export type { EntitlementsErrorCode } from './core/errors';

export type {
  ActivePlan,
  ActiveSubscription,
  EntitlementsContext,
  FeatureValue,
  Logger,
  PlanDefinition,
  PlanResolver,
  SubscriptionStatus
} from './core/types';
export { ACTIVE_STATUSES, isStatusActive } from './core/types';

export { MemoryCache, createMemoryCache } from './core/cache';
export type { CacheAdapter, MemoryCacheOptions } from './core/cache';

export { CaslAuthorizationEngine } from './adapters/authorization/casl-engine';
export type { AuthorizationEngine, CompiledRules } from './adapters/authorization/interface';

export type { SubscriptionPersistenceAdapter } from './adapters/persistence/interface';

export {
  parseActiveSubscription,
  parsePlanDefinition,
  activeSubscriptionSchema,
  planDefinitionSchema
} from './validation/schemas';
