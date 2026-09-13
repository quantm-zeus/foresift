/**
 * Class-templated content fixtures (T027, FR-ALERT-002/003, AC-140/142;
 * PRD §26.7/§26.8).
 *
 * The builders take the classification outcome from the caller (content renders
 * FROM a classification) and supply the inert identity/narrative/execution
 * envelope. Two shapes exist: a compliant EARLY_WATCH render that discloses
 * explicit missing data, and a complete CONFIRMED_OPPORTUNITY render carrying
 * every §26.7/§26.8 field.
 */
import type {
  AlertClassificationOutcome,
  AlertContentRenderInput,
  AlertContentSuppressionFlags,
} from '@foresift/alerts';
import { AlertSuppressionReason } from '@foresift/domain';
import {
  ALERT_FIXTURE_T0,
  ALERT_FIXTURE_VALID_UNTIL,
  ALERT_HASH_A,
  cloneFixture,
  deepFreeze,
} from './common.ts';
import { EARLY_WATCH_COUNTER_THESIS, EARLY_WATCH_MISSING_DATA } from './classification.ts';

/** A fully populated §26.8 execution/utility block. */
export function fullExecutionFixture(
  overrides: Partial<NonNullable<AlertContentRenderInput['execution']>> = {},
): NonNullable<AlertContentRenderInput['execution']> {
  return {
    populationScopeClaim: 'prospectively observed supported-program universe',
    decisionReadyAt: ALERT_FIXTURE_T0,
    actionDelayPolicyRef: 'delay-policy-v1',
    requiredDelayPassMatrix: { required: true, passed: true },
    baseExecutionResult: { fillRatio: 0.9 },
    conservativeExecutionResult: { fillRatio: 0.7 },
    maximumExecutableNotionalUsd: '5000.00',
    capacityCaveat: 'capacity is bounded by observed pool depth',
    poolProgramAdapterVersions: { poolAdapter: 'v1', programAdapter: 'v2' },
    conservativeNetUtilityRange: { low: 0.01, high: 0.05 },
    portfolioExposureConstraintResult: { passed: true },
    sourceEffectiveIndependence: 'three independent clusters after dependence discount',
    coverageGaps: [],
    statisticalAuthorizationScope: 'profile-1/horizon-24h/scenario-1',
    statisticalAuthorizationExpiresAt: ALERT_FIXTURE_VALID_UNTIL,
    ...overrides,
  };
}

/** The suppression flags that withhold a positive headline when any is not satisfied. */
export function passingSuppressionFlags(
  overrides: Partial<AlertContentSuppressionFlags> = {},
): AlertContentSuppressionFlags {
  return {
    criticalContradiction: false,
    requiredDelayScenarioPassed: true,
    adaptersSupported: true,
    performanceClaimAuthorized: true,
    ...overrides,
  };
}

/**
 * One §26.8 headline-withholding case: the flag that fails and the closed
 * suppression reason the renderer must record.
 */
export interface HeadlineSuppressionCase {
  readonly label: string;
  readonly flags: AlertContentSuppressionFlags;
  readonly expectedReason: AlertSuppressionReason;
}

export const HEADLINE_SUPPRESSION_MATRIX: readonly HeadlineSuppressionCase[] = deepFreeze([
  {
    label: 'critical contradiction in the body',
    flags: passingSuppressionFlags({ criticalContradiction: true }),
    expectedReason: AlertSuppressionReason.CRITICAL_CONTRADICTION,
  },
  {
    label: 'required delay/stress scenario failed',
    flags: passingSuppressionFlags({ requiredDelayScenarioPassed: false }),
    expectedReason: AlertSuppressionReason.FAILED_REQUIRED_DELAY_SCENARIO,
  },
  {
    label: 'unsupported adapter',
    flags: passingSuppressionFlags({ adaptersSupported: false }),
    expectedReason: AlertSuppressionReason.UNSUPPORTED_ADAPTER,
  },
  {
    label: 'unauthorized performance claim',
    flags: passingSuppressionFlags({ performanceClaimAuthorized: false }),
    expectedReason: AlertSuppressionReason.UNAUTHORIZED_PERFORMANCE_CLAIM,
  },
]);

/** Explicit missing-data disclosure for an absent social capability (§67.4). */
export const SOCIAL_UNAVAILABLE_MISSING_DATA_ENTRY =
  'social_capability:SOCIAL_UNAVAILABLE' as const;

/** A fresh render input. EARLY_WATCH defaults to a missing-data-disclosing shape. */
export function renderInputFixture(
  classification: AlertClassificationOutcome,
  overrides: Partial<AlertContentRenderInput> = {},
): AlertContentRenderInput {
  const base: AlertContentRenderInput = {
    classification,
    identity: {
      alertId: 'aalt-fixture-1',
      assetId: 'asset-1',
      chainId: 'solana',
      canonicalContract: 'contract-1',
      profileId: 'profile-1',
      candidateStage: 'EMERGING',
      detectedAt: ALERT_FIXTURE_T0,
      deliveredAt: ALERT_FIXTURE_T0,
    },
    narrative: {
      whyEarly: 'emerging before full deep-evidence coverage is available',
      positiveEvidence: ['evidence-1'],
      riskEvidence: ['risk-1'],
      counterThesis: EARLY_WATCH_COUNTER_THESIS,
      alphaEvidence: [{ evidenceRef: 'evidence-1', lifecycleStatus: 'ACTIVE' }],
      patternStage: 'EARLY',
      patternRemainingActionability: 'still early in the pattern',
      multiViewContradictions: [],
      vetoes: [],
      failureHazardDrivers: ['liquidity depth'],
      noveltyApplicabilityLimits: ['regime shift'],
      providerConflicts: [],
      thesisInvalidationConditions: ['liquidity collapse'],
      sources: ['source-1'],
      freshness: ALERT_FIXTURE_T0,
    },
    validUntil: ALERT_FIXTURE_VALID_UNTIL,
    actionabilityState: 'ACTIONABLE',
    cancellationState: 'NONE',
    evidenceTimestamp: ALERT_FIXTURE_T0,
    configuredNotionalUsd: null,
    modeledEntryImpact: null,
    modeledExitImpact: null,
    executionAssumptions: null,
    frozenRunRef: 'run-frozen-1',
    frozenEvidenceRef: 'evidence-frozen-1',
    researchDisclaimer: 'Research only; not investment advice.',
    socialCapabilityState: 'SOCIAL_FULL',
    execution: null,
    suppression: passingSuppressionFlags(),
    missingData: [...EARLY_WATCH_MISSING_DATA],
    candidateHeadline: 'Emerging candidate with incomplete deep-evidence coverage',
  };
  return { ...cloneFixture(base), ...overrides };
}

/** An EARLY_WATCH render input that discloses explicit missing data. */
export function earlyWatchRenderInput(
  classification: AlertClassificationOutcome,
  overrides: Partial<AlertContentRenderInput> = {},
): AlertContentRenderInput {
  return renderInputFixture(classification, {
    missingData: [...EARLY_WATCH_MISSING_DATA],
    ...overrides,
  });
}

/** A complete CONFIRMED_OPPORTUNITY render input: every §26.7/§26.8 field set. */
export function confirmedOpportunityRenderInput(
  classification: AlertClassificationOutcome,
  overrides: Partial<AlertContentRenderInput> = {},
): AlertContentRenderInput {
  return renderInputFixture(classification, {
    identity: {
      alertId: 'aalt-fixture-confirmed-1',
      assetId: 'asset-1',
      chainId: 'solana',
      canonicalContract: 'contract-1',
      profileId: 'profile-1',
      candidateStage: 'CONFIRMED',
      detectedAt: ALERT_FIXTURE_T0,
      deliveredAt: ALERT_FIXTURE_T0,
    },
    configuredNotionalUsd: '1000.00',
    modeledEntryImpact: 0.01,
    modeledExitImpact: 0.02,
    executionAssumptions: { slippageBps: 50, poolAdapter: 'v1' },
    execution: fullExecutionFixture(),
    missingData: [],
    candidateHeadline: 'Confirmed opportunity under the active profile and frozen run',
    narrative: {
      ...renderInputFixture(classification).narrative,
      whyEarly: 'still early relative to the modeled opportunity horizon',
      positiveEvidence: ['evidence-1', 'evidence-2'],
      alphaEvidence: [{ evidenceRef: 'evidence-1', lifecycleStatus: 'ACTIVE' }],
    },
    ...overrides,
  });
}

/**
 * The §26.7/§26.8 fields an opportunity envelope REQUIRES; any one null renders
 * as explicit missing data and refuses an incomplete confirmed notification.
 */
export const OPPORTUNITY_REQUIRED_RENDER_FIELDS: readonly string[] = deepFreeze([
  'configuredNotionalUsd',
  'modeledEntryImpact',
  'modeledExitImpact',
  'executionAssumptions',
  'execution',
]);

/** A sentinel content hash the unit fixtures never confuse with real output. */
export const CONTENT_FIXTURE_SENTINEL_HASH = ALERT_HASH_A;
