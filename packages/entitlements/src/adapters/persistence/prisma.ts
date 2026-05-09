import type { ActiveSubscription, EntitlementsContext } from '../../core/types';
import type { SubscriptionPersistenceAdapter } from './interface';

/**
 * Minimal structural type of the Prisma client surface this adapter needs.
 * Declared locally so we don't depend on `@prisma/client` types at build time
 * (it is an optional peer-dep). Consumers pass in their generated `PrismaClient`.
 *
 * Recommended schema (see ARCHITECTURE.md > Recipes):
 *
 *   model EntitlementsSubscription {
 *     id                       String   @id @default(cuid())
 *     userId                   String
 *     tenantId                 String?
 *     planId                   String
 *     status                   String
 *     provider                 String
 *     providerCustomerId       String?
 *     providerSubscriptionId   String?
 *     startedAt                DateTime
 *     currentPeriodStart       DateTime
 *     currentPeriodEnd         DateTime
 *     entitlements             Json
 *     @@unique([userId, tenantId])
 *   }
 *
 *   model EntitlementsUsage {
 *     id           String   @id @default(cuid())
 *     userId       String
 *     tenantId     String?
 *     metric       String
 *     periodStart  DateTime
 *     amount       Int      @default(0)
 *     @@unique([userId, tenantId, metric, periodStart])
 *   }
 */
export interface PrismaSubscriptionDelegate {
  findFirst(args: { where: Record<string, unknown> }): Promise<unknown>;
  upsert(args: {
    where: Record<string, unknown>;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<unknown>;
}

export interface PrismaUsageDelegate {
  findFirst(args: { where: Record<string, unknown> }): Promise<unknown>;
  upsert(args: {
    where: Record<string, unknown>;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<unknown>;
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
}

export interface PrismaClientLike {
  entitlementsSubscription: PrismaSubscriptionDelegate;
  entitlementsUsage: PrismaUsageDelegate;
}

export interface PrismaPersistenceAdapterOptions {
  client: PrismaClientLike;
  /**
   * Resolves the period boundary used to scope usage counters. By default we
   * use the subscription's `currentPeriodStart`; consumers can override to use
   * calendar months / weeks if they bill differently.
   */
  resolvePeriodStart?: (ctx: EntitlementsContext, metric: string) => Promise<Date> | Date;
}

interface UsageRow {
  amount: number;
}
type SubscriptionRow = ActiveSubscription;

/**
 * Prisma-backed adapter. Atomic increments use `update { increment }`; the
 * row is created on first call via `upsert`.
 *
 * Re-exported as `@isubscribe/entitlements/adapters/persistence/prisma`.
 */
export class PrismaPersistenceAdapter implements SubscriptionPersistenceAdapter {
  private readonly client: PrismaClientLike;
  private readonly resolvePeriodStart: NonNullable<
    PrismaPersistenceAdapterOptions['resolvePeriodStart']
  >;

  constructor(options: PrismaPersistenceAdapterOptions) {
    this.client = options.client;
    this.resolvePeriodStart =
      options.resolvePeriodStart ??
      (async (ctx) => {
        const sub = await this.getActiveSubscription(ctx);
        return sub?.currentPeriodStart ?? new Date(0);
      });
  }

  async getActiveSubscription(ctx: EntitlementsContext): Promise<ActiveSubscription | null> {
    const row = (await this.client.entitlementsSubscription.findFirst({
      where: { userId: ctx.userId, tenantId: ctx.tenantId ?? null }
    })) as SubscriptionRow | null;
    return row ?? null;
  }

  async saveSubscription(sub: ActiveSubscription): Promise<void> {
    await this.client.entitlementsSubscription.upsert({
      where: { userId_tenantId: { userId: sub.userId, tenantId: sub.tenantId ?? null } },
      create: { ...sub, tenantId: sub.tenantId ?? null },
      update: { ...sub, tenantId: sub.tenantId ?? null }
    });
  }

  async getUsage(ctx: EntitlementsContext, metric: string): Promise<number> {
    const periodStart = await this.resolvePeriodStart(ctx, metric);
    const row = (await this.client.entitlementsUsage.findFirst({
      where: { userId: ctx.userId, tenantId: ctx.tenantId ?? null, metric, periodStart }
    })) as UsageRow | null;
    return row?.amount ?? 0;
  }

  async incrementUsage(ctx: EntitlementsContext, metric: string, amount: number): Promise<void> {
    const periodStart = await this.resolvePeriodStart(ctx, metric);
    await this.client.entitlementsUsage.upsert({
      where: {
        userId_tenantId_metric_periodStart: {
          userId: ctx.userId,
          tenantId: ctx.tenantId ?? null,
          metric,
          periodStart
        }
      },
      create: {
        userId: ctx.userId,
        tenantId: ctx.tenantId ?? null,
        metric,
        periodStart,
        amount
      },
      update: { amount: { increment: amount } }
    });
  }

  async resetUsage(ctx: EntitlementsContext, metric: string): Promise<void> {
    const periodStart = await this.resolvePeriodStart(ctx, metric);
    await this.client.entitlementsUsage.updateMany({
      where: { userId: ctx.userId, tenantId: ctx.tenantId ?? null, metric, periodStart },
      data: { amount: 0 }
    });
  }
}

export function createPrismaAdapter(
  options: PrismaPersistenceAdapterOptions
): PrismaPersistenceAdapter {
  return new PrismaPersistenceAdapter(options);
}
