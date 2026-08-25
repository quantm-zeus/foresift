// AC-270 (acceptance): "Expired documentation/plan/rights/schema/deprecation
// verification moves the affected provider operation out of active
// decision-critical use until a successful official-doc and live-contract
// verification refreshes it." Injected-clock timeline over the REAL
// registry/machine/TTL services: activation → TTL lapse sweeps the
// operation out of ACTIVE → the two-source refresh pair re-arms use.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { utcTimestamp, type ClockPort } from '@foresift/domain';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import {
  LifecycleMachine,
  OperationRegistry,
  ReadinessEvaluator,
  RightsMatrixService,
  VerificationTtlService,
  type OperationDefinition,
} from '../../packages/provider-lifecycle/src/index.ts';
import { RIGHTS_TIMELINE, VERIFICATION_TIMELINE } from '../fixtures/prov/governance-scenarios.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);

function movableClock(startEpochMs: number): { clock: ClockPort; moveTo: (ms: number) => void } {
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

function definition(): OperationDefinition {
  return {
    providerId: 'ac270-prov',
    operationId: 'ac270-op',
    version: '1.0.0',
    capabilityClass: 'READ_MARKET',
    supportedChains: ['solana-mainnet'],
    inputSchemaId: 'schema/in',
    rawOutputSchemaId: 'schema/raw',
    normalizedOutputSchemaId: 'schema/norm',
    quotaModelId: 'quota/basic',
    cachePolicyId: 'cache/ttl-60s',
    timeoutMs: 5000,
    retryPolicyId: 'retry/twice',
    declaredIndependenceGroup: 'indep/g1',
    upstreamLineage: [],
    licensePolicyId: 'license/default',
    healthStatus: 'HEALTHY',
    costClass: 'FREE_QUOTA',
    estimatedQuotaUnits: 10,
    quotaResetPolicyId: 'reset/daily',
    protectedReserveEligible: false,
    allowedInStrictFree: true,
    paidFallbackAllowed: false,
    verificationExpiresAt: '2026-07-01T00:00:00Z',
    forbiddenOutputFields: [],
    negativeCapabilities: ['no-trading'],
  };
}

let db: PGlite;
let engine: DatabaseEngine;
const T0 = Date.parse(VERIFICATION_TIMELINE.t0Activation);
const clockBox = movableClock(T0);
let machine: LifecycleMachine;
let verification: VerificationTtlService;
let readiness: ReadinessEvaluator;

function evaluate() {
  return readiness.evaluate({
    providerId: 'ac270-prov',
    operationId: 'ac270-op',
    operationVersion: '1.0.0',
  });
}

async function recordPair(kind: 'PRICING_PLAN' | 'RIGHTS'): Promise<void> {
  for (const source of ['OFFICIAL_DOC', 'LIVE_CONTRACT'] as const) {
    await verification.record({
      providerId: 'ac270-prov',
      operationId: 'ac270-op',
      operationVersion: '1.0.0',
      kind,
      source,
      outcome: 'SUCCEEDED',
      evidenceRefs: [`evidence/ac270/${kind}/${source}`],
    });
  }
}

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  const registry = new OperationRegistry({ engine, clock: clockBox.clock });
  machine = new LifecycleMachine({ engine, clock: clockBox.clock });
  const rights = new RightsMatrixService({ engine, clock: clockBox.clock });
  verification = new VerificationTtlService({
    engine,
    clock: clockBox.clock,
    machine,
  });
  readiness = new ReadinessEvaluator({ engine, clock: clockBox.clock });

  await registry.registerProvider({
    providerId: 'ac270-prov',
    providerGroup: 'market-data',
    displayName: 'AC-270 Provider',
  });
  await registry.registerOperation(definition());
  await rights.declareVersion({
    providerId: 'ac270-prov',
    operationId: 'ac270-op',
    matrix: {
      commercialUseAllowed: true,
      personalResearchAllowed: true,
      cacheAllowed: true,
      maximumCacheDurationSeconds: 60,
      rawRetentionAllowed: true,
      derivedFeaturesAllowed: true,
      modelTrainingAllowed: false,
      redistributionAllowed: true,
      publicAlertDerivativeAllowed: true,
      attributionRequired: true,
      userByokRequired: false,
      rawExportAllowed: true,
      jurisdictionRestrictions: [],
      termsVersion: `terms/ac270-${RIGHTS_TIMELINE.v1ExpiresAt}`,
      verifiedAt: utcTimestamp(RIGHTS_TIMELINE.v1VerifiedAt),
      verificationExpiresAt: utcTimestamp('2026-07-01T00:00:00Z'),
    },
    actor: 'officer-a',
  });
  for (const [toState, reasonClass] of [
    ['VERIFIED', 'VERIFICATION_PROMOTED'],
    ['ACTIVE', 'ACTIVATION_APPROVED'],
  ] as const) {
    await machine.transition({
      providerId: 'ac270-prov',
      operationId: 'ac270-op',
      operationVersion: '1.0.0',
      toState,
      reasonClass,
      actor: 'acceptance',
      idempotencyKey: `ac270:${toState}`,
    });
  }
  await verification.configureTtl('ac270-prov', 'PRICING_PLAN', VERIFICATION_TIMELINE.ttlSeconds);
  await verification.configureTtl('ac270-prov', 'RIGHTS', VERIFICATION_TIMELINE.ttlSeconds);
});

afterAll(async () => {
  await db.close();
});

describe('AC-270: expiry pulls active operations from decision-critical use', () => {
  it('a fully verified ACTIVE operation is usable', async () => {
    // Evidence captured at activation (inside every TTL window).
    for (const kind of ['PRICING_PLAN', 'RIGHTS'] as const) {
      await verification.record({
        providerId: 'ac270-prov',
        operationId: 'ac270-op',
        operationVersion: '1.0.0',
        kind,
        source: 'OFFICIAL_DOC',
        outcome: 'SUCCEEDED',
        evidenceRefs: [`evidence/ac270/initial/${kind}`],
      });
    }
    expect((await evaluate()).verdict).toBe('ELIGIBLE');
  });

  it('injected-clock expiry sweeps the operation OUT of ACTIVE', async () => {
    clockBox.moveTo(Date.parse(VERIFICATION_TIMELINE.t1Lapsed));
    const sweep = await verification.sweepExpiries();
    expect(sweep.swept).toHaveLength(1);
    expect(sweep.swept[0]!.lapsedKinds.sort()).toEqual(['PRICING_PLAN', 'RIGHTS']);
    const projection = await machine.projection('ac270-prov', 'ac270-op', '1.0.0');
    expect(projection.currentState).toBe('DEGRADED');

    // Decision use is gone: readiness blocks on BOTH lapsed kinds…
    const verdict = await evaluate();
    expect(verdict.verdict).toBe('BLOCKED');
    expect(verdict.reasons.map((r) => r.code)).toEqual(['VERIFICATION_LAPSED', 'VERIFICATION_LAPSED']);
    // …and freshness itself reports EXPIRED, not MISSING.
    expect(
      (await verification.evaluate('ac270-prov', 'ac270-op', '1.0.0', 'PRICING_PLAN')).status,
    ).toBe('EXPIRED');
  });
});

describe('AC-270: the official-doc AND live-contract pair restores use', () => {
  it('the refresh pair re-arms freshness and recovery returns ACTIVE eligibility', async () => {
    clockBox.moveTo(Date.parse(VERIFICATION_TIMELINE.t2Refreshed));
    await recordPair('PRICING_PLAN');
    await recordPair('RIGHTS');

    const resume = await verification.resumeAllowedAfterLapse(
      'ac270-prov',
      'ac270-op',
      '1.0.0',
      'PRICING_PLAN',
      VERIFICATION_TIMELINE.t1Lapsed,
    );
    expect(resume.allowed).toBe(true);
    expect(resume.missingSources).toEqual([]);

    await machine.transition({
      providerId: 'ac270-prov',
      operationId: 'ac270-op',
      operationVersion: '1.0.0',
      toState: 'ACTIVE',
      reasonClass: 'RECOVERY_VERIFIED',
      actor: 'acceptance',
      idempotencyKey: 'ac270:recovery',
    });
    expect((await evaluate()).verdict).toBe('ELIGIBLE');
  });
});
