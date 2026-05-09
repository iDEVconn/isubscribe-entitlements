import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { Entitlements } from '../core/create-entitlements';
import {
  EntitlementDeniedError,
  EntitlementsError,
  LimitExceededError,
  NoActiveSubscriptionError
} from '../core/errors';
import {
  defaultEntitlementsContextResolver,
  type EntitlementsContextResolver
} from './entitlements-context';
import type { RequireSubscriptionMetadata } from './require-subscription.decorator';
import {
  ENTITLEMENTS,
  ENTITLEMENTS_CONTEXT_RESOLVER,
  REQUIRE_SUBSCRIPTION_METADATA
} from './tokens';

/**
 * Global guard that enforces `@RequireSubscription(...)` on Nest routes.
 *
 * Behavior:
 *   - No metadata => allows the request.
 *   - No `EntitlementsContext` => `UnauthorizedException` (401).
 *   - Boolean / `all` / `any` denied => `ForbiddenException` (403).
 *   - Metered `amount` would exceed quota => `ForbiddenException` (403, code `LIMIT_EXCEEDED`).
 *   - No active subscription record => `PaymentRequiredException` (402).
 */
@Injectable()
export class EntitlementsGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ENTITLEMENTS) private readonly handle: Entitlements,
    @Inject(ENTITLEMENTS_CONTEXT_RESOLVER)
    private readonly resolveContext: EntitlementsContextResolver = defaultEntitlementsContextResolver
  ) {}

  async canActivate(execContext: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<RequireSubscriptionMetadata | undefined>(
      REQUIRE_SUBSCRIPTION_METADATA,
      [execContext.getHandler(), execContext.getClass()]
    );
    if (!meta) return true;

    const ctx = await this.resolveContext(execContext);
    if (!ctx) {
      throw new UnauthorizedException(
        'Unable to resolve entitlements context for the current request'
      );
    }

    const service = this.handle.for(ctx);

    try {
      const required = collectFeatures(meta);
      if (required.length === 0) return true;

      if (meta.any && meta.any.length > 0) {
        const results = await Promise.all(meta.any.map((f) => service.has(f)));
        if (!results.some(Boolean)) {
          throw new EntitlementDeniedError(meta.any.join('|'));
        }
      }

      const allFeatures = meta.all ?? (meta.feature ? [meta.feature] : []);
      for (const feature of allFeatures) {
        if (typeof meta.amount === 'number') {
          const ok = await service.check(feature, meta.amount);
          if (!ok) {
            const limit = (await service.limit(feature)) ?? 0;
            const used = await service.usage(feature);
            throw new LimitExceededError(feature, limit, used, meta.amount);
          }
        } else {
          await service.require(feature);
        }
      }

      return true;
    } catch (err) {
      throw mapError(err);
    }
  }
}

function collectFeatures(meta: RequireSubscriptionMetadata): string[] {
  const buf = new Set<string>();
  if (meta.feature) buf.add(meta.feature);
  meta.all?.forEach((f) => buf.add(f));
  meta.any?.forEach((f) => buf.add(f));
  return Array.from(buf);
}

function mapError(err: unknown): unknown {
  if (err instanceof NoActiveSubscriptionError) {
    // Nest does not ship a `PaymentRequiredException`; emit a typed HttpException
    // with the standard 402 status so consumers can match on status code or body.
    return new HttpException(err.toResponseBody(), HttpStatus.PAYMENT_REQUIRED);
  }
  if (err instanceof LimitExceededError || err instanceof EntitlementDeniedError) {
    return new ForbiddenException(err.toResponseBody());
  }
  if (err instanceof EntitlementsError) {
    return new ForbiddenException(err.toResponseBody());
  }
  return err;
}
