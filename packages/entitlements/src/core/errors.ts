export type EntitlementsErrorCode =
  | 'ENTITLEMENT_DENIED'
  | 'LIMIT_EXCEEDED'
  | 'NO_ACTIVE_SUBSCRIPTION'
  | 'UNKNOWN_FEATURE'
  | 'INVALID_INPUT'
  | 'PLAN_NOT_FOUND'
  | 'INTERNAL_ERROR';

/** Base class for everything the public API can throw. */
export class EntitlementsError extends Error {
  constructor(
    public readonly code: EntitlementsErrorCode,
    public readonly statusCode: number,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'EntitlementsError';
  }

  toResponseBody(verbose = true): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      ...(verbose && this.details ? { details: this.details } : {})
    };
  }
}

/** Thrown by `require()` and the Nest guard when a boolean/numeric feature is not granted. */
export class EntitlementDeniedError extends EntitlementsError {
  constructor(
    public readonly feature: string,
    details?: Record<string, unknown>
  ) {
    super('ENTITLEMENT_DENIED', 403, `Entitlement denied for feature "${feature}"`, {
      feature,
      ...details
    });
    this.name = 'EntitlementDeniedError';
  }
}

/** Thrown when a metered `consume()` would push usage above the period budget. */
export class LimitExceededError extends EntitlementsError {
  constructor(
    public readonly feature: string,
    public readonly limit: number,
    public readonly used: number,
    public readonly requested: number
  ) {
    super(
      'LIMIT_EXCEEDED',
      403,
      `Limit exceeded for "${feature}": requested ${requested}, used ${used}, limit ${limit}`,
      { feature, limit, used, requested, remaining: Math.max(0, limit - used) }
    );
    this.name = 'LimitExceededError';
  }
}

/** Thrown when the persistence layer has no record for the current context. */
export class NoActiveSubscriptionError extends EntitlementsError {
  constructor(
    public readonly userId: string,
    tenantId?: string
  ) {
    super('NO_ACTIVE_SUBSCRIPTION', 402, `No active subscription for user "${userId}"`, {
      userId,
      ...(tenantId ? { tenantId } : {})
    });
    this.name = 'NoActiveSubscriptionError';
  }
}

/** Thrown when a feature key is not declared by the resolved plan. */
export class UnknownFeatureError extends EntitlementsError {
  constructor(
    public readonly feature: string,
    public readonly planId: string
  ) {
    super('UNKNOWN_FEATURE', 400, `Unknown feature "${feature}" for plan "${planId}"`, {
      feature,
      planId
    });
    this.name = 'UnknownFeatureError';
  }
}

/** Thrown by zod validation in the public surface. */
export class InvalidInputError extends EntitlementsError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('INVALID_INPUT', 400, message, details);
    this.name = 'InvalidInputError';
  }
}

/** Thrown when `PlanResolver` returns `null` for the active subscription's `planId`. */
export class PlanNotFoundError extends EntitlementsError {
  constructor(public readonly planId: string) {
    super('PLAN_NOT_FOUND', 404, `Plan "${planId}" not found`, { planId });
    this.name = 'PlanNotFoundError';
  }
}
