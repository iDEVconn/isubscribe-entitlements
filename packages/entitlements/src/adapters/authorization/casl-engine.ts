import { AbilityBuilder, createMongoAbility, type MongoAbility } from '@casl/ability';

import type { ActiveSubscription, FeatureValue, PlanDefinition } from '../../core/types';
import { isStatusActive } from '../../core/types';
import type { AuthorizationEngine, CompiledRules } from './interface';

type Action = 'access';
type Subject = string;
type FeatureAbility = MongoAbility<[Action, Subject]>;

/**
 * Default authorization engine. Translates the plan's feature map into a CASL
 * `MongoAbility` so the public API can answer `has`/`limit`/`check` without
 * leaking CASL types to consumers.
 *
 * Mapping rules:
 *   - `boolean true`  -> `can('access', feature)`.
 *   - `boolean false` -> rule omitted (denied by default).
 *   - `number > 0`    -> `can('access', feature)` and stored as numeric limit.
 *   - `number === 0`  -> rule omitted (denied).
 *   - `null`          -> `can('access', feature)` and exposed as unlimited.
 *
 * If the subscription is missing or in a non-granting status, no rules are
 * registered and every `can()` call returns `false`.
 */
export class CaslAuthorizationEngine implements AuthorizationEngine {
  build(plan: PlanDefinition, subscription: ActiveSubscription | null): CompiledRules {
    // When `subscription` is null, the upstream resolver has already picked the
    // plan to apply (either the fallback plan or an empty placeholder), so we
    // grant whatever it carries. When a subscription exists, we still gate the
    // grant on status (only `trialing`/`active` count).
    const grants = subscription === null || isStatusActive(subscription.status);
    const effective = grants ? plan.features : {};
    const ability = compileAbility(effective);

    return {
      can: (feature) => ability.can('access', feature),
      limit: (feature) => readLimit(effective, feature),
      raw: (feature) => (feature in effective ? effective[feature] : undefined),
      snapshot: () => ({ ...effective })
    };
  }
}

function compileAbility(features: Record<string, FeatureValue>): FeatureAbility {
  const builder = new AbilityBuilder<FeatureAbility>(createMongoAbility);

  for (const [feature, value] of Object.entries(features)) {
    if (value === true || value === null) {
      builder.can('access', feature);
      continue;
    }
    if (typeof value === 'number' && value > 0) {
      builder.can('access', feature);
    }
  }

  return builder.build();
}

function readLimit(
  features: Record<string, FeatureValue>,
  feature: string
): number | null | undefined {
  if (!(feature in features)) {
    return undefined;
  }
  const value = features[feature];
  if (value === null) return null;
  if (typeof value === 'number') return value;
  return undefined;
}
