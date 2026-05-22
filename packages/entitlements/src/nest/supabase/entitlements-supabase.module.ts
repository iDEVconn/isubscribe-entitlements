import { Module } from '@nestjs/common';
import type { DynamicModule, Type } from '@nestjs/common';
import { createSupabaseAdapter } from '../../adapters/persistence/supabase';
import type { SupabaseClientLike } from '../../adapters/persistence/supabase';
import { EntitlementsModule } from '../entitlements.module';
import type {
  NestEntitlementsContextResolver,
  EntitlementsContextResolver
} from '../entitlements-context';
import type { EntitlementsConfig } from '../../core/create-entitlements';
import type { PlanDefinition } from '../../core/types';

export interface EntitlementsSupabaseAsyncOptions {
  imports?: (Type<unknown> | DynamicModule)[];
  inject?: unknown[];
  useFactory: (...args: unknown[]) =>
    | {
        client: SupabaseClientLike;
        fallbackPlan: PlanDefinition;
        planResolver: (id: string) => Promise<PlanDefinition | null>;
        subscriptionsTable?: string;
        usageTable?: string;
      }
    | Promise<{
        client: SupabaseClientLike;
        fallbackPlan: PlanDefinition;
        planResolver: (id: string) => Promise<PlanDefinition | null>;
        subscriptionsTable?: string;
        usageTable?: string;
      }>;
  contextResolver?: EntitlementsContextResolver | Type<NestEntitlementsContextResolver> | undefined;
  global?: boolean;
  isGlobal?: boolean;
  logger?: EntitlementsConfig['logger'];
  defaultPolicy?: 'allow' | 'deny';
  exposeErrorDetails?: boolean;
}

@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module pattern: class is the DI marker
export class EntitlementsSupabaseModule {
  static registerAsync(options: EntitlementsSupabaseAsyncOptions): DynamicModule {
    const internalImports = options.imports ?? [];
    const internalInject = options.inject ?? [];

    return {
      module: EntitlementsSupabaseModule,
      imports: [
        EntitlementsModule.forRootAsync({
          imports: internalImports,
          inject: internalInject,
          useFactory: async (...args: unknown[]): Promise<EntitlementsConfig> => {
            const config = await options.useFactory(...args);

            // Bridge Logger to NestJS standard logger if no custom logger is provided
            const nestLogger = options.logger ?? {
              debug: (_msg: string) => {
                /* Keep debug silent */
              },
              info: (msg: string) => console.log(`[Entitlements] ${msg}`),
              warn: (msg: string) => console.warn(`[Entitlements] ${msg}`),
              error: (msg: string) => console.error(`[Entitlements] ${msg}`)
            };

            return {
              persistence: createSupabaseAdapter({
                client: config.client,
                subscriptionsTable: config.subscriptionsTable ?? 'user_subscriptions',
                usageTable: config.usageTable ?? 'entitlements_usage'
              }),
              planResolver: config.planResolver,
              fallbackPlan: config.fallbackPlan,
              cacheTtlMs: 0, // Real-time active consistency by default
              logger: nestLogger
            };
          },
          contextResolver: options.contextResolver,
          global: options.global ?? false,
          isGlobal: options.isGlobal ?? false,
          defaultPolicy: options.defaultPolicy ?? 'allow',
          exposeErrorDetails: options.exposeErrorDetails ?? true
        })
      ],
      exports: [EntitlementsModule]
    };
  }
}
