# Testing `@idevconn/entitlements`

Five levels of testing, ordered from quickest to most realistic. Pick whichever you need.

| Level | Proves                                                                                                                       |
| ----- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1     | Engine logic, status gating, metered increments, error mapping, React hooks, Nest guard mapping, SSR snapshot path           |
| 2     | Real Nest pipeline; HTTP codes; example API uses `unsafeHeaderBasedEntitlementsContextResolver` for header-based `curl` only |
| 3     | Real React 19 provider, hooks, `<Feature>`/`<LockedFeature>`, reactive consume → re-render                                   |
| 4     | The published artifacts (`dist/*.mjs` + `dist/*.js`) actually work standalone                                                |
| 5     | The packaged tarball — `exports`, `peerDependenciesMeta`, `files`, `prepack` doc-sync — works for an outside consumer        |

All commands assume you start at the repo root:

```bash
cd /Users/kudenv/pr/www/cvrnd/mm_analitics/isubscribe-entitlements
```

---

## Level 1 — Automated tests

```bash
npm run -w @idevconn/isubscribe-entitlements test           # integration included
npm run -w @idevconn/isubscribe-entitlements test:coverage  # with coverage report
```

Coverage HTML lands at `packages/entitlements/coverage/index.html`.

The full project pipeline:

```bash
npm run lint
npm run format:check
npm run typecheck
npm run test
npm run build
```

---

## Level 2 — Exercise the live NestJS demo

Boots `example-nest-api` on port 3000 and seeds a `demo` user with the Pro plan.

The demo opts into `unsafeHeaderBasedEntitlementsContextResolver` so `curl` can pass
`x-user-id`. **Production apps must not do this** — use the default resolver and
populate `req.user` from a verified JWT/session.

```bash
cp apps/example-nest-api/.env.example apps/example-nest-api/.env
npm run start:dev:nest
```

In another terminal hit it with `curl`. Each line covers a different code path:

```bash
# health check (public route)
curl -s http://localhost:3000/health
# → {"ok":true}

# boolean grant: demo user has crm.export
curl -si -H "x-user-id: demo" http://localhost:3000/crm/export
# → 200 {"exported":true}

# numeric limit: projects.max is granted (>0)
curl -si -H "x-user-id: demo" http://localhost:3000/projects/max
# → 200 {"ok":true}

# metered: each call consumes 1 token from ai.tokens.monthly (Pro budget = 100,000).
# The response body is STATIC — `consumed: 1` means "this request burned 1 token",
# not the running total. The actual increment fires post-response from
# ConsumeOnSuccessInterceptor. Use /me/usage/:metric below to read the counter.
curl -si -H "x-user-id: demo" http://localhost:3000/ai/search
# → 200 {"ok":true,"consumed":1}

curl -si -H "x-user-id: demo" http://localhost:3000/me/usage/ai.tokens.monthly
# → 200 {"feature":"ai.tokens.monthly","limit":100000,"used":1,"remaining":99999}

curl -si -H "x-user-id: demo" http://localhost:3000/ai/search
curl -si -H "x-user-id: demo" http://localhost:3000/me/usage/ai.tokens.monthly
# → 200 {"feature":"ai.tokens.monthly","limit":100000,"used":2,"remaining":99998}

# diagnostic: everything the engine sees for this user
curl -si -H "x-user-id: demo" http://localhost:3000/me
# → 200 {
#   "userId":"demo",
#   "plan":{"id":"pro_monthly","name":"Pro","source":"subscription"},
#   "status":"active",
#   "entitlements":{"crm.export":true,"ai.search":true,"projects.max":10,"ai.tokens.monthly":100000,"storage.gb":null}
# }

# exhaust bob's tiny 3-token budget to trigger LIMIT_EXCEEDED on the 4th call
for i in 1 2 3 4; do
  curl -si -H "x-user-id: bob" http://localhost:3000/ai/search | head -1
done
# HTTP/1.1 200 OK
# HTTP/1.1 200 OK
# HTTP/1.1 200 OK
# HTTP/1.1 403 Forbidden   ← {"code":"LIMIT_EXCEEDED",...}

curl -si -H "x-user-id: bob" http://localhost:3000/me/usage/ai.tokens.monthly
# → 200 {"feature":"ai.tokens.monthly","limit":3,"used":3,"remaining":0}

# 403: free fallback plan denies crm.export
curl -si -H "x-user-id: stranger" http://localhost:3000/crm/export
# → 403 {"code":"ENTITLEMENT_DENIED",...}

# 401: protected routes with no identity (example uses unsafe header resolver for curl;
#       without x-user-id the guard cannot resolve context). `/me` likewise requires the header in this demo.
curl -si http://localhost:3000/crm/export
# → 401

# upsert a fresh subscription via the admin route
curl -si -X POST http://localhost:3000/admin/subscriptions \
  -H "content-type: application/json" \
  -d '{
    "userId":"alice","planId":"pro_monthly","status":"active","provider":"stripe",
    "startedAt":"2026-05-01T00:00:00Z","currentPeriodStart":"2026-05-01T00:00:00Z",
    "currentPeriodEnd":"2026-06-01T00:00:00Z",
    "entitlements":{"crm.export":true,"projects.max":10,"ai.tokens.monthly":100000}
  }'

# now this works:
curl -si -H "x-user-id: alice" http://localhost:3000/crm/export
# → 200
```

Watch the response codes — that is the entitlements engine deciding allow / deny / limit live.

### Routes at a glance

| Route                       | Purpose                                                         | Status codes                       |
| --------------------------- | --------------------------------------------------------------- | ---------------------------------- |
| `GET /health`               | liveness                                                        | 200                                |
| `GET /crm/export`           | boolean gate                                                    | 200 / 401 / 403                    |
| `GET /projects/max`         | numeric-limit gate                                              | 200 / 401 / 403                    |
| `GET /ai/search`            | metered gate (consumes 1 token on success)                      | 200 / 401 / 403 (`LIMIT_EXCEEDED`) |
| `GET /me`                   | diagnostic — plan + status + entitlements snapshot              | 200 / 401                          |
| `GET /me/usage/:metric`     | diagnostic — `{ limit, used, remaining }` for a metered feature | 200 / 401                          |
| `POST /admin/subscriptions` | upsert (call from your webhook handler)                         | 201                                |

### Seeded users

| `x-user-id`   | Plan                                 | Notes                                       |
| ------------- | ------------------------------------ | ------------------------------------------- |
| `demo`        | `pro_monthly` (100,000-token budget) | full access, useful for happy-path          |
| `bob`         | `tiny` (3-token budget)              | exhaust in 3 calls to demo `LIMIT_EXCEEDED` |
| anything else | fallback `free` plan                 | `crm.export` is explicitly `false` → 403    |

---

## Level 3 — Click through the React demo

```bash
npm run start:dev:react
# Vite prints "Local: http://localhost:5173/"
```

Open the URL. The page is wired in `apps/example-react/src/main.tsx` and demonstrates:

- `<Feature name="crm.export">` — the **Export CRM data** button is rendered.
- `<LockedFeature name="advanced.analytics" fallback={<UpgradeCard />}>` — `advanced.analytics` is undeclared, so you see the **upgrade card** instead of the dashboard.
- `useLimit('projects.max')` — shows "Up to 10 projects".
- `useUsage('ai.tokens.monthly')` + `useSubscription().consume(...)` — click **Consume 2,500 tokens** and watch the counter tick up reactively (`0/100000 → 2500/97500 → 5000/95000 …`).

This is the same code path consumers will use, end-to-end through the React provider.

---

## Level 4 — Use the built package from a Node script

Build first, then run a one-shot script straight against the artifacts under `dist/`.

```bash
npm run build:pkg

# CJS + ESM smoke test
node -e "console.log(Object.keys(require('./packages/entitlements/dist/index.js')))"
node --input-type=module \
  -e "import('./packages/entitlements/dist/index.mjs').then(m => console.log(Object.keys(m)))"
```

Both should print the public surface (`createEntitlements`, `MemoryCache`, `EntitlementDeniedError`, …).

For a richer scripted test, drop this in `/tmp/probe.mjs`:

```js
import { createEntitlements } from '/abs/path/to/isubscribe-entitlements/packages/entitlements/dist/index.mjs';
import { createMemoryAdapter } from '/abs/path/to/isubscribe-entitlements/packages/entitlements/dist/adapters/persistence/memory.mjs';

const PRO = {
  id: 'pro',
  name: 'Pro',
  features: { 'crm.export': true, 'ai.tokens.monthly': 100 },
  meteredKeys: ['ai.tokens.monthly']
};

const ent = createEntitlements({
  persistence: createMemoryAdapter(),
  planResolver: async (id) => (id === 'pro' ? PRO : null)
});

await ent.saveSubscription({
  userId: 'u1',
  planId: 'pro',
  status: 'active',
  provider: 'demo',
  startedAt: new Date(),
  currentPeriodStart: new Date(),
  currentPeriodEnd: new Date(Date.now() + 86400000),
  entitlements: PRO.features
});

const svc = ent.for({ userId: 'u1' });
console.log('has crm.export?', await svc.has('crm.export')); // true
console.log('limit ai.tokens.monthly?', await svc.limit('ai.tokens.monthly')); // 100
console.log('check 30?', await svc.check('ai.tokens.monthly', 30)); // true

await svc.consume('ai.tokens.monthly', 30);
console.log('usage now?', await svc.usage('ai.tokens.monthly')); // 30

try {
  await svc.consume('ai.tokens.monthly', 80);
} catch (e) {
  console.log('caught:', e.code, '-', e.message);
}
// caught: LIMIT_EXCEEDED - Limit exceeded for "ai.tokens.monthly": requested 80, used 30, limit 100
```

Run with `node /tmp/probe.mjs`.

---

## Level 5 — Treat it like a real npm consumer (tarball install)

This is the most realistic test before publishing — proves `exports`, `peerDependenciesMeta`, file inclusion, and the `prepack` doc-sync all work.

```bash
# 1. Build + pack — produces an npm tarball next to the package
npm run build:pkg
cd packages/entitlements && npm pack && cd -
# → packages/entitlements/isubscribe-entitlements-0.1.0.tgz

# 2. Inspect what will ship to npm
tar -tzf packages/entitlements/isubscribe-entitlements-0.1.0.tgz | head -40

# 3. Install into a throwaway consumer project
mkdir -p /tmp/ent-consumer && cd /tmp/ent-consumer
npm init -y >/dev/null
npm install /abs/path/to/isubscribe-entitlements/packages/entitlements/isubscribe-entitlements-0.1.0.tgz

cat > probe.mjs <<'JS'
import { createEntitlements } from '@idevconn/entitlements';
import { createMemoryAdapter } from '@idevconn/entitlements/adapters/persistence/memory';

const ent = createEntitlements({
  persistence: createMemoryAdapter(),
  planResolver: async () => ({ id: 'free', name: 'Free', features: { 'projects.max': 1 } }),
  fallbackPlan: { id: 'free', name: 'Free', features: { 'projects.max': 1 } },
});

const svc = ent.for({ userId: 'anon' });
console.log('plan source:', (await svc.getPlan()).source);   // 'fallback'
console.log('limit:', await svc.limit('projects.max'));      // 1
console.log('has unknown:', await svc.has('not.declared'));  // false
JS

node probe.mjs
```

Expected output:

```
plan source: fallback
limit: 1
has unknown: false
```

To verify the `/react` and `/nest` subpaths resolve at all (without actually pulling those frameworks):

```bash
node --input-type=module \
  -e "import('@idevconn/entitlements/react').then(m => console.log('react:', Object.keys(m)))"
# → react: [ 'EntitlementsProvider', 'Feature', 'LockedFeature', 'useSubscription', ... ]
```

That import will warn that `react` is not installed — which is the point: peer-deps are optional, so backend-only consumers do not pay for them.

---

## Bonus — Run via Docker

Ship-the-container test for the example API:

```bash
cp apps/example-nest-api/.env.example apps/example-nest-api/.env
docker compose up --build
# then re-run the curl commands from Level 2 against http://localhost:3000
```

---

## Troubleshooting

- **`npm run start:dev:nest` exits immediately.** Make sure `apps/example-nest-api/.env` exists; copy from `.env.example`.
- **React demo shows nothing.** The Vite dev server must be on Node 20+. Check `node --version`.
- **`Cannot find module '@idevconn/entitlements'` in Level 4/5.** Run `npm run build:pkg` first; `dist/` must exist.
- **Tarball install fails with `EBADENGINE`.** The package declares `engines.node >=20`; upgrade Node.
- **402 vs 403 confusion.** 402 = no active subscription record at all and no fallback plan; 403 = subscription/fallback exists but the specific feature is denied.
