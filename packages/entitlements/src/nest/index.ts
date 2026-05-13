/**
 * Public barrel for `@idevconn/entitlements/nest`.
 *
 * Lives behind a subpath so React/standalone consumers never bundle Nest.
 */

export { EntitlementsModule } from './entitlements.module';
export type { EntitlementsModuleOptions } from './entitlements.module';

export { EntitlementsGuard } from './entitlements.guard';

export { ConsumeOnSuccessInterceptor } from './consume-on-success.interceptor';

export { RequireSubscription } from './require-subscription.decorator';
export type {
  RequireSubscriptionInput,
  RequireSubscriptionMetadata
} from './require-subscription.decorator';

export { PublicEntitlement } from './public-entitlement.decorator';

export {
  defaultEntitlementsContextResolver,
  unsafeHeaderBasedEntitlementsContextResolver
} from './entitlements-context';
export type { EntitlementsContextResolver } from './entitlements-context';

export {
  ENTITLEMENTS,
  ENTITLEMENTS_CONTEXT_RESOLVER,
  ENTITLEMENTS_DEFAULT_POLICY,
  ENTITLEMENTS_EXPOSE_ERROR_DETAILS,
  PUBLIC_ENTITLEMENT_METADATA,
  REQUIRE_SUBSCRIPTION_METADATA
} from './tokens';
