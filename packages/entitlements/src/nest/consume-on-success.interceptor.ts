import { Inject, Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import type { Observable } from 'rxjs';

import type { Entitlements } from '../core/create-entitlements';
import type { EntitlementsContext } from '../core/types';
import {
  defaultEntitlementsContextResolver,
  type EntitlementsContextResolver
} from './entitlements-context';
import type { RequireSubscriptionMetadata } from './require-subscription.decorator';
import {
  ENTITLEMENTS,
  ENTITLEMENTS_CONTEXT_RESOLVER,
  ENTITLEMENTS_RESOLVED_CTX_KEY,
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
 *
 * @remarks
 * `consume()` is awaited **before** the response is flushed. A storage failure
 * propagates as a 5xx rather than being silently swallowed, so quota is never
 * decremented without confirmation. For absolute correctness under crash
 * (no double-spend), run `consume()` and the domain write in the same database
 * transaction inside the route handler instead of relying on this interceptor.
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

    if (!meta || typeof meta.amount !== 'number' || meta.amount <= 0) return next.handle();

    const features = meta.all ?? (meta.feature ? [meta.feature] : []);
    if (features.length === 0) return next.handle();

    const amount = meta.amount as number;
    return next
      .handle()
      .pipe(switchMap((value) => from(this.consumeAndPass(execContext, features, amount, value))));
  }

  /**
   * Awaits all `consume()` calls before resolving with the response value.
   * Errors propagate — Nest maps them to the appropriate HTTP status (5xx for
   * storage failures, 403 for a race-condition quota breach).
   */
  private async consumeAndPass(
    execContext: ExecutionContext,
    features: string[],
    amount: number,
    responseValue: unknown
  ): Promise<unknown> {
    // Reuse the identity resolved by EntitlementsGuard (stored on the request
    // by the guard). Fall back to resolveContext() only when the guard didn't
    // run (e.g. the interceptor is registered but the guard is not).
    const req = execContext.switchToHttp().getRequest<Record<string | symbol, unknown>>();
    const ctx =
      (req[ENTITLEMENTS_RESOLVED_CTX_KEY] as EntitlementsContext | undefined) ??
      (await this.resolveContext(execContext));

    if (!ctx) return responseValue;

    const service = this.handle.for(ctx);
    for (const feature of features) {
      await service.consume(feature, amount);
    }
    return responseValue;
  }
}
