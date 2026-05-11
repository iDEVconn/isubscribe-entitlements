/**
 * Public domain types for `@idevconn/entitlements`.
 *
 * Hand-shake contracts:
 *   - Plan Builder produces `PlanDefinition`.
 *   - Payment Orchestrator produces (after a successful checkout) `ActiveSubscription`.
 *   - Consumer app persists those via a `SubscriptionPersistenceAdapter`.
 *   - The runtime engine reads them and exposes `EntitlementsService`.
 */

/** Allowed feature value shapes. `null` means "explicitly unlimited". */
export type FeatureValue = boolean | number | null;

/** Plan as authored in the Plan Builder. */
export interface PlanDefinition {
  id: string;
  name: string;
  /**
   * Map of feature key -> value.
   * - `boolean`: gated capability (e.g. `crm.export: true`).
   * - `number`:  numeric cap (e.g. `projects.max: 10`) or metered budget (e.g. `ai.tokens.monthly: 100000`).
   * - `null`:    unlimited.
   */
  features: Record<string, FeatureValue>;
  /**
   * Subset of feature keys whose `number` value is consumed over the period
   * (i.e. metered usage rather than a hard cap).
   */
  meteredKeys?: readonly string[];
}

/** Lifecycle status of an active subscription record. */
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';

/** Persisted subscription tied to a single user/tenant. */
export interface ActiveSubscription {
  userId: string;
  tenantId?: string;
  planId: string;
  status: SubscriptionStatus;

  provider: string;
  providerCustomerId?: string;
  providerSubscriptionId?: string;

  startedAt: Date;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;

  /**
   * Effective entitlements snapshot at the time of persistence.
   * Used as a fallback / cache when the live `PlanDefinition` cannot be resolved.
   */
  entitlements: Record<string, FeatureValue>;
}

/** Resolved plan returned to consumers via `getPlan()`. */
export type ActivePlan = PlanDefinition & {
  /**
   * - `'subscription'`: came from the user's active subscription.
   * - `'fallback'`:     came from `EntitlementsConfig.fallbackPlan`.
   */
  source: 'subscription' | 'fallback';
};

/** Identity used to scope every persistence call. */
export interface EntitlementsContext {
  userId: string;
  tenantId?: string;
}

/** Pluggable plan resolver — the consumer app owns where plans live. */
export type PlanResolver = (planId: string) => Promise<PlanDefinition | null>;

/** Minimal logger contract — same shape as the `payPal-npm` Logger. */
export interface Logger {
  debug?(message: string, meta?: unknown): void;
  info?(message: string, meta?: unknown): void;
  warn?(message: string, meta?: unknown): void;
  error?(message: string, meta?: unknown): void;
}

/**
 * Statuses that grant entitlements. Anything outside falls back to
 * `EntitlementsConfig.fallbackPlan` (or denies everything if absent).
 */
export const ACTIVE_STATUSES: readonly SubscriptionStatus[] = ['trialing', 'active'] as const;

export function isStatusActive(status: SubscriptionStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}
