# Changelog

## Unreleased

### Dependencies

- Bump `zod` 3.25.76 → 4.5.4 and `@casl/ability` 6.8.1 → 7.0.1 (major). No
  code changes required — public API surfaces used (`AbilityBuilder`,
  `createMongoAbility`, `z.record`/`ZodIssue`) are unchanged. Verified via
  `tsc --noEmit` and the full unit/integration suite (99 tests).

### Breaking Changes

- **NestJS:** `defaultEntitlementsContextResolver` no longer reads `x-user-id` /
  `x-tenant-id` headers (they were spoofable). Identity must come from `req.user`
  or `req.entitlementsContext` after authentication. For local demos and tests,
  pass `unsafeHeaderBasedEntitlementsContextResolver` explicitly via
  `EntitlementsModule.forRoot({ contextResolver })`.

# 1.0.0 (2026-05-09)

### Features

- add validation schemas for plan definitions and active subscriptions ([c5001d0](https://github.com/iDEVconn/isubscribe-entitlements/commit/c5001d0fcd9f2c1ee93604c68291ae72a26be566))
