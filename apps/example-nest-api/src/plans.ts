import type { PlanDefinition, PlanResolver } from '@idevconn/isubscribe-entitlements';

export const PLANS: Record<string, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free',
    features: {
      'crm.export': false,
      'projects.max': 1,
      'ai.tokens.monthly': 1_000
    },
    meteredKeys: ['ai.tokens.monthly']
  },
  pro_monthly: {
    id: 'pro_monthly',
    name: 'Pro',
    features: {
      'crm.export': true,
      'ai.search': true,
      'projects.max': 10,
      'ai.tokens.monthly': 100_000,
      'storage.gb': null
    },
    meteredKeys: ['ai.tokens.monthly']
  },
  /**
   * Tiny demo plan — exists purely to make the LIMIT_EXCEEDED path observable
   * from `curl` in seconds. See `doc/test.md` Level 2.
   */
  tiny: {
    id: 'tiny',
    name: 'Tiny',
    features: {
      'crm.export': true,
      'ai.tokens.monthly': 3
    },
    meteredKeys: ['ai.tokens.monthly']
  }
};

export const planResolver: PlanResolver = async (id) => PLANS[id] ?? null;
