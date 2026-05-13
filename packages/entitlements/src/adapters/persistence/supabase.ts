import type { ActiveSubscription, EntitlementsContext } from '../../core/types';
import { EntitlementsError, InvalidInputError, LimitExceededError } from '../../core/errors';
import type { SubscriptionPersistenceAdapter } from './interface';

/**
 * Structural type of the Supabase client surface this adapter needs. Declared
 * locally so we don't pull in `@supabase/supabase-js` at build time (it's an
 * optional peer-dep). Pass a `SupabaseClient` instance.
 *
 * ─── Recommended SQL ────────────────────────────────────────────────────────
 * (see ARCHITECTURE.md > Recipes for the complete migration)
 *
 * 1. Schema
 *
 *   create table if not exists entitlements_subscriptions (
 *     id            bigserial primary key,
 *     user_id       text        not null,
 *     tenant_id     text,                   -- nullable: single-tenant apps omit it
 *     plan_id       text        not null,
 *     status        text        not null,
 *     provider      text        not null,
 *     provider_customer_id      text,
 *     provider_subscription_id  text,
 *     started_at             timestamptz not null,
 *     current_period_start   timestamptz not null,
 *     current_period_end     timestamptz not null,
 *     entitlements  jsonb       not null default '{}'
 *   );
 *
 *   -- M3: use NULLS NOT DISTINCT (Postgres ≥ 15) so that two rows with
 *   -- tenant_id = NULL are treated as the same tenant slot, not two distinct
 *   -- nulls that bypass the unique constraint.
 *   create unique index if not exists entitlements_subscriptions_user_tenant
 *     on entitlements_subscriptions (user_id, tenant_id)
 *     nulls not distinct;
 *   -- Postgres < 15 fallback: store '' (empty string) for no-tenant rows and
 *   -- use a plain CREATE UNIQUE INDEX without NULLS NOT DISTINCT.
 *
 *   create table if not exists entitlements_usage (
 *     id           bigserial primary key,
 *     user_id      text        not null,
 *     tenant_id    text,
 *     metric       text        not null,
 *     period_start timestamptz not null,
 *     amount       int         not null default 0
 *   );
 *
 *   create unique index if not exists entitlements_usage_key
 *     on entitlements_usage (user_id, tenant_id, metric, period_start)
 *     nulls not distinct;   -- Postgres ≥ 15; see subscriptions note above for < 15
 *
 * 2. Row-Level Security (M4)
 *
 *   alter table entitlements_subscriptions enable row level security;
 *   alter table entitlements_usage         enable row level security;
 *
 *   -- Service-role key (used server-side) bypasses RLS automatically.
 *   -- Deny all access via the anon/authenticated roles so direct client calls
 *   -- can never read or modify entitlement data.
 *   -- If you need row-level user access, scope by auth.uid():
 *   --
 *   --   create policy "users see own subscription"
 *   --     on entitlements_subscriptions
 *   --     for select using (user_id = auth.uid()::text);
 *   --
 *   -- For fully server-side usage (recommended), simply leave no policies;
 *   -- RLS-enabled + no policies = default-deny for all non-service-role callers.
 *
 * 3. Atomic increment RPC
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
 *   $$ language sql security definer;
 *
 * 4. Capped atomic increment RPC (M2 — prevents TOCTOU race under concurrency)
 *
 *   create or replace function entitlements_increment_usage_capped(
 *     p_user_id text,
 *     p_tenant_id text,
 *     p_metric text,
 *     p_period_start timestamptz,
 *     p_amount int,
 *     p_limit int
 *   ) returns int as $$   -- returns new total
 *   declare
 *     v_new int;
 *   begin
 *     insert into entitlements_usage (user_id, tenant_id, metric, period_start, amount)
 *     values (p_user_id, p_tenant_id, p_metric, p_period_start, p_amount)
 *     on conflict (user_id, tenant_id, metric, period_start)
 *     do update set amount = entitlements_usage.amount + excluded.amount
 *     returning amount into v_new;
 *
 *     if v_new > p_limit then
 *       -- Roll back the increment and signal the caller.
 *       update entitlements_usage
 *          set amount = v_new - p_amount
 *        where user_id = p_user_id
 *          and (tenant_id = p_tenant_id or (tenant_id is null and p_tenant_id is null))
 *          and metric = p_metric
 *          and period_start = p_period_start;
 *       raise exception 'LIMIT_EXCEEDED' using errcode = 'P0001';
 *     end if;
 *
 *     return v_new;
 *   end;
 *   $$ language plpgsql security definer;
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
  /**
   * RPC name for the **capped** atomic increment that prevents TOCTOU races.
   * Defaults to `entitlements_increment_usage_capped`. When this function is
   * deployed in your database, `consume()` uses it instead of the non-atomic
   * getUsage → compare → incrementUsage path.
   */
  incrementRpcCapped?: string;
  /** Defaults to using the active subscription's `currentPeriodStart`. */
  resolvePeriodStart?: (ctx: EntitlementsContext, metric: string) => Promise<Date> | Date;
}

/**
 * Supabase-backed adapter. Atomic increment uses an RPC function (see SQL above).
 *
 * Re-exported as `@idevconn/entitlements/adapters/persistence/supabase`.
 */
/** Validates that a caller-supplied identifier is safe to interpolate into table/RPC names. */
const IDENT = /^[a-z_][a-z0-9_]*$/i;

export class SupabasePersistenceAdapter implements SubscriptionPersistenceAdapter {
  private readonly client: SupabaseClientLike;
  private readonly subsTable: string;
  private readonly usageTable: string;
  private readonly incrementRpc: string;
  private readonly incrementRpcCapped: string;
  private readonly resolvePeriodStart: NonNullable<
    SupabasePersistenceAdapterOptions['resolvePeriodStart']
  >;

  constructor(options: SupabasePersistenceAdapterOptions) {
    // M5: validate caller-supplied identifier strings to prevent injection via
    // option values (e.g. a misconfigured table name like "t; DROP TABLE ...").
    const customIdents = [
      ['subscriptionsTable', options.subscriptionsTable],
      ['usageTable', options.usageTable],
      ['incrementRpc', options.incrementRpc],
      ['incrementRpcCapped', options.incrementRpcCapped]
    ] as const;
    for (const [name, value] of customIdents) {
      if (value !== undefined && !IDENT.test(value)) {
        throw new InvalidInputError(
          `SupabasePersistenceAdapter: invalid identifier for option "${name}": "${value}"`
        );
      }
    }

    this.client = options.client;
    this.subsTable = options.subscriptionsTable ?? 'entitlements_subscriptions';
    this.usageTable = options.usageTable ?? 'entitlements_usage';
    this.incrementRpc = options.incrementRpc ?? 'entitlements_increment_usage';
    this.incrementRpcCapped = options.incrementRpcCapped ?? 'entitlements_increment_usage_capped';
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

  /**
   * Atomically increments usage and enforces the cap inside the database
   * transaction, eliminating the TOCTOU race present in the non-atomic path.
   * Requires the `entitlements_increment_usage_capped` SQL function (see JSDoc
   * at the top of this file for the full SQL template).
   *
   * Throws `LimitExceededError` when the database rolls back the increment
   * because adding `amount` would exceed `limit`.
   */
  async incrementUsageCapped(
    ctx: EntitlementsContext,
    metric: string,
    amount: number,
    limit: number
  ): Promise<void> {
    const periodStart = await this.resolvePeriodStart(ctx, metric);
    const { error } = await this.client.rpc(this.incrementRpcCapped, {
      p_user_id: ctx.userId,
      p_tenant_id: ctx.tenantId ?? null,
      p_metric: metric,
      p_period_start: periodStart.toISOString(),
      p_amount: amount,
      p_limit: limit
    });
    if (!error) return;
    if (error.message === 'LIMIT_EXCEEDED') {
      // The DB rolled back the increment; fetch accurate used count for the error body.
      const used = await this.getUsage(ctx, metric);
      throw new LimitExceededError(metric, limit, used, amount);
    }
    throw new EntitlementsError('INTERNAL_ERROR', 500, error.message);
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
