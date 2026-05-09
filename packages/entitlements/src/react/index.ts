/**
 * Public barrel for `@isubscribe/entitlements/react`.
 *
 * Lives behind a subpath so backend-only consumers never bundle React.
 */

export { EntitlementsProvider } from './provider';
export type { EntitlementsProviderProps } from './provider';

export { Feature } from './feature';
export type { FeatureProps } from './feature';

export { LockedFeature } from './locked-feature';
export type { LockedFeatureProps } from './locked-feature';

export { useSubscription } from './hooks/use-subscription';
export type { UseSubscriptionResult } from './hooks/use-subscription';

export { useFeature } from './hooks/use-feature';
export type { UseFeatureResult } from './hooks/use-feature';

export { useLimit } from './hooks/use-limit';
export type { UseLimitResult } from './hooks/use-limit';

export { useUsage } from './hooks/use-usage';
export type { UseUsageResult } from './hooks/use-usage';

export type { EntitlementsContextValue, EntitlementsSnapshot } from './context';
