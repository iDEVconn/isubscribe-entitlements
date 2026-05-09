/**
 * Injection tokens for `@isubscribe/entitlements/nest`. Exposed so that
 * consumers can access raw collaborators when they need to.
 */
export const ENTITLEMENTS = Symbol.for('isubscribe.entitlements.handle');
export const ENTITLEMENTS_CONTEXT_RESOLVER = Symbol.for('isubscribe.entitlements.context_resolver');
export const REQUIRE_SUBSCRIPTION_METADATA = 'isubscribe:entitlements:require';
