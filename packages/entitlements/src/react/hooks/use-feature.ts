import type { FeatureValue } from '../../core/types';
import { useEntitlementsContext } from './use-entitlements';

export interface UseFeatureResult {
  /** `true` when the feature is granted by the active plan. */
  allowed: boolean;
  /** Raw value (boolean / number / null / undefined when the feature is not declared). */
  value: FeatureValue | undefined;
  /** Hydration state — `true` while the provider is still loading. */
  loading: boolean;
}

/** Reactive boolean access check for a single feature. */
export function useFeature(feature: string): UseFeatureResult {
  const { snapshot } = useEntitlementsContext();
  const value = snapshot.entitlements[feature];
  const allowed = isAllowed(value);
  return {
    allowed,
    value,
    loading: snapshot.status === 'loading' || snapshot.status === 'idle'
  };
}

function isAllowed(value: FeatureValue | undefined): boolean {
  if (value === true || value === null) return true;
  if (typeof value === 'number') return value > 0;
  return false;
}
