# Security Audit Fixes — M/L Bundle

**Date:** 2026-05-14  
**Package:** `packages/entitlements`  
**Scope:** 7 findings from internal security audit (M1–M5, L1–L3)

---

## Findings & Changes

### M1 — Multi-process cache coherence warning

**Risk:** `MemoryCache` is process-local. In multi-process deployments (PM2 clusters, serverless cold starts), entitlements cached in one process are invisible to others, causing stale reads.  
**Fix:** Added a prominent JSDoc warning to `MemoryCache` and the `cacheTtlMs` option in `createEntitlements` recommending a shared cache (e.g. Redis) for multi-process environments. Setting `cacheTtlMs: 0` opts out entirely.  
**Files:** `src/core/cache.ts`, `src/core/create-entitlements.ts`

---

### M2 — TOCTOU race in `consume()` limit enforcement

**Risk:** The check-then-increment pattern (`getUsage` → compare → `incrementUsage`) is non-atomic. Two concurrent requests can both pass the limit check and both succeed, exceeding the limit.  
**Fix:** Added optional `incrementUsageCapped?` method to `SubscriptionPersistenceAdapter`. When the adapter implements it, `consume()` delegates to the atomic DB-side operation instead of the non-atomic fallback. `SupabasePersistenceAdapter` implements the method via a Postgres RPC that performs the increment and cap check in a single transaction. A `LimitExceededError` is thrown when the cap is hit.  
**Files:** `src/adapters/persistence/interface.ts`, `src/adapters/persistence/supabase.ts`, `src/adapters/persistence/memory.ts`, `src/core/entitlements-service.ts`  
**Tests:** `test/unit/entitlements-service.test.ts`

---

### M3 — Supabase unique index missing NULLS NOT DISTINCT

**Risk:** Without `NULLS NOT DISTINCT`, a composite unique index on `(tenant_id, user_id, plan_id)` allows multiple `NULL` values in the same column, creating duplicate active subscriptions for users with no tenant.  
**Fix:** Added the correct index DDL (with `NULLS NOT DISTINCT`) to the Supabase adapter JSDoc so implementers copy a schema that prevents duplicates.  
**Files:** `src/adapters/persistence/supabase.ts`

---

### M4 — Supabase RLS guidance absent

**Risk:** Supabase tables without Row Level Security policies are readable/writable by any authenticated user, enabling horizontal privilege escalation.  
**Fix:** Added RLS policy templates to the `SupabasePersistenceAdapter` JSDoc covering tenant isolation, user-scoped reads, and service-role-only writes.  
**Files:** `src/adapters/persistence/supabase.ts`

---

### M5 — Supabase table/column name injection

**Risk:** Caller-supplied identifiers (`tableName`, `schemaName`, `subscriptionRpc`, etc.) are interpolated into Supabase PostgREST calls. A malicious value could escape the intended query context.  
**Fix:** Added `const IDENT = /^[a-z_][a-z0-9_]*$/i` and a constructor-time validation loop. Every caller-supplied identifier is validated on construction; invalid values throw `InvalidInputError` immediately, before any DB call is made.  
**Files:** `src/adapters/persistence/supabase.ts`  
**Tests:** `test/unit/supabase-adapter.test.ts`

---

### L1 — `planSnapshotFallback` revoke pattern undocumented

**Risk:** The `planSnapshotFallback` option is intended as a soft-revoke safety net, but without documentation developers use it as a permanent shortcut, bypassing live entitlement checks and silently granting access to cancelled users.  
**Fix:** Added a "Soft-revoke pattern" JSDoc section to `planSnapshotFallback` describing its correct role as a last-resort fallback and recommending `{ status: 'revoke' }` as the safe default.  
**Files:** `src/core/create-entitlements.ts`

---

### L2 — Error details exposed to end-users

**Risk:** `toResponseBody()` always included `details` (e.g. feature names, limit values, usage counts). This leaks internal plan structure to clients.  
**Fix:**

- `EntitlementsError.toResponseBody(verbose?: boolean)` now accepts an optional flag (default `true` for backward compatibility). When `false`, the `details` field is omitted.
- New `exposeErrorDetails?: boolean` option on `EntitlementsModuleOptions` (default `true`). Bound to the `ENTITLEMENTS_EXPOSE_ERROR_DETAILS` DI token.
- `EntitlementsGuard` injects the token and passes the flag to `mapError`, which forwards it to `toResponseBody`.  
  **Files:** `src/core/errors.ts`, `src/nest/entitlements.module.ts`, `src/nest/entitlements.guard.ts`, `src/nest/tokens.ts`, `src/nest/index.ts`  
  **Tests:** `test/unit/errors.test.ts`, `test/integration/nest-guard.test.ts`

---

### L3 — React provider does not reset state on service change

**Risk:** When `service` changes (e.g. user logs out and a new user logs in), the provider retains the previous user's snapshot in React state until the new fetch completes. This causes a brief window where the wrong entitlements are visible.  
**Fix:** Replaced two `useEffect` calls with one effect that tracks whether it is the first invocation via `useRef`. On first run it respects `initialSnapshot` (SSR path). On subsequent runs (service identity change) it immediately resets state to `idle` before fetching.  
**Files:** `src/react/provider.tsx`  
**Tests:** `test/unit/react/feature.test.tsx`

---

## Test Coverage Added

| File                                     | New tests | Finding |
| ---------------------------------------- | --------- | ------- |
| `test/unit/supabase-adapter.test.ts`     | ~8        | M5      |
| `test/unit/errors.test.ts`               | 5         | L2      |
| `test/integration/nest-guard.test.ts`    | 3         | L2      |
| `test/unit/entitlements-service.test.ts` | 4         | M2      |
| `test/unit/react/feature.test.tsx`       | 2         | L3      |

**Total:** 99 tests passing, 0 failures, 0 TypeScript errors.

---

## Notes

- All changes are backward-compatible. No public API removed.
- `incrementUsageCapped` is optional on the interface — adapters that do not implement it fall back to the existing non-atomic path.
- `exposeErrorDetails` defaults to `true` so existing NestJS consumers see no behaviour change.
- RTL auto-cleanup does not run under `globals: false` vitest config; `test/unit/react/feature.test.tsx` now calls `afterEach(() => cleanup())` explicitly.
