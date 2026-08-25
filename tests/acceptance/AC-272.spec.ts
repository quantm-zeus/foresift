// AC-272 (acceptance): fully verified rights + healthy lifecycle + zero
// prohibited exposure yields ELIGIBLE activation readiness for the future
// workspace/public gate. The positive path exercises every contributing
// subsystem through its real service at one injected instant.
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
    providerId: 'ac272-prov',
    operationId: 'ac272-op',
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

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
});

afterAll(async () => {
  await db.close();
});

describe('AC-272: every gate green → ELIGIBLE', () => {
  it('a fully verified operation evaluates ELIGIBLE with zero reasons', async () => {
    const T0 = Date.parse('2026-06-01T00:00:00Z');
    const clockBox = movableClock(T0);
    const registry = new OperationRegistry({ engine, clock: clockBox.clock });
    const machine = new LifecycleMachine({ engine, clock: clockBox.clock });
    const rights = new RightsMatrixService({ engine, clock: clockBox.clock });
    const verification = new VerificationTtlService({ engine, clock: clockBox.clock });
    const readiness = new ReadinessEvaluator({ engine, clock: clockBox.clock });

    await registry.registerProvider({
      providerId: 'ac272-prov',
      providerGroup: 'market-data',
      displayName: 'AC-272 Provider',
    });
    await registry.registerOperation(definition());

    // Healthy lifecycle through the real machine.
    for (const [toState, reasonClass] of [
      ['VERIFIED', 'VERIFICATION_PROMOTED'],
      ['ACTIVE', 'ACTIVATION_APPROVED'],
    ] as const) {
      await machine.transition({
        providerId: 'ac272-prov',
        operationId: 'ac272-op',
        operationVersion: '1.0.0',
        toState,
        reasonClass,
        actor: 'acceptance',
        idempotencyKey: `ac272:${toState}`,
      });
    }

    // Rights declared with a window open well past the evaluation instant.
    await rights.declareVersion({
      providerId: 'ac272-prov',
      operationId: 'ac272-op',
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
        termsVersion: 'terms/ac272',
        verifiedAt: utcTimestamp('2026-06-01T00:00:00Z'),
        verificationExpiresAt: utcTimestamp('2026-07-01T00:00:00Z'),
      },
      actor: 'officer-a',
    });

    // Every verification kind this provider declares policy for is fresh.
    for (const kind of ['PRICING_PLAN', 'RIGHTS', 'SCHEMA'] as const) {
      await verification.configureTtl('ac272-prov', kind, 3600);
      for (const source of ['OFFICIAL_DOC', 'LIVE_CONTRACT'] as const) {
        await verification.record({
          providerId: 'ac272-prov',
          operationId: 'ac272-op',
          operationVersion: '1.0.0',
          kind,
          source,
          outcome: 'SUCCEEDED',
          evidenceRefs: [`evidence/ac272/${kind}/${source}`],
        });
      }
    }
    // Zero quarantined exposure: nothing was ever screened malicious.

    const verdict = await readiness.evaluate({
      providerId: 'ac272-prov',
      operationId: 'ac272-op',
      operationVersion: '1.0.0',
    });
    expect(verdict.verdict).toBe('ELIGIBLE');
    expect(verdict.reasons).toEqual([]);
  });
});
