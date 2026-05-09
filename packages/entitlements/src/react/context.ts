import { createContext } from 'react';

import type { EntitlementsService } from '../core/entitlements-service';
import type { ActivePlan, ActiveSubscription, FeatureValue } from '../core/types';

/** Snapshot the provider keeps in state. Drives all React hooks. */
export interface EntitlementsSnapshot {
  status: 'idle' | 'loading' | 'ready' | 'error';
  subscription: ActiveSubscription | null;
  plan: ActivePlan | null;
  entitlements: Record<string, FeatureValue>;
  error: Error | null;
}

export interface EntitlementsContextValue {
  service: EntitlementsService;
  snapshot: EntitlementsSnapshot;
  refresh: () => Promise<void>;
}

export const EntitlementsReactContext = createContext<EntitlementsContextValue | null>(null);
EntitlementsReactContext.displayName = 'EntitlementsContext';
