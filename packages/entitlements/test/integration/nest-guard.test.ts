/* eslint-disable @typescript-eslint/no-extraneous-class */
import 'reflect-metadata';

import { Controller, Get, type INestApplication, Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createMemoryAdapter } from '../../src/adapters/persistence/memory';
import type { Entitlements } from '../../src/core/create-entitlements';
import {
  ConsumeOnSuccessInterceptor,
  EntitlementsModule,
  RequireSubscription,
  ENTITLEMENTS,
  ENTITLEMENTS_CONTEXT_RESOLVER,
  type EntitlementsContextResolver
} from '../../src/nest';
import { ACTIVE_SUB, planResolver } from '../fixtures';

@Controller()
class TestController {
  @Get('public')
  publicRoute(): { ok: true } {
    return { ok: true };
  }

  @Get('crm/export')
  @RequireSubscription('crm.export')
  exportCrm(): { ok: true } {
    return { ok: true };
  }

  @Get('reports/advanced')
  @RequireSubscription('reports.advanced')
  reportsAdvanced(): { ok: true } {
    return { ok: true };
  }

  @Get('ai/search')
  @RequireSubscription({ all: ['crm.export', 'ai.search'] })
  aiSearch(): { ok: true } {
    return { ok: true };
  }

  @Get('ai/tokens')
  @RequireSubscription({ feature: 'ai.tokens.monthly', amount: 1_000 })
  aiTokens(): { ok: true } {
    return { ok: true };
  }
}

const adapter = createMemoryAdapter();

@Module({
  imports: [
    EntitlementsModule.forRoot({
      config: { persistence: adapter, planResolver }
    })
  ],
  controllers: [TestController]
})
class TestAppModule {}

describe('Nest integration (EntitlementsGuard)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await adapter.saveSubscription(ACTIVE_SUB);

    const moduleRef = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = moduleRef.createNestApplication();

    const reflector = app.get(Reflector, { strict: false });
    const handle = app.get<Entitlements>(ENTITLEMENTS, { strict: false });
    const resolver = app.get<EntitlementsContextResolver>(ENTITLEMENTS_CONTEXT_RESOLVER, {
      strict: false
    });
    app.useGlobalInterceptors(new ConsumeOnSuccessInterceptor(reflector, handle, resolver));

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows routes without metadata', async () => {
    await request(app.getHttpServer()).get('/public').expect(200, { ok: true });
  });

  it('returns 401 when no context can be resolved', async () => {
    await request(app.getHttpServer()).get('/crm/export').expect(401);
  });

  it('allows access for the active subscription', async () => {
    await request(app.getHttpServer())
      .get('/crm/export')
      .set('x-user-id', ACTIVE_SUB.userId)
      .expect(200, { ok: true });
  });

  it('forbids denied features', async () => {
    await request(app.getHttpServer())
      .get('/reports/advanced')
      .set('x-user-id', ACTIVE_SUB.userId)
      .expect(403);
  });

  it('enforces all-of when multiple features are required', async () => {
    await request(app.getHttpServer())
      .get('/ai/search')
      .set('x-user-id', ACTIVE_SUB.userId)
      .expect(200, { ok: true });
  });

  it('enforces metered amounts and consumes after success', async () => {
    const server = app.getHttpServer();
    await request(server)
      .get('/ai/tokens')
      .set('x-user-id', ACTIVE_SUB.userId)
      .expect(200, { ok: true });

    await new Promise((resolve) => setTimeout(resolve, 10));
    const used = await adapter.getUsage({ userId: ACTIVE_SUB.userId }, 'ai.tokens.monthly');
    expect(used).toBeGreaterThanOrEqual(1_000);
  });

  it('returns 402 when there is no active subscription record', async () => {
    await request(app.getHttpServer())
      .get('/crm/export')
      .set('x-user-id', 'never-subscribed')
      .expect(402);
  });
});
