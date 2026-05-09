import { z } from 'zod';

import { InvalidInputError } from '../core/errors';
import type { ActiveSubscription, PlanDefinition, SubscriptionStatus } from '../core/types';

const featureValueSchema = z.union([z.boolean(), z.number(), z.null()]);

export const planDefinitionSchema = z
  .object({
    id: z.string().min(1, 'plan id must be a non-empty string'),
    name: z.string().min(1, 'plan name must be a non-empty string'),
    features: z.record(z.string(), featureValueSchema),
    meteredKeys: z.array(z.string()).optional()
  })
  .strict();

const subscriptionStatusSchema = z.enum([
  'trialing',
  'active',
  'past_due',
  'canceled',
  'expired'
]) satisfies z.ZodType<SubscriptionStatus>;

export const activeSubscriptionSchema = z
  .object({
    userId: z.string().min(1, 'userId must be a non-empty string'),
    tenantId: z.string().min(1).optional(),
    planId: z.string().min(1, 'planId must be a non-empty string'),
    status: subscriptionStatusSchema,
    provider: z.string().min(1, 'provider must be a non-empty string'),
    providerCustomerId: z.string().optional(),
    providerSubscriptionId: z.string().optional(),
    startedAt: z.coerce.date(),
    currentPeriodStart: z.coerce.date(),
    currentPeriodEnd: z.coerce.date(),
    entitlements: z.record(z.string(), featureValueSchema)
  })
  .strict();

export function parsePlanDefinition(payload: unknown): PlanDefinition {
  const result = planDefinitionSchema.safeParse(payload);
  if (!result.success) {
    throw new InvalidInputError(formatIssues(result.error.issues), {
      issues: result.error.issues
    });
  }
  return result.data as PlanDefinition;
}

export function parseActiveSubscription(payload: unknown): ActiveSubscription {
  const result = activeSubscriptionSchema.safeParse(payload);
  if (!result.success) {
    throw new InvalidInputError(formatIssues(result.error.issues), {
      issues: result.error.issues
    });
  }
  return result.data as ActiveSubscription;
}

function formatIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'body';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}
