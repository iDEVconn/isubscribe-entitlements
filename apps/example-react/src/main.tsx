import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import {
  createEntitlements,
  type PlanDefinition,
  type PlanResolver
} from '@isubscribe/entitlements';
import { createMemoryAdapter } from '@isubscribe/entitlements/adapters/persistence/memory';
import {
  EntitlementsProvider,
  Feature,
  LockedFeature,
  useFeature,
  useLimit,
  useSubscription,
  useUsage
} from '@isubscribe/entitlements/react';

const PRO: PlanDefinition = {
  id: 'pro_monthly',
  name: 'Pro',
  features: {
    'crm.export': true,
    'ai.search': true,
    'projects.max': 10,
    'ai.tokens.monthly': 100_000
  },
  meteredKeys: ['ai.tokens.monthly']
};

const FREE: PlanDefinition = {
  id: 'free',
  name: 'Free',
  features: {
    'crm.export': false,
    'projects.max': 1,
    'ai.tokens.monthly': 1_000
  },
  meteredKeys: ['ai.tokens.monthly']
};

const planResolver: PlanResolver = async (id) =>
  id === 'pro_monthly' ? PRO : id === 'free' ? FREE : null;

const persistence = createMemoryAdapter();
void persistence.saveSubscription({
  userId: 'demo',
  planId: 'pro_monthly',
  status: 'active',
  provider: 'demo',
  startedAt: new Date(),
  currentPeriodStart: new Date(),
  currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  entitlements: PRO.features
});

const entitlements = createEntitlements({
  persistence,
  planResolver,
  fallbackPlan: FREE
});

const service = entitlements.for({ userId: 'demo' });

function ExportButton() {
  return <button type="button">Export CRM data</button>;
}

function AnalyticsDashboard() {
  return <div>Analytics dashboard</div>;
}

function UpgradeCard() {
  return (
    <div style={{ padding: 12, border: '1px dashed gray' }}>
      Upgrade to unlock advanced analytics.
    </div>
  );
}

function AiTokensWidget() {
  const { used, limit, remaining, loading } = useUsage('ai.tokens.monthly');
  const { consume } = useSubscription();
  return (
    <div>
      <h3>AI tokens this period</h3>
      {loading ? (
        <p>Loading...</p>
      ) : (
        <p>
          {used} / {limit ?? '∞'} used. Remaining: {remaining ?? '∞'}.
        </p>
      )}
      <button type="button" onClick={() => void consume('ai.tokens.monthly', 2_500)}>
        Consume 2,500 tokens
      </button>
    </div>
  );
}

function ProjectsWidget() {
  const { limit, loading } = useLimit('projects.max');
  if (loading) return <p>Loading projects limit…</p>;
  return <p>You can create up to {limit ?? '∞'} projects.</p>;
}

function ExportProbe() {
  const { allowed } = useFeature('crm.export');
  return <small>useFeature("crm.export") -&gt; {allowed ? 'granted' : 'denied'}</small>;
}

function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '40px auto' }}>
      <h1>@isubscribe/entitlements demo</h1>

      <section>
        <h2>Feature gate</h2>
        <Feature name="crm.export">
          <ExportButton />
        </Feature>
        <ExportProbe />
      </section>

      <section>
        <h2>Locked feature with upsell</h2>
        <LockedFeature name="advanced.analytics" fallback={<UpgradeCard />}>
          <AnalyticsDashboard />
        </LockedFeature>
      </section>

      <section>
        <ProjectsWidget />
      </section>

      <section>
        <AiTokensWidget />
      </section>
    </main>
  );
}

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- #root is guaranteed by index.html
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EntitlementsProvider service={service}>
      <App />
    </EntitlementsProvider>
  </StrictMode>
);
