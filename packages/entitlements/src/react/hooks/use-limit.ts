import { useEntitlementsContext } from './use-entitlements';

export interface UseLimitResult {
  /** `null` for unlimited, `number` for a cap, `undefined` if not declared. */
  limit: number | null | undefined;
  loading: boolean;
}

/** Reactive numeric limit lookup. */
export function useLimit(feature: string): UseLimitResult {
  const { snapshot } = useEntitlementsContext();
  const value = snapshot.entitlements[feature];

  let limit: number | null | undefined;
  if (value === undefined) limit = undefined;
  else if (value === null) limit = null;
  else if (typeof value === 'number') limit = value;
  else limit = undefined;

  return {
    limit,
    loading: snapshot.status === 'loading' || snapshot.status === 'idle'
  };
}
