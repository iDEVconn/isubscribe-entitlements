import type { ActiveSubscription, EntitlementsContext } from '../../core/types';
import type { SubscriptionPersistenceAdapter } from './interface';

/**
 * Structural types for the subset of TypeORM we touch. Declared locally so we
 * do not depend on `typeorm` at build time (it's an optional peer-dep).
 *
 * Pass in a `DataSource` and the entity classes/names below. Either:
 *   1. Use the bundled entity definitions in your `DataSource` config, or
 *   2. Provide your own entities and pass their class to `subscriptionEntity` /
 *      `usageEntity`.
 */
export interface TypeOrmRepositoryLike<T> {
  findOne(options: { where: Record<string, unknown> }): Promise<T | null>;
  save(entity: Partial<T>): Promise<T>;
  upsert?(entity: Partial<T>, conflictPaths: string[]): Promise<unknown>;
  increment(
    where: Record<string, unknown>,
    column: string,
    amount: number | string
  ): Promise<{ affected?: number | null }>;
  update(
    where: Record<string, unknown>,
    partial: Partial<T>
  ): Promise<{ affected?: number | null }>;
  insert(entity: Partial<T>): Promise<unknown>;
}

export interface TypeOrmDataSourceLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getRepository<T = any>(target: unknown): TypeOrmRepositoryLike<T>;
}

export interface TypeOrmPersistenceAdapterOptions {
  dataSource: TypeOrmDataSourceLike;
  /** Entity class or name representing the subscription row. */
  subscriptionEntity: unknown;
  /** Entity class or name representing the per-period usage row. */
  usageEntity: unknown;
  resolvePeriodStart?: (ctx: EntitlementsContext, metric: string) => Promise<Date> | Date;
}

interface SubscriptionEntity {
  userId: string;
  tenantId: string | null;
  planId: string;
  status: ActiveSubscription['status'];
  provider: string;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  startedAt: Date;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  entitlements: Record<string, unknown>;
}

interface UsageEntity {
  userId: string;
  tenantId: string | null;
  metric: string;
  periodStart: Date;
  amount: number;
}

/**
 * TypeORM-backed adapter. Atomic increments use `Repository.increment()`, which
 * issues a single `UPDATE ... SET amount = amount + ?` statement.
 *
 * Re-exported as `@isubscribe/entitlements/adapters/persistence/typeorm`.
 */
export class TypeOrmPersistenceAdapter implements SubscriptionPersistenceAdapter {
  private readonly subs: TypeOrmRepositoryLike<SubscriptionEntity>;
  private readonly usage: TypeOrmRepositoryLike<UsageEntity>;
  private readonly resolvePeriodStart: NonNullable<
    TypeOrmPersistenceAdapterOptions['resolvePeriodStart']
  >;

  constructor(options: TypeOrmPersistenceAdapterOptions) {
    this.subs = options.dataSource.getRepository<SubscriptionEntity>(options.subscriptionEntity);
    this.usage = options.dataSource.getRepository<UsageEntity>(options.usageEntity);
    this.resolvePeriodStart =
      options.resolvePeriodStart ??
      (async (ctx) => {
        const sub = await this.getActiveSubscription(ctx);
        return sub?.currentPeriodStart ?? new Date(0);
      });
  }

  async getActiveSubscription(ctx: EntitlementsContext): Promise<ActiveSubscription | null> {
    const row = await this.subs.findOne({
      where: { userId: ctx.userId, tenantId: ctx.tenantId ?? null }
    });
    return row ? entityToSubscription(row) : null;
  }

  async saveSubscription(sub: ActiveSubscription): Promise<void> {
    if (this.subs.upsert) {
      await this.subs.upsert(subscriptionToEntity(sub), ['userId', 'tenantId']);
      return;
    }
    await this.subs.save(subscriptionToEntity(sub));
  }

  async getUsage(ctx: EntitlementsContext, metric: string): Promise<number> {
    const periodStart = await this.resolvePeriodStart(ctx, metric);
    const row = await this.usage.findOne({
      where: { userId: ctx.userId, tenantId: ctx.tenantId ?? null, metric, periodStart }
    });
    return row?.amount ?? 0;
  }

  async incrementUsage(ctx: EntitlementsContext, metric: string, amount: number): Promise<void> {
    const periodStart = await this.resolvePeriodStart(ctx, metric);
    const where = { userId: ctx.userId, tenantId: ctx.tenantId ?? null, metric, periodStart };
    const result = await this.usage.increment(where, 'amount', amount);
    if (!result.affected) {
      await this.usage.insert({ ...where, amount });
    }
  }

  async resetUsage(ctx: EntitlementsContext, metric: string): Promise<void> {
    const periodStart = await this.resolvePeriodStart(ctx, metric);
    await this.usage.update(
      { userId: ctx.userId, tenantId: ctx.tenantId ?? null, metric, periodStart },
      { amount: 0 }
    );
  }
}

export function createTypeOrmAdapter(
  options: TypeOrmPersistenceAdapterOptions
): TypeOrmPersistenceAdapter {
  return new TypeOrmPersistenceAdapter(options);
}

function entityToSubscription(e: SubscriptionEntity): ActiveSubscription {
  return {
    userId: e.userId,
    ...(e.tenantId ? { tenantId: e.tenantId } : {}),
    planId: e.planId,
    status: e.status,
    provider: e.provider,
    ...(e.providerCustomerId ? { providerCustomerId: e.providerCustomerId } : {}),
    ...(e.providerSubscriptionId ? { providerSubscriptionId: e.providerSubscriptionId } : {}),
    startedAt: e.startedAt,
    currentPeriodStart: e.currentPeriodStart,
    currentPeriodEnd: e.currentPeriodEnd,
    entitlements: e.entitlements as ActiveSubscription['entitlements']
  };
}

function subscriptionToEntity(s: ActiveSubscription): SubscriptionEntity {
  return {
    userId: s.userId,
    tenantId: s.tenantId ?? null,
    planId: s.planId,
    status: s.status,
    provider: s.provider,
    providerCustomerId: s.providerCustomerId ?? null,
    providerSubscriptionId: s.providerSubscriptionId ?? null,
    startedAt: s.startedAt,
    currentPeriodStart: s.currentPeriodStart,
    currentPeriodEnd: s.currentPeriodEnd,
    entitlements: s.entitlements
  };
}
