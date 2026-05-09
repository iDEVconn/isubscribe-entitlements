import type { ActiveSubscription, PlanDefinition, PlanResolver } from '../src/core/types';

export const PRO_PLAN: PlanDefinition = {
  id: 'pro_monthly',
  name: 'Pro',
  features: {
    'crm.export': true,
    'ai.search': true,
    'reports.advanced': false,
    'projects.max': 10,
    'ai.tokens.monthly': 100_000,
    'storage.gb': null
  },
  meteredKeys: ['ai.tokens.monthly']
};

export const FREE_PLAN: PlanDefinition = {
  id: 'free',
  name: 'Free',
  features: {
    'crm.export': false,
    'projects.max': 1,
    'ai.tokens.monthly': 1_000
  },
  meteredKeys: ['ai.tokens.monthly']
};

export const ACTIVE_SUB: ActiveSubscription = {
  userId: 'user_1',
  planId: 'pro_monthly',
  status: 'active',
  provider: 'stripe',
  startedAt: new Date('2026-01-01T00:00:00Z'),
  currentPeriodStart: new Date('2026-05-01T00:00:00Z'),
  currentPeriodEnd: new Date('2026-06-01T00:00:00Z'),
  entitlements: PRO_PLAN.features
};

export const CANCELED_SUB: ActiveSubscription = {
  ...ACTIVE_SUB,
  status: 'canceled'
};

export const TRIALING_SUB: ActiveSubscription = {
  ...ACTIVE_SUB,
  status: 'trialing'
};

export const planResolver: PlanResolver = async (planId) => {
  if (planId === 'pro_monthly') return PRO_PLAN;
  if (planId === 'free') return FREE_PLAN;
  return null;
};
