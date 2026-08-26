/**
 * AC-270 acceptance (positive).
 * Traces: FR-PROV-002, FR-PROV-003, FR-PROV-001.
 * AC text (manifest, abridged): an ACTIVE operation whose documentation/
 * rights/schema verification EXPIRES under an injected clock moves OUT of
 * active decision-critical use; refreshing BOTH official-doc AND
 * live-contract sources restores that use.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { utcTimestamp, type ClockPort } from '@foresift/domain';
import {
  LifecycleMachine,
  OperationRegistry,
  VerificationTtlEngine,
  REQUIRED_NEGATIVE_CAPABILITIES,
  ProvErrorCode,
  expiryHealthFor,
} from '@foresift/provider-lifecycle';
import type { OperationDefinition, OperationTarget, ProviderVerificationKind } from '@foresift/provider-lifecycle';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';

const TARGET: OperationTarget = { providerId: 'ac270-provider', operationId: 'op-ac270', version: 'v1' };
const KINDS: readonly ProviderVerificationKind[] = ['DOCUMENTATION', 'RIGHTS', 'SCHEMA'];
const TTL_SECONDS = 2_678_400; // 31 days

/** Mutable injected clock — suites move wall time by mutating `nowRef.iso`. */
const nowRef = { iso: '2026-01-10T00:00:00Z' };
const clock: ClockPort = {
  now: () => utcTimestamp(nowRef.iso),
  nowEpochMs: () => Date.parse(nowRef.iso),
};

let tdb: TestDatabase;
let registry: OperationRegistry;
let machine: LifecycleMachine;
let ttl: VerificationTtlEngine;

function definition(overrides: Partial<OperationDefinition> = {}): OperationDefinition {
  return {
    providerId: TARGET.providerId,
    operationId: TARGET.operationId,
    version: 'v1',
    capabilityClass: 'READ_MARKET',
    costClass: 'FREE_UNMETERED',
    supportedChains: ['solana'],
    supportedPrograms: [],
    inputSchemaId: 'in@1',
    rawOutputSchemaId: 'raw@1',
    normalizedOutputSchemaId: 'norm@1',
    quotaModelId: 'qm@1',
    cachePolicyId: 'cp@1',
    timeoutMs: 1000,
    retryPolicyId: 'rp@1',
    declaredIndependenceGroup: 'group-ac270',
    upstreamLineage: [],
    licensePolicyId: 'lic@1',
    estimatedQuotaUnits: 0,
    quotaResetPolicyId: 'qrp@1',
    batchCapability: null,
    minimumCandidateStage: null,
    protectedReserveEligible: false,
    allowedInStrictFree: false,
    paidFallbackAllowed: false,
    deprecatedAt: null,
    sunsetAt: null,
    replacementOperationId: null,
    verificationExpiresAt: utcTimestamp('2020-01-01T00:00:00Z'),
    forbiddenOutputFields: [],
    negativeCapabilities: [...REQUIRED_NEGATIVE_CAPABILITIES],
    ...overrides,
  };
}

/**
 * Records one fresh OFFICIAL_DOC+LIVE_CONTRACT pair. The window defaults to
 * [now, now+TTL] — strictly ordered at ANY injected clock instant — but the
 * initial seeding pins the expiry so the later expiry step lands mid-window.
 */
async function recordPair(kind: ProviderVerificationKind, window?: { expiresAt?: string }): Promise<void> {
  const expiresAt = utcTimestamp(
    window?.expiresAt ?? new Date(clock.nowEpochMs() + TTL_SECONDS * 1000).toISOString(),
  );
  for (const source of ['OFFICIAL_DOC', 'LIVE_CONTRACT'] as const) {
    await ttl.recordVerification({
      target: TARGET,
      kind,
      source,
      outcome: 'PASSED',
      verifiedAt: utcTimestamp(nowRef.iso),
      expiresAt,
      evidenceRefs: [`evidence:${kind}:${source}`],
    });
  }
}

beforeAll(async () => {
  tdb = await makeTestDatabase();
  registry = new OperationRegistry(tdb.engine, clock);
  machine = new LifecycleMachine({ engine: tdb.engine, clock });
  ttl = new VerificationTtlEngine({ engine: tdb.engine, clock, machine });
  await registry.registerProvider({
    providerId: TARGET.providerId,
    displayName: 'AC-270 provider',
    providerGroup: 'acceptance',
  });
  await registry.registerOperation(definition());
  await machine.transition({ target: TARGET, toState: 'VERIFIED', reasonClass: 'VERIFICATION_PASSED', actor: 'ac270' });
  for (const kind of KINDS) {
    await ttl.configureTtl({ kind, ttlSeconds: TTL_SECONDS });
    await recordPair(kind, { expiresAt: '2026-02-01T00:00:00Z' });
  }
  await machine.transition({ target: TARGET, toState: 'ACTIVE', reasonClass: 'ACTIVATION', actor: 'ac270' });
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('AC-270 refresh-pair lifecycle', () => {
  it('allows active decision use while both sources are fresh (pre-expiry)', async () => {
    nowRef.iso = '2026-01-31T23:59:59Z';
    for (const kind of KINDS) {
      const freshness = await ttl.assertActiveUseAllowed(TARGET, kind);
      expect(freshness.pairFresh).toBe(true);
    }
    expect((await registry.getOperation(TARGET)).currentState).toBe('ACTIVE');
  });

  it('injected-clock expiry moves the operation out of active decision-critical use', async () => {
    nowRef.iso = '2026-02-01T00:00:01Z'; // one second past the window
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
      await recordPair(kind); // fresh windows from the NEW clock instant
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
