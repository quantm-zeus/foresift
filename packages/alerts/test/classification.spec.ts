/**
 * Classification / policy / content / commit suite (T018, FR-ALERT-001…005,
 * AC-140/141/142/143; PRD §26.2/§26.3/§26.7/§26.8, §33.1/§33.9, §34.3, §67.4).
 *
 * Runs on a real SQL engine (PGlite) with the engine's deterministic
 * `FakeNotificationChannel`. Proven here:
 * - six-class policy totality and genuinely separate TTL/cooldown/content/
 *   denominator policies, plus the D3 EARLY_WATCH TTL invariant and the
 *   persisted policy loader's typed refusals;
 * - every §26.3 gate refusal is reachable and typed, and unknown/missing gate
 *   input fails closed;
 * - EARLY_WATCH refuses high-conviction/buy content while a compliant watch
 *   record renders; opportunity content completeness is enforced;
 * - SOCIAL_UNAVAILABLE is unknown coverage: it never lowers the class and never
 *   satisfies organic confirmation;
 * - the classification+content+commit path adds bounded internal overhead, and a
 *   budget-exceeded alert is expired/suppressed instead of delivered late.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  ALL_ALERT_CLASSES,
  ALL_CONFIRMED_OPPORTUNITY_GATES,
  ALL_ALERT_SUPPRESSION_REASONS,
  AlertClass,
  AlertSuppressionReason,
  ErrorCode,
  type ConfirmedOpportunityGate,
} from '@foresift/domain';
import type { AlertClassPolicyRow } from '@foresift/shared-schemas';
import {
  FakeNotificationChannel,
  claimOutboxBatch,
  deliverClaimed,
} from '@foresift/workflow-runtime';
import {
  AlertContentRefusedError,
  AlertPolicySource,
  alertPolicyFor,
  buildAlertPolicyRegistry,
  classifyAlert,
  commitAlert,
  confirmedOpportunityPasses,
  DEFAULT_ALERT_POLICY_REGISTRY,
  deriveAlertFingerprint,
  deriveAlertUpdateKey,
  evaluateConfirmedOpportunityGates,
  firstRefusedGate,
  loadAlertPolicies,
  renderAlertContent,
  socialCoverageVerdict,
  validateConfirmedOpportunityGateResults,
  type AlertClassificationOutcome,
  type AlertContentRenderInput,
  type CommitAlertInput,
  type ConfirmedOpportunityGateInput,
  type RenderedAlertContent,
} from '../src/index.ts';
import {
  HASH_A,
  closeTestDatabase,
  expectForesiftError,
  makeTestDatabase,
  seedPolicyRow,
  seedRun,
  withTestDatabase,
  type TestDatabase,
} from './helpers.ts';

const T0 = '2026-06-01T12:00:00.000Z';
const T_EXPIRING = '2026-06-01T12:58:00.000Z';
const T_EXPIRED = '2026-06-01T13:30:00.000Z';
const T_VALID = '2026-06-01T13:00:00.000Z';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
}, 120_000);

afterAll(async () => {
  await closeTestDatabase(tdb);
});

// --- fixtures ---------------------------------------------------------------

function passingGateInput(
  overrides: Partial<Record<keyof ConfirmedOpportunityGateInput, unknown>> = {},
): ConfirmedOpportunityGateInput {
  const base = {
    decision: 'ALERT',
    criticalRisk: { riskState: 'LOW', criticalVetoCount: 0 },
    profileEligibility: { profileId: 'profile-1', eligibleUnderActiveProfile: true },
    dataCoverage: { coverageRatio: 0.9, minimumCoverageRatio: 0.8 },
    independentEvidence: { independentGroupCount: 3, minimumIndependentGroupCount: 2 },
    freshness: {
      market: { ageSeconds: 10, limitSeconds: 60 },
      security: { ageSeconds: 10, limitSeconds: 60 },
      holder: { ageSeconds: 10, limitSeconds: 60 },
    },
    semanticValidation: { semanticValidationPassed: true },
    unresolvedConflict: { unresolvedConflictCount: 0, blockingThreshold: 0 },
    fingerprintCooldown: {
      fingerprint: HASH_A,
      duplicateFingerprint: false,
      withinCooldown: false,
    },
    dailyScheduleBudget: { dailyBudgetRemaining: 5, scheduleBudgetRemaining: 3 },
    executionTradability: {
      tradabilityAssessmentId: 'tradability-1',
      passed: true,
      configuredNotionalUsd: '1000.00',
      delaySeconds: 30,
    },
    expiryActionability: { actionability: 'ACTIONABLE' as const },
    solanaSecurity: {
      deterministicChecksPassed: true,
      approvedProfileFallback: false,
      fallbackProfileId: null,
    },
    costPolicy: { costPolicyResult: 'PASS' as const },
  };
  return { ...base, ...overrides } as ConfirmedOpportunityGateInput;
}

function baseClassificationInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    assetId: 'asset-1',
    chainId: 'solana',
    profileId: 'profile-1',
    decision: 'WATCH',
    alertClassRecommendation: null,
    lifecycleState: 'EMERGING',
    riskState: 'LOW',
    multiViewState: 'CONSENSUS_POSITIVE',
    noveltyState: 'IN_DISTRIBUTION',
    costPolicyResult: 'PASS',
    socialCapabilityState: 'SOCIAL_FULL',
    thesisVersion: 1,
    severity: 0.5,
    validUntil: T_VALID,
    validUntilGeneration: 1,
    executionScenarioId: 'scenario-1',
    tradabilityAssessmentId: 'tradability-1',
    materialEvidenceFingerprint: HASH_A,
    priorAlertRef: null,
    gateResults: [],
    ...overrides,
  };
}

function confirmedClassification(
  overrides: Record<string, unknown> = {},
): AlertClassificationOutcome {
  return classifyAlert(
    baseClassificationInput({
      decision: 'ALERT',
      alertClassRecommendation: 'CONFIRMED_OPPORTUNITY',
      lifecycleState: 'CONFIRMED',
      gateInputs: passingGateInput(),
      now: T0,
      ...overrides,
    }),
  );
}

function earlyWatchClassification(
  overrides: Record<string, unknown> = {},
): AlertClassificationOutcome {
  return classifyAlert(
    baseClassificationInput({
      decision: 'WATCH',
      alertClassRecommendation: 'EARLY_WATCH',
      lifecycleState: 'EMERGING',
      now: T0,
      ...overrides,
    }),
  );
}

function fullExecution(
  overrides: Partial<NonNullable<AlertContentRenderInput['execution']>> = {},
): NonNullable<AlertContentRenderInput['execution']> {
  return {
    populationScopeClaim: 'prospectively observed supported-program universe',
    decisionReadyAt: T0,
    actionDelayPolicyRef: 'delay-policy-v1',
    requiredDelayPassMatrix: { required: true, passed: true },
    baseExecutionResult: { fillRatio: 0.9 },
    conservativeExecutionResult: { fillRatio: 0.7 },
    maximumExecutableNotionalUsd: '5000.00',
    capacityCaveat: 'capacity is bounded by pool depth',
    poolProgramAdapterVersions: { poolAdapter: 'v1', programAdapter: 'v2' },
    conservativeNetUtilityRange: { low: 0.01, high: 0.05 },
    portfolioExposureConstraintResult: { passed: true },
    sourceEffectiveIndependence: 'three independent clusters',
    coverageGaps: [],
    statisticalAuthorizationScope: 'profile-1/horizon-24h/scenario-1',
    statisticalAuthorizationExpiresAt: T_VALID,
    ...overrides,
  };
}

function renderInput(
  classification: AlertClassificationOutcome,
  overrides: Record<string, unknown> = {},
): AlertContentRenderInput {
  return {
    classification,
    identity: {
      alertId: 'alert-1',
      assetId: 'asset-1',
      chainId: 'solana',
      canonicalContract: 'contract-1',
      profileId: 'profile-1',
      candidateStage: 'EMERGING',
      detectedAt: T0,
      deliveredAt: T0,
    },
    narrative: {
      whyEarly: 'emerging before full deep-evidence coverage',
      positiveEvidence: ['evidence-1'],
      riskEvidence: ['risk-1'],
      counterThesis: 'the pattern may be a false positive',
      alphaEvidence: [{ evidenceRef: 'evidence-1', lifecycleStatus: 'ACTIVE' }],
      patternStage: 'EARLY',
      patternRemainingActionability: 'still early',
      multiViewContradictions: [],
      vetoes: [],
      failureHazardDrivers: ['liquidity'],
      noveltyApplicabilityLimits: ['regime shift'],
      providerConflicts: [],
      thesisInvalidationConditions: ['liquidity collapse'],
      sources: ['source-1'],
      freshness: T0,
    },
    validUntil: T_VALID,
    actionabilityState: 'ACTIONABLE' as const,
    cancellationState: 'NONE' as const,
    evidenceTimestamp: T0,
    configuredNotionalUsd: '1000.00',
    modeledEntryImpact: 0.01,
    modeledExitImpact: 0.02,
    executionAssumptions: { slippageBps: 50 },
    frozenRunRef: 'run-frozen-1',
    frozenEvidenceRef: 'evidence-frozen-1',
    researchDisclaimer: 'Research only; not investment advice.',
    socialCapabilityState: 'SOCIAL_FULL' as const,
    execution: fullExecution(),
    suppression: {
      criticalContradiction: false,
      requiredDelayScenarioPassed: true,
      adaptersSupported: true,
      performanceClaimAuthorized: true,
    },
    missingData: ['market_depth_snapshot'],
    candidateHeadline: 'Emerging candidate with partial coverage',
    ...overrides,
  } as AlertContentRenderInput;
}

const POLICY_TEMPLATE_BY_CLASS: Readonly<Record<string, string>> = {
  EARLY_WATCH: 'EARLY_WATCH',
  CONFIRMED_OPPORTUNITY: 'OPPORTUNITY',
  THESIS_STRENGTHENING: 'THESIS_UPDATE',
  THESIS_WEAKENING: 'THESIS_UPDATE',
  OPPORTUNITY_EXPIRED: 'EXPIRY',
  RISK_ALERT: 'RISK',
};

function policyRow(overrides: Partial<AlertClassPolicyRow> = {}): AlertClassPolicyRow {
  const alertClass = (overrides.alertClass ?? 'EARLY_WATCH') as string;
  return {
    policyId: 'policy-1',
    alertClass,
    version: 1,
    configHash: HASH_A,
    config: {
      contentPolicyVersion: 1,
      template: POLICY_TEMPLATE_BY_CLASS[alertClass] ?? 'EARLY_WATCH',
    },
    ttlSeconds: 900,
    cooldownSeconds: 60,
    highConvictionAllowed: false,
    confirmedDenominatorMember: alertClass === 'CONFIRMED_OPPORTUNITY',
    thresholds: {},
    supersededBy: null,
    createdAt: T0,
    ...overrides,
  } as AlertClassPolicyRow;
}

function throwsWithCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    const actual = error as { code?: string; name?: string };
    if (actual.code !== code) {
      throw new Error(
        `expected ForesiftError ${code}, got ${actual.name}: ${(error as Error).message}`,
      );
    }
    return;
  }
  throw new Error(`expected a throw with code ${code}, but the call resolved`);
}

// --- T012 policy registry ---------------------------------------------------

describe('T012 per-class policy registry (AC-140)', () => {
  it('is total over the six classes with separate TTL/cooldown/content/denominator', () => {
    const seen = new Set<string>();
    for (const alertClass of ALL_ALERT_CLASSES) {
      const policy = alertPolicyFor(alertClass);
      expect(policy.alertClass).toBe(alertClass);
      expect(policy.ttlSeconds).toBeGreaterThan(0);
      expect(policy.cooldownSeconds).toBeGreaterThanOrEqual(0);
      expect(policy.source).toBe(AlertPolicySource.DEFAULT);
      expect(policy.policyId).toBeNull();
      seen.add(`${policy.ttlSeconds}:${policy.cooldownSeconds}:${policy.content.template}`);
    }
    // Six classes, and their (ttl, cooldown, template) triples are not one blob.
    expect(seen.size).toBeGreaterThanOrEqual(4);

    const early = alertPolicyFor(AlertClass.EARLY_WATCH);
    const confirmed = alertPolicyFor(AlertClass.CONFIRMED_OPPORTUNITY);
    expect(early.ttlSeconds).toBeLessThan(confirmed.ttlSeconds);
    expect(early.cooldownSeconds).not.toBe(confirmed.cooldownSeconds);
    expect(early.content.template).not.toBe(confirmed.content.template);
    expect(early.content.requiresMissingData).toBe(true);
    expect(confirmed.content.requiresOpportunityEnvelope).toBe(true);
    expect(early.content.highConvictionAllowed).toBe(false);
    expect(confirmed.content.highConvictionAllowed).toBe(true);
    expect(early.confirmedDenominatorMember).toBe(false);
    expect(confirmed.confirmedDenominatorMember).toBe(true);

    // The default registry is total and resolves the same policies.
    for (const alertClass of ALL_ALERT_CLASSES) {
      expect(DEFAULT_ALERT_POLICY_REGISTRY.policyFor(alertClass).alertClass).toBe(alertClass);
    }
  });

  it('refuses an unknown class with a typed error', () => {
    throwsWithCode(() => alertPolicyFor('NOT_A_CLASS' as never), ErrorCode.ALERT_CLASS_UNKNOWN);
  });

  it('asserts the D3 EARLY_WATCH TTL invariant on every resolved registry', () => {
    // A direct row that violates the invariant (persisted TTL ordering) refuses.
    throwsWithCode(
      () =>
        buildAlertPolicyRegistry([
          policyRow({ policyId: 'p-ew', alertClass: 'EARLY_WATCH', ttlSeconds: 4000 }),
          policyRow({ policyId: 'p-co', alertClass: 'CONFIRMED_OPPORTUNITY', ttlSeconds: 3600 }),
        ]),
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
    );
  });

  it('refuses a foreign class and an ambiguous duplicate active version', () => {
    throwsWithCode(
      () => buildAlertPolicyRegistry([policyRow({ alertClass: 'BOGUS' as never })]),
      ErrorCode.ALERT_CLASS_UNKNOWN,
    );
    throwsWithCode(
      () =>
        buildAlertPolicyRegistry([
          policyRow({ policyId: 'p-a', alertClass: 'RISK_ALERT', version: 1 }),
          policyRow({ policyId: 'p-b', alertClass: 'RISK_ALERT', version: 2 }),
        ]),
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
    );
  });

  it('loads persisted policy versions and falls back to the in-code default', async () => {
    await withTestDatabase(async ({ engine }) => {
      await seedPolicyRow(engine, {
        policyId: 'policy-ew-2',
        alertClass: 'EARLY_WATCH',
        version: 2,
        ttlSeconds: 600,
        cooldownSeconds: 120,
        thresholds: { severityDelta: 0.2, thesisVersionDelta: 2 },
      });
      const registry = await loadAlertPolicies(engine);
      const early = registry.policyFor(AlertClass.EARLY_WATCH);
      expect(early.source).toBe(AlertPolicySource.PERSISTED);
      expect(early.version).toBe(2);
      expect(early.policyId).toBe('policy-ew-2');
      expect(early.ttlSeconds).toBe(600);
      expect(early.cooldownSeconds).toBe(120);
      expect(early.thresholds.severityDelta).toBe(0.2);
      expect(registry.policyFor(AlertClass.CONFIRMED_OPPORTUNITY).source).toBe(
        AlertPolicySource.DEFAULT,
      );
    });
  }, 120_000);

  it('refuses an unmapped persisted content-policy version', async () => {
    await withTestDatabase(async ({ engine }) => {
      await seedPolicyRow(engine, {
        policyId: 'policy-bad-version',
        alertClass: 'THESIS_WEAKENING',
        version: 1,
        ttlSeconds: 1800,
        config: { contentPolicyVersion: 99, template: 'THESIS_UPDATE' },
      });
      await expectForesiftError(loadAlertPolicies(engine), ErrorCode.ALERT_POLICY_UNKNOWN);
    });
  }, 120_000);

  it('refuses a persisted content template that does not match its class', async () => {
    await withTestDatabase(async ({ engine }) => {
      await seedPolicyRow(engine, {
        policyId: 'policy-bad-template',
        alertClass: 'RISK_ALERT',
        version: 1,
        ttlSeconds: 7200,
        config: { contentPolicyVersion: 1, template: 'OPPORTUNITY' },
      });
      await expectForesiftError(loadAlertPolicies(engine), ErrorCode.ALERT_POLICY_UNKNOWN);
    });
  }, 120_000);

  it('refuses a persisted conviction flag on a non-confirmed class (FR-ALERT-002)', async () => {
    await withTestDatabase(async ({ engine }) => {
      await seedPolicyRow(engine, {
        policyId: 'policy-bad-conviction',
        alertClass: 'THESIS_STRENGTHENING',
        version: 1,
        ttlSeconds: 3600,
        highConvictionAllowed: true,
      });
      await expectForesiftError(loadAlertPolicies(engine), ErrorCode.CONTRACT_INVARIANT_VIOLATED);
    });
  }, 120_000);
});

// --- T013 gate set ----------------------------------------------------------

describe('T013 §26.3 confirmed-opportunity gates (AC-140/141, AC-245…249)', () => {
  it('is the ordered, complete fourteen-gate set and passes a complete input', () => {
    const results = evaluateConfirmedOpportunityGates(passingGateInput());
    expect(results.map((result) => result.gate)).toEqual([...ALL_CONFIRMED_OPPORTUNITY_GATES]);
    expect(results).toHaveLength(ALL_CONFIRMED_OPPORTUNITY_GATES.length);
    expect(results.every((result) => result.passed && result.reason === null)).toBe(true);
    expect(firstRefusedGate(results)).toBeNull();
  });

  it('is total and fails closed for missing or unknown input', () => {
    for (const input of [null, undefined, {}]) {
      const results = evaluateConfirmedOpportunityGates(input as never);
      expect(results).toHaveLength(ALL_CONFIRMED_OPPORTUNITY_GATES.length);
      expect(results.every((result) => !result.passed)).toBe(true);
      expect(results.every((result) => result.reason === AlertSuppressionReason.GATE_REFUSED)).toBe(
        true,
      );
    }
    // A partial input passes only the gate whose evidence is actually present;
    // every gate whose input is missing refuses.
    const partial = evaluateConfirmedOpportunityGates({ decision: 'ALERT' } as never);
    expect(partial.filter((result) => result.passed)).toHaveLength(1);
    expect(partial.find((result) => result.gate === 'DECISION_ALERT')?.passed).toBe(true);
    expect(firstRefusedGate(partial)?.gate).toBe('NO_CRITICAL_RISK');
  });

  it('reaches every gate refusal with a typed reason', () => {
    const cases: readonly {
      readonly gate: ConfirmedOpportunityGate;
      readonly input: ConfirmedOpportunityGateInput;
      readonly reason: AlertSuppressionReason;
    }[] = [
      {
        gate: 'DECISION_ALERT',
        input: passingGateInput({ decision: 'WATCH' }),
        reason: AlertSuppressionReason.GATE_REFUSED,
      },
      {
        gate: 'NO_CRITICAL_RISK',
        input: passingGateInput({
          criticalRisk: { riskState: 'CRITICAL', criticalVetoCount: 0 },
        }),
        reason: AlertSuppressionReason.GATE_REFUSED,
      },
      {
        gate: 'PROFILE_ELIGIBILITY',
        input: passingGateInput({
          profileEligibility: { profileId: 'profile-1', eligibleUnderActiveProfile: false },
        }),
        reason: AlertSuppressionReason.GATE_REFUSED,
      },
      {
        gate: 'MINIMUM_DATA_COVERAGE',
        input: passingGateInput({
          dataCoverage: { coverageRatio: 0.5, minimumCoverageRatio: 0.8 },
        }),
        reason: AlertSuppressionReason.GATE_REFUSED,
      },
      {
        gate: 'MINIMUM_INDEPENDENT_EVIDENCE_GROUPS',
        input: passingGateInput({
          independentEvidence: { independentGroupCount: 1, minimumIndependentGroupCount: 2 },
        }),
        reason: AlertSuppressionReason.GATE_REFUSED,
      },
      {
        gate: 'FRESHNESS',
        input: passingGateInput({
          freshness: {
            market: { ageSeconds: 120, limitSeconds: 60 },
            security: { ageSeconds: 10, limitSeconds: 60 },
            holder: { ageSeconds: 10, limitSeconds: 60 },
          },
        }),
        reason: AlertSuppressionReason.GATE_REFUSED,
      },
      {
        gate: 'SEMANTIC_VALIDATION',
        input: passingGateInput({ semanticValidation: { semanticValidationPassed: false } }),
        reason: AlertSuppressionReason.GATE_REFUSED,
      },
      {
        gate: 'UNRESOLVED_CONFLICT_THRESHOLD',
        input: passingGateInput({
          unresolvedConflict: { unresolvedConflictCount: 3, blockingThreshold: 1 },
        }),
        reason: AlertSuppressionReason.GATE_REFUSED,
      },
      {
        gate: 'FINGERPRINT_COOLDOWN',
        input: passingGateInput({
          fingerprintCooldown: {
            fingerprint: HASH_A,
            duplicateFingerprint: true,
            withinCooldown: false,
          },
        }),
        reason: AlertSuppressionReason.DUPLICATE_FINGERPRINT,
      },
      {
        gate: 'FINGERPRINT_COOLDOWN',
        input: passingGateInput({
          fingerprintCooldown: {
            fingerprint: HASH_A,
            duplicateFingerprint: false,
            withinCooldown: true,
          },
        }),
        reason: AlertSuppressionReason.WITHIN_COOLDOWN,
      },
      {
        gate: 'DAILY_SCHEDULE_BUDGET',
        input: passingGateInput({
          dailyScheduleBudget: { dailyBudgetRemaining: 0, scheduleBudgetRemaining: 3 },
        }),
        reason: AlertSuppressionReason.DAILY_SCHEDULE_BUDGET_EXHAUSTED,
      },
      {
        gate: 'EXECUTION_AWARE_TRADABILITY',
        input: passingGateInput({
          executionTradability: {
            tradabilityAssessmentId: 'tradability-1',
            passed: false,
            configuredNotionalUsd: '1000.00',
            delaySeconds: 30,
          },
        }),
        reason: AlertSuppressionReason.GATE_REFUSED,
      },
      {
        gate: 'ALERT_NOT_EXPIRED',
        input: passingGateInput({ expiryActionability: { actionability: 'EXPIRED' } }),
        reason: AlertSuppressionReason.EXPIRED_ACTIONABILITY,
      },
      {
        gate: 'SOLANA_SECURITY_CHECKS',
        input: passingGateInput({
          solanaSecurity: {
            deterministicChecksPassed: false,
            approvedProfileFallback: false,
            fallbackProfileId: null,
          },
        }),
        reason: AlertSuppressionReason.GATE_REFUSED,
      },
      {
        gate: 'SOLANA_SECURITY_CHECKS',
        input: passingGateInput({
          solanaSecurity: {
            deterministicChecksPassed: false,
            approvedProfileFallback: true,
            fallbackProfileId: null,
          },
        }),
        reason: AlertSuppressionReason.GATE_REFUSED,
      },
      {
        gate: 'STRICT_FREE_COST_POLICY',
        input: passingGateInput({ costPolicy: { costPolicyResult: 'DEGRADED' } }),
        reason: AlertSuppressionReason.GATE_REFUSED,
      },
    ];

    const covered = new Set<ConfirmedOpportunityGate>();
    for (const testCase of cases) {
      const results = evaluateConfirmedOpportunityGates(testCase.input);
      const result = results.find((entry) => entry.gate === testCase.gate);
      expect(result).toBeDefined();
      expect(result?.passed).toBe(false);
      expect(result?.reason).toBe(testCase.reason);
      expect(ALL_ALERT_SUPPRESSION_REASONS).toContain(result?.reason as AlertSuppressionReason);
      covered.add(testCase.gate);
    }
    // Every one of the fourteen gates is reachable as a typed refusal above.
    expect([...covered].sort()).toEqual([...ALL_CONFIRMED_OPPORTUNITY_GATES].sort());
  });

  it('accepts an approved profile fallback that names its profile', () => {
    const results = evaluateConfirmedOpportunityGates(
      passingGateInput({
        solanaSecurity: {
          deterministicChecksPassed: false,
          approvedProfileFallback: true,
          fallbackProfileId: 'profile-fallback-1',
        },
      }),
    );
    const security = results.find((entry) => entry.gate === 'SOLANA_SECURITY_CHECKS');
    expect(security?.passed).toBe(true);
  });

  it('schema-validates provided gate input fields and refuses them fail-closed (F7a)', () => {
    const unknownRisk = evaluateConfirmedOpportunityGates(
      passingGateInput({
        criticalRisk: { riskState: 'NOT_A_RISK_STATE', criticalVetoCount: 0 },
      }),
    );
    expect(unknownRisk.find((entry) => entry.gate === 'NO_CRITICAL_RISK')?.passed).toBe(false);

    const emptyFingerprint = evaluateConfirmedOpportunityGates(
      passingGateInput({
        fingerprintCooldown: {
          fingerprint: '',
          duplicateFingerprint: false,
          withinCooldown: false,
        },
      }),
    );
    expect(emptyFingerprint.find((entry) => entry.gate === 'FINGERPRINT_COOLDOWN')?.passed).toBe(
      false,
    );

    // An unrecognised top-level field is not part of the §26.3 input: fail closed
    // for the whole set rather than silently ignoring it.
    const unknownField = evaluateConfirmedOpportunityGates({
      ...passingGateInput(),
      extraGate: true,
    } as never);
    expect(unknownField.every((entry) => !entry.passed)).toBe(true);

    // A complete, valid input still passes every gate.
    expect(
      evaluateConfirmedOpportunityGates(passingGateInput()).every((entry) => entry.passed),
    ).toBe(true);

    // `confirmedOpportunityPasses` consumes the same validated evaluator, so a
    // structurally invalid field is false rather than a silent pass.
    expect(confirmedOpportunityPasses(passingGateInput())).toBe(true);
    expect(
      confirmedOpportunityPasses(
        passingGateInput({
          criticalRisk: { riskState: 'NOT_A_RISK_STATE', criticalVetoCount: 0 },
        }),
      ),
    ).toBe(false);
    expect(
      confirmedOpportunityPasses(
        passingGateInput({
          fingerprintCooldown: {
            fingerprint: '',
            duplicateFingerprint: false,
            withinCooldown: false,
          },
        }),
      ),
    ).toBe(false);
  });

  it('fails closed on an unknown or incomplete observed gate set', () => {
    throwsWithCode(
      () =>
        validateConfirmedOpportunityGateResults([
          { gate: 'NOT_A_GATE', passed: true, reason: null },
        ]),
      ErrorCode.ALERT_GATE_UNKNOWN,
    );
    throwsWithCode(
      () =>
        validateConfirmedOpportunityGateResults(
          evaluateConfirmedOpportunityGates(passingGateInput()).slice(0, 3),
        ),
      ErrorCode.ALERT_GATE_SET_INCOMPLETE,
    );
    throwsWithCode(
      () => validateConfirmedOpportunityGateResults('nope'),
      ErrorCode.ALERT_GATE_SET_INCOMPLETE,
    );
  });
});

// --- T014 classification ----------------------------------------------------

describe('T014 classification routing and fail-closed law (AC-140/142/143)', () => {
  it('classifies a gate-complete recommendation as CONFIRMED_OPPORTUNITY', () => {
    const outcome = confirmedClassification();
    expect(outcome.kind).toBe('CLASSIFIED');
    expect(outcome.alertClass).toBe(AlertClass.CONFIRMED_OPPORTUNITY);
    expect(outcome.gateSetComplete).toBe(true);
    expect(outcome.policy?.confirmedDenominatorMember).toBe(true);
  });

  it('consumes an observed gate-result list that deep-equals the evaluation', () => {
    const gateInputs = passingGateInput();
    const gateResults = evaluateConfirmedOpportunityGates(gateInputs);
    const outcome = classifyAlert(
      baseClassificationInput({
        decision: 'ALERT',
        alertClassRecommendation: 'CONFIRMED_OPPORTUNITY',
        lifecycleState: 'CONFIRMED',
        gateInputs,
        gateResults,
        now: T0,
      }),
    );
    expect(outcome.alertClass).toBe(AlertClass.CONFIRMED_OPPORTUNITY);
    expect(outcome.gateSetComplete).toBe(true);
  });

  it('refuses a forged complete gate-result set supplied without gate inputs (F2)', () => {
    // The exact review probe: fourteen {passed:true, reason:null} entries and no
    // gate inputs. Unauthenticated results must never yield a confirmation.
    const forged = ALL_CONFIRMED_OPPORTUNITY_GATES.map((gate) => ({
      gate,
      passed: true,
      reason: null,
    }));
    const outcome = classifyAlert(
      baseClassificationInput({
        decision: 'ALERT',
        alertClassRecommendation: 'CONFIRMED_OPPORTUNITY',
        lifecycleState: 'CONFIRMED',
        gateInputs: null,
        gateResults: forged,
        now: T0,
      }),
    );
    expect(outcome.kind).toBe('SUPPRESSED');
    expect(outcome.alertClass).toBeNull();
    expect(outcome.gateSetComplete).toBe(false);
    expect(outcome.suppressionReason).toBe(AlertSuppressionReason.GATE_REFUSED);
  });

  it('refuses supplied gate results that do not deep-equal the evaluated set (F2)', () => {
    const failingInput = passingGateInput({ costPolicy: { costPolicyResult: 'BLOCKED' } });
    const evaluated = evaluateConfirmedOpportunityGates(failingInput);
    const forged = evaluated.map((result) =>
      result.gate === 'STRICT_FREE_COST_POLICY'
        ? { gate: result.gate, passed: true, reason: null }
        : result,
    );
    throwsWithCode(
      () =>
        classifyAlert(
          baseClassificationInput({
            decision: 'ALERT',
            alertClassRecommendation: 'CONFIRMED_OPPORTUNITY',
            lifecycleState: 'CONFIRMED',
            gateInputs: failingInput,
            gateResults: forged,
            now: T0,
          }),
        ),
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
    );

    // The honest observed set for the same inputs is still refused (gate fails).
    const honest = classifyAlert(
      baseClassificationInput({
        decision: 'ALERT',
        alertClassRecommendation: 'CONFIRMED_OPPORTUNITY',
        lifecycleState: 'CONFIRMED',
        gateInputs: failingInput,
        gateResults: evaluated,
        now: T0,
      }),
    );
    expect(honest.kind).toBe('SUPPRESSED');
    expect(honest.suppressionReason).toBe(AlertSuppressionReason.GATE_REFUSED);
  });

  it('suppresses a would-be confirmed opportunity when gate input is unavailable', () => {
    const outcome = classifyAlert(
      baseClassificationInput({
        decision: 'ALERT',
        alertClassRecommendation: 'CONFIRMED_OPPORTUNITY',
        lifecycleState: 'CONFIRMED',
        gateResults: [],
        now: T0,
      }),
    );
    expect(outcome.kind).toBe('SUPPRESSED');
    expect(outcome.alertClass).toBeNull();
    expect(outcome.suppressionReason).toBe(AlertSuppressionReason.GATE_REFUSED);
  });

  it('suppresses a confirmed recommendation when a gate refuses (no degrade to EARLY_WATCH)', () => {
    const outcome = classifyAlert(
      baseClassificationInput({
        decision: 'ALERT',
        alertClassRecommendation: 'CONFIRMED_OPPORTUNITY',
        lifecycleState: 'CONFIRMED',
        gateInputs: passingGateInput({ costPolicy: { costPolicyResult: 'BLOCKED' } }),
        now: T0,
      }),
    );
    expect(outcome.kind).toBe('SUPPRESSED');
    expect(outcome.suppressionReason).toBe(AlertSuppressionReason.GATE_REFUSED);
    expect(outcome.alertClass).toBeNull();
  });

  it('routes strengthening, weakening, expiry, and risk from lifecycle/risk state', () => {
    const strengthening = classifyAlert(
      baseClassificationInput({
        decision: 'ALERT',
        priorAlertRef: 'alert-prior-1',
        lifecycleState: 'CONFIRMED',
        now: T0,
      }),
    );
    expect(strengthening.alertClass).toBe(AlertClass.THESIS_STRENGTHENING);

    const weakening = classifyAlert(
      baseClassificationInput({
        decision: 'ALERT',
        priorAlertRef: 'alert-prior-1',
        lifecycleState: 'DECAYING',
        now: T0,
      }),
    );
    expect(weakening.alertClass).toBe(AlertClass.THESIS_WEAKENING);

    const risk = classifyAlert(
      baseClassificationInput({
        decision: 'ALERT',
        priorAlertRef: 'alert-prior-1',
        lifecycleState: 'CONFIRMED',
        riskState: 'HIGH',
        now: T0,
      }),
    );
    expect(risk.alertClass).toBe(AlertClass.RISK_ALERT);

    const expiring = classifyAlert(
      baseClassificationInput({
        decision: 'ALERT',
        priorAlertRef: 'alert-prior-1',
        lifecycleState: 'CONFIRMED',
        now: T_EXPIRING,
      }),
    );
    expect(expiring.alertClass).toBe(AlertClass.OPPORTUNITY_EXPIRED);

    const expiredPrior = classifyAlert(
      baseClassificationInput({
        decision: 'ALERT',
        priorAlertRef: 'alert-prior-1',
        lifecycleState: 'CONFIRMED',
        now: T_EXPIRED,
      }),
    );
    expect(expiredPrior.kind).toBe('SUPPRESSED');
    expect(expiredPrior.suppressionReason).toBe(AlertSuppressionReason.EXPIRED_ACTIONABILITY);
  });

  it('suppresses IGNORE/REJECT/INSUFFICIENT_DATA decisions', () => {
    for (const decision of ['IGNORE', 'REJECT', 'INSUFFICIENT_DATA'] as const) {
      const outcome = classifyAlert(baseClassificationInput({ decision, now: T0 }));
      expect(outcome.kind).toBe('SUPPRESSED');
      expect(outcome.suppressionReason).toBe(AlertSuppressionReason.GATE_REFUSED);
    }
  });

  it('defaults a fresh WATCH to EARLY_WATCH', () => {
    const outcome = earlyWatchClassification();
    expect(outcome.alertClass).toBe(AlertClass.EARLY_WATCH);
    expect(outcome.contentTemplate).toBe('EARLY_WATCH');
  });

  it('refuses an unauthorized scraping/private-endpoint capability (§67.3/AC-143)', () => {
    for (const ref of [
      'adapter:scraping:twitter',
      'private-endpoint/social',
      'reverse-engineer api',
    ]) {
      throwsWithCode(
        () => classifyAlert(baseClassificationInput({ requestedCapabilityRefs: [ref], now: T0 })),
        ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      );
    }
  });
});

// --- §67.4 social unknown coverage ------------------------------------------

describe('§67.4 SOCIAL_UNAVAILABLE is unknown coverage (AC-142)', () => {
  it('never names negative evidence, organic confirmation, or a score change', () => {
    const verdict = socialCoverageVerdict('SOCIAL_UNAVAILABLE');
    expect(verdict.unknownCoverage).toBe(true);
    expect(verdict.negativeEvidence).toBe(false);
    expect(verdict.organicConfirmationAvailable).toBe(false);
    expect(verdict.scoreContribution).toBe(0);
  });

  it('does not change the classified class versus full social coverage', () => {
    const withSocial = earlyWatchClassification({ socialCapabilityState: 'SOCIAL_FULL' });
    const withoutSocial = earlyWatchClassification({ socialCapabilityState: 'SOCIAL_UNAVAILABLE' });
    expect(withoutSocial.alertClass).toBe(withSocial.alertClass);
    expect(withoutSocial.socialUnknownCoverage).toBe(true);
    expect(withSocial.socialUnknownCoverage).toBe(false);
  });

  it('refuses an organic-confirmation claim made while social coverage is unavailable', () => {
    const outcome = earlyWatchClassification({
      socialCapabilityState: 'SOCIAL_UNAVAILABLE',
      organicConfirmationClaimed: true,
    });
    expect(outcome.kind).toBe('SUPPRESSED');
    expect(outcome.suppressionReason).toBe(
      AlertSuppressionReason.SOCIAL_UNAVAILABLE_ORGANIC_CONFIRMATION,
    );
    expect(outcome.organicConfirmationClaimed).toBe(false);
  });

  it('renders SOCIAL_UNAVAILABLE as explicit missing data', () => {
    const classification = earlyWatchClassification({
      socialCapabilityState: 'SOCIAL_UNAVAILABLE',
    });
    const rendered = renderAlertContent(
      renderInput(classification, {
        socialCapabilityState: 'SOCIAL_UNAVAILABLE',
        identity: { ...renderInput(classification).identity, candidateStage: 'EMERGING' },
      }),
    );
    expect(rendered.envelope.socialCapabilityState).toBe('SOCIAL_UNAVAILABLE');
    expect(rendered.missingData).toContain('social_capability:SOCIAL_UNAVAILABLE');
  });

  it('refuses a caller social state that contradicts the classification coverage (F4)', () => {
    const classification = earlyWatchClassification({
      socialCapabilityState: 'SOCIAL_UNAVAILABLE',
    });
    // The exact review probe: an unknown-coverage classification rendered with a
    // caller-supplied SOCIAL_FULL state must be refused, not silently rendered
    // without the SOCIAL_UNAVAILABLE marker.
    throwsWithCode(
      () =>
        renderAlertContent(renderInput(classification, { socialCapabilityState: 'SOCIAL_FULL' })),
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
    );
    // The marker is forced whenever the classification says coverage is unknown.
    const forced = renderAlertContent(
      renderInput(classification, {
        socialCapabilityState: 'SOCIAL_UNAVAILABLE',
        missingData: [],
      }),
    );
    expect(forced.missingData).toContain('social_capability:SOCIAL_UNAVAILABLE');
  });

  it('refuses a contradictory rendered payload at the commit boundary (F4)', async () => {
    const runId = await seedRun(tdb.engine);
    const classification = earlyWatchClassification({
      socialCapabilityState: 'SOCIAL_UNAVAILABLE',
    });
    const content = renderAlertContent(
      renderInput(classification, { socialCapabilityState: 'SOCIAL_UNAVAILABLE' }),
    );
    const fingerprint = {
      assetId: 'asset-1',
      profileId: 'profile-1',
      alertType: 'EARLY_WATCH' as const,
      lifecycleState: 'EMERGING' as const,
      riskState: 'LOW' as const,
      thesisVersion: 1,
      executionScenarioId: 'scenario-1',
      validUntilGeneration: 1,
      materialEvidenceFingerprint: HASH_A,
    };
    const contradictory: RenderedAlertContent = {
      ...content,
      envelope: { ...content.envelope, socialCapabilityState: 'SOCIAL_FULL' },
    };
    await expectForesiftError(
      commitAlert(tdb.engine, {
        runId,
        decisionId: `decision-social-${runId}`,
        decisionKind: 'CANDIDATE_DECISION',
        alertId: `alert-social-${runId}`,
        classification,
        content: contradictory,
        fingerprint,
        decisionReadyAt: T0,
        now: T0,
      }),
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
    );

    // An unknown-coverage payload that omits the explicit marker is refused too.
    const markerless: RenderedAlertContent = {
      ...content,
      missingData: content.missingData.filter(
        (entry) => entry !== 'social_capability:SOCIAL_UNAVAILABLE',
      ),
    };
    await expectForesiftError(
      commitAlert(tdb.engine, {
        runId,
        decisionId: `decision-marker-${runId}`,
        decisionKind: 'CANDIDATE_DECISION',
        alertId: `alert-marker-${runId}`,
        classification,
        content: markerless,
        fingerprint,
        decisionReadyAt: T0,
        now: T0,
      }),
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
    );
  }, 120_000);
});

// --- T015 content -----------------------------------------------------------

describe('T015 class-templated content (AC-140/142)', () => {
  it('refuses EARLY_WATCH high-conviction/buy language', () => {
    const classification = earlyWatchClassification();
    for (const headline of ['Guaranteed profit, buy now', 'this is a sure thing', 'LOAD UP']) {
      throwsWithCode(
        () => renderAlertContent(renderInput(classification, { candidateHeadline: headline })),
        ErrorCode.ALERT_HIGH_CONVICTION_LANGUAGE,
      );
    }
  });

  it('refuses high-conviction language anywhere in the delivered envelope (F3)', () => {
    const classification = earlyWatchClassification();
    const base = renderInput(classification);
    const attempts: readonly Record<string, unknown>[] = [
      { narrative: { ...base.narrative, positiveEvidence: ['guaranteed 100x returns'] } },
      { narrative: { ...base.narrative, riskEvidence: ['this will moon'] } },
      { missingData: ['sure thing'] },
      { researchDisclaimer: 'risk-free opportunity' },
    ];
    for (const overrides of attempts) {
      throwsWithCode(
        () => renderAlertContent(renderInput(classification, overrides)),
        ErrorCode.ALERT_HIGH_CONVICTION_LANGUAGE,
      );
    }
    // The same fields stay legal for CONFIRMED_OPPORTUNITY, whose policy allows
    // high-conviction language.
    const confirmed = confirmedClassification();
    const confirmedBase = renderInput(confirmed);
    const rendered = renderAlertContent(
      renderInput(confirmed, {
        narrative: {
          ...confirmedBase.narrative,
          positiveEvidence: ['guaranteed returns'],
        },
      }),
    );
    expect(rendered.headlineSuppressed).toBe(false);
  });

  it('renders a compliant EARLY_WATCH record with explicit missing data', () => {
    const classification = earlyWatchClassification();
    const rendered = renderAlertContent(renderInput(classification));
    expect(rendered.alertClass).toBe(AlertClass.EARLY_WATCH);
    expect(rendered.template).toBe('EARLY_WATCH');
    expect(rendered.headline).toBe('Emerging candidate with partial coverage');
    expect(rendered.headlineSuppressed).toBe(false);
    expect(rendered.missingData.length).toBeGreaterThan(0);
    expect(rendered.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(rendered.envelope.alertClass).toBe(AlertClass.EARLY_WATCH);
  });

  it('refuses an EARLY_WATCH record with no missing-data disclosure', () => {
    const classification = earlyWatchClassification();
    throwsWithCode(
      () => renderAlertContent(renderInput(classification, { missingData: [] })),
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
    );
  });

  it('enforces opportunity content completeness', () => {
    const classification = confirmedClassification();
    const rendered = renderAlertContent(renderInput(classification));
    expect(rendered.template).toBe('OPPORTUNITY');
    expect(rendered.envelope.validUntil).toBe(T_VALID);
    expect(rendered.envelope.actionabilityState).toBe('ACTIONABLE');
    expect(rendered.envelope.configuredNotionalUsd).toBe('1000.00');
    expect(rendered.envelope.modeledEntryImpact).toBeGreaterThan(0);
    expect(rendered.envelope.modeledExitImpact).toBeGreaterThan(0);
    expect(rendered.envelope.cancellationState).toBe('NONE');
    expect(rendered.envelope.evidenceTimestamp).toBe(T0);
    expect(rendered.envelope.frozenRunRef).toBe('run-frozen-1');
    expect(rendered.envelope.frozenEvidenceRef).toBe('evidence-frozen-1');

    try {
      renderAlertContent(renderInput(classification, { execution: null }));
      throw new Error('expected the renderer to refuse incomplete opportunity content');
    } catch (error) {
      expect(error).toBeInstanceOf(AlertContentRefusedError);
      expect((error as AlertContentRefusedError).missing).toContain('execution_analysis');
    }
  });

  it('withholds a positive headline on a critical contradiction or a failed delay scenario', () => {
    const classification = confirmedClassification();
    const contradiction = renderAlertContent(
      renderInput(classification, {
        suppression: {
          criticalContradiction: true,
          requiredDelayScenarioPassed: true,
          adaptersSupported: true,
          performanceClaimAuthorized: true,
        },
      }),
    );
    expect(contradiction.headline).toBeNull();
    expect(contradiction.headlineSuppressed).toBe(true);
    expect(contradiction.suppressionReasons).toContain(
      AlertSuppressionReason.CRITICAL_CONTRADICTION,
    );

    const failedDelay = renderAlertContent(
      renderInput(classification, {
        suppression: {
          criticalContradiction: false,
          requiredDelayScenarioPassed: false,
          adaptersSupported: true,
          performanceClaimAuthorized: true,
        },
      }),
    );
    expect(failedDelay.headline).toBeNull();
    expect(failedDelay.envelope.suppressionReasons).toContain(
      AlertSuppressionReason.FAILED_REQUIRED_DELAY_SCENARIO,
    );
  });

  it('refuses to render a suppressed classification', () => {
    const suppressed = classifyAlert(baseClassificationInput({ decision: 'REJECT', now: T0 }));
    throwsWithCode(
      () => renderAlertContent(renderInput(suppressed)),
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
    );
  });
});

// --- T016 commit adapter ----------------------------------------------------

describe('T016 commit adapter and §33.9 latency budget (AC-141)', () => {
  it('derives deterministic fingerprint and update idempotency keys', () => {
    const input = {
      assetId: 'asset-1',
      profileId: 'profile-1',
      alertType: 'CONFIRMED_OPPORTUNITY' as const,
      lifecycleState: 'CONFIRMED' as const,
      riskState: 'LOW' as const,
      thesisVersion: 3,
      executionScenarioId: 'scenario-1',
      validUntilGeneration: 2,
      materialEvidenceFingerprint: HASH_A,
    };
    const first = deriveAlertFingerprint(input);
    const second = deriveAlertFingerprint({ ...input });
    expect(first.fingerprintHash).toBe(second.fingerprintHash);
    expect(first.fingerprintHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(deriveAlertFingerprint({ ...input, thesisVersion: 4 }).fingerprintHash).not.toBe(
      first.fingerprintHash,
    );

    const updateKey = deriveAlertUpdateKey({
      priorAlertRef: 'alert-prior-1',
      updateKind: 'MATERIAL_DETERIORATION',
      fingerprintHash: first.fingerprintHash,
      thesisVersion: 3,
    });
    expect(updateKey).toBe(
      deriveAlertUpdateKey({
        priorAlertRef: 'alert-prior-1',
        updateKind: 'MATERIAL_DETERIORATION',
        fingerprintHash: first.fingerprintHash,
        thesisVersion: 3,
      }),
    );
    expect(updateKey).not.toBe(
      deriveAlertUpdateKey({
        priorAlertRef: 'alert-prior-1',
        updateKind: 'CANCELLATION',
        fingerprintHash: first.fingerprintHash,
        thesisVersion: 3,
      }),
    );
  });

  function fingerprint() {
    return {
      assetId: 'asset-1',
      profileId: 'profile-1',
      alertType: 'CONFIRMED_OPPORTUNITY' as const,
      lifecycleState: 'CONFIRMED' as const,
      riskState: 'LOW' as const,
      thesisVersion: 1,
      executionScenarioId: 'scenario-1',
      validUntilGeneration: 1,
      materialEvidenceFingerprint: HASH_A,
    };
  }

  function commitInput(
    runId: string,
    classification: AlertClassificationOutcome,
    content: RenderedAlertContent,
    overrides: Partial<CommitAlertInput> = {},
  ): CommitAlertInput {
    return {
      runId,
      decisionId: `decision-${runId}`,
      decisionKind: 'CANDIDATE_DECISION',
      alertId: `alert-${runId}`,
      classification,
      content,
      fingerprint: fingerprint(),
      decisionReadyAt: T0,
      now: T0,
      ...overrides,
    };
  }

  it('commits through the engine and delivers exactly once via the fake channel', async () => {
    const runId = await seedRun(tdb.engine);
    const classification = confirmedClassification();
    const content = renderAlertContent(renderInput(classification));

    const result = await commitAlert(tdb.engine, commitInput(runId, classification, content));
    expect(result.kind).toBe('COMMITTED');
    if (result.kind !== 'COMMITTED') throw new Error('expected a committed alert');
    expect(result.engine.status).toBe('PENDING');
    expect(result.engine.alertId).toBe(`alert-${runId}`);

    const claims = await claimOutboxBatch(tdb.engine, {
      workerId: `worker-${runId}`,
      now: T0,
      leaseMs: 5_000,
      limit: 10,
    });
    const claim = claims.find((entry) => entry.alertRef === `alert-${runId}`);
    expect(claim).toBeDefined();
    const channel = new FakeNotificationChannel();
    const delivery = await deliverClaimed(tdb.engine, channel, {
      workerId: `worker-${runId}`,
      now: T0,
      ...(claim === undefined ? {} : { claims: [claim] }),
    });
    expect(delivery.sent).toHaveLength(1);
    expect(channel.deliveryCount).toBe(1);
    expect(channel.deliveries[0]?.payloadHash).toBe(content.contentHash);
  }, 120_000);

  it('suppresses a budget-exceeded alert instead of delivering it late', async () => {
    const runId = await seedRun(tdb.engine);
    const classification = confirmedClassification();
    const content = renderAlertContent(renderInput(classification));

    const result = await commitAlert(
      tdb.engine,
      commitInput(runId, classification, content, {
        decisionReadyAt: T0,
        now: '2026-06-01T12:05:00.000Z',
        budgetMs: 1_000,
      }),
    );
    expect(result.kind).toBe('SUPPRESSED');
    if (result.kind !== 'SUPPRESSED') throw new Error('expected a suppressed alert');
    expect(result.latencyOutcome).toBe('BUDGET_EXCEEDED_SUPPRESSED');
    expect(result.reason).toBe(AlertSuppressionReason.GATE_REFUSED);

    // No outbox row was written: the engine boundary was never invoked.
    const rows = await tdb.engine.query<{ count: string }>(
      `SELECT count(*) AS count FROM wf.notification_outbox WHERE alert_ref = $1`,
      [`alert-${runId}`],
    );
    expect(Number(rows.rows[0]?.count)).toBe(0);
  }, 120_000);

  it('returns a suppression (no write) for a suppressed classification', async () => {
    const runId = await seedRun(tdb.engine);
    const suppressed = classifyAlert(baseClassificationInput({ decision: 'REJECT', now: T0 }));
    const classification = confirmedClassification();
    const content = renderAlertContent(renderInput(classification));
    const result = await commitAlert(tdb.engine, commitInput(runId, suppressed, content));
    expect(result.kind).toBe('SUPPRESSED');
    if (result.kind !== 'SUPPRESSED') throw new Error('expected a suppressed alert');
    expect(result.reason).toBe(AlertSuppressionReason.GATE_REFUSED);
    expect(result.latencyOutcome).toBeNull();
    const rows = await tdb.engine.query<{ count: string }>(
      `SELECT count(*) AS count FROM wf.notification_outbox WHERE alert_ref = $1`,
      [`alert-${runId}`],
    );
    expect(Number(rows.rows[0]?.count)).toBe(0);
  }, 120_000);

  it('keeps the classification+content path within the §33.1 internal-overhead budget', () => {
    const gateInputs = passingGateInput();
    const iterations = 25;
    const startedAt = performance.now();
    for (let index = 0; index < iterations; index += 1) {
      const outcome = classifyAlert(
        baseClassificationInput({
          decision: 'ALERT',
          alertClassRecommendation: 'CONFIRMED_OPPORTUNITY',
          lifecycleState: 'CONFIRMED',
          gateInputs,
          now: T0,
        }),
      );
      const rendered = renderAlertContent(renderInput(outcome));
      expect(rendered.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
    const elapsedMs = performance.now() - startedAt;
    const perIterationMs = elapsedMs / iterations;
    // §33.1: internal authorization/validation overhead p95 < 100 ms.
    expect(perIterationMs).toBeLessThan(100);
  });
});
