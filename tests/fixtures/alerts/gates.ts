/**
 * Canonical §26.3 gate pass/fail matrices (T027, FR-ALERT-003, PRD §26.3).
 *
 * `PASSING_GATE_INPUT` is the full fourteen-gate input every matrix case starts
 * from; each failure case replaces exactly ONE top-level field so the case
 * isolates a single gate. `GATE_MISSING_INPUT_MATRIX` nulls one gate input at a
 * time: §34.3 fail-closed requires a missing required input to REFUSE the gate,
 * never pass it silently.
 *
 * Inert typed data plus total builders only — no I/O, no clock, no credentials.
 */
import {
  AlertSuppressionReason,
  type ConfirmedOpportunityGate,
  CandidateRiskState,
} from '@foresift/domain';
import type { ConfirmedOpportunityGateInput } from '@foresift/alerts';
import { ALERT_HASH_A, deepFreeze } from './common.ts';

/** A fresh, fully populated, all-gates-pass input. */
export function passingGateInput(
  overrides: Partial<Record<keyof ConfirmedOpportunityGateInput, unknown>> = {},
): ConfirmedOpportunityGateInput {
  const base: ConfirmedOpportunityGateInput = {
    decision: 'ALERT',
    criticalRisk: { riskState: CandidateRiskState.LOW, criticalVetoCount: 0 },
    profileEligibility: { profileId: 'profile-1', eligibleUnderActiveProfile: true },
    dataCoverage: { coverageRatio: 0.92, minimumCoverageRatio: 0.8 },
    independentEvidence: { independentGroupCount: 4, minimumIndependentGroupCount: 3 },
    freshness: {
      market: { ageSeconds: 10, limitSeconds: 60 },
      security: { ageSeconds: 10, limitSeconds: 60 },
      holder: { ageSeconds: 10, limitSeconds: 60 },
    },
    semanticValidation: { semanticValidationPassed: true },
    unresolvedConflict: { unresolvedConflictCount: 0, blockingThreshold: 0 },
    fingerprintCooldown: {
      fingerprint: ALERT_HASH_A,
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
    expiryActionability: { actionability: 'ACTIONABLE' },
    solanaSecurity: {
      deterministicChecksPassed: true,
      approvedProfileFallback: false,
      fallbackProfileId: null,
    },
    costPolicy: { costPolicyResult: 'PASS' },
  };
  return { ...base, ...overrides } as ConfirmedOpportunityGateInput;
}

/** The frozen canonical all-pass input. */
export const PASSING_GATE_INPUT: ConfirmedOpportunityGateInput = deepFreeze(passingGateInput());

export interface GateFailureCase {
  readonly label: string;
  readonly gate: ConfirmedOpportunityGate;
  readonly input: ConfirmedOpportunityGateInput;
  readonly reason: AlertSuppressionReason;
}

export interface GateMissingInputCase {
  readonly label: string;
  readonly gate: ConfirmedOpportunityGate;
  /** The single top-level gate input nulled for this case. */
  readonly field: keyof ConfirmedOpportunityGateInput;
  readonly input: ConfirmedOpportunityGateInput;
  readonly reason: AlertSuppressionReason;
}

function failure(
  label: string,
  gate: ConfirmedOpportunityGate,
  input: ConfirmedOpportunityGateInput,
  reason: AlertSuppressionReason = AlertSuppressionReason.GATE_REFUSED,
): GateFailureCase {
  return deepFreeze({ label, gate, input: deepFreeze(input), reason });
}

function missing(
  label: string,
  gate: ConfirmedOpportunityGate,
  field: keyof ConfirmedOpportunityGateInput,
): GateMissingInputCase {
  return deepFreeze({
    label,
    gate,
    field,
    input: deepFreeze(passingGateInput({ [field]: null })),
    reason: AlertSuppressionReason.GATE_REFUSED,
  });
}

/**
 * Exactly one failure case per §26.3 gate, plus the gates with more than one
 * closed refusal reason (duplicate vs cooldown, expired vs cancelled, degraded
 * vs blocked cost). Every case starts from `passingGateInput()` and replaces
 * one field.
 */
export const GATE_FAILURE_MATRIX: readonly GateFailureCase[] = deepFreeze([
  failure(
    'decision is WATCH, not ALERT',
    'DECISION_ALERT',
    passingGateInput({ decision: 'WATCH' }),
  ),
  failure(
    'critical risk state',
    'NO_CRITICAL_RISK',
    passingGateInput({
      criticalRisk: { riskState: CandidateRiskState.CRITICAL, criticalVetoCount: 0 },
    }),
  ),
  failure(
    'critical veto count above zero',
    'NO_CRITICAL_RISK',
    passingGateInput({
      criticalRisk: { riskState: CandidateRiskState.LOW, criticalVetoCount: 1 },
    }),
  ),
  failure(
    'profile not eligible under the active profile',
    'PROFILE_ELIGIBILITY',
    passingGateInput({
      profileEligibility: { profileId: 'profile-1', eligibleUnderActiveProfile: false },
    }),
  ),
  failure(
    'data coverage below the minimum',
    'MINIMUM_DATA_COVERAGE',
    passingGateInput({ dataCoverage: { coverageRatio: 0.4, minimumCoverageRatio: 0.8 } }),
  ),
  failure(
    'independent evidence groups below the minimum',
    'MINIMUM_INDEPENDENT_EVIDENCE_GROUPS',
    passingGateInput({
      independentEvidence: { independentGroupCount: 2, minimumIndependentGroupCount: 3 },
    }),
  ),
  failure(
    'a non-positive independent-group minimum cannot pass',
    'MINIMUM_INDEPENDENT_EVIDENCE_GROUPS',
    passingGateInput({
      independentEvidence: { independentGroupCount: 0, minimumIndependentGroupCount: 0 },
    }),
  ),
  failure(
    'market freshness age above its limit',
    'FRESHNESS',
    passingGateInput({
      freshness: {
        market: { ageSeconds: 120, limitSeconds: 60 },
        security: { ageSeconds: 10, limitSeconds: 60 },
        holder: { ageSeconds: 10, limitSeconds: 60 },
      },
    }),
  ),
  failure(
    'holder freshness age above its limit',
    'FRESHNESS',
    passingGateInput({
      freshness: {
        market: { ageSeconds: 10, limitSeconds: 60 },
        security: { ageSeconds: 10, limitSeconds: 60 },
        holder: { ageSeconds: 300, limitSeconds: 60 },
      },
    }),
  ),
  failure(
    'semantic validation failed (a control with unexplained lift)',
    'SEMANTIC_VALIDATION',
    passingGateInput({ semanticValidation: { semanticValidationPassed: false } }),
  ),
  failure(
    'unresolved conflicts above the blocking threshold',
    'UNRESOLVED_CONFLICT_THRESHOLD',
    passingGateInput({ unresolvedConflict: { unresolvedConflictCount: 2, blockingThreshold: 0 } }),
  ),
  failure(
    'duplicate fingerprint',
    'FINGERPRINT_COOLDOWN',
    passingGateInput({
      fingerprintCooldown: {
        fingerprint: ALERT_HASH_A,
        duplicateFingerprint: true,
        withinCooldown: false,
      },
    }),
    AlertSuppressionReason.DUPLICATE_FINGERPRINT,
  ),
  failure(
    'within cooldown',
    'FINGERPRINT_COOLDOWN',
    passingGateInput({
      fingerprintCooldown: {
        fingerprint: ALERT_HASH_A,
        duplicateFingerprint: false,
        withinCooldown: true,
      },
    }),
    AlertSuppressionReason.WITHIN_COOLDOWN,
  ),
  failure(
    'daily/schedule budget exhausted',
    'DAILY_SCHEDULE_BUDGET',
    passingGateInput({
      dailyScheduleBudget: { dailyBudgetRemaining: 0, scheduleBudgetRemaining: 3 },
    }),
    AlertSuppressionReason.DAILY_SCHEDULE_BUDGET_EXHAUSTED,
  ),
  failure(
    'execution-aware tradability did not pass',
    'EXECUTION_AWARE_TRADABILITY',
    passingGateInput({
      executionTradability: {
        tradabilityAssessmentId: 'tradability-1',
        passed: false,
        configuredNotionalUsd: '1000.00',
        delaySeconds: 30,
      },
    }),
  ),
  failure(
    'alert actionability expired',
    'ALERT_NOT_EXPIRED',
    passingGateInput({ expiryActionability: { actionability: 'EXPIRED' } }),
    AlertSuppressionReason.EXPIRED_ACTIONABILITY,
  ),
  failure(
    'alert actionability cancelled',
    'ALERT_NOT_EXPIRED',
    passingGateInput({ expiryActionability: { actionability: 'CANCELLED' } }),
    AlertSuppressionReason.EXPIRED_ACTIONABILITY,
  ),
  failure(
    'solana security checks failed without a NAMED approved fallback',
    'SOLANA_SECURITY_CHECKS',
    passingGateInput({
      solanaSecurity: {
        deterministicChecksPassed: false,
        approvedProfileFallback: true,
        fallbackProfileId: null,
      },
    }),
  ),
  failure(
    'strict-free cost policy degraded (paid/unknown-cost operation)',
    'STRICT_FREE_COST_POLICY',
    passingGateInput({ costPolicy: { costPolicyResult: 'DEGRADED' } }),
  ),
  failure(
    'strict-free cost policy blocked',
    'STRICT_FREE_COST_POLICY',
    passingGateInput({ costPolicy: { costPolicyResult: 'BLOCKED' } }),
  ),
]);

/**
 * The §26.3 solana-security gate id, declared before the missing-input matrix
 * so the row names the real gate rather than a placeholder.
 */
export const SOLANA_SECURITY_GATE: ConfirmedOpportunityGate = 'SOLANA_SECURITY_CHECKS' as const;

/** One nulled gate input per §26.3 gate: a missing input ALWAYS refuses. */
export const GATE_MISSING_INPUT_MATRIX: readonly GateMissingInputCase[] = deepFreeze([
  missing('decision unavailable', 'DECISION_ALERT', 'decision'),
  missing('critical risk unavailable', 'NO_CRITICAL_RISK', 'criticalRisk'),
  missing('profile eligibility unavailable', 'PROFILE_ELIGIBILITY', 'profileEligibility'),
  missing('data coverage unavailable', 'MINIMUM_DATA_COVERAGE', 'dataCoverage'),
  missing(
    'independent evidence unavailable',
    'MINIMUM_INDEPENDENT_EVIDENCE_GROUPS',
    'independentEvidence',
  ),
  missing('freshness unavailable', 'FRESHNESS', 'freshness'),
  missing('semantic validation unavailable', 'SEMANTIC_VALIDATION', 'semanticValidation'),
  missing('unresolved conflict unavailable', 'UNRESOLVED_CONFLICT_THRESHOLD', 'unresolvedConflict'),
  missing('fingerprint/cooldown unavailable', 'FINGERPRINT_COOLDOWN', 'fingerprintCooldown'),
  missing('daily/schedule budget unavailable', 'DAILY_SCHEDULE_BUDGET', 'dailyScheduleBudget'),
  missing(
    'execution tradability unavailable',
    'EXECUTION_AWARE_TRADABILITY',
    'executionTradability',
  ),
  missing('expiry actionability unavailable', 'ALERT_NOT_EXPIRED', 'expiryActionability'),
  missing('solana security unavailable', SOLANA_SECURITY_GATE, 'solanaSecurity'),
  missing('strict-free cost policy unavailable', 'STRICT_FREE_COST_POLICY', 'costPolicy'),
]);

// --- empirical dependence / lineage-credit fixtures (AC-245/246) -------------

/**
 * One evidence-credit fixture: the raw provider-id count the sources claim
 * versus the independent-group count after empirical dependence / duplicated
 * lineage collapse. The alert gate set consumes ONLY the independent count; the
 * raw count never enters a gate input (it is not a schema field).
 */
export interface EvidenceCreditFixture {
  readonly label: string;
  readonly rawProviderIdCount: number;
  readonly independentGroupCount: number;
  readonly minimumIndependentGroupCount: number;
  /** The gate input the alert layer actually evaluates. */
  readonly gateInput: ConfirmedOpportunityGateInput;
}

function creditFixture(
  label: string,
  rawProviderIdCount: number,
  independentGroupCount: number,
  minimumIndependentGroupCount: number,
  extra: Partial<Record<keyof ConfirmedOpportunityGateInput, unknown>> = {},
): EvidenceCreditFixture {
  return deepFreeze({
    label,
    rawProviderIdCount,
    independentGroupCount,
    minimumIndependentGroupCount,
    gateInput: deepFreeze(
      passingGateInput({
        independentEvidence: { independentGroupCount, minimumIndependentGroupCount },
        ...extra,
      }),
    ),
  });
}

/**
 * AC-245: five providers whose timing, values/errors, outages, and first-seen
 * behaviour are strongly correlated collapse to TWO independent groups — below
 * the registered minimum of three. Raw provider ids cannot restore credit.
 */
export const EMPIRICALLY_DEPENDENT_CREDIT: EvidenceCreditFixture = creditFixture(
  'five correlated providers reduce to two independent groups',
  5,
  2,
  3,
);

/**
 * AC-245 control: the same five providers, credited at exactly the registered
 * minimum (three groups) — reduced credit is still enough, proving the gate
 * compares the REDUCED count rather than rejecting on dependence alone.
 */
export const DEPENDENT_BUT_AT_THRESHOLD_CREDIT: EvidenceCreditFixture = creditFixture(
  'correlated providers credited at exactly the minimum three groups',
  5,
  3,
  3,
);

/**
 * AC-246: every provider resolves to one duplicated upstream lineage, so the
 * collapsed independent count is ONE against a minimum of two.
 */
export const DUPLICATED_LINEAGE_CREDIT: EvidenceCreditFixture = creditFixture(
  'all providers share one duplicated upstream lineage',
  5,
  1,
  2,
);

/**
 * AC-246 sensitivity control: collapsing the duplicated lineage is the decision
 * that matters — at two genuine groups the same alert clears the minimum.
 */
export const LINEAGE_SENSITIVITY_CREDIT: EvidenceCreditFixture = creditFixture(
  'duplicated lineage removed leaves two independent lineages',
  5,
  2,
  2,
);

// --- frozen historical count / maturity fixtures (AC-247/248) ----------------

/**
 * AC-247: a realizable replay pinned to a FROZEN historical evidence count of
 * two, below the registered minimum of three. The fixture is frozen data; a
 * later retrospective dependence estimate cannot rewrite it in place.
 */
export const FROZEN_HISTORICAL_EVIDENCE_COUNT = 2 as const;
export const FROZEN_HISTORICAL_EVIDENCE_MINIMUM = 3 as const;
export const FROZEN_HISTORICAL_CREDIT_INPUT: ConfirmedOpportunityGateInput = deepFreeze(
  passingGateInput({
    independentEvidence: {
      independentGroupCount: FROZEN_HISTORICAL_EVIDENCE_COUNT,
      minimumIndependentGroupCount: FROZEN_HISTORICAL_EVIDENCE_MINIMUM,
    },
  }),
);

/**
 * AC-248: mature counts / effective sample size / coverage below threshold with
 * a deliberately favorable point estimate (severity/thesis are not even gate
 * inputs, so no favorable estimate can rescue the missing denominator).
 */
export const BELOW_THRESHOLD_MATURE_CREDIT: EvidenceCreditFixture = creditFixture(
  'mature counts and effective sample size below the registered minimum',
  9,
  1,
  3,
  { dataCoverage: { coverageRatio: 0.4, minimumCoverageRatio: 0.8 } },
);

// --- negative-control fixtures (AC-249) ------------------------------------

/**
 * AC-249: every gate passes except the semantic-validation control, which shows
 * unexplained lift: the confirmation cannot be promoted on the strength of its
 * favorable point estimate.
 */
export const FAILED_CONTROL_GATE_INPUT: ConfirmedOpportunityGateInput = deepFreeze(
  passingGateInput({
    semanticValidation: { semanticValidationPassed: false },
    criticalRisk: { riskState: CandidateRiskState.LOW, criticalVetoCount: 0 },
  }),
);

/**
 * AC-249 companion: a placebo/leakage control that forces a paid or
 * unknown-cost operation is not a `STRICT_FREE` pass, so promotion is blocked.
 */
export const DEGRADED_COST_CONTROL_GATE_INPUT: ConfirmedOpportunityGateInput = deepFreeze(
  passingGateInput({ costPolicy: { costPolicyResult: 'DEGRADED' } }),
);
