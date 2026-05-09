import { useContext } from 'react';

import { EntitlementsReactContext } from '../context';
import type { EntitlementsContextValue } from '../context';

/** Internal hook: throws if used outside `<EntitlementsProvider>`. */
export function useEntitlementsContext(): EntitlementsContextValue {
  const ctx = useContext(EntitlementsReactContext);
  if (!ctx) {
    throw new Error(
      '@isubscribe/entitlements/react: useSubscription/useFeature/useLimit/useUsage must be used inside <EntitlementsProvider>'
    );
  }
  return ctx;
}
