import { Module } from '@nestjs/common';
import type { DynamicModule, Provider, Type, ExecutionContext } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import {
  createEntitlements,
  type Entitlements,
  type EntitlementsConfig
} from '../core/create-entitlements';
import { EntitlementsGuard } from './entitlements.guard';
import {
  defaultEntitlementsContextResolver,
  type EntitlementsContextResolver,
  type NestEntitlementsContextResolver
} from './entitlements-context';
import {
  ENTITLEMENTS,
  ENTITLEMENTS_CONTEXT_RESOLVER,
  ENTITLEMENTS_DEFAULT_POLICY,
  ENTITLEMENTS_EXPOSE_ERROR_DETAILS
} from './tokens';

export interface EntitlementsModuleOptions {
  /** Synchronous config — wins over `useFactory` if both are provided. */
  config?: EntitlementsConfig;
  /** Async config builder. Receives any deps listed in `inject`. */
  useFactory?: (...deps: unknown[]) => EntitlementsConfig | Promise<EntitlementsConfig>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inject?: any[];
  imports?: (Type<unknown> | DynamicModule)[];
  /**
   * Override context resolution. Defaults to `defaultEntitlementsContextResolver`,
   * which uses only `req.user` / `req.entitlementsContext` (never spoofable headers).
   * For header-driven demos/tests, pass `unsafeHeaderBasedEntitlementsContextResolver`
   * explicitly — never in production.
   */
  contextResolver?: EntitlementsContextResolver | Type<NestEntitlementsContextResolver> | undefined;
  /**
   * Register `EntitlementsGuard` as a global guard. Default `true` so that
   * `@RequireSubscription(...)` works out of the box.
   */
  global?: boolean;
  /**
   * Controls how the guard treats routes that carry no `@RequireSubscription`
   * decorator.
   *
   * - `'allow'` *(default)* — undecorated routes pass through. Safe when every
   *   paid handler is explicitly decorated, but offers no protection against
   *   accidentally omitted decorators.
   * - `'deny'` — undecorated routes are rejected with **403** unless the route
   *   or its controller is marked `@PublicEntitlement()`. Recommended for
   *   production applications where a missing decorator should be a loud
   *   failure rather than a silent bypass.
   *
   * @default 'allow'
   */
  defaultPolicy?: 'deny' | 'allow';
  /**
   * Mark the module as `@Global()` so non-importing modules can inject the
   * `Entitlements` handle. Default `false`.
   */
  isGlobal?: boolean;
  /**
   * When `false`, HTTP error responses produced by the guard omit the
   * `details` field from `EntitlementsError.toResponseBody()`. This prevents
   * internal identifiers (userId, planId, remaining quota, etc.) from leaking
   * into API responses in production.
   *
   * @default true  (backward-compatible; set to `false` for new deployments)
   */
  exposeErrorDetails?: boolean;
}

/**
 * Root NestJS module. Mount once at the application level.
 *
 *   ```ts
 *   EntitlementsModule.forRoot({
 *     config: {
 *       persistence: createMemoryAdapter(),
 *       planResolver: (id) => Promise.resolve(plansById[id])
 *     }
 *   })
 *   ```
 */
@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module pattern: class is the DI marker
export class EntitlementsModule {
  static forRoot(options: EntitlementsModuleOptions): DynamicModule {
    const handleProvider: Provider = {
      provide: ENTITLEMENTS,
      useFactory: async (...deps: unknown[]): Promise<Entitlements> => {
        if (options.config) return createEntitlements(options.config);
        if (options.useFactory) return createEntitlements(await options.useFactory(...deps));
        throw new Error('EntitlementsModule.forRoot requires either `config` or `useFactory`');
      },
      ...(options.useFactory && options.inject ? { inject: options.inject } : {})
    };

    const isResolverClass =
      typeof options.contextResolver === 'function' &&
      /^\s*class\s+/.test(options.contextResolver.toString());

    const contextResolverProvider: Provider = isResolverClass
      ? {
          provide: ENTITLEMENTS_CONTEXT_RESOLVER,
          inject: [options.contextResolver as Type<NestEntitlementsContextResolver>],
          useFactory: (resolverInstance: NestEntitlementsContextResolver) => {
            return (ctx: ExecutionContext) => resolverInstance.resolve(ctx);
          }
        }
      : {
          provide: ENTITLEMENTS_CONTEXT_RESOLVER,
          useValue: options.contextResolver ?? defaultEntitlementsContextResolver
        };

    const defaultPolicyProvider: Provider = {
      provide: ENTITLEMENTS_DEFAULT_POLICY,
      useValue: options.defaultPolicy ?? 'allow'
    };

    const exposeErrorDetailsProvider: Provider = {
      provide: ENTITLEMENTS_EXPOSE_ERROR_DETAILS,
      useValue: options.exposeErrorDetails ?? true
    };

    const providers: Provider[] = [
      handleProvider,
      contextResolverProvider,
      defaultPolicyProvider,
      exposeErrorDetailsProvider,
      EntitlementsGuard
    ];
    if (isResolverClass && options.contextResolver) {
      providers.push(options.contextResolver as Type<NestEntitlementsContextResolver>);
    }
    if (options.global !== false) {
      providers.push({ provide: APP_GUARD, useClass: EntitlementsGuard });
    }

    return {
      module: EntitlementsModule,
      imports: options.imports ?? [],
      providers,
      exports: [
        ENTITLEMENTS,
        ENTITLEMENTS_CONTEXT_RESOLVER,
        ENTITLEMENTS_DEFAULT_POLICY,
        ENTITLEMENTS_EXPOSE_ERROR_DETAILS,
        EntitlementsGuard
      ],
      global: options.isGlobal ?? false
    };
  }

  static forRootAsync(
    options: Omit<EntitlementsModuleOptions, 'config'> & {
      useFactory: (...deps: unknown[]) => EntitlementsConfig | Promise<EntitlementsConfig>;
    }
  ): DynamicModule {
    return EntitlementsModule.forRoot(options);
  }
}
