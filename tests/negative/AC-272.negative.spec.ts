// AC-272 (negative): each failing gate HOLDS the workspace/public gate BLOCKED
// with its typed reason — rights-unverified, expired-verification,
// deprecated-without-valid-exception, and prohibited (quarantine) exposure.
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
import { AuditChain } from '../../packages/security/src/index.ts';
import {
  LifecycleMachine,
  MigrationExceptions,
  OperationRegistry,
  ProviderAuditBridge,
  ReadinessEvaluator,
  ResponseQuarantineService,
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

function definition(providerId: string, overrides?: Partial<OperationDefinition>): OperationDefinition {
  return {
    providerId,
    operationId: 'op',
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

function permissiveMatrix() {
  return {
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
    jurisdictionRestrictions: [] as string[],
    termsVersion: 'terms/ac272n',
    verifiedAt: utcTimestamp('2026-06-01T00:00:00Z'),
    verificationExpiresAt: utcTimestamp('2026-07-01T00:00:00Z'),
  };
}

let db: PGlite;
let engine: DatabaseEngine;
const clockBox = movableClock(Date.parse('2026-06-05T00:00:00Z'));

async function activate(providerId: string): Promise<void> {
  const machine = new LifecycleMachine({ engine, clock: clockBox.clock });
  for (const [toState, reasonClass] of [
    ['VERIFIED', 'VERIFICATION_PROMOTED'],
    ['ACTIVE', 'ACTIVATION_APPROVED'],
  ] as const) {
    await machine.transition({
      providerId,
      operationId: 'op',
      operationVersion: '1.0.0',
      toState,
      reasonClass,
      actor: 'acceptance',
      idempotencyKey: `ac272n:${providerId}:${toState}`,
    });
  }
}

async function seed(providerId: string, overrides?: Partial<OperationDefinition>): Promise<void> {
  const registry = new OperationRegistry({ engine, clock: clockBox.clock });
  await registry.registerProvider({
    providerId,
    providerGroup: 'market-data',
    displayName: `AC-272N ${providerId}`,
  });
  await registry.registerOperation(definition(providerId, overrides));
}

function evaluate(providerId: string) {
  return new ReadinessEvaluator({ engine, clock: clockBox.clock }).evaluate({
    providerId,
    operationId: 'op',
    operationVersion: '1.0.0',
  });
}

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
});

afterAll(async () => {
  await db.close();
});

describe('AC-272 negative: each failing gate holds BLOCKED with typed reasons', () => {
  it('rights-unverified: ACTIVE op without any declaration blocks', async () => {
    await seed('ac272n-rights');
    await activate('ac272n-rights');
    const verdict = await evaluate('ac272n-rights');
    expect(verdict.verdict).toBe('BLOCKED');
    expect(verdict.reasons.map((r) => r.code)).toContain('RIGHTS_UNVERIFIED');
  });

  it('expired-verification: configured kind past TTL blocks even with rights', async () => {
    await seed('ac272n-ttl');
    await activate('ac272n-ttl');
    const rights = new RightsMatrixService({ engine, clock: clockBox.clock });
    await rights.declareVersion({
      providerId: 'ac272n-ttl',
      operationId: 'op',
      matrix: permissiveMatrix(),
      actor: 'officer-a',
    });
    const verification = new VerificationTtlService({ engine, clock: clockBox.clock });
    await verification.configureTtl('ac272n-ttl', 'PRICING_PLAN', 60);
    await verification.record({
      providerId: 'ac272n-ttl',
      operationId: 'op',
      operationVersion: '1.0.0',
      kind: 'PRICING_PLAN',
      source: 'OFFICIAL_DOC',
      outcome: 'SUCCEEDED',
      evidenceRefs: ['evidence/ac272n/stale-plan'],
    }); // recorded 2026-06-05, expires 06:00; evaluate at 07:00.
    clockBox.moveTo(Date.parse('2026-06-05T07:00:00Z'));
    const verdict = await evaluate('ac272n-ttl');
    expect(verdict.verdict).toBe('BLOCKED');
    expect(verdict.reasons.map((r) => r.code)).toEqual(['VERIFICATION_LAPSED']);
    clockBox.moveTo(Date.parse('2026-06-05T00:00:00Z'));
  });

  it('deprecated-without-valid-exception blocks until an exception exists', async () => {
    await seed('ac272n-dep', {
      deprecatedAt: utcTimestamp('2026-05-01T00:00:00Z'),
    });
    await activate('ac272n-dep');
    const rights = new RightsMatrixService({ engine, clock: clockBox.clock });
    await rights.declareVersion({
      providerId: 'ac272n-dep',
      operationId: 'op',
      matrix: permissiveMatrix(),
      actor: 'officer-a',
    });
    const blocked = await evaluate('ac272n-dep');
    expect(blocked.verdict).toBe('BLOCKED');
    expect(blocked.reasons.map((r) => r.code)).toEqual(['DEPRECATED_WITHOUT_EXCEPTION']);

    await new MigrationExceptions({ engine, clock: clockBox.clock }).grant({
      providerId: 'ac272n-dep',
      operationId: 'op',
      approver: 'operator-a',
      replacementPlanRef: 'plan/ac272n-migration',
      exceptionExpiresAt: utcTimestamp('2026-07-01T00:00:00Z'),
      evidenceRefs: ['ticket/ac272n'],
    });
    const cleared = await evaluate('ac272n-dep');
    expect(cleared.verdict).toBe('ELIGIBLE');
  });

  it('prohibited-exposure: one quarantined response holds the gate BLOCKED', async () => {
    await seed('ac272n-expo');
    await activate('ac272n-expo');
    const chain = new AuditChain({ engine });
    const bridge = new ProviderAuditBridge({ chain });
    const rights = new RightsMatrixService({ engine, clock: clockBox.clock, audit: bridge });
    await rights.declareVersion({
      providerId: 'ac272n-expo',
      operationId: 'op',
      matrix: permissiveMatrix(),
      actor: 'officer-a',
    });
    const quarantine = new ResponseQuarantineService({
      engine,
      clock: clockBox.clock,
      audit: bridge,
    });
    await quarantine.screenResponse({
      providerId: 'ac272n-expo',
      operationId: 'op',
      bodyText: JSON.stringify({ secret_key: 'REDACTED' }),
    });
    const verdict = await evaluate('ac272n-expo');
    expect(verdict.verdict).toBe('BLOCKED');
    expect(verdict.reasons.map((r) => r.code)).toEqual(['QUARANTINED_EXPOSURE']);
  });
});
