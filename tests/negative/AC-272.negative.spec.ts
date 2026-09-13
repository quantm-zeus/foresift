/**
 * AC-272 negative.
 * Traces: FR-PROV-009, FR-PROV-002, FR-PROV-003, FR-PROV-004.
 * Rights-unverified, expired-verification, deprecated-without-valid-
 * exception, and prohibited-exposure states each hold the gate BLOCKED with
 * typed reasons — never a throw past the gate, never a silent pass.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  ActivationKind,
  evaluateActivationGate,
  type DistributionEvidenceInput,
} from '@foresift/capability-registry';
import {
  checkPublicAuthorizationWithoutGateEvidence,
  evaluateDistributionAuthorization,
} from '@foresift/release-conformance';
import {
  PROD_PUBLIC_AUTHORIZED_MISSING_CLAIM,
  PROD_TECHNICALLY_READY_CLAIM,
  makeProdScope,
  passingDistributionEvidence,
  passingOpportunityGateInput,
} from '../fixtures/prod/index.ts';

function prodDistributionInput(
  kind: ActivationKind,
  overrides: Partial<DistributionEvidenceInput> = {},
) {
  const scope = makeProdScope({ profile_version: `ac272-prod-neg-${kind.toLowerCase()}` });
  return {
    ...passingOpportunityGateInput(scope),
    kind,
    distributionEvidence: passingDistributionEvidence(overrides),
  };
}
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
} from '@foresift/provider-lifecycle';
import type { OperationTarget, ProviderVerificationKind } from '@foresift/provider-lifecycle';
import {
  closeProvTestDatabase,
  makeFixedClock,
  makeProvTestDatabase,
  openRightsDeclaration,
  provOperationDefinition,
  recordVerificationPair,
  type ProvTestDatabase,
} from '../helpers/prov.ts';

const KINDS: readonly ProviderVerificationKind[] = ['DOCUMENTATION', 'PRICING_PLAN', 'RIGHTS'];

const clock = makeFixedClock('2026-08-26T12:00:00Z');

let tdb: ProvTestDatabase;
let registry: OperationRegistry;
let machine: LifecycleMachine;
let ttl: VerificationTtlEngine;
let rights: RightsMatrixEngine;

beforeAll(async () => {
  tdb = await makeProvTestDatabase();
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
}, 120_000);

afterAll(async () => {
  await closeProvTestDatabase(tdb);
});

/** Walks an op to ACTIVE with fresh verification pairs; rights optional. */
async function seedActive(
  operationId: string,
  options: { withRights?: boolean } = {},
): Promise<OperationTarget> {
  const target: OperationTarget = { providerId: 'ac272neg-provider', operationId, version: 'v1' };
  await registry.registerOperation(provOperationDefinition(target));
  await machine.transition({
    target,
    toState: 'VERIFIED',
    reasonClass: 'VERIFICATION_PASSED',
    actor: 'ac272n',
  });
  await machine.transition({
    target,
    toState: 'ACTIVE',
    reasonClass: 'ACTIVATION',
    actor: 'ac272n',
  });
  for (const kind of KINDS) {
    await ttl.configureTtl({ kind, ttlSeconds: 86_400 });
    await recordVerificationPair(ttl, {
      target,
      kind,
      clock,
      window: { verifiedAt: '2026-08-26T10:00:00Z', expiresAt: '2027-01-01T00:00:00Z' },
    });
  }
  if (options.withRights !== false) {
    await rights.declareRights({
      providerId: target.providerId,
      operationId,
      rightsVersion: 1,
      declaration: openRightsDeclaration({ termsVersion: `terms@${operationId}` }),
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
    const target: OperationTarget = {
      providerId: 'ac272neg-provider',
      operationId: 'op-deprecated-noexc',
      version: 'v1',
    };
    await registry.registerOperation(
      provOperationDefinition(target, { deprecatedAt: utcTimestamp('2026-07-01T00:00:00Z') }),
    );
    await machine.transition({
      target,
      toState: 'DEPRECATED',
      reasonClass: 'DEPRECATION_NOTICE',
      actor: 'ac272n',
    });
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
    await machine.transition({
      target,
      toState: 'DEGRADED',
      reasonClass: 'HEALTH_DEGRADED',
      actor: 'ac272n',
    });
    const verdict = await evaluatorFor().evaluate(target);
    expect(verdict.status).toBe('BLOCKED');
    if (verdict.status !== 'BLOCKED') return;
    const dimensions = new Set(verdict.reasons.map((r) => r.dimension));
    expect(dimensions.has('LIFECYCLE')).toBe(true); // DEGRADED ≠ ACTIVE
    expect(dimensions.has('RIGHTS')).toBe(true); // no declaration
  });
});

// --- prod-scoped additions (T037, FR-PROD-002/004, AC-272) -------------------

describe('AC-272 prod-scoped negatives: technically ready without evidence stays unauthorized', () => {
  it('holds WORKSPACE_TECHNICALLY_READY unauthorized for an exact-release claim', () => {
    const evaluation = evaluateDistributionAuthorization(PROD_TECHNICALLY_READY_CLAIM);
    expect(evaluation.readinessAuthorized).toBe(false);
    expect(evaluation.authorized).toBe(false);
  });

  it('refuses a WORKSPACE activation whose readiness is only technically ready', () => {
    const result = evaluateActivationGate(
      prodDistributionInput(ActivationKind.WORKSPACE, {
        distributionReadiness: 'WORKSPACE_TECHNICALLY_READY',
      }),
    );
    expect(result.verdict).toBe('REFUSE');
    if (result.verdict === 'REFUSE') {
      expect(result.failingGate).toBe('DISTRIBUTION_EVIDENCE');
      expect(result.reason).toBe('DISTRIBUTION_NOT_AUTHORIZED');
    }
  });

  it('refuses a PUBLIC activation missing any single distribution duty', () => {
    const result = evaluateActivationGate(
      prodDistributionInput(ActivationKind.PUBLIC, {
        distributionReadiness: 'PUBLIC_AUTHORIZED',
        privacyRetentionDeletionExport: false,
      }),
    );
    expect(result.verdict).toBe('REFUSE');
    if (result.verdict === 'REFUSE') {
      expect(result.failingGate).toBe('DISTRIBUTION_EVIDENCE');
      expect(result.reason).toBe('DISTRIBUTION_EVIDENCE_MISSING');
    }
  });

  it('flags an authorized claim whose required gate evidence is missing', () => {
    const report = checkPublicAuthorizationWithoutGateEvidence([
      PROD_PUBLIC_AUTHORIZED_MISSING_CLAIM,
    ]);
    expect(report.passed).toBe(false);
    expect(report.findings[0]?.message).toContain('missing gate evidence');
  });
});
