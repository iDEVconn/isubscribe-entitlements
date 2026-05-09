import type { EntitlementsService } from '../../core/entitlements-service';
import type { ActivePlan, ActiveSubscription, FeatureValue } from '../../core/types';
import type { EntitlementsSnapshot } from '../context';
import { useEntitlementsContext } from './use-entitlements';

export interface UseSubscriptionResult {
  status: EntitlementsSnapshot['status'];
  subscription: ActiveSubscription | null;
  plan: ActivePlan | null;
  entitlements: Record<string, FeatureValue>;
  error: Error | null;
  has: EntitlementsService['has'];
  limit: EntitlementsService['limit'];
  usage: EntitlementsService['usage'];
  check: EntitlementsService['check'];
  consume: EntitlementsService['consume'];
  require: EntitlementsService['require'];
  refresh: () => Promise<void>;
}

/**
 * Primary read hook. Returns the live snapshot plus bound mutator helpers
 * that automatically refresh the provider state after writes.
 */
export function useSubscription(): UseSubscriptionResult {
  const { service, snapshot, refresh } = useEntitlementsContext();

  return {
    status: snapshot.status,
    subscription: snapshot.subscription,
    plan: snapshot.plan,
    entitlements: snapshot.entitlements,
    error: snapshot.error,
    has: service.has.bind(service),
    limit: service.limit.bind(service),
    usage: service.usage.bind(service),
    check: service.check.bind(service),
    consume: async (feature, amount) => {
      await service.consume(feature, amount);
      await refresh();
    },
    require: service.require.bind(service),
    refresh
  };
}
