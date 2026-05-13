// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { createMemoryAdapter } from '../../../src/adapters/persistence/memory';
import { createEntitlements } from '../../../src/core/create-entitlements';
import { EntitlementsProvider } from '../../../src/react/provider';
import { Feature } from '../../../src/react/feature';
import { LockedFeature } from '../../../src/react/locked-feature';
import { useFeature } from '../../../src/react/hooks/use-feature';
import { useLimit } from '../../../src/react/hooks/use-limit';
import { useSubscription } from '../../../src/react/hooks/use-subscription';
import { useUsage } from '../../../src/react/hooks/use-usage';
import { ACTIVE_SUB, planResolver } from '../../fixtures';

function FeatureProbe({ name }: { name: string }) {
  const f = useFeature(name);
  return <span data-testid={`feature:${name}`}>{f.allowed ? 'yes' : 'no'}</span>;
}

function LimitProbe({ name }: { name: string }) {
  const l = useLimit(name);
  let display: string;
  if (l.limit === undefined) display = 'undef';
  else if (l.limit === null) display = 'null';
  else display = String(l.limit);
  return <span data-testid={`limit:${name}`}>{display}</span>;
}

function UsageProbe({ name }: { name: string }) {
  const u = useUsage(name);
  return (
    <span data-testid={`usage:${name}`}>
      {u.loading ? 'loading' : `${u.used}/${u.remaining ?? 'unlimited'}`}
    </span>
  );
}

function ConsumeProbe({ name, amount }: { name: string; amount: number }) {
  const sub = useSubscription();
  return (
    <button
      type="button"
      data-testid="consume"
      onClick={() => {
        void sub.consume(name, amount);
      }}
    >
      consume
    </button>
  );
}

async function renderWithEntitlements(ui: ReactNode) {
  const adapter = createMemoryAdapter();
  await adapter.saveSubscription(ACTIVE_SUB);
  const ent = createEntitlements({ persistence: adapter, planResolver });
  const service = ent.for({ userId: ACTIVE_SUB.userId });
  const view = render(<EntitlementsProvider service={service}>{ui}</EntitlementsProvider>);
  return { view, adapter, ent, service };
}

describe('React integration', () => {
  // RTL does not auto-cleanup when vitest runs with globals:false (globalThis.afterEach is
  // not defined, so @testing-library/react's afterEach hook is never registered).
  // Explicit cleanup prevents renders from accumulating across tests.
  afterEach(() => cleanup());
  it('<Feature> renders children when granted, nothing when denied', async () => {
    await renderWithEntitlements(
      <>
        <Feature name="crm.export">
          <span data-testid="granted">granted</span>
        </Feature>
        <Feature name="reports.advanced">
          <span data-testid="never">never</span>
        </Feature>
      </>
    );
    await waitFor(() => expect(screen.queryByTestId('granted')).toBeTruthy());
    expect(screen.queryByTestId('never')).toBeNull();
  });

  it('<LockedFeature> shows fallback when denied', async () => {
    await renderWithEntitlements(
      <LockedFeature name="reports.advanced" fallback={<span data-testid="upgrade">upgrade</span>}>
        <span data-testid="locked">locked</span>
      </LockedFeature>
    );
    await waitFor(() => expect(screen.queryByTestId('upgrade')).toBeTruthy());
    expect(screen.queryByTestId('locked')).toBeNull();
  });

  it('useFeature / useLimit reflect plan values', async () => {
    await renderWithEntitlements(
      <>
        <FeatureProbe name="crm.export" />
        <FeatureProbe name="reports.advanced" />
        <LimitProbe name="projects.max" />
        <LimitProbe name="storage.gb" />
        <LimitProbe name="not.declared" />
      </>
    );
    await waitFor(() => {
      expect(screen.getByTestId('feature:crm.export').textContent).toBe('yes');
    });
    expect(screen.getByTestId('feature:reports.advanced').textContent).toBe('no');
    expect(screen.getByTestId('limit:projects.max').textContent).toBe('10');
    expect(screen.getByTestId('limit:storage.gb').textContent).toBe('null');
    expect(screen.getByTestId('limit:not.declared').textContent).toBe('undef');
  });

  it('useUsage refreshes after consume()', async () => {
    await renderWithEntitlements(
      <>
        <UsageProbe name="ai.tokens.monthly" />
        <ConsumeProbe name="ai.tokens.monthly" amount={2_500} />
      </>
    );

    await waitFor(() => {
      expect(screen.getByTestId('usage:ai.tokens.monthly').textContent).toBe('0/100000');
    });

    // Trigger consume via the hook so the provider's refresh cycle kicks in.
    fireEvent.click(screen.getByTestId('consume'));

    await waitFor(() => {
      const txt = screen.getByTestId('usage:ai.tokens.monthly').textContent;
      expect(txt).toBe('2500/97500');
    });
  });

  it('honors initialSnapshot and skips initial fetch (SSR hydration)', async () => {
    const adapter = createMemoryAdapter();
    const ent = createEntitlements({ persistence: adapter, planResolver });
    const service = ent.for({ userId: 'ssr_user' });

    render(
      <EntitlementsProvider
        service={service}
        initialSnapshot={{
          status: 'ready',
          subscription: ACTIVE_SUB,
          plan: {
            id: ACTIVE_SUB.planId,
            name: ACTIVE_SUB.planId,
            features: ACTIVE_SUB.entitlements,
            source: 'subscription'
          },
          entitlements: ACTIVE_SUB.entitlements,
          error: null
        }}
      >
        <Feature name="crm.export">
          <span data-testid="ssr">hydrated</span>
        </Feature>
      </EntitlementsProvider>
    );

    expect(screen.getByTestId('ssr').textContent).toBe('hydrated');
  });

  it('clears stale entitlements immediately when service changes (L3)', async () => {
    // User A has an active subscription with crm.export = true.
    const adapterA = createMemoryAdapter();
    await adapterA.saveSubscription(ACTIVE_SUB);
    const serviceA = createEntitlements({ persistence: adapterA, planResolver }).for({
      userId: ACTIVE_SUB.userId
    });

    // User B has no subscription — getPlan() will throw NoActiveSubscriptionError.
    const adapterB = createMemoryAdapter();
    const serviceB = createEntitlements({ persistence: adapterB, planResolver }).for({
      userId: 'user_b'
    });

    const { rerender } = render(
      <EntitlementsProvider service={serviceA}>
        <FeatureProbe name="crm.export" />
      </EntitlementsProvider>
    );

    // Wait for user A's data to fully load.
    await waitFor(() => expect(screen.getByTestId('feature:crm.export').textContent).toBe('yes'));

    // Switch to user B — service prop changes.
    rerender(
      <EntitlementsProvider service={serviceB}>
        <FeatureProbe name="crm.export" />
      </EntitlementsProvider>
    );

    // The snapshot must be reset to {} synchronously before loading starts.
    // This means we should see 'no' immediately — not the stale 'yes' from user A.
    expect(screen.getByTestId('feature:crm.export').textContent).toBe('no');

    // After the async load settles (error state — no subscription for user B),
    // entitlements remains {} → still 'no'.
    await waitFor(() => expect(screen.getByTestId('feature:crm.export').textContent).toBe('no'));
  });

  it('loads on service change even when initialSnapshot was provided (SSR → user switch)', async () => {
    // Simulates: server renders page for user A with SSR snapshot, then user A
    // signs out and user B signs in without a full page reload.
    const adapterA = createMemoryAdapter();
    await adapterA.saveSubscription(ACTIVE_SUB);
    const serviceA = createEntitlements({ persistence: adapterA, planResolver }).for({
      userId: ACTIVE_SUB.userId
    });

    const adapterB = createMemoryAdapter();
    await adapterB.saveSubscription(ACTIVE_SUB); // user B also has the sub
    const serviceB = createEntitlements({ persistence: adapterB, planResolver }).for({
      userId: ACTIVE_SUB.userId
    });

    const { rerender } = render(
      <EntitlementsProvider
        service={serviceA}
        initialSnapshot={{
          status: 'ready',
          subscription: ACTIVE_SUB,
          plan: {
            id: ACTIVE_SUB.planId,
            name: ACTIVE_SUB.planId,
            features: ACTIVE_SUB.entitlements,
            source: 'subscription'
          },
          entitlements: ACTIVE_SUB.entitlements,
          error: null
        }}
      >
        <FeatureProbe name="crm.export" />
      </EntitlementsProvider>
    );

    // SSR snapshot hydrates immediately.
    expect(screen.getByTestId('feature:crm.export').textContent).toBe('yes');

    // Switch to serviceB (e.g. different user session after sign-out/sign-in).
    // The provider must reload even though initialSnapshot was provided on mount.
    rerender(
      <EntitlementsProvider service={serviceB}>
        <FeatureProbe name="crm.export" />
      </EntitlementsProvider>
    );

    // After loading completes for serviceB (same plan), should still show 'yes'.
    await waitFor(() => expect(screen.getByTestId('feature:crm.export').textContent).toBe('yes'));
  });
});
