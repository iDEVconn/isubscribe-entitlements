import { useCallback, useEffect, useState } from 'react';

import { useEntitlementsContext } from './use-entitlements';

export interface UseUsageResult {
  used: number;
  limit: number | null | undefined;
  remaining: number | null | undefined;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

/**
 * Live usage counter for a metered feature. Refetches when the surrounding
 * snapshot changes (e.g. after `consume()` invalidates the cache).
 */
export function useUsage(feature: string): UseUsageResult {
  const { service, snapshot } = useEntitlementsContext();
  const [used, setUsed] = useState<number>(0);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState<boolean>(snapshot.status !== 'ready');

  const limitValue = snapshot.entitlements[feature];
  let limit: number | null | undefined;
  if (limitValue === undefined) limit = undefined;
  else if (limitValue === null) limit = null;
  else if (typeof limitValue === 'number') limit = limitValue;
  else limit = undefined;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await service.usage(feature);
      setUsed(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [service, feature]);

  useEffect(() => {
    if (snapshot.status === 'ready') {
      void refresh();
    }
    // We depend on the full snapshot object (a new reference after every
    // provider refresh) so writes that don't change the subscription row
    // identity (e.g. metered consumes against a memory adapter) still
    // re-trigger this fetch.
  }, [snapshot, refresh]);

  let remaining: number | null | undefined;
  if (limit === null) remaining = null;
  else if (typeof limit === 'number') remaining = Math.max(0, limit - used);
  else remaining = undefined;

  return { used, limit, remaining, loading, error, refresh };
}
