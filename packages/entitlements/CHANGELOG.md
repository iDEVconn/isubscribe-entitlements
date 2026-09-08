# Changelog

## Unreleased

### Dependencies

- Bump `zod` 3.25.76 → 4.5.4 and `@casl/ability` 6.8.1 → 7.0.1 (major). No
  code changes required — public API surfaces used (`AbilityBuilder`,
  `createMongoAbility`, `z.record`/`ZodIssue`) are unchanged. Verified via
  `tsc --noEmit` and the full unit/integration suite (99 tests).

## 0.3.7 (2026-05-22)

### Fixes

- `EntitlementsSupabaseModule.registerAsync` now exposes `isGlobal` (module
  visibility) separately from `global` (`APP_GUARD` opt-out) and accepts a
  custom `logger`. Previously a single `global` flag drove both, so consumers
  that injected `ENTITLEMENTS` from a feature module without importing
  `EntitlementsModule`/`EntitlementsSupabaseModule` directly hit
  `Nest can't resolve dependencies of ... (?)` at boot.
  ([153fdf0](https://github.com/iDEVconn/isubscribe-entitlements/commit/153fdf0ab8c927f91f3d916fc21d37c7f08176cf))

## 0.3.6 (2026-05-21)

No functional changes — CI/release pipeline fixes only (manual
`workflow_dispatch` support, NPM OIDC Trusted Publisher repository-URL
case-sensitivity fix, publish race-condition fixes).

## 0.3.0 (2026-05-21)

### Features

- **New `@idevconn/entitlements/nest/supabase` subpath.**
  `EntitlementsSupabaseModule.registerAsync` wraps `createSupabaseAdapter` +
  `EntitlementsModule.forRootAsync` into one call — persistence, adapter
  wiring, `cacheTtlMs: 0`, and NestJS logger bridging included.
- Class-based NestJS context resolvers.
  ([7a1a53a](https://github.com/iDEVconn/isubscribe-entitlements/commit/7a1a53aa8ca2ee6b6dec046a00eab1d66ee6f39e))

### Breaking Changes

- **NestJS:** `defaultEntitlementsContextResolver` no longer reads `x-user-id` /
  `x-tenant-id` headers (they were spoofable). Identity must come from `req.user`
  or `req.entitlementsContext` after authentication. For local demos and tests,
  pass `unsafeHeaderBasedEntitlementsContextResolver` explicitly via
  `EntitlementsModule.forRoot({ contextResolver })`.

## 0.2.0 (2026-05-13)

### Features

- `EntitlementsGuard` default policy plus a public-entitlement decorator to
  opt individual routes out of the global guard.
  ([6ea22aa](https://github.com/iDEVconn/isubscribe-entitlements/commit/6ea22aa2aa412d13020573f3876e6bc8ab779fda))

# 1.0.0 (2026-05-09)

### Features

- add validation schemas for plan definitions and active subscriptions ([c5001d0](https://github.com/iDEVconn/isubscribe-entitlements/commit/c5001d0fcd9f2c1ee93604c68291ae72a26be566))
