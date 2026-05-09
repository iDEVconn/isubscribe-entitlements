import type { ReactNode } from 'react';

import { useFeature } from './hooks/use-feature';

export interface LockedFeatureProps {
  name: string;
  children: ReactNode;
  /** Rendered when the feature is **denied**. Typical use: an upgrade card. */
  fallback: ReactNode;
  /** Optional placeholder while the provider is still loading. */
  loadingFallback?: ReactNode;
}

/**
 * Same gating logic as `<Feature>` but shows `fallback` (e.g. an upsell)
 * instead of `null` when the feature is denied.
 */
export function LockedFeature({
  name,
  children,
  fallback,
  loadingFallback = null
}: LockedFeatureProps) {
  const { allowed, loading } = useFeature(name);
  if (loading) return <>{loadingFallback}</>;
  if (!allowed) return <>{fallback}</>;
  return <>{children}</>;
}
