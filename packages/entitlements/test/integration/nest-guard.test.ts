/* eslint-disable @typescript-eslint/no-extraneous-class */
import 'reflect-metadata';

import { Controller, Get, type INestApplication, Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import {
  createMemoryAdapter,
  type MemoryPersistenceAdapter
} from '../../src/adapters/persistence/memory';
import type { Entitlements } from '../../src/core/create-entitlements';
import {
  ConsumeOnSuccessInterceptor,
  EntitlementsModule,
  PublicEntitlement,
  RequireSubscription,
  ENTITLEMENTS,
  ENTITLEMENTS_CONTEXT_RESOLVER,
  type EntitlementsContextResolver,
  unsafeHeaderBasedEntitlementsContextResolver
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
      config: { persistence: adapter, planResolver },
      contextResolver: unsafeHeaderBasedEntitlementsContextResolver
    })
  ],
  controllers: [TestController]
})
class TestAppModule {}

const secureAdapter = createMemoryAdapter();

@Module({
  imports: [
    EntitlementsModule.forRoot({
      config: { persistence: secureAdapter, planResolver }
    })
  ],
  controllers: [TestController]
})
class SecureHeaderTestAppModule {}

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

  it('enforces metered amounts and consumes synchronously before the response', async () => {
    const server = app.getHttpServer();
    await request(server)
      .get('/ai/tokens')
      .set('x-user-id', ACTIVE_SUB.userId)
      .expect(200, { ok: true });

    // No artificial delay needed — consume() is now awaited before the 200 is flushed.
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

describe('Nest integration (default secure context resolver)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await secureAdapter.saveSubscription(ACTIVE_SUB);

    const moduleRef = await Test.createTestingModule({
      imports: [SecureHeaderTestAppModule]
    }).compile();
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

  it('returns 401 when client sends only x-user-id (spoofable headers are ignored)', async () => {
    await request(app.getHttpServer())
      .get('/crm/export')
      .set('x-user-id', ACTIVE_SUB.userId)
      .expect(401);
  });
});

describe('Nest integration (ConsumeOnSuccessInterceptor — storage failure propagation)', () => {
  let app: INestApplication;
  let faultyAdapter: MemoryPersistenceAdapter;

  beforeAll(async () => {
    faultyAdapter = createMemoryAdapter();
    await faultyAdapter.saveSubscription(ACTIVE_SUB);

    // Wrap incrementUsage to throw after the guard's check() passes so that
    // only the interceptor's consume() call sees the error.
    const original = faultyAdapter.incrementUsage.bind(faultyAdapter);
    faultyAdapter.incrementUsage = async () => {
      throw new Error('storage unavailable');
    };
    // Restore for getUsage so check() in the guard still reads 0.
    void original; // referenced to satisfy linters

    @Module({
      imports: [
        EntitlementsModule.forRoot({
          config: { persistence: faultyAdapter, planResolver },
          contextResolver: unsafeHeaderBasedEntitlementsContextResolver
        })
      ],
      controllers: [TestController]
    })
    class FaultyAdapterModule {}

    const moduleRef = await Test.createTestingModule({ imports: [FaultyAdapterModule] }).compile();
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

  it('returns 500 (not 200) when the usage increment fails', async () => {
    // Storage throws during consume() — the error must propagate so the client
    // knows the request was not fully processed, instead of silently losing the
    // increment and returning a false-positive 200.
    await request(app.getHttpServer())
      .get('/ai/tokens')
      .set('x-user-id', ACTIVE_SUB.userId)
      .expect(500);
  });
});

// ---------------------------------------------------------------------------
// defaultPolicy: 'deny' suite
// ---------------------------------------------------------------------------

@Controller('deny-test')
class DenyTestController {
  @Get('undecorated')
  undecorated(): { ok: true } {
    return { ok: true };
  }

  @Get('public-method')
  @PublicEntitlement()
  publicMethod(): { ok: true } {
    return { ok: true };
  }

  @Get('protected')
  @RequireSubscription('crm.export')
  protected(): { ok: true } {
    return { ok: true };
  }

  @Get('denied-feature')
  @RequireSubscription('reports.advanced')
  deniedFeature(): { ok: true } {
    return { ok: true };
  }
}

@PublicEntitlement()
@Controller('public-controller')
class PublicController {
  @Get('route-a')
  routeA(): { ok: true } {
    return { ok: true };
  }

  @Get('route-b')
  routeB(): { ok: true } {
    return { ok: true };
  }
}

describe('Nest integration (defaultPolicy: deny)', () => {
  let app: INestApplication;
  const denyAdapter = createMemoryAdapter();

  beforeAll(async () => {
    await denyAdapter.saveSubscription(ACTIVE_SUB);

    @Module({
      imports: [
        EntitlementsModule.forRoot({
          config: { persistence: denyAdapter, planResolver },
          contextResolver: unsafeHeaderBasedEntitlementsContextResolver,
          defaultPolicy: 'deny'
        })
      ],
      controllers: [DenyTestController, PublicController]
    })
    class DenyPolicyModule {}

    const moduleRef = await Test.createTestingModule({ imports: [DenyPolicyModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an undecorated route with 403', async () => {
    await request(app.getHttpServer())
      .get('/deny-test/undecorated')
      .set('x-user-id', ACTIVE_SUB.userId)
      .expect(403);
  });

  it('allows a route decorated with @PublicEntitlement()', async () => {
    await request(app.getHttpServer()).get('/deny-test/public-method').expect(200, { ok: true });
  });

  it('allows all routes on a @PublicEntitlement() controller', async () => {
    await request(app.getHttpServer()).get('/public-controller/route-a').expect(200, { ok: true });
    await request(app.getHttpServer()).get('/public-controller/route-b').expect(200, { ok: true });
  });

  it('allows a decorated route when the subscription grants the feature', async () => {
    await request(app.getHttpServer())
      .get('/deny-test/protected')
      .set('x-user-id', ACTIVE_SUB.userId)
      .expect(200, { ok: true });
  });

  it('rejects a decorated route when the feature is denied', async () => {
    await request(app.getHttpServer())
      .get('/deny-test/denied-feature')
      .set('x-user-id', ACTIVE_SUB.userId)
      .expect(403);
  });
});

// ---------------------------------------------------------------------------
// exposeErrorDetails: false suite (L2 — error response body sanitisation)
// ---------------------------------------------------------------------------

describe('Nest integration (exposeErrorDetails: false)', () => {
  let app: INestApplication;
  const safeAdapter = createMemoryAdapter();

  beforeAll(async () => {
    await safeAdapter.saveSubscription(ACTIVE_SUB);

    @Module({
      imports: [
        EntitlementsModule.forRoot({
          config: { persistence: safeAdapter, planResolver },
          contextResolver: unsafeHeaderBasedEntitlementsContextResolver,
          exposeErrorDetails: false
        })
      ],
      controllers: [TestController]
    })
    class SafeErrorsModule {}

    const moduleRef = await Test.createTestingModule({ imports: [SafeErrorsModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('omits details from 402 body when exposeErrorDetails=false', async () => {
    const res = await request(app.getHttpServer())
      .get('/crm/export')
      .set('x-user-id', 'no-sub-user')
      .expect(402);

    expect(res.body.code).toBe('NO_ACTIVE_SUBSCRIPTION');
    expect(res.body.details).toBeUndefined();
  });

  it('omits details from 403 body when exposeErrorDetails=false', async () => {
    const res = await request(app.getHttpServer())
      .get('/reports/advanced')
      .set('x-user-id', ACTIVE_SUB.userId)
      .expect(403);

    expect(res.body.code).toBe('ENTITLEMENT_DENIED');
    expect(res.body.details).toBeUndefined();
  });

  it('still includes code and message when details are suppressed', async () => {
    const res = await request(app.getHttpServer())
      .get('/crm/export')
      .set('x-user-id', 'no-sub-user')
      .expect(402);

    expect(typeof res.body.code).toBe('string');
    expect(typeof res.body.message).toBe('string');
  });
});
