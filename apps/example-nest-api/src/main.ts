import 'reflect-metadata';
import 'dotenv/config';

import { NestFactory, Reflector } from '@nestjs/core';

import {
  ConsumeOnSuccessInterceptor,
  ENTITLEMENTS,
  ENTITLEMENTS_CONTEXT_RESOLVER,
  type EntitlementsContextResolver
} from '@isubscribe/entitlements/nest';
import type { Entitlements } from '@isubscribe/entitlements';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const reflector = app.get(Reflector);
  const handle = app.get<Entitlements>(ENTITLEMENTS);
  const resolver = app.get<EntitlementsContextResolver>(ENTITLEMENTS_CONTEXT_RESOLVER);

  app.useGlobalInterceptors(new ConsumeOnSuccessInterceptor(reflector, handle, resolver));

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);

  console.log(`example-nest-api listening on port ${port}`);

  console.log('Try:');

  console.log('  curl -H "x-user-id: demo" http://localhost:' + port + '/crm/export');

  console.log('  curl -H "x-user-id: demo" http://localhost:' + port + '/ai/search');
}

void bootstrap();
