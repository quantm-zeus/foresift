/**
 * Registry, activation-gate, containment, and rollback unit suite (T019,
 * FR-PROD-001/002/003/004/005, AC-144/150/151/152/154/272/273/275/276/277/
 * 278/279).
 *
 * Every PGlite-backed hook carries an explicit 120s timeout (the suite runs
 * the full `prod` migration set per file).
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACTIVATION_GATE_ORDER,
  type ActivationGateKind,
  type SustainableCapacityContract,
} from '@foresift/domain';
import { createGateEvidence } from '@foresift/release-conformance';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import {
  ActivationGateRefusalReason,
  ActivationKind,
  ModuleStateRefusalReason,
  NegativeControlKind,
  activationEvidenceSetRef,
  activationGateEvaluationsFor,
  assertAlertResumptionAllowed,
  assertNoAutoReactivation,
  activationScopeHash,
  advanceState,
  clearContainment,
  containForFailedGate,
  evaluateActivationGate,
  latestRollback,
  openContainments,
  parseModuleStateScope,
  recordActivationGateEvaluation,
  recordActivationGateResult,
  rollbackToApproved,
  smallestAffectedScope,
  stateRowsFor,
  statesFor,
  type ActivationGateInput,
  type ActivationGateResult,
  type ModuleStateScope,
  type RegisteredStatisticalEvidence,
} from '../src/index.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

const NOW = '2026-06-01T00:00:00Z';
const FUTURE = '2027-06-01T00:00:00Z';
const FAR_FUTURE = '2030-01-01T00:00:00Z';
const PAST = '2025-01-01T00:00:00Z';
const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const PEPPER = 'test-pepper';

let db: PGlite;
let engine: DatabaseEngine;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
}, 180_000);

afterAll(async () => {
  await db.close();
});

function makeScope(overrides: Partial<ModuleStateScope> = {}): ModuleStateScope {
  return parseModuleStateScope({
    profile_version: 'profile-v1',
    policy_version: 'policy-v1',
    regime_scope: 'regime-v1',
    execution_scenario: 'scenario-v1',
    delay_policy: 'delay-v1',
    population_claim: 'population-v1',
    requires_proven: true,
    ...overrides,
  });
}

function passingCapacityContract(
  overrides: Partial<SustainableCapacityContract> = {},
): SustainableCapacityContract {
  return {
    contractId: 'capacity-1',
    version: 'v1',
    scheduleRef: 'schedule-1',
    profileRef: 'profile-1',
    horizonDays: 30,
    candidateLoad: {
      newAssetsPerDayExpected: 1,
      newAssetsPerDayStress: 2,
      cheapMonitorRowsPerDay: 1,
      promotedCandidatesPerDay: 1,
      activeRiskCandidatesPerDay: 1,
      highResolutionOutcomeCasesPerDay: 1,
      interactiveInvestigationsPerDay: 1,
    },
    providerEnvelope: [
      {
        operationId: 'op-1',
        callsExpected: 1,
        callsStress: 2,
        quotaUnitsExpected: 1,
        quotaUnitsStress: 2,
        retryAllowance: 1,
      },
    ],
    systemEnvelope: {
      modelInputTokens: 1,
      modelOutputTokens: 1,
      modelSpendUsd: 1,
      workflowSteps: 100,
      schedulerMessages: 1,
      databaseReads: 1,
      databaseWrites: 1,
      databaseStorageBytes: 1,
      objectOperations: 1,
      objectStorageBytes: 1,
      egressBytes: 1,
      notificationSends: 1,
      concurrency: 1,
    },
    retryAllowance: 1,
    protectedReserves: {},
    minimumHeadroomFraction: 0.1,
    safetyMarginFraction: 0.1,
    degradationPolicyVersion: 'v1',
    verifiedAt: '2026-01-01T00:00:00Z',
    expiresAt: FUTURE,
    result: 'PASS',
    ...overrides,
  };
}

function statisticalEvidence(
  scopeHash: string,
  overrides: Partial<RegisteredStatisticalEvidence> = {},
): RegisteredStatisticalEvidence {
  return {
    evidenceRef: 'stat-1',
    scopeHash,
    intervalMethod: 'CLUSTERED_BLOCK_BOOTSTRAP',
    clusterDefinition: 'by-deployer-and-window',
    naiveIntervalMethod: 'NAIVE_INDEPENDENT_TOKEN',
    clusteredDiffersFromNaive: true,
    negativeControls: [
      {
        control: NegativeControlKind.LABEL_PERMUTATION,
        passed: true,
        unexplainedMaterialLift: false,
      },
      {
        control: NegativeControlKind.FEATURE_TIME_SHIFT,
        passed: true,
        unexplainedMaterialLift: false,
      },
      {
        control: NegativeControlKind.SYNTHETIC_NULL_FEATURE,
        passed: true,
        unexplainedMaterialLift: false,
      },
      {
        control: NegativeControlKind.DELAYED_PROVIDER,
        passed: true,
        unexplainedMaterialLift: false,
      },
    ],
    calibration: {
      maturity: 'MATURE',
      expectedNetUtilityRankingEnabled: false,
      regimeDrift: false,
    },
    expiresAt: FAR_FUTURE,
    ...overrides,
  };
}

function passingGateEvidence(
  scopeHash: string,
  expiresAt = FAR_FUTURE,
): ActivationGateInput['verifiedGateEvidence'] {
  const record = createGateEvidence(
    {
      gateKind: 'OWNER_APPROVAL',
      approver: 'owner-1',
      scopeRefs: [scopeHash],
      subject: 'module-activation',
      issuedAt: '2026-01-01T00:00:00Z',
      expiresAt,
    },
    PEPPER,
  );
  return { record, pepper: PEPPER };
}

async function gatePass(
  scope: ModuleStateScope,
  activationEventRef: string,
  now = NOW,
): Promise<ActivationGateResult> {
  // The ONLY legitimate way to reach ACTIVE: evaluate the total gate, then
  // persist its evaluations through the real recorder (which mints the
  // persisted set reference). A hand-built PASS object is refused by the
  // recorder's evaluator-provenance brand.
  const result = evaluateActivationGate({
    ...passingOpportunityInput(scope),
    activationEventRef,
    now,
  });
  if (result.verdict !== 'PASS') {
    throw new Error(`expected a passing gate for ${activationEventRef}, got ${result.verdict}`);
  }
  return recordActivationGateResult(engine, result);
}

function passingOpportunityInput(scope: ModuleStateScope): ActivationGateInput {
  const scopeHash = activationScopeHash(scope);
  return {
    kind: ActivationKind.OPPORTUNITY,
    scope,
    now: NOW,
    implemented: true,
    available: true,
    proven: true,
    availableEvidence: {
      data: true,
      rights: true,
      capability: true,
      sourceCoverage: true,
      poolAdapter: true,
      cost: true,
      capacity: true,
      freshness: true,
    },
    registeredStatisticalEvidence: [statisticalEvidence(scopeHash)],
    verifiedGateEvidence: passingGateEvidence(scopeHash),
    capacityContract: passingCapacityContract(),
    distributionEvidence: null,
    openContainment: [],
    activationEventRef: 'activation-1',
    expiresAt: FUTURE,
    evidenceRefs: ['evidence-1'],
  };
}

function passingWorkspaceInput(scope: ModuleStateScope): ActivationGateInput {
  const base = passingOpportunityInput(scope);
  return {
    ...base,
    kind: ActivationKind.WORKSPACE,
    distributionEvidence: {
      distributionReadiness: 'WORKSPACE_AUTHORIZED',
      oauthTenantIsolation: true,
      originClientCompatibility: true,
      dataRightsRedistribution: true,
      privacyRetentionDeletionExport: true,
      jurisdictionDisclosure: true,
      claimsReview: true,
      abuseRateLimitIncidentResponse: true,
      supportSecurityContact: true,
      publicSafeRedaction: true,
      isolationFixtures: true,
      rightsChangeBlockedPaths: [],
    },
  };
}

async function advance(
  moduleId: string,
  scope: ModuleStateScope,
  toState:
    | 'IMPLEMENTED'
    | 'AVAILABLE'
    | 'SHADOW'
    | 'PROVEN'
    | 'ACTIVE'
    | 'DEGRADED'
    | 'PAUSED'
    | 'DISABLED',
  stateRowId: string,
  options: { readonly gateResult?: ActivationGateResult | null; readonly hash?: string } = {},
) {
  return advanceState(engine, {
    moduleId,
    scope,
    artifactSetHash: options.hash ?? HASH_A,
    toState,
    operationalReadiness: 'READY_FOR_ACTIVE_PROFILE',
    distributionReadiness: 'PRIVATE_ONLY',
    changeClassification: 'MATERIAL_OPERATIONAL',
    reason: `advance to ${toState}`,
    actorRef: 'test-actor',
    at: NOW,
    gateResult: options.gateResult ?? null,
    stateRowId,
    transitionId: `${stateRowId}-t`,
  });
}

async function rejection(work: Promise<unknown>): Promise<{ code?: string; detail?: unknown }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; detail?: unknown };
  }
  throw new Error('expected a typed refusal, but the operation succeeded');
}

describe('nine-state lattice and independent dimensions (AC-152)', () => {
  it('reports implemented/available/proven independently along the ladder', async () => {
    const scope = makeScope({ profile_version: 'indep' });
    const moduleId = 'module-indep';
    const fresh = await statesFor(engine, { moduleId, scope });
    expect(fresh.lifecycleState).toBe('NOT_IMPLEMENTED');
    expect([fresh.implemented, fresh.available, fresh.proven]).toEqual([false, false, false]);

    await advance(moduleId, scope, 'IMPLEMENTED', 'indep-1');
    const implemented = await statesFor(engine, { moduleId, scope });
    // Deployed but unavailable: implementation never implies availability.
    expect([implemented.implemented, implemented.available, implemented.proven]).toEqual([
      true,
      false,
      false,
    ]);

    await advance(moduleId, scope, 'AVAILABLE', 'indep-2');
    const available = await statesFor(engine, { moduleId, scope });
    expect([available.implemented, available.available, available.proven]).toEqual([
      true,
      true,
      false,
    ]);

    await advance(moduleId, scope, 'SHADOW', 'indep-2b');
    await advance(moduleId, scope, 'PROVEN', 'indep-3');
    const proven = await statesFor(engine, { moduleId, scope });
    expect([proven.implemented, proven.available, proven.proven]).toEqual([true, true, true]);

    await advance(moduleId, scope, 'ACTIVE', 'indep-4', {
      gateResult: await gatePass(scope, 'activation-indep'),
    });
    const active = await statesFor(engine, { moduleId, scope });
    expect(active.lifecycleState).toBe('ACTIVE');
    expect(active.activationEventRef).toBe('activation-indep');
  }, 120_000);

  it('refuses an illegal lifecycle edge and an in-place mutation', async () => {
    const scope = makeScope({ profile_version: 'illegal' });
    const moduleId = 'module-illegal';
    const illegal = await rejection(advance(moduleId, scope, 'PROVEN', 'illegal-1'));
    expect(illegal.code).toBe('PROD_LIFECYCLE_TRANSITION_ILLEGAL');

    await advance(moduleId, scope, 'IMPLEMENTED', 'illegal-2');
    await advance(moduleId, scope, 'AVAILABLE', 'illegal-3');
    // Reusing an existing row id is an in-place mutation, never an append.
    const mutation = await rejection(advance(moduleId, scope, 'SHADOW', 'illegal-2'));
    expect(mutation.code).toBe('PROD_LIFECYCLE_TRANSITION_ILLEGAL');

    const rows = await stateRowsFor(engine, { moduleId, scope });
    expect(rows.length).toBe(2);
    const superseded = rows.filter((row) => row.supersededBy !== null);
    expect(superseded.length).toBe(1);
    expect(superseded[0]?.lifecycleState).toBe('IMPLEMENTED');
    expect(superseded[0]?.supersededBy).toBe('illegal-3');
  }, 120_000);

  it('refuses an unknown/mismatched scope and a missing cross-gate result', async () => {
    const scope = makeScope({ profile_version: 'scope-mismatch' });
    const other = makeScope({ profile_version: 'scope-other' });
    const moduleId = 'module-mismatch';
    await advance(moduleId, scope, 'IMPLEMENTED', 'mismatch-1');

    const mismatched = await rejection(
      advanceState(engine, {
        moduleId,
        scope,
        artifactSetHash: HASH_A,
        toState: 'AVAILABLE',
        operationalReadiness: 'READY_FOR_ACTIVE_PROFILE',
        distributionReadiness: 'PRIVATE_ONLY',
        changeClassification: 'MATERIAL_OPERATIONAL',
        reason: 'mismatched current row',
        actorRef: 'test-actor',
        at: NOW,
        currentStateRowId: 'does-not-exist',
        stateRowId: 'mismatch-2',
        transitionId: 'mismatch-2-t',
      }),
    );
    expect(mismatched.code).toBe('PROD_ACTIVATION_SCOPE_INVALID');

    const wrongScopeGate = await rejection(
      advance(moduleId, scope, 'AVAILABLE', 'mismatch-3', {
        gateResult: await gatePass(other, 'activation-wrong'),
      }),
    );
    expect(wrongScopeGate.code).toBe('PROD_ACTIVATION_SCOPE_INVALID');

    await advance(moduleId, scope, 'AVAILABLE', 'mismatch-4');
    await advance(moduleId, scope, 'SHADOW', 'mismatch-5');
    await advance(moduleId, scope, 'PROVEN', 'mismatch-6');
    const noGate = await rejection(advance(moduleId, scope, 'ACTIVE', 'mismatch-7'));
    expect(noGate.code).toBe('PROD_ACTIVATION_GATE_REFUSED');
  }, 120_000);
});

describe('the total ordered activation gate (AC-150/151/152/154/272/273/275/276/277)', () => {
  it('passes a fully evidenced opportunity scope', () => {
    const result = evaluateActivationGate(passingOpportunityInput(makeScope()));
    expect(result.verdict).toBe('PASS');
  }, 120_000);

  it('refuses each required gate with a typed name', () => {
    const scope = makeScope();
    const cases: readonly [string, Partial<ActivationGateInput>, ActivationGateKind][] = [
      ['IMPLEMENTED_PRESENT', { implemented: false }, 'IMPLEMENTED_PRESENT'],
      ['AVAILABLE_EVIDENCE', { available: false }, 'AVAILABLE_EVIDENCE'],
      [
        'AVAILABLE_EVIDENCE incomplete',
        {
          availableEvidence: {
            data: true,
            rights: false,
            capability: true,
            sourceCoverage: true,
            poolAdapter: true,
            cost: true,
            capacity: true,
            freshness: true,
          },
        },
        'AVAILABLE_EVIDENCE',
      ],
      ['PROVEN_PRESENT', { proven: false }, 'PROVEN_PRESENT'],
      [
        'STATISTICAL_EVIDENCE_SCOPE',
        { registeredStatisticalEvidence: [] },
        'STATISTICAL_EVIDENCE_SCOPE',
      ],
      [
        'NEGATIVE_CONTROLS',
        {
          registeredStatisticalEvidence: [
            statisticalEvidence(activationScopeHash(scope), {
              negativeControls: [
                {
                  control: NegativeControlKind.LABEL_PERMUTATION,
                  passed: false,
                  unexplainedMaterialLift: true,
                },
              ],
            }),
          ],
        },
        'NEGATIVE_CONTROLS',
      ],
      [
        'CLUSTERED_INTERVALS',
        {
          registeredStatisticalEvidence: [
            statisticalEvidence(activationScopeHash(scope), {
              intervalMethod: 'NAIVE_INDEPENDENT_TOKEN',
            }),
          ],
        },
        'CLUSTERED_INTERVALS',
      ],
      [
        'CALIBRATION_MATURITY',
        {
          registeredStatisticalEvidence: [
            statisticalEvidence(activationScopeHash(scope), {
              calibration: {
                maturity: 'IMMATURE',
                expectedNetUtilityRankingEnabled: true,
                regimeDrift: false,
              },
            }),
          ],
        },
        'CALIBRATION_MATURITY',
      ],
      ['VERIFIED_GATE_EVIDENCE', { verifiedGateEvidence: null }, 'VERIFIED_GATE_EVIDENCE'],
      ['CAPACITY_CONTRACT', { capacityContract: null }, 'CAPACITY_CONTRACT'],
      [
        'NO_OPEN_CONTAINMENT',
        {
          openContainment: [
            {
              containmentId: 'containment-open',
              moduleId: 'module-1',
              scopeHash: activationScopeHash(scope),
              action: 'PAUSED',
            },
          ],
        },
        'NO_OPEN_CONTAINMENT',
      ],
    ];
    for (const [label, patch, expectedGate] of cases) {
      const result = evaluateActivationGate({ ...passingOpportunityInput(scope), ...patch });
      expect(result.verdict, label).toBe('REFUSE');
      if (result.verdict === 'REFUSE') {
        expect(result.failingGate, label).toBe(expectedGate);
      }
    }
    const workspaceMissing = evaluateActivationGate({
      ...passingWorkspaceInput(makeScope({ profile_version: 'ws-gate' })),
      distributionEvidence: null,
    });
    expect(workspaceMissing.verdict).toBe('REFUSE');
    if (workspaceMissing.verdict === 'REFUSE') {
      expect(workspaceMissing.failingGate).toBe('DISTRIBUTION_EVIDENCE');
    }
  }, 120_000);

  it('fails closed on missing, stale, and mismatched-scope input', () => {
    const scope = makeScope({ profile_version: 'fail-closed' });
    const scopeHash = activationScopeHash(scope);
    const otherHash = activationScopeHash(makeScope({ profile_version: 'other-scope' }));

    const mismatchedStat = evaluateActivationGate({
      ...passingOpportunityInput(scope),
      registeredStatisticalEvidence: [statisticalEvidence(otherHash)],
    });
    expect(mismatchedStat.verdict).toBe('REFUSE');
    if (mismatchedStat.verdict === 'REFUSE') {
      expect(mismatchedStat.failingGate).toBe('STATISTICAL_EVIDENCE_SCOPE');
      expect(mismatchedStat.reason).toBe(ActivationGateRefusalReason.STATISTICAL_EVIDENCE_MISSING);
    }

    const staleEvidence = evaluateActivationGate({
      ...passingOpportunityInput(scope),
      verifiedGateEvidence: passingGateEvidence(scopeHash, FUTURE),
      now: '2028-01-01T00:00:00Z',
    });
    expect(staleEvidence.verdict).toBe('REFUSE');
    if (staleEvidence.verdict === 'REFUSE') {
      expect(staleEvidence.failingGate).toBe('VERIFIED_GATE_EVIDENCE');
    }

    const wrongScopeEvidence = evaluateActivationGate({
      ...passingOpportunityInput(scope),
      verifiedGateEvidence: passingGateEvidence(otherHash),
    });
    expect(wrongScopeEvidence.verdict).toBe('REFUSE');
    if (wrongScopeEvidence.verdict === 'REFUSE') {
      expect(wrongScopeEvidence.failingGate).toBe('VERIFIED_GATE_EVIDENCE');
    }

    const staleStatistical = evaluateActivationGate({
      ...passingOpportunityInput(scope),
      registeredStatisticalEvidence: [statisticalEvidence(scopeHash, { expiresAt: PAST })],
    });
    expect(staleStatistical.verdict).toBe('REFUSE');
    if (staleStatistical.verdict === 'REFUSE') {
      expect(staleStatistical.failingGate).toBe('STATISTICAL_EVIDENCE_SCOPE');
      expect(staleStatistical.reason).toBe(ActivationGateRefusalReason.STATISTICAL_EVIDENCE_STALE);
    }

    const ambiguous = evaluateActivationGate({
      ...passingOpportunityInput(scope),
      registeredStatisticalEvidence: [
        statisticalEvidence(scopeHash, { evidenceRef: 'stat-a' }),
        statisticalEvidence(scopeHash, { evidenceRef: 'stat-b' }),
      ],
    });
    expect(ambiguous.verdict).toBe('REFUSE');
    if (ambiguous.verdict === 'REFUSE') {
      expect(ambiguous.failingGate).toBe('STATISTICAL_EVIDENCE_SCOPE');
      expect(ambiguous.reason).toBe(ActivationGateRefusalReason.STATISTICAL_EVIDENCE_AMBIGUOUS);
    }
  }, 120_000);

  it('refuses draft calibration and a failing/expired capacity contract', () => {
    const scope = makeScope({ profile_version: 'calibration' });
    const scopeHash = activationScopeHash(scope);
    const draft = evaluateActivationGate({
      ...passingOpportunityInput(scope),
      registeredStatisticalEvidence: [
        statisticalEvidence(scopeHash, {
          calibration: {
            maturity: 'DRAFT',
            expectedNetUtilityRankingEnabled: true,
            regimeDrift: false,
          },
        }),
      ],
    });
    expect(draft.verdict).toBe('REFUSE');
    if (draft.verdict === 'REFUSE') {
      expect(draft.failingGate).toBe('CALIBRATION_MATURITY');
      expect(draft.reason).toBe(ActivationGateRefusalReason.CALIBRATION_IMMATURE);
    }

    const failing = evaluateActivationGate({
      ...passingOpportunityInput(scope),
      capacityContract: passingCapacityContract({ result: 'FAIL' }),
    });
    expect(failing.verdict).toBe('REFUSE');
    if (failing.verdict === 'REFUSE') {
      expect(failing.failingGate).toBe('CAPACITY_CONTRACT');
    }

    const expired = evaluateActivationGate({
      ...passingOpportunityInput(scope),
      now: '2027-07-01T00:00:00Z',
    });
    expect(expired.verdict).toBe('REFUSE');
  }, 120_000);

  it('records immutable pass evaluations for an exact scope', async () => {
    const scope = makeScope({ profile_version: 'persist-gate' });
    const scopeHash = activationScopeHash(scope);
    const first = evaluateActivationGate({
      ...passingOpportunityInput(scope),
      activationEventRef: 'gate-eval-event-1',
    });
    expect(first.verdict).toBe('PASS');
    if (first.verdict !== 'PASS') throw new Error('unreachable');
    const recorded = await recordActivationGateEvaluation(engine, first);
    expect(recorded.evaluationIds.length).toBe(first.evaluations.length);
    expect(recorded.evaluationSetRef).toMatch(/^sha256:[0-9a-f]{64}$/);
    const rows = await activationGateEvaluationsFor(engine, scopeHash);
    expect(rows.length).toBe(first.evaluations.length);
    expect(activationEvidenceSetRef(rows)).toBe(recorded.evaluationSetRef);
    // A re-evaluation is a NEW immutable row, never an in-place edit.
    const second = evaluateActivationGate({
      ...passingOpportunityInput(scope),
      activationEventRef: 'gate-eval-event-2',
      now: '2026-06-02T00:00:00Z',
    });
    expect(second.verdict).toBe('PASS');
    if (second.verdict !== 'PASS') throw new Error('unreachable');
    await recordActivationGateEvaluation(engine, second);
    const after = await activationGateEvaluationsFor(engine, scopeHash);
    expect(after.length).toBe(rows.length * 2);
  }, 120_000);
});

describe('§69.11 containment (AC-278)', () => {
  it('contains the smallest affected scope, records the reason, and never auto-reactivates', async () => {
    const narrow = makeScope({ profile_version: 'narrow' });
    const broad = makeScope({ profile_version: '*', policy_version: '*' });
    const moduleId = 'module-contain';
    for (const [scope, id] of [
      [narrow, 'contain-narrow'],
      [broad, 'contain-broad'],
    ] as const) {
      await advance(moduleId, scope, 'IMPLEMENTED', `${id}-1`);
      await advance(moduleId, scope, 'AVAILABLE', `${id}-2`);
      await advance(moduleId, scope, 'SHADOW', `${id}-3`);
      await advance(moduleId, scope, 'PROVEN', `${id}-4`);
      await advance(moduleId, scope, 'ACTIVE', `${id}-5`, {
        gateResult: await gatePass(scope, `activation-${id}`),
      });
    }
    const chosen = smallestAffectedScope([
      { moduleId, scope: broad },
      { moduleId, scope: narrow },
    ]);
    expect(chosen.scope.profile_version).toBe('narrow');

    const outcome = await containForFailedGate(engine, {
      criticalGate: 'CAPACITY',
      affectedScopes: [
        { moduleId, scope: broad },
        { moduleId, scope: narrow },
      ],
      reason: 'capacity breach on the narrow scope',
      at: NOW,
      containmentId: 'containment-smallest',
    });
    expect(outcome.containment.action).toBe('DEGRADED');
    expect(outcome.containment.triggerGateKind).toBe('CAPACITY_CONTRACT');
    expect(outcome.containment.reason).toBe('capacity breach on the narrow scope');
    expect(outcome.containment.autoReactivationAllowed).toBe(false);
    expect(outcome.state.lifecycleState).toBe('DEGRADED');
    expect(assertNoAutoReactivation(outcome.containment)).toBeUndefined();

    const open = await openContainments(engine, { moduleId });
    expect(open.map((row) => row.containmentId)).toContain('containment-smallest');

    const cleared = await clearContainment(engine, {
      containmentId: 'containment-smallest',
      revalidationEventRef: 'revalidation-1',
    });
    expect(cleared.clearedByEventRef).toBe('revalidation-1');
    const again = await rejection(
      clearContainment(engine, {
        containmentId: 'containment-smallest',
        revalidationEventRef: 'revalidation-2',
      }),
    );
    expect(again.code).toBe('PROD_ACTIVATION_GATE_REFUSED');
  }, 120_000);

  it('escalates hard failures to DISABLED and refuses while containment is open', async () => {
    const scope = makeScope({ profile_version: 'security-contain' });
    const moduleId = 'module-security';
    await advance(moduleId, scope, 'IMPLEMENTED', 'security-1');
    await advance(moduleId, scope, 'AVAILABLE', 'security-2');
    const outcome = await containForFailedGate(engine, {
      criticalGate: 'SECURITY',
      affectedScopes: [{ moduleId, scope }],
      reason: 'security incident',
      at: NOW,
      containmentId: 'containment-security',
    });
    expect(outcome.containment.action).toBe('DISABLED');
    expect(outcome.state.lifecycleState).toBe('DISABLED');

    const okScope = makeScope({ profile_version: 'security-contain-2' });
    const blocked = evaluateActivationGate({
      ...passingOpportunityInput(okScope),
      openContainment: [
        {
          containmentId: 'containment-security',
          moduleId,
          scopeHash: activationScopeHash(scope),
          action: 'DISABLED',
        },
      ],
    });
    expect(blocked.verdict).toBe('REFUSE');
    if (blocked.verdict === 'REFUSE') {
      expect(blocked.failingGate).toBe('NO_OPEN_CONTAINMENT');
    }
  }, 120_000);

  it('refuses replaying prior PASS while containment is open and re-activates only after clearContainment + fresh evidence', async () => {
    const scope = makeScope({ profile_version: 'containment-replay' });
    const moduleId = 'module-containment-replay';
    await advance(moduleId, scope, 'IMPLEMENTED', 'creplay-1');
    await advance(moduleId, scope, 'AVAILABLE', 'creplay-2');
    await advance(moduleId, scope, 'SHADOW', 'creplay-3');
    await advance(moduleId, scope, 'PROVEN', 'creplay-4');
    const firstPass = await gatePass(scope, 'activation-creplay-1');
    await advance(moduleId, scope, 'ACTIVE', 'creplay-5', { gateResult: firstPass });

    const outcome = await containForFailedGate(engine, {
      criticalGate: 'CAPACITY',
      affectedScopes: [{ moduleId, scope }],
      reason: 'capacity breach blocks replay',
      at: NOW,
      containmentId: 'containment-creplay',
    });
    expect(outcome.state.lifecycleState).toBe('DEGRADED');
    expect((await openContainments(engine, { moduleId })).length).toBe(1);

    // Replaying the previously genuine, still-unexpired PASS is refused while
    // the containment is open (the pre-fix bypass reached ACTIVE here).
    const replay = await rejection(
      advance(moduleId, scope, 'ACTIVE', 'creplay-6', { gateResult: firstPass }),
    );
    expect(replay.code).toBe('PROD_ACTIVATION_GATE_REFUSED');
    expect((replay.detail as { reason?: string }).reason).toBe(
      ModuleStateRefusalReason.CONTAINMENT_OPEN,
    );
    expect((await statesFor(engine, { moduleId, scope })).lifecycleState).toBe('DEGRADED');

    // Clearing the containment is necessary but not sufficient: the older pass
    // is still a replay of an already-consumed activation event.
    await clearContainment(engine, {
      containmentId: 'containment-creplay',
      revalidationEventRef: 'revalidation-creplay',
    });
    const staleReplay = await rejection(
      advance(moduleId, scope, 'ACTIVE', 'creplay-7', { gateResult: firstPass }),
    );
    expect(staleReplay.code).toBe('PROD_ACTIVATION_GATE_REFUSED');
    expect((staleReplay.detail as { reason?: string }).reason).toBe(
      ModuleStateRefusalReason.ACTIVATION_EVENT_ALREADY_CONSUMED,
    );

    // The documented sole path back: clearContainment + a FRESH recorded
    // evaluation for a distinct activation event.
    const fresh = await gatePass(scope, 'activation-creplay-2', '2026-06-02T00:00:00Z');
    await advance(moduleId, scope, 'ACTIVE', 'creplay-8', { gateResult: fresh });
    const after = await statesFor(engine, { moduleId, scope });
    expect(after.lifecycleState).toBe('ACTIVE');
    expect(after.activationEventRef).toBe('activation-creplay-2');
  }, 120_000);

  it('refuses replaying the same activation event from DEGRADED and allows a fresh distinct persisted event', async () => {
    const scope = makeScope({ profile_version: 'degraded-replay' });
    const moduleId = 'module-degraded-replay';
    await advance(moduleId, scope, 'IMPLEMENTED', 'dreplay-1');
    await advance(moduleId, scope, 'AVAILABLE', 'dreplay-2');
    await advance(moduleId, scope, 'SHADOW', 'dreplay-3');
    await advance(moduleId, scope, 'PROVEN', 'dreplay-4');
    const firstPass = await gatePass(scope, 'activation-dreplay-1');
    await advance(moduleId, scope, 'ACTIVE', 'dreplay-5', { gateResult: firstPass });
    await advance(moduleId, scope, 'DEGRADED', 'dreplay-6');

    const replay = await rejection(
      advance(moduleId, scope, 'ACTIVE', 'dreplay-7', { gateResult: firstPass }),
    );
    expect(replay.code).toBe('PROD_ACTIVATION_GATE_REFUSED');
    expect((replay.detail as { reason?: string }).reason).toBe(
      ModuleStateRefusalReason.ACTIVATION_EVENT_ALREADY_CONSUMED,
    );
    expect((await statesFor(engine, { moduleId, scope })).lifecycleState).toBe('DEGRADED');

    const fresh = await gatePass(scope, 'activation-dreplay-2', '2026-06-02T00:00:00Z');
    await advance(moduleId, scope, 'ACTIVE', 'dreplay-8', { gateResult: fresh });
    const after = await statesFor(engine, { moduleId, scope });
    expect(after.lifecycleState).toBe('ACTIVE');
    expect(after.activationEventRef).toBe('activation-dreplay-2');
  }, 120_000);
});

describe('§69.11 rollback (AC-279)', () => {
  it('appends a new activation event, preserves history, and blocks alert resumption', async () => {
    const scope = makeScope({ profile_version: 'rollback' });
    const moduleId = 'module-rollback';
    await advance(moduleId, scope, 'IMPLEMENTED', 'rollback-1');
    await advance(moduleId, scope, 'AVAILABLE', 'rollback-2');
    await advance(moduleId, scope, 'SHADOW', 'rollback-3');
    await advance(moduleId, scope, 'PROVEN', 'rollback-4');
    await advance(moduleId, scope, 'ACTIVE', 'rollback-5', {
      gateResult: await gatePass(scope, 'activation-old'),
    });
    const before = await stateRowsFor(engine, { moduleId, scope });

    const outcome = await rollbackToApproved(engine, {
      moduleId,
      scope,
      restoredArtifactSetHash: HASH_A,
      priorActivationEventRef: 'activation-old',
      newActivationEventRef: 'activation-new',
      candidateReevaluationRef: 'reevaluation-1',
      at: NOW,
      rollbackId: 'rollback-event-1',
    });
    expect(outcome.rollback.newActivationEventRef).toBe('activation-new');
    expect(outcome.rollback.historyPreserved).toBe(true);
    expect(outcome.state.activationEventRef).toBe('activation-new');
    expect(outcome.state.lifecycleState).toBe('PAUSED');
    expect(outcome.alertResumption).toBe('BLOCKED_PENDING_CANDIDATE_REEVALUATION');

    const after = await stateRowsFor(engine, { moduleId, scope });
    // Every historical decision remains resolvable; a new row was appended.
    expect(after.length).toBe(before.length + 1);
    expect(after.some((row) => row.activationEventRef === 'activation-old')).toBe(true);

    const latest = await latestRollback(engine, moduleId);
    expect(latest?.candidateReevaluationRef).toBe('reevaluation-1');
    await expect(
      assertAlertResumptionAllowed(engine, {
        moduleId,
        completedReevaluationRef: 'reevaluation-other',
      }),
    ).rejects.toThrow();
    await assertAlertResumptionAllowed(engine, {
      moduleId,
      completedReevaluationRef: 'reevaluation-1',
    });
  }, 120_000);

  it('refuses reusing an activation event or restoring an unapproved artifact set', async () => {
    const scope = makeScope({ profile_version: 'rollback-refuse' });
    const moduleId = 'module-rollback-refuse';
    await advance(moduleId, scope, 'IMPLEMENTED', 'rr-1');
    await advance(moduleId, scope, 'AVAILABLE', 'rr-2');
    await advance(moduleId, scope, 'SHADOW', 'rr-3');
    await advance(moduleId, scope, 'PROVEN', 'rr-4');
    await advance(moduleId, scope, 'ACTIVE', 'rr-5', {
      gateResult: await gatePass(scope, 'activation-rr'),
    });

    const reused = await rejection(
      rollbackToApproved(engine, {
        moduleId,
        scope,
        restoredArtifactSetHash: HASH_A,
        priorActivationEventRef: 'activation-rr',
        newActivationEventRef: 'activation-rr',
        candidateReevaluationRef: 'reevaluation-rr',
        at: NOW,
      }),
    );
    expect(reused.code).toBe('PROD_LIFECYCLE_TRANSITION_ILLEGAL');

    const unapproved = await rejection(
      rollbackToApproved(engine, {
        moduleId,
        scope,
        restoredArtifactSetHash: HASH_B,
        priorActivationEventRef: 'activation-rr',
        newActivationEventRef: 'activation-rr-new',
        candidateReevaluationRef: 'reevaluation-rr',
        at: NOW,
      }),
    );
    expect(unapproved.code).toBe('PROD_LIFECYCLE_TRANSITION_ILLEGAL');
  }, 120_000);
});

// --- forgery probes (review F1) ---------------------------------------------
//
// ACTIVE must be bound to PERSISTED gate evidence. Each probe builds the exact
// object the pre-fix code accepted and proves it is now refused.

describe('ACTIVE is bound to persisted gate evidence (F1)', () => {
  async function forgedPass(
    scope: ModuleStateScope,
    activationEventRef: string,
    evaluationSetRef: string,
  ): Promise<ActivationGateResult> {
    const scopeHash = activationScopeHash(scope);
    // A deliberate cast: the adversarial caller forges an object shaped like a
    // pass but carrying no evaluator provenance brand. The typed recorder and
    // the persisted-evidence guard must both refuse it at runtime.
    return {
      verdict: 'PASS',
      scopeHash,
      evaluations: [],
      activationEventRef,
      capacityContractRef: 'forged-capacity',
      evaluatedAt: NOW,
      expiresAt: FUTURE,
      evidenceRefs: [],
      activationKind: 'OPPORTUNITY',
      evaluationSetRef,
    } as unknown as ActivationGateResult;
  }

  async function provenLadder(
    moduleId: string,
    scope: ModuleStateScope,
    tag: string,
  ): Promise<void> {
    await advance(moduleId, scope, 'IMPLEMENTED', `${tag}-1`);
    await advance(moduleId, scope, 'AVAILABLE', `${tag}-2`);
    await advance(moduleId, scope, 'SHADOW', `${tag}-3`);
    await advance(moduleId, scope, 'PROVEN', `${tag}-4`);
  }

  it('refuses a hand-built PASS object carrying zero evaluations', async () => {
    const scope = makeScope({ profile_version: 'forged-empty' });
    const moduleId = 'module-forged-empty';
    await provenLadder(moduleId, scope, 'forged-empty');

    const refused = await rejection(
      advance(moduleId, scope, 'ACTIVE', 'forged-empty-5', {
        gateResult: await forgedPass(scope, 'forged-activation-event', `sha256:${'f'.repeat(64)}`),
      }),
    );
    expect(refused.code).toBe('PROD_ACTIVATION_GATE_REFUSED');
    expect((refused.detail as { readonly reason?: string }).reason).toBe('EVIDENCE_SET_EMPTY');

    // No ACTIVE row landed and ZERO gate evaluations were ever persisted.
    const rows = await stateRowsFor(engine, { moduleId, scope });
    expect(rows.some((row) => row.lifecycleState === 'ACTIVE')).toBe(false);
    expect(await activationGateEvaluationsFor(engine, activationScopeHash(scope))).toEqual([]);
  }, 120_000);

  it('refuses a hand-built all-PASS object at every recorder and persists zero rows', async () => {
    const scope = makeScope({ profile_version: 'forged-brand' });
    const moduleId = 'module-forged-brand';
    const scopeHash = activationScopeHash(scope);
    await provenLadder(moduleId, scope, 'forged-brand');

    // The exact pre-fix bypass: 11 fabricated PASS evaluations with no proof
    // they came from `evaluateActivationGate`, offered to both public writers.
    const handBuilt = {
      verdict: 'PASS',
      scopeHash,
      evaluations: ACTIVATION_GATE_ORDER.map((gateKind) => ({
        gateKind,
        verdict: 'PASS',
        failingGate: null,
        reason: null,
        detail: 'forged',
      })),
      activationEventRef: 'forged-via-recorder',
      capacityContractRef: 'forged',
      evaluatedAt: NOW,
      expiresAt: FUTURE,
      evidenceRefs: [],
      activationKind: 'OPPORTUNITY',
      evaluationSetRef: null,
    };

    const viaResult = await rejection(recordActivationGateResult(engine, handBuilt as never));
    expect(viaResult.code).toBe('PROD_ACTIVATION_GATE_REFUSED');
    expect((viaResult.detail as { readonly reason?: string }).reason).toBe(
      'ACTIVATION_PASS_UNBRANDED',
    );

    const viaEvaluation = await rejection(
      recordActivationGateEvaluation(engine, handBuilt as never),
    );
    expect(viaEvaluation.code).toBe('PROD_ACTIVATION_GATE_REFUSED');
    expect((viaEvaluation.detail as { readonly reason?: string }).reason).toBe(
      'ACTIVATION_PASS_UNBRANDED',
    );

    // ZERO rows were minted, so the fabricated set reference cannot name
    // evidence, and ACTIVE stays unreachable.
    expect(await activationGateEvaluationsFor(engine, scopeHash)).toEqual([]);
    const refused = await rejection(
      advance(moduleId, scope, 'ACTIVE', 'forged-brand-5', {
        gateResult: { ...handBuilt, evaluations: [] } as never,
      }),
    );
    expect(refused.code).toBe('PROD_ACTIVATION_GATE_REFUSED');
    const rows = await stateRowsFor(engine, { moduleId, scope });
    expect(rows.some((row) => row.lifecycleState === 'ACTIVE')).toBe(false);
  }, 120_000);

  it('refuses a PASS object whose activation event was never persisted', async () => {
    const scope = makeScope({ profile_version: 'forged-event' });
    const moduleId = 'module-forged-event';
    await provenLadder(moduleId, scope, 'forged-event');

    const recorded = await gatePass(scope, 'activation-real');
    if (recorded.verdict !== 'PASS') throw new Error('expected a recorded PASS');
    const forged = { ...recorded, activationEventRef: 'activation-never-persisted' };

    const refused = await rejection(
      advance(moduleId, scope, 'ACTIVE', 'forged-event-5', { gateResult: forged }),
    );
    expect(refused.code).toBe('PROD_ACTIVATION_GATE_REFUSED');
    expect((refused.detail as { readonly reason?: string }).reason).toBe(
      'EVIDENCE_EVENT_REF_UNPERSISTED',
    );
    const rows = await stateRowsFor(engine, { moduleId, scope });
    expect(rows.some((row) => row.lifecycleState === 'ACTIVE')).toBe(false);
  }, 120_000);

  it('refuses to re-activate from DEGRADED without fresh persisted PASS evidence', async () => {
    const scope = makeScope({ profile_version: 'degraded-reactivation' });
    const moduleId = 'module-degraded-reactivation';
    await provenLadder(moduleId, scope, 'degraded-re');
    // Legitimate recorder -> advance path reaches ACTIVE...
    await advance(moduleId, scope, 'ACTIVE', 'degraded-re-5', {
      gateResult: await gatePass(scope, 'activation-degraded'),
    });
    // ...containment degrades it...
    await advance(moduleId, scope, 'DEGRADED', 'degraded-re-6');

    // ...and a forged PASS (same trick the pre-fix code allowed) cannot
    // re-activate it without a fresh persisted evaluation for a new event.
    const refused = await rejection(
      advance(moduleId, scope, 'ACTIVE', 'degraded-re-7', {
        gateResult: await forgedPass(scope, 'forged-reactivation', `sha256:${'e'.repeat(64)}`),
      }),
    );
    expect(refused.code).toBe('PROD_ACTIVATION_GATE_REFUSED');
    const rows = await stateRowsFor(engine, { moduleId, scope });
    expect(rows[rows.length - 1]?.lifecycleState).toBe('DEGRADED');
    expect(rows.some((row) => row.lifecycleState === 'ACTIVE')).toBe(true); // only the first, legitimate one
  }, 120_000);

  it('accepts a freshly recorded PASS set on the legitimate recorder -> advance path', async () => {
    const scope = makeScope({ profile_version: 'legit-recorded' });
    const moduleId = 'module-legit-recorded';
    await provenLadder(moduleId, scope, 'legit-recorded');

    const recorded = await gatePass(scope, 'activation-legit');
    expect(recorded.verdict).toBe('PASS');
    if (recorded.verdict !== 'PASS') throw new Error('unreachable');
    expect(recorded.evaluationSetRef).toMatch(/^sha256:[0-9a-f]{64}$/);

    await advance(moduleId, scope, 'ACTIVE', 'legit-recorded-5', { gateResult: recorded });
    const active = await statesFor(engine, { moduleId, scope });
    expect(active.lifecycleState).toBe('ACTIVE');
    expect(active.activationEventRef).toBe('activation-legit');
  }, 120_000);
});
