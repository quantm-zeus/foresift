/**
 * AC-272 negative.
 * Traces: FR-PROV-009, FR-PROV-002, FR-PROV-003, FR-PROV-004.
 * Rights-unverified, expired-verification, deprecated-without-valid-
 * exception, and prohibited-exposure states each hold the gate BLOCKED with
 * typed reasons — never a throw past the gate, never a silent pass.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { utcTimestamp, type ClockPort } from '@foresift/domain';
import { AuditChain } from '@foresift/security';
import {
  LifecycleMachine,
  MigrationExceptions,
  OperationRegistry,
  ReadinessEvaluator,
  RightsMatrixEngine,
  VerificationTtlEngine,
  ProvErrorCode,
  REQUIRED_NEGATIVE_CAPABILITIES,
} from '@foresift/provider-lifecycle';
import type {
  OperationDefinition,
  OperationTarget,
  ProviderVerificationKind,
} from '@foresift/provider-lifecycle';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from '../acceptance/helpers.ts';

const KINDS: readonly ProviderVerificationKind[] = ['DOCUMENTATION', 'PRICING_PLAN', 'RIGHTS'];
const NOW = '2026-08-26T12:00:00Z';

const clock: ClockPort = {
  now: () => utcTimestamp(NOW),
  nowEpochMs: () => Date.parse(NOW),
};

let tdb: TestDatabase;
let registry: OperationRegistry;
let machine: LifecycleMachine;
let ttl: VerificationTtlEngine;
let rights: RightsMatrixEngine;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  registry = new OperationRegistry(tdb.engine, clock);
  machine = new LifecycleMachine({ engine: tdb.engine, clock });
  ttl = new VerificationTtlEngine({ engine: tdb.engine, clock, machine });
  rights = new RightsMatrixEngine({
    engine: tdb.engine,
    clock,
    auditChain: new AuditChain({ engine: tdb.engine }),
  });
  await registry.registerProvider({
    providerId: 'ac272neg-provider',
    displayName: 'AC-272 negative provider',
    providerGroup: 'acceptance',
  });
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

function definition(overrides: Partial<OperationDefinition> = {}): OperationDefinition {
  return {
    providerId: 'ac272neg-provider',
    operationId: 'op-ac272neg',
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
    declaredIndependenceGroup: 'group-ac272neg',
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

/** Walks an op to ACTIVE with fresh verification pairs; rights optional. */
async function seedActive(
  operationId: string,
  options: { withRights?: boolean } = {},
): Promise<OperationTarget> {
  const target: OperationTarget = { providerId: 'ac272neg-provider', operationId, version: 'v1' };
  await registry.registerOperation(definition({ operationId }));
  await machine.transition({ target, toState: 'VERIFIED', reasonClass: 'VERIFICATION_PASSED', actor: 'ac272n' });
  await machine.transition({ target, toState: 'ACTIVE', reasonClass: 'ACTIVATION', actor: 'ac272n' });
  for (const kind of KINDS) {
    await ttl.configureTtl({ kind, ttlSeconds: 86_400 });
    for (const source of ['OFFICIAL_DOC', 'LIVE_CONTRACT'] as const) {
      await ttl.recordVerification({
        target,
        kind,
        source,
        outcome: 'PASSED',
        verifiedAt: utcTimestamp('2026-08-26T10:00:00Z'),
        expiresAt: utcTimestamp('2027-01-01T00:00:00Z'),
        evidenceRefs: [`evidence:${kind}:${source}`],
      });
    }
  }
  if (options.withRights !== false) {
    await rights.declareRights({
      providerId: target.providerId,
      operationId,
      rightsVersion: 1,
      declaration: {
        commercialUseAllowed: true,
        personalResearchAllowed: true,
        cacheAllowed: true,
        maximumCacheDurationSeconds: 86_400,
        rawRetentionAllowed: true,
        derivedFeaturesAllowed: true,
        modelTrainingAllowed: true,
        redistributionAllowed: true,
        publicAlertDerivativeAllowed: true,
        attributionRequired: false,
        userByokRequired: false,
        rawExportAllowed: true,
        jurisdictionRestrictions: [],
        termsVersion: `terms@${operationId}`,
        verifiedAt: utcTimestamp('2026-08-01T00:00:00Z'),
        verificationExpiresAt: utcTimestamp('2027-08-01T00:00:00Z'),
      },
    });
  }
  return target;
}

function evaluatorFor(): ReadinessEvaluator {
  return new ReadinessEvaluator({
    clock,
    registry,
    ttl,
    verificationKinds: KINDS,
    rights,
    exceptions: new MigrationExceptions(tdb.engine, clock),
  });
}

describe('AC-272 blocked states', () => {
  it('rights-UNVERIFIED (no declaration at all) holds BLOCKED with a RIGHTS reason', async () => {
    const target = await seedActive('op-norights', { withRights: false });
    const verdict = await evaluatorFor().evaluate(target);
    expect(verdict.status).toBe('BLOCKED');
    if (verdict.status !== 'BLOCKED') return;
    const rightsReason = verdict.reasons.find((r) => r.dimension === 'RIGHTS');
    expect(rightsReason).toBeDefined();
    expect(rightsReason?.code).toBe(ProvErrorCode.PROV_RIGHTS_VERSION_UNKNOWN);
  });

  it('EXPIRED verification holds BLOCKED with REFRESH_INCOMPLETE per kind', async () => {
    const target = await seedActive('op-expired-verification');
    // Lapse every kind by reading the SAME stored windows through a clock
    // moved past all of them (windows end 2027-01-01; read at 2027-06-01).
    const lapsedClock: ClockPort = {
      now: () => utcTimestamp('2027-06-01T00:00:00Z'),
      nowEpochMs: () => Date.parse('2027-06-01T00:00:00Z'),
    };
    const evaluator = new ReadinessEvaluator({
      clock: lapsedClock,
      registry,
      ttl: new VerificationTtlEngine({ engine: tdb.engine, clock: lapsedClock, machine }),
      verificationKinds: KINDS,
      rights,
      exceptions: new MigrationExceptions(tdb.engine, lapsedClock),
    });
    const verdict = await evaluator.evaluate(target);
    expect(verdict.status).toBe('BLOCKED');
    if (verdict.status !== 'BLOCKED') return;
    const verificationReasons = verdict.reasons.filter((r) => r.dimension === 'VERIFICATION');
    expect(verificationReasons.length).toBeGreaterThanOrEqual(KINDS.length);
    for (const reason of verificationReasons) {
      expect(reason.code).toBe(ProvErrorCode.PROV_VERIFICATION_REFRESH_INCOMPLETE);
    }
  });

  it('DEPRECATED without a valid exception holds BLOCKED with a DEPRECATION reason', async () => {
    const target: OperationTarget = { providerId: 'ac272neg-provider', operationId: 'op-deprecated-noexc', version: 'v1' };
    await registry.registerOperation(
      definition({ operationId: 'op-deprecated-noexc', deprecatedAt: utcTimestamp('2026-07-01T00:00:00Z') }),
    );
    await machine.transition({ target, toState: 'DEPRECATED', reasonClass: 'DEPRECATION_NOTICE', actor: 'ac272n' });
    const verdict = await evaluatorFor().evaluate(target);
    expect(verdict.status).toBe('BLOCKED');
    if (verdict.status !== 'BLOCKED') return;
    const deprecation = verdict.reasons.find((r) => r.dimension === 'DEPRECATION');
    expect(deprecation).toBeDefined();
    expect(deprecation?.code).toBe(ProvErrorCode.PROV_MIGRATION_EXCEPTION_EXPIRED);
  });

  it('prohibited EXPOSURE (incomplete negative metadata) holds BLOCKED', async () => {
    const target = await seedActive('op-exposure-hole');
    await tdb.engine.query(
      `UPDATE prov.prov_operations SET negative_capabilities = '{}'
       WHERE provider_id='ac272neg-provider' AND operation_id='op-exposure-hole'`,
    );
    const verdict = await evaluatorFor().evaluate(target);
    expect(verdict.status).toBe('BLOCKED');
    if (verdict.status !== 'BLOCKED') return;
    const exposure = verdict.reasons.find((r) => r.dimension === 'EXPOSURE');
    expect(exposure?.code).toBe(ProvErrorCode.PROV_CAPABILITY_CLASS_PROHIBITED);
  });

  it('reasons AGGREGATE — multiple failing dimensions appear together', async () => {
    const target = await seedActive('op-multi-fail', { withRights: false });
    await machine.transition({ target, toState: 'DEGRADED', reasonClass: 'HEALTH_DEGRADED', actor: 'ac272n' });
    const verdict = await evaluatorFor().evaluate(target);
    expect(verdict.status).toBe('BLOCKED');
    if (verdict.status !== 'BLOCKED') return;
    const dimensions = new Set(verdict.reasons.map((r) => r.dimension));
    expect(dimensions.has('LIFECYCLE')).toBe(true); // DEGRADED ≠ ACTIVE
    expect(dimensions.has('RIGHTS')).toBe(true); // no declaration
  });
});
