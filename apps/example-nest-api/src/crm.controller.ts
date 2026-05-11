import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  UnauthorizedException,
  type INestApplication
} from '@nestjs/common';

import { RequireSubscription, ENTITLEMENTS } from '@idevconn/isubscribe-entitlements/nest';
import type {
  ActiveSubscription,
  Entitlements,
  EntitlementsContext,
  FeatureValue,
  SubscriptionStatus
} from '@idevconn/isubscribe-entitlements';

@Controller()
export class CrmController {
  constructor(@Inject(ENTITLEMENTS) private readonly entitlements: Entitlements) {}

  @Get('/health')
  health(): { ok: true } {
    return { ok: true };
  }

  /** Boolean gate. */
  @Get('/crm/export')
  @RequireSubscription('crm.export')
  exportCrm(): { exported: true } {
    return { exported: true };
  }

  /** Numeric limit gate (counted at the application level). */
  @Get('/projects/max')
  @RequireSubscription('projects.max')
  projectsMax(): { ok: true } {
    return { ok: true };
  }

  /** Metered gate: guard `check`s 1 token; interceptor consumes on success. */
  @Get('/ai/search')
  @RequireSubscription({ feature: 'ai.tokens.monthly', amount: 1 })
  aiSearch(): { ok: true; consumed: 1 } {
    return { ok: true, consumed: 1 };
  }

  /** Demo: persist a subscription (in real life this is invoked from your webhook handler). */
  @Post('/admin/subscriptions')
  async upsert(@Body() sub: ActiveSubscription): Promise<{ ok: true }> {
    await this.entitlements.saveSubscription({
      ...sub,
      startedAt: new Date(sub.startedAt),
      currentPeriodStart: new Date(sub.currentPeriodStart),
      currentPeriodEnd: new Date(sub.currentPeriodEnd)
    });
    return { ok: true };
  }

  /** Diagnostic: what does the engine see for the calling user? */
  @Get('/me')
  async me(
    @Headers('x-user-id') userId: string | undefined,
    @Headers('x-tenant-id') tenantId: string | undefined
  ): Promise<{
    userId: string;
    tenantId?: string;
    plan: { id: string; name: string; source: 'subscription' | 'fallback' };
    status: SubscriptionStatus | null;
    entitlements: Record<string, FeatureValue>;
  }> {
    if (!userId) throw new UnauthorizedException('x-user-id header required');

    const ctx: EntitlementsContext = tenantId ? { userId, tenantId } : { userId };
    const service = this.entitlements.for(ctx);

    const plan = await service.getPlan();
    const subscription = await service.getSubscription().catch(() => null);
    const entitlements = await service.getEntitlements();

    return {
      userId,
      ...(tenantId ? { tenantId } : {}),
      plan: { id: plan.id, name: plan.name, source: plan.source },
      status: subscription?.status ?? null,
      entitlements
    };
  }

  /** Diagnostic: read the current usage / limit / remaining for one metered feature. */
  @Get('/me/usage/:metric')
  async myUsage(
    @Param('metric') metric: string,
    @Headers('x-user-id') userId: string | undefined,
    @Headers('x-tenant-id') tenantId: string | undefined
  ): Promise<{
    feature: string;
    limit: number | null;
    used: number;
    remaining: number | null;
  }> {
    if (!userId) throw new UnauthorizedException('x-user-id header required');

    const ctx: EntitlementsContext = tenantId ? { userId, tenantId } : { userId };
    const service = this.entitlements.for(ctx);

    const limit = await service.limit(metric);
    const used = await service.usage(metric);
    const remaining = limit === null ? null : Math.max(0, limit - used);

    return { feature: metric, limit, used, remaining };
  }
}

export type { INestApplication };
