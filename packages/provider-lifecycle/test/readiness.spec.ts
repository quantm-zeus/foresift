/**
 * Activation-readiness suite (AC-272; T123): the evaluator aggregates
 * lifecycle state, migration-exception validity, rights verification,
 * verification-TTL freshness, and quarantine exposure into ELIGIBLE or
 * BLOCKED verdicts with canonically ordered typed reasons. Every gate is
 * exercised positively AND negatively (Constitution XII).
 */
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
import { AuditChain } from '@foresift/security';
import {
  LifecycleMachine,
  MigrationExceptions,
  OperationRegistry,
  ProviderAuditBridge,
  ProvErrorCode,
  ReadinessEvaluator,
  ResponseQuarantineService,
  RightsMatrixService,
  VerificationTtlService,
  type OperationDefinition,
} from '../src/index.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

const T0 = Date.parse('2026-06-01T12:00:00Z');

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

function validDefinition(overrides?: Partial<OperationDefinition>): OperationDefinition {
  return {
    providerId: 'prov-ready',
    operationId: 'op-ready',
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
let registry: OperationRegistry;
let machine: LifecycleMachine;
let rights: RightsMatrixService;
let verification: VerificationTtlService;
let exceptions: MigrationExceptions;
let quarantine: ResponseQuarantineService;
let readiness: ReadinessEvaluator;

async function seed(
  providerId: string,
  operationId: string,
  overrides?: Partial<OperationDefinition>,
): Promise<void> {
  await registry.registerProvider({
    providerId,
    providerGroup: 'market-data',
    displayName: `Provider ${providerId}`,
  });
  await registry.registerOperation(validDefinition({ providerId, operationId, ...overrides }));
}

async function activate(providerId: string, operationId: string): Promise<void> {
  for (const [toState, reasonClass] of [
    ['VERIFIED', 'VERIFICATION_PROMOTED'],
    ['ACTIVE', 'ACTIVATION_APPROVED'],
  ] as const) {
    await machine.transition({
      providerId,
      operationId,
      operationVersion: '1.0.0',
      toState,
      reasonClass,
      actor: 'test',
      idempotencyKey: `ready:${providerId}:${operationId}:${toState}`,
    });
  }
}

function freshMatrix() {
  return {
    commercialUseAllowed: true,
    personalResearchAllowed: true,
    cacheAllowed: false,
    maximumCacheDurationSeconds: null,
    rawRetentionAllowed: false,
    derivedFeaturesAllowed: true,
    modelTrainingAllowed: false,
    redistributionAllowed: false,
    publicAlertDerivativeAllowed: true,
    attributionRequired: true,
    userByokRequired: false,
    rawExportAllowed: false,
    jurisdictionRestrictions: [] as string[],
    termsVersion: 'terms/ready',
    verifiedAt: utcTimestamp('2026-06-01T00:00:00Z'),
    verificationExpiresAt: utcTimestamp('2026-07-01T00:00:00Z'),
  };
}

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  const chain = new AuditChain({ engine });
  const bridge = new ProviderAuditBridge({ chain });
  registry = new OperationRegistry({ engine, clock });
  machine = new LifecycleMachine({ engine, clock });
  rights = new RightsMatrixService({ engine, clock, audit: bridge });
  verification = new VerificationTtlService({ engine, clock });
  exceptions = new MigrationExceptions({ engine, clock });
  quarantine = new ResponseQuarantineService({ engine, clock, audit: bridge });
  readiness = new ReadinessEvaluator({ engine, clock });
});

afterAll(async () => {
  await db.close();
});

describe('single-gate verdicts', () => {
  it('unknown operations block with exactly OPERATION_UNKNOWN', async () => {
    const verdict = await readiness.evaluate({
      providerId: 'ghost',
      operationId: 'ghost-op',
      operationVersion: '9.9.9',
    });
    expect(verdict.verdict).toBe('BLOCKED');
    expect(verdict.reasons.map((r) => r.code)).toEqual(['OPERATION_UNKNOWN']);
  });

  it('DISCOVERED state blocks before activation', async () => {
    await seed('prov-disc', 'op-disc');
    const verdict = await readiness.evaluate({
      providerId: 'prov-disc',
      operationId: 'op-disc',
      operationVersion: '1.0.0',
    });
    expect(verdict.verdict).toBe('BLOCKED');
    expect(verdict.reasons.map((r) => r.code)).toEqual([
      'LIFECYCLE_STATE_BLOCKING',
      'RIGHTS_UNVERIFIED',
    ]);
  });
});

describe('path to ELIGIBLE', () => {
  it('an ACTIVE op with fresh rights and no configured verifications is ELIGIBLE', async () => {
    await seed('prov-ok', 'op-ok');
    await activate('prov-ok', 'op-ok');
    await rights.declareVersion({
      providerId: 'prov-ok',
      operationId: 'op-ok',
      matrix: freshMatrix(),
      actor: 'officer-a',
    });
    expect(
      (
        await readiness.evaluate({
          providerId: 'prov-ok',
          operationId: 'op-ok',
          operationVersion: '1.0.0',
        })
      ).verdict,
    ).toBe('ELIGIBLE');
  });

  it('a configured-but-unproven kind blocks; recording success re-arms eligibility', async () => {
    await verification.configureTtl('prov-ok', 'PRICING_PLAN', 3600);
    let verdict = await readiness.evaluate({
      providerId: 'prov-ok',
      operationId: 'op-ok',
      operationVersion: '1.0.0',
    });
    expect(verdict.reasons.map((r) => r.code)).toEqual(['VERIFICATION_LAPSED']);

    await verification.record({
      providerId: 'prov-ok',
      operationId: 'op-ok',
      operationVersion: '1.0.0',
      kind: 'PRICING_PLAN',
      source: 'OFFICIAL_DOC',
      outcome: 'SUCCEEDED',
      evidenceRefs: ['pricing/prov-ok-free-tier'],
    });
    verdict = await readiness.evaluate({
      providerId: 'prov-ok',
      operationId: 'op-ok',
      operationVersion: '1.0.0',
    });
    expect(verdict.verdict).toBe('ELIGIBLE');

    // …and the instant the TTL lapses, the same evaluation blocks again.
    moveTo(T0 + 3601_000);
    verdict = await readiness.evaluate({
      providerId: 'prov-ok',
      operationId: 'op-ok',
      operationVersion: '1.0.0',
    });
    expect(verdict.reasons[0]).toMatchObject({ code: 'VERIFICATION_LAPSED' });
    moveTo(T0);
  });

  it('expired rights windows block; a fresh declaration restores eligibility', async () => {
    moveTo(Date.parse('2026-07-02T00:00:00Z'));
    const blocked = await readiness.evaluate({
      providerId: 'prov-ok',
      operationId: 'op-ok',
      operationVersion: '1.0.0',
    });
    expect(blocked.reasons.map((r) => r.code)).toContain('RIGHTS_UNVERIFIED');

    // Re-declare with a CURRENT window (verification evidence is new too).
    await verification.record({
      providerId: 'prov-ok',
      operationId: 'op-ok',
      operationVersion: '1.0.0',
      kind: 'PRICING_PLAN',
      source: 'OFFICIAL_DOC',
      outcome: 'SUCCEEDED',
      evidenceRefs: ['pricing/prov-ok-refreshed'],
    });
    await rights.declareVersion({
      providerId: 'prov-ok',
      operationId: 'op-ok',
      matrix: {
        ...freshMatrix(),
        verifiedAt: utcTimestamp('2026-07-02T00:00:00Z'),
        verificationExpiresAt: utcTimestamp('2026-08-01T00:00:00Z'),
      },
      actor: 'officer-b',
    });
    const eligible = await readiness.evaluate({
      providerId: 'prov-ok',
      operationId: 'op-ok',
      operationVersion: '1.0.0',
    });
    expect(eligible.verdict).toBe('ELIGIBLE');
    moveTo(T0);
  });
});

describe('deprecation and exception interplay (FR-PROV-003)', () => {
  it('deprecated operations block until a valid exception exists', async () => {
    await seed('prov-dep', 'op-dep', {
      capabilityClass: 'READ_TRANSACTION_RAW',
      deprecatedAt: utcTimestamp('2026-05-01T00:00:00Z'),
      sunsetAt: utcTimestamp('2026-09-01T00:00:00Z'),
    });
    await activate('prov-dep', 'op-dep');
    await rights.declareVersion({
      providerId: 'prov-dep',
      operationId: 'op-dep',
      matrix: freshMatrix(),
      actor: 'officer-a',
    });
    // Walk through DEPRECATED explicitly so the projection matches the flag.
    await machine.transition({
      providerId: 'prov-dep',
      operationId: 'op-dep',
      operationVersion: '1.0.0',
      toState: 'DEPRECATED',
      reasonClass: 'DEPRECATION_MARKED',
      actor: 'test',
      idempotencyKey: 'ready:dep-mark',
    });

    const blocked = await readiness.evaluate({
      providerId: 'prov-dep',
      operationId: 'op-dep',
      operationVersion: '1.0.0',
    });
    expect(blocked.reasons.map((r) => r.code)).toEqual(['DEPRECATED_WITHOUT_EXCEPTION']);

    await exceptions.grant({
      providerId: 'prov-dep',
      operationId: 'op-dep',
      approver: 'operator-a',
      replacementPlanRef: 'plan/migrate-off-deprecated-path',
      exceptionExpiresAt: utcTimestamp('2026-06-15T00:00:00Z'),
      evidenceRefs: ['ticket/migration-window'],
    });
    const eligible = await readiness.evaluate({
      providerId: 'prov-dep',
      operationId: 'op-dep',
      operationVersion: '1.0.0',
    });
    expect(eligible.verdict).toBe('ELIGIBLE');

    // Exception lapse re-blocks — validity is evaluated AT the instant.
    moveTo(Date.parse('2026-06-15T00:00:01Z'));
    const relapsed = await readiness.evaluate({
      providerId: 'prov-dep',
      operationId: 'op-dep',
      operationVersion: '1.0.0',
    });
    expect(relapsed.reasons.map((r) => r.code)).toEqual(['DEPRECATED_WITHOUT_EXCEPTION']);
    moveTo(T0);
  });
});

describe('quarantine exposure and aggregate ordering', () => {
  it('a quarantined malicious response blocks an otherwise-eligible operation', async () => {
    await quarantine.screenResponse({
      providerId: 'prov-ok',
      operationId: 'op-ok',
      bodyText: JSON.stringify({ privateKeyField: 'hazard' }),
    });
    const verdict = await readiness.evaluate({
      providerId: 'prov-ok',
      operationId: 'op-ok',
      operationVersion: '1.0.0',
    });
    expect(verdict.reasons.map((r) => r.code)).toEqual(['QUARANTINED_EXPOSURE']);
  });

  it('multiple simultaneous failures list EVERY reason in canonical order', async () => {
    await seed('prov-mess', 'op-mess', {
      deprecatedAt: utcTimestamp('2026-05-01T00:00:00Z'),
    });
    await verification.configureTtl('prov-mess', 'PRICING_PLAN', 60);
    await quarantine.screenResponse({
      providerId: 'prov-mess',
      operationId: 'op-mess',
      bodyText: JSON.stringify({ signMessageUrl: 'https://x' }),
    });
    const verdict = await readiness.evaluate({
      providerId: 'prov-mess',
      operationId: 'op-mess',
      operationVersion: '1.0.0',
    });
    expect(verdict.verdict).toBe('BLOCKED');
    expect(verdict.reasons.map((r) => r.code)).toEqual([
      'LIFECYCLE_STATE_BLOCKING',
      'DEPRECATED_WITHOUT_EXCEPTION',
      'RIGHTS_UNVERIFIED',
      'VERIFICATION_LAPSED',
      'QUARANTINED_EXPOSURE',
    ]);
  });

  it('empty identities refuse at the input gate', async () => {
    await expect(
      readiness.evaluate({ providerId: '', operationId: 'x', operationVersion: '1' }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_READINESS_INPUT_INVALID });
  });
});
