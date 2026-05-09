import type { ActiveSubscription, FeatureValue, PlanDefinition } from '../../core/types';

/**
 * Pluggable authorization engine. The default implementation is CASL-based
 * (`CaslAuthorizationEngine`) but consumers can swap it for OPA, Cerbos,
 * or a custom evaluator without touching the public `EntitlementsService` API.
 */
export interface AuthorizationEngine {
  build(plan: PlanDefinition, subscription: ActiveSubscription | null): CompiledRules;
}

/** Output of `AuthorizationEngine.build`. Pure & synchronous. */
export interface CompiledRules {
  /** Boolean access check. Numeric features count as "granted" when not null and != 0. */
  can(feature: string): boolean;
  /** Numeric limit (or `null` for unlimited / `undefined` if feature is not declared). */
  limit(feature: string): number | null | undefined;
  /** Raw feature value as declared on the plan. */
  raw(feature: string): FeatureValue | undefined;
  /** Snapshot of the effective entitlements map. */
  snapshot(): Record<string, FeatureValue>;
}
