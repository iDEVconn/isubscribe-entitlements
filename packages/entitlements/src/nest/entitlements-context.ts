import type { ExecutionContext } from '@nestjs/common';

import type { EntitlementsContext } from '../core/types';

/**
 * Resolves the `EntitlementsContext` (i.e. who is the user / which tenant)
 * from the current Nest `ExecutionContext`. Pluggable so consumers can match
 * their auth setup (Passport, Clerk, custom guards, etc.).
 *
 * The default implementation looks at:
 *   - `request.entitlementsContext` (explicit override)
 *   - `request.user` (`{ id, userId, sub, tenantId }`)
 *   - `x-user-id` and `x-tenant-id` headers (useful in dev / tests)
 */
export type EntitlementsContextResolver = (
  context: ExecutionContext
) => EntitlementsContext | null | Promise<EntitlementsContext | null>;

interface RequestLike {
  entitlementsContext?: EntitlementsContext;
  user?: {
    id?: string;
    userId?: string;
    sub?: string;
    tenantId?: string;
  };
  headers?: Record<string, string | string[] | undefined>;
}

export const defaultEntitlementsContextResolver: EntitlementsContextResolver = (ctx) => {
  const req = ctx.switchToHttp().getRequest<RequestLike>();
  if (!req) return null;

  if (req.entitlementsContext) {
    return req.entitlementsContext;
  }

  const userId =
    req.user?.id ?? req.user?.userId ?? req.user?.sub ?? headerValue(req.headers, 'x-user-id');

  if (!userId) return null;

  const tenantId = req.user?.tenantId ?? headerValue(req.headers, 'x-tenant-id');

  return tenantId ? { userId, tenantId } : { userId };
};

function headerValue(headers: RequestLike['headers'], name: string): string | undefined {
  if (!headers) return undefined;
  const raw = headers[name];
  if (Array.isArray(raw)) return raw[0];
  return raw ?? undefined;
}
