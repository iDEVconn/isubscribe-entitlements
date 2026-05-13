import { SetMetadata } from '@nestjs/common';

import { PUBLIC_ENTITLEMENT_METADATA } from './tokens';

/**
 * Marks a route handler or an entire controller as intentionally public when
 * `EntitlementsModule.forRoot` is configured with `defaultPolicy: 'deny'`.
 *
 * Without this decorator (or `@RequireSubscription(...)`), every route is
 * rejected with 403 in deny mode, making unintentional exposure a build-time
 * mistake rather than a silent runtime bypass.
 *
 * Examples:
 *
 *   ```ts
 *   // Single route opt-out
 *   @Get('health')
 *   @PublicEntitlement()
 *   healthCheck() { ... }
 *
 *   // Whole controller opt-out (e.g. webhooks, public landing)
 *   @PublicEntitlement()
 *   @Controller('webhooks')
 *   export class WebhookController { ... }
 *   ```
 */
export function PublicEntitlement(): MethodDecorator & ClassDecorator {
  return SetMetadata(PUBLIC_ENTITLEMENT_METADATA, true);
}
