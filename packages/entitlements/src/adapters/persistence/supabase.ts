import type { ActiveSubscription, EntitlementsContext } from '../../core/types';
import { EntitlementsError } from '../../core/errors';
import type { SubscriptionPersistenceAdapter } from './interface';

/**
 * Structural type of the Supabase client surface this adapter needs. Declared
 * locally so we don't pull in `@supabase/supabase-js` at build time (it's an
 * optional peer-dep). Pass a `SupabaseClient` instance.
 *
 * Recommended SQL (see ARCHITECTURE.md > Recipes for the full migration).
 *
 * The adapter relies on a Postgres function `entitlements_increment_usage`
 * for atomic upsert + increment:
 *
 *   create or replace function entitlements_increment_usage(
 *     p_user_id text,
 *     p_tenant_id text,
 *     p_metric text,
 *     p_period_start timestamptz,
 *     p_amount int
 *   ) returns void as $$
 *     insert into entitlements_usage (user_id, tenant_id, metric, period_start, amount)
 *     values (p_user_id, p_tenant_id, p_metric, p_period_start, p_amount)
 *     on conflict (user_id, tenant_id, metric, period_start)
 *     do update set amount = entitlements_usage.amount + excluded.amount;
 *   $$ language sql;
 */
interface SupabaseFilterBuilder {
  eq(column: string, value: unknown): SupabaseFilterBuilder;
  is(column: string, value: unknown): SupabaseFilterBuilder;
  maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }>;
}

interface SupabaseQueryBuilder {
  select(columns?: string): SupabaseFilterBuilder;
  upsert(
    values: unknown,
    options?: { onConflict?: string }
  ): {
    select(columns?: string): {
      single(): Promise<{ data: unknown; error: { message: string } | null }>;
    };
  };
  update(values: unknown): {
    eq(
      column: string,
      value: unknown
    ): {
      is(
        column: string,
        value: unknown
      ): {
        eq(
          column: string,
          value: unknown
        ): { eq(column: string, value: unknown): Promise<{ error: { message: string } | null }> };
      };
    };
  };
}

export interface SupabaseClientLike {
  from(table: string): SupabaseQueryBuilder;
  rpc(
    fn: string,
    args: Record<string, unknown>
  ): Promise<{ data: unknown; error: { message: string } | null }>;
}

export interface SupabasePersistenceAdapterOptions {
  client: SupabaseClientLike;
  subscriptionsTable?: string;
  usageTable?: string;
  /** RPC name for atomic upsert+increment. Defaults to `entitlements_increment_usage`. */
  incrementRpc?: string;
  /** Defaults to using the active subscription's `currentPeriodStart`. */
  resolvePeriodStart?: (ctx: EntitlementsContext, metric: string) => Promise<Date> | Date;
}

/**
 * Supabase-backed adapter. Atomic increment uses an RPC function (see SQL above).
 *
 * Re-exported as `@isubscribe/entitlements/adapters/persistence/supabase`.
 */
export class SupabasePersistenceAdapter implements SubscriptionPersistenceAdapter {
  private readonly client: SupabaseClientLike;
  private readonly subsTable: string;
  private readonly usageTable: string;
  private readonly incrementRpc: string;
  private readonly resolvePeriodStart: NonNullable<
    SupabasePersistenceAdapterOptions['resolvePeriodStart']
  >;

  constructor(options: SupabasePersistenceAdapterOptions) {
    this.client = options.client;
    this.subsTable = options.subscriptionsTable ?? 'entitlements_subscriptions';
    this.usageTable = options.usageTable ?? 'entitlements_usage';
    this.incrementRpc = options.incrementRpc ?? 'entitlements_increment_usage';
    this.resolvePeriodStart =
      options.resolvePeriodStart ??
      (async (ctx) => {
        const sub = await this.getActiveSubscription(ctx);
        return sub?.currentPeriodStart ?? new Date(0);
      });
  }

  async getActiveSubscription(ctx: EntitlementsContext): Promise<ActiveSubscription | null> {
    const query = this.client.from(this.subsTable).select('*').eq('user_id', ctx.userId);
    const filtered = ctx.tenantId
      ? query.eq('tenant_id', ctx.tenantId)
      : query.is('tenant_id', null);
    const { data, error } = await filtered.maybeSingle();
    if (error) throw new EntitlementsError('INTERNAL_ERROR', 500, error.message);
    return data ? rowToSubscription(data) : null;
  }

  async saveSubscription(sub: ActiveSubscription): Promise<void> {
    const { error } = await this.client
      .from(this.subsTable)
      .upsert(subscriptionToRow(sub), { onConflict: 'user_id,tenant_id' })
      .select('id')
      .single();
    if (error) throw new EntitlementsError('INTERNAL_ERROR', 500, error.message);
  }

  async getUsage(ctx: EntitlementsContext, metric: string): Promise<number> {
    const periodStart = await this.resolvePeriodStart(ctx, metric);
    const base = this.client
      .from(this.usageTable)
      .select('amount')
      .eq('user_id', ctx.userId)
      .eq('metric', metric)
      .eq('period_start', periodStart.toISOString());
    const filtered = ctx.tenantId ? base.eq('tenant_id', ctx.tenantId) : base.is('tenant_id', null);
    const { data, error } = await filtered.maybeSingle();
    if (error) throw new EntitlementsError('INTERNAL_ERROR', 500, error.message);
    return (data as { amount: number } | null)?.amount ?? 0;
  }

  async incrementUsage(ctx: EntitlementsContext, metric: string, amount: number): Promise<void> {
    const periodStart = await this.resolvePeriodStart(ctx, metric);
    const { error } = await this.client.rpc(this.incrementRpc, {
      p_user_id: ctx.userId,
      p_tenant_id: ctx.tenantId ?? null,
      p_metric: metric,
      p_period_start: periodStart.toISOString(),
      p_amount: amount
    });
    if (error) throw new EntitlementsError('INTERNAL_ERROR', 500, error.message);
  }
}

export function createSupabaseAdapter(
  options: SupabasePersistenceAdapterOptions
): SupabasePersistenceAdapter {
  return new SupabasePersistenceAdapter(options);
}

interface SubscriptionRow {
  user_id: string;
  tenant_id: string | null;
  plan_id: string;
  status: ActiveSubscription['status'];
  provider: string;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  started_at: string | Date;
  current_period_start: string | Date;
  current_period_end: string | Date;
  entitlements: Record<string, unknown>;
}

function rowToSubscription(row: unknown): ActiveSubscription {
  const r = row as SubscriptionRow;
  return {
    userId: r.user_id,
    ...(r.tenant_id ? { tenantId: r.tenant_id } : {}),
    planId: r.plan_id,
    status: r.status,
    provider: r.provider,
    ...(r.provider_customer_id ? { providerCustomerId: r.provider_customer_id } : {}),
    ...(r.provider_subscription_id ? { providerSubscriptionId: r.provider_subscription_id } : {}),
    startedAt: new Date(r.started_at),
    currentPeriodStart: new Date(r.current_period_start),
    currentPeriodEnd: new Date(r.current_period_end),
    entitlements: r.entitlements as ActiveSubscription['entitlements']
  };
}

function subscriptionToRow(sub: ActiveSubscription): SubscriptionRow {
  return {
    user_id: sub.userId,
    tenant_id: sub.tenantId ?? null,
    plan_id: sub.planId,
    status: sub.status,
    provider: sub.provider,
    provider_customer_id: sub.providerCustomerId ?? null,
    provider_subscription_id: sub.providerSubscriptionId ?? null,
    started_at: sub.startedAt.toISOString(),
    current_period_start: sub.currentPeriodStart.toISOString(),
    current_period_end: sub.currentPeriodEnd.toISOString(),
    entitlements: sub.entitlements
  };
}
