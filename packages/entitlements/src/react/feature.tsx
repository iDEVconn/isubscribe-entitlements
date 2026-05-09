import type { ReactNode } from 'react';

import { useFeature } from './hooks/use-feature';

export interface FeatureProps {
  /** Feature key declared on the plan. */
  name: string;
  children: ReactNode;
  /** Optional fallback rendered while the provider is still loading the snapshot. */
  loadingFallback?: ReactNode;
}

/**
 * Renders `children` only when the named feature is granted by the active plan.
 * Renders nothing when denied. Use `<LockedFeature>` if you need an upsell UI.
 */
export function Feature({ name, children, loadingFallback = null }: FeatureProps) {
  const { allowed, loading } = useFeature(name);
  if (loading) return <>{loadingFallback}</>;
  if (!allowed) return null;
  return <>{children}</>;
}
