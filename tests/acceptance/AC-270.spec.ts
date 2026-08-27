/**
 * AC-270 acceptance (positive).
 * Traces: FR-PROV-002, FR-PROV-003, FR-PROV-001.
 * AC text (manifest, abridged): an ACTIVE operation whose documentation/
 * rights/schema verification EXPIRES under an injected clock moves OUT of
 * active decision-critical use; refreshing BOTH official-doc AND
 * live-contract sources restores that use.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  LifecycleMachine,
  OperationRegistry,
  VerificationTtlEngine,
  ProvErrorCode,
  expiryHealthFor,
} from '@foresift/provider-lifecycle';
import type { OperationTarget, ProviderVerificationKind } from '@foresift/provider-lifecycle';
import {
  closeProvTestDatabase,
  makeMutableClock,
  makeProvTestDatabase,
  provOperationDefinition,
  recordVerificationPair,
  type MutableClock,
  type ProvTestDatabase,
} from '../helpers/prov.ts';

const TARGET: OperationTarget = {
  providerId: 'ac270-provider',
  operationId: 'op-ac270',
  version: 'v1',
};
const KINDS: readonly ProviderVerificationKind[] = ['DOCUMENTATION', 'RIGHTS', 'SCHEMA'];
const TTL_SECONDS = 2_678_400; // 31 days

/** Mutable injected clock — suites move wall time via `clockControl.setNow`. */
const clockControl: MutableClock = makeMutableClock('2026-01-10T00:00:00Z');
const clock = clockControl.clock;

let tdb: ProvTestDatabase;
let registry: OperationRegistry;
let machine: LifecycleMachine;
let ttl: VerificationTtlEngine;

beforeAll(async () => {
  tdb = await makeProvTestDatabase();
  registry = new OperationRegistry(tdb.engine, clock);
  machine = new LifecycleMachine({ engine: tdb.engine, clock });
  ttl = new VerificationTtlEngine({ engine: tdb.engine, clock, machine });
  await registry.registerProvider({
    providerId: TARGET.providerId,
    displayName: 'AC-270 provider',
    providerGroup: 'acceptance',
  });
  await registry.registerOperation(provOperationDefinition(TARGET));
  await machine.transition({
    target: TARGET,
    toState: 'VERIFIED',
    reasonClass: 'VERIFICATION_PASSED',
    actor: 'ac270',
  });
  for (const kind of KINDS) {
    await ttl.configureTtl({ kind, ttlSeconds: TTL_SECONDS });
    // Initial seeding pins the expiry so the later expiry step lands mid-window.
    await recordVerificationPair(ttl, {
      target: TARGET,
      kind,
      clock,
      window: { expiresAt: '2026-02-01T00:00:00Z' },
    });
  }
  await machine.transition({
    target: TARGET,
    toState: 'ACTIVE',
    reasonClass: 'ACTIVATION',
    actor: 'ac270',
  });
});

afterAll(async () => {
  await closeProvTestDatabase(tdb);
});

describe('AC-270 refresh-pair lifecycle', () => {
  it('allows active decision use while both sources are fresh (pre-expiry)', async () => {
    clockControl.setNow('2026-01-31T23:59:59Z');
    for (const kind of KINDS) {
      const freshness = await ttl.assertActiveUseAllowed(TARGET, kind);
      expect(freshness.pairFresh).toBe(true);
    }
    expect((await registry.getOperation(TARGET)).currentState).toBe('ACTIVE');
  });

  it('injected-clock expiry moves the operation out of active decision-critical use', async () => {
    clockControl.setNow('2026-02-01T00:00:01Z'); // one second past the window
    for (const kind of KINDS) {
      await expect(ttl.assertActiveUseAllowed(TARGET, kind)).rejects.toMatchObject({
        code: ProvErrorCode.PROV_VERIFICATION_REFRESH_INCOMPLETE,
      });
    }
    // The sweep projects the lapse onto the registry row with §15.4 health.
    const report = await ttl.sweepExpired({ actor: 'ac270-sweep' });
    expect(report.examinedOperations).toBeGreaterThanOrEqual(1);
    const op = await registry.getOperation(TARGET);
    expect(op.currentState).toBe('DEGRADED');
    expect(op.healthStatus).toBe(expiryHealthFor('DOCUMENTATION'));
  });

  it('refreshing BOTH sources restores active decision use and re-activates', async () => {
    for (const kind of KINDS) {
      await recordVerificationPair(ttl, { target: TARGET, kind, clock, ttlSeconds: TTL_SECONDS }); // fresh windows from the NEW clock instant
    }
    for (const kind of KINDS) {
      const freshness = await ttl.assertActiveUseAllowed(TARGET, kind);
      expect(freshness.pairFresh).toBe(true);
    }
    await machine.transition({
      target: TARGET,
      toState: 'ACTIVE',
      reasonClass: 'VERIFICATION_REFRESHED',
      actor: 'ac270',
    });
    expect((await registry.getOperation(TARGET)).currentState).toBe('ACTIVE');
  });
});
