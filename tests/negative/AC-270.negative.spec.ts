// AC-270 (negative): refresh-pair and exception-validity mutations ATTEMPTED
// and REFUSED. A single-source refresh never re-arms; refreshing the WRONG
// kind satisfies nothing; stale pre-expiry evidence is excluded by the
// lapsedAt fence; a lapsed migration exception re-blocks instantly.
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
  MigrationExceptions,
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

const T0 = Date.parse('2026-06-01T00:00:00Z');

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

function definition(overrides?: Partial<OperationDefinition>): OperationDefinition {
  return {
    providerId: 'ac270n-prov',
    operationId: 'ac270n-op',
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
    ...overrides,
  };
}

let db: PGlite;
let engine: DatabaseEngine;
const { clock, moveTo } = movableClock(T0);
let verification: VerificationTtlService;
let exceptions: MigrationExceptions;
let readiness: ReadinessEvaluator;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  const registry = new OperationRegistry({ engine, clock });
  await registry.registerProvider({
    providerId: 'ac270n-prov',
    providerGroup: 'market-data',
    displayName: 'AC-270 Negative Provider',
  });
  await registry.registerOperation(
    definition({
      deprecatedAt: utcTimestamp('2026-05-15T00:00:00Z'),
      sunsetAt: utcTimestamp('2026-09-01T00:00:00Z'),
    }),
  );
  // Minimal rights posture so readiness isolates the gates under test.
  await new RightsMatrixService({ engine, clock }).declareVersion({
    providerId: 'ac270n-prov',
    operationId: 'ac270n-op',
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
      termsVersion: 'terms/ac270n',
      verifiedAt: utcTimestamp('2026-06-01T00:00:00Z'),
      verificationExpiresAt: utcTimestamp('2026-08-01T00:00:00Z'),
    },
    actor: 'officer-a',
  });
  verification = new VerificationTtlService({ engine, clock });
  exceptions = new MigrationExceptions({ engine, clock });
  readiness = new ReadinessEvaluator({ engine, clock });
});

afterAll(async () => {
  await db.close();
});

function resume(kind: 'PRICING_PLAN' | 'RIGHTS', lapsedAt: string) {
  return verification.resumeAllowedAfterLapse('ac270n-prov', 'ac270n-op', '1.0.0', kind, lapsedAt);
}

async function recordOne(input: {
  kind: 'PRICING_PLAN' | 'RIGHTS';
  source: 'OFFICIAL_DOC' | 'LIVE_CONTRACT';
  verifiedAt?: string;
}): Promise<void> {
  await verification.record({
    providerId: 'ac270n-prov',
    operationId: 'ac270n-op',
    operationVersion: '1.0.0',
    kind: input.kind,
    source: input.source,
    outcome: 'SUCCEEDED',
    evidenceRefs: [`evidence/ac270n/${input.kind}/${input.source}`],
    ...(input.verifiedAt !== undefined ? { verifiedAt: input.verifiedAt } : {}),
  });
}

describe('AC-270 negative: partial and wrong refreshes are refused', () => {
  it('a SINGLE-source refresh after lapse never re-arms use', async () => {
    await verification.configureTtl('ac270n-prov', 'PRICING_PLAN', 3600);
    await recordOne({ kind: 'PRICING_PLAN', source: 'OFFICIAL_DOC', verifiedAt: utcTimestamp('2026-06-01T00:10:00Z') });
    moveTo(Date.parse('2026-06-01T02:00:00Z')); // lapse
    await recordOne({ kind: 'PRICING_PLAN', source: 'OFFICIAL_DOC' }); // one-sided refresh

    const verdict = await resume('PRICING_PLAN', '2026-06-01T02:00:00Z');
    expect(verdict.allowed).toBe(false);
    expect(verdict.missingSources).toEqual(['LIVE_CONTRACT']);
    expect((await verification.evaluate('ac270n-prov', 'ac270n-op', '1.0.0', 'PRICING_PLAN')).status).toBe('FRESH');
    // Freshness of ONE source ≠ permission to resume: the pair rule holds.
  });

  it('refreshing the WRONG kind leaves the lapsed kind blocked', async () => {
    await verification.configureTtl('ac270n-prov', 'RIGHTS', 3600);
    await recordOne({ kind: 'RIGHTS', source: 'OFFICIAL_DOC', verifiedAt: utcTimestamp('2026-06-01T00:20:00Z') });
    moveTo(Date.parse('2026-06-01T03:00:00Z')); // RIGHTS lapsed too
    // Full PRICING_PLAN pair recorded — irrelevant to RIGHTS freshness.
    await recordOne({ kind: 'PRICING_PLAN', source: 'OFFICIAL_DOC' });
    await recordOne({ kind: 'PRICING_PLAN', source: 'LIVE_CONTRACT' });

    expect((await verification.evaluate('ac270n-prov', 'ac270n-op', '1.0.0', 'RIGHTS')).status).toBe('EXPIRED');
    const verdict = await resume('RIGHTS', '2026-06-01T03:00:00Z');
    expect(verdict.allowed).toBe(false);
    expect(verdict.missingSources.sort()).toEqual(['LIVE_CONTRACT', 'OFFICIAL_DOC']);
    moveTo(T0);
  });

  it('stale PRE-expiry success does not satisfy the post-lapse resume check', async () => {
    // The only OFFICIAL_DOC success predates the lapse instant.
    const verdict = await resume('PRICING_PLAN', '2026-06-01T05:00:00Z');
    expect(verdict.allowed).toBe(false);
    // Even though its TTL window is technically still open at now:
    expect((await verification.evaluate('ac270n-prov', 'ac270n-op', '1.0.0', 'PRICING_PLAN')).status).toBe('FRESH');
  });
});

describe('AC-270 negative: migration exceptions lapse hard', () => {
  it('a deprecated operation blocks again the instant its exception expires', async () => {
    moveTo(Date.parse('2026-06-01T04:00:00Z'));
    await exceptions.grant({
      providerId: 'ac270n-prov',
      operationId: 'ac270n-op',
      approver: 'operator-a',
      replacementPlanRef: 'plan/ac270n-migration',
      exceptionExpiresAt: utcTimestamp('2026-07-01T00:00:00Z'),
      evidenceRefs: ['ticket/ac270n'],
    });
    // Rights fresh until 2026-08-01; no verification kinds configured for
    // this evaluation beyond PRICING_PLAN/RIGHTS — configure none extra.
    // The deprecation gate is satisfied by the valid exception…
    const withException = await readiness.evaluate({
      providerId: 'ac270n-prov',
      operationId: 'ac270n-op',
      operationVersion: '1.0.0',
    });
    expect(withException.reasons.map((r) => r.code)).not.toContain('DEPRECATED_WITHOUT_EXCEPTION');

    // …and the moment it lapses the gate re-blocks with the typed reason.
    moveTo(Date.parse('2026-07-01T00:00:01Z'));
    const afterLapse = await readiness.evaluate({
      providerId: 'ac270n-prov',
      operationId: 'ac270n-op',
      operationVersion: '1.0.0',
    });
    expect(afterLapse.verdict).toBe('BLOCKED');
    expect(afterLapse.reasons.map((r) => r.code)).toContain('DEPRECATED_WITHOUT_EXCEPTION');
    moveTo(T0);
  });
});
