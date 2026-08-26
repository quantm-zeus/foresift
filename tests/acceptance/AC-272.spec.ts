/**
 * AC-272 acceptance (positive).
 * Traces: FR-PROV-009, FR-PROV-002, FR-PROV-003, FR-PROV-004.
 * AC text (manifest, abridged): FULLY verified rights + healthy lifecycle +
 * zero prohibited exposure yields ELIGIBLE readiness for the future
 * workspace/public activation gate.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { utcTimestamp, type ClockPort } from '@foresift/domain';
import { AuditChain } from '@foresift/security';
import {
  LifecycleMachine,
  OperationRegistry,
  ReadinessEvaluator,
  RightsMatrixEngine,
  VerificationTtlEngine,
  REQUIRED_NEGATIVE_CAPABILITIES,
} from '@foresift/provider-lifecycle';
import type {
  OperationDefinition,
  OperationTarget,
  ProviderVerificationKind,
  RightsDeclaration,
} from '@foresift/provider-lifecycle';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';

const TARGET: OperationTarget = { providerId: 'ac272-provider', operationId: 'op-ac272', version: 'v1' };
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
let evaluator: ReadinessEvaluator;

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
    declaredIndependenceGroup: 'group-ac272',
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

function openRights(): RightsDeclaration {
  return {
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
    termsVersion: 'terms@ac272-v1',
    verifiedAt: utcTimestamp('2026-08-01T00:00:00Z'),
    verificationExpiresAt: utcTimestamp('2027-08-01T00:00:00Z'),
  };
}

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
  evaluator = new ReadinessEvaluator({
    clock,
    registry,
    ttl,
    verificationKinds: KINDS,
    rights,
  });

  await registry.registerProvider({
    providerId: TARGET.providerId,
    displayName: 'AC-272 provider',
    providerGroup: 'acceptance',
  });
  await registry.registerOperation(definition());
  // Healthy lifecycle walk to ACTIVE.
  await machine.transition({ target: TARGET, toState: 'VERIFIED', reasonClass: 'VERIFICATION_PASSED', actor: 'ac272' });
  await machine.transition({ target: TARGET, toState: 'ACTIVE', reasonClass: 'ACTIVATION', actor: 'ac272' });
  // Fresh AC-270 pair per kind.
  for (const kind of KINDS) {
    await ttl.configureTtl({ kind, ttlSeconds: 86_400 });
    for (const source of ['OFFICIAL_DOC', 'LIVE_CONTRACT'] as const) {
      await ttl.recordVerification({
        target: TARGET,
        kind,
        source,
        outcome: 'PASSED',
        verifiedAt: utcTimestamp('2026-08-26T10:00:00Z'),
        expiresAt: utcTimestamp('2027-01-01T00:00:00Z'),
        evidenceRefs: [`evidence:${kind}:${source}`],
      });
    }
  }
  // Fully verified rights declaration.
  await rights.declareRights({
    providerId: TARGET.providerId,
    operationId: TARGET.operationId,
    rightsVersion: 1,
    declaration: openRights(),
  });
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('AC-272 readiness eligibility', () => {
  it('yields ELIGIBLE for the workspace/public gate with every dimension green', async () => {
    const verdict = await evaluator.evaluate(TARGET, 'PUBLIC');
    expect(verdict.status).toBe('ELIGIBLE');
    if (verdict.status !== 'ELIGIBLE') throw new Error(JSON.stringify(verdict.reasons));
    expect(verdict.scope).toBe('PUBLIC');
    expect(verdict.checkedAt).toBeTruthy();
  });

  it('applies the SAME evidence bar in the WORKSPACE scope', async () => {
    const verdict = await evaluator.evaluate(TARGET, 'WORKSPACE');
    expect(verdict.status).toBe('ELIGIBLE');
    if (verdict.status !== 'ELIGIBLE') throw new Error(JSON.stringify(verdict.reasons));
    expect(verdict.scope).toBe('WORKSPACE');
  });

  it('stays ELIGIBLE under re-evaluation (idempotent reads, no state churn)', async () => {
    for (let i = 0; i < 3; i += 1) {
      const verdict = await evaluator.evaluate(TARGET);
      expect(verdict.status).toBe('ELIGIBLE');
    }
  });
});
