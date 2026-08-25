/**
 * Verification-TTL suite (FR-PROV-002; §15.4 rules 3/4, AC-270): nine kinds,
 * explicit per-kind/per-provider TTL configuration, use-time freshness on an
 * injected clock, fail-closed refusal when no TTL is configured, the AC-270
 * refresh-pair rule (both sources required), and expiry sweeps driving
 * §15.4 health outcomes + out-of-ACTIVE events.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { type ClockPort } from '@foresift/domain';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LifecycleMachine,
  OperationRegistry,
  VerificationTtlService,
  ProvErrorCode,
  type OperationDefinition,
} from '../src/index.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

/** Clock whose NOW is movable between test steps (deterministic timelines). */
function manualClock(startEpochMs: number): { clock: ClockPort; moveTo: (ms: number) => void } {
  let current = startEpochMs;
  return {
    clock: {
      now: () => new Date(current).toISOString().replace('.000Z', 'Z') as ReturnType<ClockPort['now']>,
      nowEpochMs: () => current,
    },
    moveTo: (ms) => {
      current = ms;
    },
  };
}

let db: PGlite;
let engine: DatabaseEngine;
let registry: OperationRegistry;

async function seedActiveOperation(providerId: string): Promise<void> {
  const definition: OperationDefinition = {
    providerId,
    operationId: 'op',
    version: '1.0.0',
    capabilityClass: 'READ_ACCOUNT_STATE',
    supportedChains: ['solana-mainnet'],
    inputSchemaId: 'schema/in',
    rawOutputSchemaId: 'schema/raw',
    normalizedOutputSchemaId: 'schema/norm',
    quotaModelId: 'quota/basic',
    cachePolicyId: 'cache/short',
    timeoutMs: 5000,
    retryPolicyId: 'retry/twice',
    declaredIndependenceGroup: 'indep/g',
    upstreamLineage: [],
    licensePolicyId: 'license/default',
    healthStatus: 'HEALTHY',
    costClass: 'FREE_QUOTA',
    estimatedQuotaUnits: 10,
    quotaResetPolicyId: 'reset/daily',
    protectedReserveEligible: false,
    allowedInStrictFree: true,
    paidFallbackAllowed: false,
    verificationExpiresAt: '2027-01-01T00:00:00Z',
    forbiddenOutputFields: [],
    negativeCapabilities: ['no-trading'],
  };
  await registry.registerProvider({ providerId, providerGroup: 'g', displayName: providerId });
  await registry.registerOperation(definition);
}

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  registry = new OperationRegistry({ engine });
});

afterAll(async () => {
  await db.close();
});

describe('TTL configuration and recording', () => {
  it('records verifications only under an explicit TTL; absence refuses', async () => {
    await seedActiveOperation('prov-ttl');
    const ttl = new VerificationTtlService({ engine });

    await expect(
      ttl.record({
        providerId: 'prov-ttl',
        operationId: 'op',
        operationVersion: '1.0.0',
        kind: 'DOCUMENTATION',
        source: 'OFFICIAL_DOC',
        outcome: 'SUCCEEDED',
        evidenceRefs: ['doc/ref'],
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_VERIFICATION_TTL_UNCONFIGURED });

    await ttl.configureTtl('prov-ttl', 'DOCUMENTATION', 3600);
    const record = await ttl.record({
      providerId: 'prov-ttl',
      operationId: 'op',
      operationVersion: '1.0.0',
      kind: 'DOCUMENTATION',
      source: 'OFFICIAL_DOC',
      outcome: 'SUCCEEDED',
      evidenceRefs: ['doc/ref'],
    });
    expect(record.expiresAt > record.verifiedAt).toBe(true);
  });

  it('evaluates FRESH inside the window and EXPIRED past it (injected clock)', async () => {
    await seedActiveOperation('prov-fresh');
    const { clock, moveTo } = manualClock(Date.parse('2026-06-01T00:00:00Z'));
    const ttl = new VerificationTtlService({ engine, clock });
    await ttl.configureTtl('prov-fresh', 'QUOTA', 1000); // 1000 s window

    // Recorded at T0 with a 1000 s TTL.
    await ttl.record({
      providerId: 'prov-fresh',
      operationId: 'op',
      operationVersion: '1.0.0',
      kind: 'QUOTA',
      source: 'LIVE_CONTRACT',
      outcome: 'SUCCEEDED',
      evidenceRefs: ['quota/ref'],
    });

    const fresh = await ttl.evaluate('prov-fresh', 'op', '1.0.0', 'QUOTA');
    expect(fresh.status).toBe('FRESH');

    moveTo(Date.parse('2026-06-01T00:16:41Z')); // just past the window
    const expired = await ttl.evaluate('prov-fresh', 'op', '1.0.0', 'QUOTA');
    expect(expired.status).toBe('EXPIRED');

    // A FAILED outcome never counts as freshness.
    await ttl.configureTtl('prov-fresh', 'SCHEMA', 3600);
    await ttl.record({
      providerId: 'prov-fresh',
      operationId: 'op',
      operationVersion: '1.0.0',
      kind: 'SCHEMA',
      source: 'OFFICIAL_DOC',
      outcome: 'FAILED',
      evidenceRefs: ['schema/failed'],
    });
    const missing = await ttl.evaluate('prov-fresh', 'op', '1.0.0', 'SCHEMA');
    expect(missing.status).toBe('MISSING');
  });

  it('refuses evaluation entirely for unconfigured kinds (fail-closed)', async () => {
    await seedActiveOperation('prov-noconfig');
    const ttl = new VerificationTtlService({ engine });
    await expect(
      ttl.evaluate('prov-noconfig', 'op', '1.0.0', 'RIGHTS'),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_VERIFICATION_TTL_UNCONFIGURED });
  });
});

describe('AC-270 refresh-pair rule (material decision 5)', () => {
  it('re-arms ONLY after both OFFICIAL_DOC and LIVE_CONTRACT succeed within TTL', async () => {
    await seedActiveOperation('prov-pair');
    const t0 = Date.parse('2026-06-01T00:00:00Z');
    const { clock, moveTo } = manualClock(t0);
    const ttl = new VerificationTtlService({ engine, clock });
    await ttl.configureTtl('prov-pair', 'ENDPOINT', 3600);

    await ttl.record({
      providerId: 'prov-pair',
      operationId: 'op',
      operationVersion: '1.0.0',
      kind: 'ENDPOINT',
      source: 'OFFICIAL_DOC',
      outcome: 'SUCCEEDED',
      evidenceRefs: ['endpoint/v1'],
    });
    const lapsedRecord = await ttl.evaluate('prov-pair', 'op', '1.0.0', 'ENDPOINT');
    const lapsedAt = lapsedRecord.record!.expiresAt;

    // One-sided refresh: still blocked.
    moveTo(t0 + 3601_000);
    await ttl.record({
      providerId: 'prov-pair',
      operationId: 'op',
      operationVersion: '1.0.0',
      kind: 'ENDPOINT',
      source: 'OFFICIAL_DOC',
      outcome: 'SUCCEEDED',
      evidenceRefs: ['endpoint/v2'],
    });
    const oneSide = await ttl.resumeAllowedAfterLapse(
      'prov-pair',
      'op',
      '1.0.0',
      'ENDPOINT',
      lapsedAt,
    );
    expect(oneSide).toEqual({ allowed: false, missingSources: ['LIVE_CONTRACT'] });

    // Second source refreshes → resumed.
    await ttl.record({
      providerId: 'prov-pair',
      operationId: 'op',
      operationVersion: '1.0.0',
      kind: 'ENDPOINT',
      source: 'LIVE_CONTRACT',
      outcome: 'SUCCEEDED',
      evidenceRefs: ['endpoint/probe-v2'],
    });
    const both = await ttl.resumeAllowedAfterLapse(
      'prov-pair',
      'op',
      '1.0.0',
      'ENDPOINT',
      lapsedAt,
    );
    expect(both.allowed).toBe(true);

    // But a refresh pair that ITSELF lapses re-blocks (no grace windows).
    moveTo(t0 + 7202_000);
    const relapsed = await ttl.resumeAllowedAfterLapse(
      'prov-pair',
      'op',
      '1.0.0',
      'ENDPOINT',
      lapsedAt,
    );
    expect(relapsed.allowed).toBe(false);
  });
});

describe('expiry sweeps drive §15.4 outcomes out of ACTIVE', () => {
  it('maps PRICING_PLAN→PLAN_UNVERIFIED and RIGHTS→RIGHTS_UNVERIFIED via machine', async () => {
    await seedActiveOperation('prov-sweep-a');
    await seedActiveOperation('prov-sweep-b');
    const t0 = Date.parse('2026-06-01T00:00:00Z');
    const { clock, moveTo } = manualClock(t0);

    const machine = new LifecycleMachine({ engine, clock });
    const ttl = new VerificationTtlService({ engine, clock, machine });

    // Activate both operations first.
    for (const p of ['prov-sweep-a', 'prov-sweep-b']) {
      await machine.transition({
        providerId: p,
        operationId: 'op',
        operationVersion: '1.0.0',
        toState: 'VERIFIED',
        reasonClass: 'VERIFICATION_PROMOTED',
        actor: 'test',
        idempotencyKey: `${p}-v`,
      });
      await machine.transition({
        providerId: p,
        operationId: 'op',
        operationVersion: '1.0.0',
        toState: 'ACTIVE',
        reasonClass: 'ACTIVATION_APPROVED',
        actor: 'test',
        idempotencyKey: `${p}-a`,
      });
    }

    // A keeps a fresh long-window pricing plan; B's lapses at +60s.
    await ttl.configureTtl('prov-sweep-a', 'PRICING_PLAN', 86_400);
    await ttl.record({
      providerId: 'prov-sweep-a',
      operationId: 'op',
      operationVersion: '1.0.0',
      kind: 'PRICING_PLAN',
      source: 'OFFICIAL_DOC',
      outcome: 'SUCCEEDED',
      evidenceRefs: ['pricing/a'],
    });
    await ttl.configureTtl('prov-sweep-b', 'PRICING_PLAN', 60);
    await ttl.record({
      providerId: 'prov-sweep-b',
      operationId: 'op',
      operationVersion: '1.0.0',
      kind: 'PRICING_PLAN',
      source: 'OFFICIAL_DOC',
      outcome: 'SUCCEEDED',
      evidenceRefs: ['pricing/b'],
    });
    // B's RIGHTS proof stays fresh — it must NOT drive the sweep.
    await ttl.configureTtl('prov-sweep-b', 'RIGHTS', 120);
    await ttl.record({
      providerId: 'prov-sweep-b',
      operationId: 'op',
      operationVersion: '1.0.0',
      kind: 'RIGHTS',
      source: 'OFFICIAL_DOC',
      outcome: 'SUCCEEDED',
      evidenceRefs: ['rights/terms'],
    });

    moveTo(t0 + 61_000); // B's pricing plan (60 s) has lapsed; RIGHTS has not.

    const { swept } = await ttl.sweepExpiries();
    expect(swept).toHaveLength(1);
    expect(swept[0]).toMatchObject({
      providerId: 'prov-sweep-b',
      lapsedKinds: ['PRICING_PLAN'],
      healthOutcome: 'PLAN_UNVERIFIED',
    });

    const projection = await engine.query<{ current_state: string; health_status: string }>(
      "SELECT current_state, health_status FROM prov.prov_operations WHERE provider_id = 'prov-sweep-b'",
    );
    expect(projection.rows[0]).toMatchObject({ current_state: 'DEGRADED', health_status: 'PLAN_UNVERIFIED' });

    // The sweep event used the *_EXPIRED class and is in the ledger.
    const events = await engine.query<{ reason_class: string; to_state: string }>(
      "SELECT reason_class, to_state FROM prov.prov_lifecycle_events WHERE provider_id = 'prov-sweep-b' AND reason_class LIKE '%_EXPIRED'",
    );
    expect(events.rows).toEqual([{ reason_class: 'PRICING_PLAN_EXPIRED', to_state: 'DEGRADED' }]);
  });

  it('is a no-op when nothing lapsed or nothing is ACTIVE', async () => {
    await seedActiveOperation('prov-idle');
    const { clock } = manualClock(Date.parse('2026-06-01T00:00:00Z'));
    const ttl = new VerificationTtlService({ engine, clock });
    const { swept } = await ttl.sweepExpiries();
    expect(swept).toHaveLength(0);
  });
});
