import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { EntitlementsService } from '../core/entitlements-service';
import type { ActivePlan, ActiveSubscription, FeatureValue } from '../core/types';
import { EntitlementsReactContext } from './context';
import type { EntitlementsSnapshot } from './context';

export interface EntitlementsProviderProps {
  /** A pre-built service (e.g. produced by `entitlements.for(ctx)` server-side). */
  service: EntitlementsService;
  /** SSR snapshot. When provided, the provider hydrates without an initial fetch. */
  initialSnapshot?: Partial<EntitlementsSnapshot>;
  children: ReactNode;
}

/**
 * Wires the core service into React. SSR-safe: when `initialSnapshot` is
 * provided the first render uses those values verbatim and we never trigger
 * effects against `window` until the client hydrates.
 */
export function EntitlementsProvider({
  service,
  initialSnapshot,
  children
}: EntitlementsProviderProps) {
  const [snapshot, setSnapshot] = useState<EntitlementsSnapshot>(() => ({
    status: initialSnapshot?.status ?? (initialSnapshot ? 'ready' : 'idle'),
    subscription: initialSnapshot?.subscription ?? null,
    plan: initialSnapshot?.plan ?? null,
    entitlements: initialSnapshot?.entitlements ?? {},
    error: initialSnapshot?.error ?? null
  }));

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setSnapshot((prev) => ({ ...prev, status: 'loading', error: null }));
    try {
      const [subscription, plan, entitlements] = await Promise.all([
        service.getSubscription().catch(() => null),
        service.getPlan(),
        service.getEntitlements()
      ]);
      if (!mounted.current) return;
      setSnapshot({
        status: 'ready',
        subscription: subscription as ActiveSubscription | null,
        plan: plan as ActivePlan,
        entitlements: entitlements as Record<string, FeatureValue>,
        error: null
      });
    } catch (err) {
      if (!mounted.current) return;
      setSnapshot((prev) => ({
        ...prev,
        status: 'error',
        error: err instanceof Error ? err : new Error(String(err))
      }));
    }
  }, [service]);

  // isFirstEffect tracks whether this is the initial mount so we can handle
  // SSR hydration (skip load) vs. service-change (reset + load) correctly.
  const isFirstEffect = useRef(true);
  useEffect(() => {
    const first = isFirstEffect.current;
    isFirstEffect.current = false;

    if (first) {
      // Initial mount: when an SSR snapshot was provided, skip the first fetch
      // to avoid a hydration flash. The snapshot is already in state.
      if (initialSnapshot) return;
    } else {
      // `load` changed identity because `service` changed (e.g. a different
      // authenticated user). Clear stale entitlements synchronously so that
      // hooks like useFeature never return data belonging to the previous user.
      setSnapshot({
        status: 'idle',
        subscription: null,
        plan: null,
        entitlements: {},
        error: null
      });
    }

    void load();
    // `load` is the only dep we need: it gets a new reference whenever
    // `service` changes (its useCallback dep), which re-triggers this effect.
    // `initialSnapshot` is intentionally consumed only on the first run (via
    // the isFirstEffect ref) and does not need to trigger re-loading if it
    // changes at runtime (it is an SSR-only prop).
  }, [load]);

  const value = useMemo(() => ({ service, snapshot, refresh: load }), [service, snapshot, load]);

  return (
    <EntitlementsReactContext.Provider value={value}>{children}</EntitlementsReactContext.Provider>
  );
}
