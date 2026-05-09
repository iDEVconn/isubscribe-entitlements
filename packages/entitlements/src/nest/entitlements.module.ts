import { Module } from '@nestjs/common';
import type { DynamicModule, Provider, Type } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import {
  createEntitlements,
  type Entitlements,
  type EntitlementsConfig
} from '../core/create-entitlements';
import { EntitlementsGuard } from './entitlements.guard';
import {
  defaultEntitlementsContextResolver,
  type EntitlementsContextResolver
} from './entitlements-context';
import { ENTITLEMENTS, ENTITLEMENTS_CONTEXT_RESOLVER } from './tokens';

export interface EntitlementsModuleOptions {
  /** Synchronous config — wins over `useFactory` if both are provided. */
  config?: EntitlementsConfig;
  /** Async config builder. Receives any deps listed in `inject`. */
  useFactory?: (...deps: unknown[]) => EntitlementsConfig | Promise<EntitlementsConfig>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inject?: any[];
  imports?: (Type<unknown> | DynamicModule)[];
  /** Override the default context resolver (recommended for any real auth setup). */
  contextResolver?: EntitlementsContextResolver;
  /**
   * Register `EntitlementsGuard` as a global guard. Default `true` so that
   * `@RequireSubscription(...)` works out of the box.
   */
  global?: boolean;
  /**
   * Mark the module as `@Global()` so non-importing modules can inject the
   * `Entitlements` handle. Default `false`.
   */
  isGlobal?: boolean;
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

    const contextResolverProvider: Provider = {
      provide: ENTITLEMENTS_CONTEXT_RESOLVER,
      useValue: options.contextResolver ?? defaultEntitlementsContextResolver
    };

    const providers: Provider[] = [handleProvider, contextResolverProvider, EntitlementsGuard];
    if (options.global !== false) {
      providers.push({ provide: APP_GUARD, useClass: EntitlementsGuard });
    }

    return {
      module: EntitlementsModule,
      imports: options.imports ?? [],
      providers,
      exports: [ENTITLEMENTS, ENTITLEMENTS_CONTEXT_RESOLVER, EntitlementsGuard],
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
