import type { ExecutionContext } from '@nestjs/common';

import type { EntitlementsContext } from '../core/types';

/**
 * Resolves the `EntitlementsContext` (i.e. who is the user / which tenant)
 * from the current Nest `ExecutionContext`. Pluggable so consumers can match
 * their auth setup (Passport, Clerk, custom guards, etc.).
 *
 * **`defaultEntitlementsContextResolver` (secure)** reads only:
 *   - `request.entitlementsContext` (explicit override, set by your code after auth)
 *   - `request.user` (`{ id, userId, sub, tenantId }`) — must come from a verified source (e.g. JWT validated by your `AuthGuard`)
 *
 * It never trusts `x-user-id` / `x-tenant-id` headers, because those are
 * trivially spoofable by clients.
 *
 * For local demos and automated tests that drive requests via headers, use
 * `unsafeHeaderBasedEntitlementsContextResolver` explicitly — never in production.
 */
export type EntitlementsContextResolver = (
  context: ExecutionContext
) => EntitlementsContext | null | Promise<EntitlementsContext | null>;

/**
 * Interface that class-based context resolvers must implement to participate
 * in NestJS dependency injection context resolution.
 */
export interface NestEntitlementsContextResolver {
  resolve(
    context: ExecutionContext
  ): EntitlementsContext | null | Promise<EntitlementsContext | null>;
}

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

/**
 * Production-safe default: identity comes only from `req.user` or an explicit
 * `req.entitlementsContext` set after authentication.
 */
export const defaultEntitlementsContextResolver: EntitlementsContextResolver = (ctx) => {
  const req = ctx.switchToHttp().getRequest<RequestLike>();
  if (!req) return null;

  if (req.entitlementsContext) {
    return req.entitlementsContext;
  }

  const userId = req.user?.id ?? req.user?.userId ?? req.user?.sub;
  if (!userId) return null;

  const tenantId = req.user?.tenantId;
  return tenantId ? { userId, tenantId } : { userId };
};

let warnedUnsafeHeaderIdentity = false;

/**
 * **UNSAFE — development and automated tests only.**
 *
 * Falls back to spoofable `x-user-id` / `x-tenant-id` when `req.user` is absent.
 * An attacker can impersonate any user or burn their metered quota.
 *
 * Use only when you deliberately want header-driven identity (e.g. `curl`
 * recipes in the example API). In production, wire `contextResolver` from a
 * verified JWT/session instead, or rely on `defaultEntitlementsContextResolver`
 * after your auth guard sets `req.user`.
 */
export const unsafeHeaderBasedEntitlementsContextResolver: EntitlementsContextResolver = (ctx) => {
  const req = ctx.switchToHttp().getRequest<RequestLike>();
  if (!req) return null;

  if (req.entitlementsContext) {
    return req.entitlementsContext;
  }

  const fromUser = req.user?.id ?? req.user?.userId ?? req.user?.sub;
  const fromHeader = headerValue(req.headers, 'x-user-id');
  const userId = fromUser ?? fromHeader;

  if (!userId) return null;

  const tenantId = req.user?.tenantId ?? headerValue(req.headers, 'x-tenant-id') ?? undefined;

  if (!fromUser && fromHeader && !warnedUnsafeHeaderIdentity) {
    warnedUnsafeHeaderIdentity = true;
    console.warn(
      '[@idevconn/isubscribe-entitlements] unsafeHeaderBasedEntitlementsContextResolver used identity from x-user-id without req.user. Do not use this resolver in production.'
    );
  }

  return tenantId ? { userId, tenantId } : { userId };
};

function headerValue(headers: RequestLike['headers'], name: string): string | undefined {
  if (!headers) return undefined;
  const raw = headers[name];
  if (Array.isArray(raw)) return raw[0];
  return raw ?? undefined;
}
