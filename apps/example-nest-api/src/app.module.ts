import { Module } from '@nestjs/common';

import {
  EntitlementsModule,
  unsafeHeaderBasedEntitlementsContextResolver
} from '@idevconn/isubscribe-entitlements/nest';
import { createMemoryAdapter } from '@idevconn/isubscribe-entitlements/adapters/persistence/memory';

import { CrmController } from './crm.controller';
import { PLANS, planResolver } from './plans';

const persistence = createMemoryAdapter();

// Seed demo subscriptions so curl-ing works out of the box.
const periodStart = new Date();
const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

void persistence.saveSubscription({
  userId: 'demo',
  planId: 'pro_monthly',
  status: 'active',
  provider: 'demo',
  startedAt: periodStart,
  currentPeriodStart: periodStart,
  currentPeriodEnd: periodEnd,
  entitlements: PLANS.pro_monthly.features
});

// Tiny budget user — used to demonstrate LIMIT_EXCEEDED on /ai/search.
void persistence.saveSubscription({
  userId: 'bob',
  planId: 'tiny',
  status: 'active',
  provider: 'demo',
  startedAt: periodStart,
  currentPeriodStart: periodStart,
  currentPeriodEnd: periodEnd,
  entitlements: PLANS.tiny.features
});

@Module({
  imports: [
    EntitlementsModule.forRoot({
      config: {
        persistence,
        planResolver,
        fallbackPlan: PLANS.free
      },
      /** Demo only: trust x-user-id for curl. Production apps must use default + AuthGuard. */
      contextResolver: unsafeHeaderBasedEntitlementsContextResolver,
      isGlobal: true
    })
  ],
  controllers: [CrmController]
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module class is required by @Module()
export class AppModule {}
