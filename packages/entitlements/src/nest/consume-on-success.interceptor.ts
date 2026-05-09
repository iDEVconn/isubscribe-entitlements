import { Inject, Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { tap } from 'rxjs/operators';
import type { Observable } from 'rxjs';

import type { Entitlements } from '../core/create-entitlements';
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
 * Optional interceptor that calls `service.consume(feature, amount)` after a
 * successful response when the route has `@RequireSubscription({ feature, amount })`
 * metadata. Failed handlers do NOT burn quota.
 *
 * Register globally:
 *
 *   `app.useGlobalInterceptors(new ConsumeOnSuccessInterceptor(reflector, handle));`
 *
 * or via providers (`APP_INTERCEPTOR`).
 */
@Injectable()
export class ConsumeOnSuccessInterceptor implements NestInterceptor {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ENTITLEMENTS) private readonly handle: Entitlements,
    @Inject(ENTITLEMENTS_CONTEXT_RESOLVER)
    private readonly resolveContext: EntitlementsContextResolver = defaultEntitlementsContextResolver
  ) {}

  intercept(execContext: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<RequireSubscriptionMetadata | undefined>(
      REQUIRE_SUBSCRIPTION_METADATA,
      [execContext.getHandler(), execContext.getClass()]
    );

    return next.handle().pipe(
      tap({
        next: () => {
          if (!meta || typeof meta.amount !== 'number' || meta.amount <= 0) return;
          const features = meta.all ?? (meta.feature ? [meta.feature] : []);
          if (features.length === 0) return;

          void Promise.resolve(this.resolveContext(execContext)).then(async (ctx) => {
            if (!ctx) return;
            const service = this.handle.for(ctx);
            for (const feature of features) {
              try {
                await service.consume(feature, meta.amount);
              } catch {
                // Swallow — the response has already been sent. Real consumers
                // should attach a logger via `EntitlementsConfig.logger` to
                // observe these (rare) post-write failures.
              }
            }
          });
        }
      })
    );
  }
}
