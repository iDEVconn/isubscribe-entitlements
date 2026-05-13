/**
 * Injection tokens for `@idevconn/entitlements/nest`. Exposed so that
 * consumers can access raw collaborators when they need to.
 */
export const ENTITLEMENTS = Symbol.for('isubscribe.entitlements.handle');
export const ENTITLEMENTS_CONTEXT_RESOLVER = Symbol.for('isubscribe.entitlements.context_resolver');
export const REQUIRE_SUBSCRIPTION_METADATA = 'isubscribe:entitlements:require';

/**
 * Request-scoped key under which `EntitlementsGuard` stores the resolved
 * `EntitlementsContext` so that `ConsumeOnSuccessInterceptor` can reuse the
 * same identity without running the resolver a second time.
 */
export const ENTITLEMENTS_RESOLVED_CTX_KEY = Symbol.for('isubscribe.entitlements.resolved_ctx');

/**
 * Metadata key set by `@PublicEntitlement()`. Routes or controllers carrying
 * this flag are allowed through the guard even when `defaultPolicy` is `'deny'`.
 */
export const PUBLIC_ENTITLEMENT_METADATA = 'isubscribe:entitlements:public';

/**
 * DI token that carries the `defaultPolicy` value (`'allow' | 'deny'`) into
 * `EntitlementsGuard`. Registered automatically by `EntitlementsModule.forRoot`.
 */
export const ENTITLEMENTS_DEFAULT_POLICY = Symbol.for('isubscribe.entitlements.default_policy');

/**
 * DI token that controls whether `EntitlementsError.toResponseBody()` includes
 * the full `details` object in HTTP error responses. Defaults to `true` for
 * backward compatibility. Set `exposeErrorDetails: false` in
 * `EntitlementsModuleOptions` to strip internal IDs (userId, planId, etc.)
 * from API responses in production.
 */
export const ENTITLEMENTS_EXPOSE_ERROR_DETAILS = Symbol.for(
  'isubscribe.entitlements.expose_error_details'
);
