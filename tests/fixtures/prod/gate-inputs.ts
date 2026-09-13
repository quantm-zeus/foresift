/**
 * Canonical PROD gate-input builders (T033, FR-PROD-001…006).
 *
 * These are pure, deterministic builders over the real
 * `@foresift/capability-registry`/`@foresift/release-conformance` surfaces. They
 * contain no credentials: the gate-evidence pepper is an obvious local-test
 * placeholder, never a production value, never logged.
 */
import type { SustainableCapacityContract } from '@foresift/domain';
import { createGateEvidence } from '@foresift/release-conformance';
import {
  ActivationKind,
  NegativeControlKind,
  activationScopeHash,
  parseModuleStateScope,
  type ActivationGateInput,
  type AvailableEvidenceInput,
  type DistributionEvidenceInput,
  type ModuleStateScope,
  type RegisteredStatisticalEvidence,
} from '@foresift/capability-registry';

/** Obvious placeholder pepper for local/PGlite tests only — NOT a credential. */
export const PROD_TEST_GATE_PEPPER = 'prod-fixture-gate-pepper-placeholder';

export const PROD_FIXTURE_NOW = '2026-06-01T00:00:00Z';
export const PROD_FIXTURE_FUTURE = '2027-06-01T00:00:00Z';
export const PROD_FIXTURE_FAR_FUTURE = '2030-01-01T00:00:00Z';
export const PROD_FIXTURE_HASH_A = `sha256:${'a'.repeat(64)}`;
export const PROD_FIXTURE_HASH_B = `sha256:${'b'.repeat(64)}`;

/** The canonical exactly-scoped §69.5 activation scope for PROD fixtures. */
export function makeProdScope(overrides: Partial<ModuleStateScope> = {}): ModuleStateScope {
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

/** A §62.5 sustainable-capacity contract that passes every capacity law. */
export function passingCapacityContract(
  overrides: Partial<SustainableCapacityContract> = {},
): SustainableCapacityContract {
  return {
    contractId: 'prod-capacity-1',
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
    expiresAt: PROD_FIXTURE_FUTURE,
    result: 'PASS',
    ...overrides,
  };
}

/** Registered statistical evidence with all four §31/§39 negative controls. */
export function passingStatisticalEvidence(
  scopeHash: string,
  overrides: Partial<RegisteredStatisticalEvidence> = {},
): RegisteredStatisticalEvidence {
  return {
    evidenceRef: 'prod-stat-1',
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
    expiresAt: PROD_FIXTURE_FAR_FUTURE,
    ...overrides,
  };
}

/** Signed, hashed, exact-scope, unexpired gate evidence for the scope hash. */
export function passingGateEvidence(
  scopeHash: string,
  pepper: string = PROD_TEST_GATE_PEPPER,
  expiresAt: string = PROD_FIXTURE_FAR_FUTURE,
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
    pepper,
  );
  return { record, pepper };
}

/** The complete §69.3 AVAILABLE evidence bundle (every dimension green). */
export function completeAvailableEvidence(): AvailableEvidenceInput {
  return {
    data: true,
    rights: true,
    capability: true,
    sourceCoverage: true,
    poolAdapter: true,
    cost: true,
    capacity: true,
    freshness: true,
  };
}

/**
 * A fully compliant OPPORTUNITY gate input for the exact scope. `scopeHash` is
 * supplied by the caller so the evidence and the scope stay bound.
 */
export function passingOpportunityGateInput(scope: ModuleStateScope): ActivationGateInput {
  const scopeHash = activationScopeHash(scope);
  return {
    kind: ActivationKind.OPPORTUNITY,
    scope,
    now: PROD_FIXTURE_NOW,
    implemented: true,
    available: true,
    proven: true,
    availableEvidence: completeAvailableEvidence(),
    registeredStatisticalEvidence: [passingStatisticalEvidence(scopeHash)],
    verifiedGateEvidence: passingGateEvidence(scopeHash),
    capacityContract: passingCapacityContract(),
    distributionEvidence: null,
    openContainment: [],
    activationEventRef: 'activation-prod-1',
    expiresAt: PROD_FIXTURE_FUTURE,
    evidenceRefs: ['evidence-prod-1'],
  };
}

/** §69.9 workspace/public distribution evidence (every dimension green). */
export function passingDistributionEvidence(
  overrides: Partial<DistributionEvidenceInput> = {},
): DistributionEvidenceInput {
  return {
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
    ...overrides,
  };
}
