/**
 * The §26.3 confirmed-opportunity gate set as ONE total, ordered pure function
 * (T013, FR-ALERT-003/004, AC-140/141/245…249; PRD §26.3; plan D4).
 *
 * `evaluateConfirmedOpportunityGates(input)` returns exactly the fourteen
 * §26.3 gates, in the domain's canonical order, each PASS or a typed refusal
 * that names the gate. The function is pure and total:
 * - it never throws for a missing/partial input — a missing required input is a
 *   refusal (`GATE_REFUSED`), so classification fails closed (§34.3);
 * - it CONSUMES already-computed results owned elsewhere (tradability pass,
 *   Solana security checks, `STRICT_FREE` cost-policy result, freshness ages,
 *   multi-view conflict counts, fingerprint/cooldown verdict, budgets) and
 *   never recomputes execution, security, or cost logic (plan D4).
 *
 * Every refusal carries a closed `AlertSuppressionReason` and the gate id, so a
 * suppression is observable and typed rather than prose.
 *
 * Strictly read-only: gates only decide whether intelligence may be delivered;
 * nothing here can trade, hold custody, sign, handle private keys, or submit a
 * transaction.
 */
import { z } from 'zod';
import {
  ALL_CONFIRMED_OPPORTUNITY_GATES,
  ActionabilityState,
  AgentDecisionKind,
  AlertSuppressionReason,
  CandidateRiskState,
  CostPolicyResult,
  ErrorCode,
  ForesiftError,
  assertConfirmedOpportunityGateSet,
  confirmedOpportunityEligible,
  parseAgentDecisionKind,
  parseConfirmedOpportunityGate,
  parseCostPolicyResult,
  type ConfirmedOpportunityGate,
  type ConfirmedOpportunityGateResult,
} from '@foresift/domain';
import {
  ActionabilityStateSchema,
  AgentDecisionKindSchema,
  CandidateRiskStateSchema,
  ConfirmedOpportunityGateResultSchema,
  CostPolicyResultSchema,
} from '@foresift/shared-schemas';

// --- typed gate inputs (mirrored 1:1 by the Zod schema below) ---------------

/** One age/limit freshness bound for market, security, or holder data. */
export interface GateFreshnessBound {
  readonly ageSeconds: number;
  readonly limitSeconds: number;
}

export const GateFreshnessBoundSchema = z
  .object({
    ageSeconds: z.number().finite().min(0),
    limitSeconds: z.number().finite().positive(),
  })
  .strict();

const CriticalRiskInputSchema = z
  .object({
    riskState: CandidateRiskStateSchema,
    criticalVetoCount: z.number().int().min(0),
  })
  .strict();

const ProfileEligibilityInputSchema = z
  .object({ profileId: z.string().min(1), eligibleUnderActiveProfile: z.boolean() })
  .strict();
const DataCoverageInputSchema = z
  .object({
    coverageRatio: z.number().finite().min(0).max(1),
    minimumCoverageRatio: z.number().finite().min(0).max(1),
  })
  .strict();
const IndependentEvidenceInputSchema = z
  .object({
    independentGroupCount: z.number().int().min(0),
    minimumIndependentGroupCount: z.number().int().min(0),
  })
  .strict();
const FreshnessInputSchema = z
  .object({
    market: GateFreshnessBoundSchema,
    security: GateFreshnessBoundSchema,
    holder: GateFreshnessBoundSchema,
  })
  .strict();
const SemanticValidationInputSchema = z.object({ semanticValidationPassed: z.boolean() }).strict();
const UnresolvedConflictInputSchema = z
  .object({
    unresolvedConflictCount: z.number().int().min(0),
    blockingThreshold: z.number().int().min(0),
  })
  .strict();
const FingerprintCooldownInputSchema = z
  .object({
    fingerprint: z.string().min(1),
    duplicateFingerprint: z.boolean(),
    withinCooldown: z.boolean(),
  })
  .strict();
const DailyScheduleBudgetInputSchema = z
  .object({
    dailyBudgetRemaining: z.number().int().min(0),
    scheduleBudgetRemaining: z.number().int().min(0),
  })
  .strict();
const ExecutionTradabilityInputSchema = z
  .object({
    tradabilityAssessmentId: z.string().min(1),
    passed: z.boolean(),
    configuredNotionalUsd: z.string().min(1),
    delaySeconds: z.number().int().min(0),
  })
  .strict();
const ExpiryActionabilityInputSchema = z
  .object({
    actionability: ActionabilityStateSchema,
  })
  .strict();
const SolanaSecurityInputSchema = z
  .object({
    deterministicChecksPassed: z.boolean(),
    approvedProfileFallback: z.boolean(),
    fallbackProfileId: z.string().min(1).nullable(),
  })
  .strict();
const CostPolicyInputSchema = z
  .object({
    costPolicyResult: CostPolicyResultSchema,
  })
  .strict();

/**
 * The gate-set input. Every field is nullable: `null` means the input was not
 * available, which is a fail-closed refusal — never a silent pass.
 */
export const ConfirmedOpportunityGateInputSchema = z
  .object({
    decision: AgentDecisionKindSchema.nullable(),
    criticalRisk: CriticalRiskInputSchema.nullable(),
    profileEligibility: ProfileEligibilityInputSchema.nullable(),
    dataCoverage: DataCoverageInputSchema.nullable(),
    independentEvidence: IndependentEvidenceInputSchema.nullable(),
    freshness: FreshnessInputSchema.nullable(),
    semanticValidation: SemanticValidationInputSchema.nullable(),
    unresolvedConflict: UnresolvedConflictInputSchema.nullable(),
    fingerprintCooldown: FingerprintCooldownInputSchema.nullable(),
    dailyScheduleBudget: DailyScheduleBudgetInputSchema.nullable(),
    executionTradability: ExecutionTradabilityInputSchema.nullable(),
    expiryActionability: ExpiryActionabilityInputSchema.nullable(),
    solanaSecurity: SolanaSecurityInputSchema.nullable(),
    costPolicy: CostPolicyInputSchema.nullable(),
  })
  .strict();

export type ConfirmedOpportunityGateInput = z.infer<typeof ConfirmedOpportunityGateInputSchema>;

/** A fully populated gate input: every gate's evidence is present. */
export type CompleteConfirmedOpportunityGateInput = {
  readonly [K in keyof ConfirmedOpportunityGateInput]: NonNullable<
    ConfirmedOpportunityGateInput[K]
  >;
};

// --- result helpers ---------------------------------------------------------

function pass(gate: ConfirmedOpportunityGate): ConfirmedOpportunityGateResult {
  return { gate, passed: true, reason: null };
}

function refuse(
  gate: ConfirmedOpportunityGate,
  reason: AlertSuppressionReason,
): ConfirmedOpportunityGateResult {
  return { gate, passed: false, reason };
}

/** Closed gate refusal used when a gate is refused for a non-specific reason. */
const GENERIC_REFUSAL = AlertSuppressionReason.GATE_REFUSED;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function freshnessBoundPasses(bound: GateFreshnessBound | null | undefined): boolean {
  if (bound === null || bound === undefined) return false;
  if (!isFiniteNumber(bound.ageSeconds) || !isFiniteNumber(bound.limitSeconds)) return false;
  return bound.ageSeconds >= 0 && bound.limitSeconds > 0 && bound.ageSeconds <= bound.limitSeconds;
}

// --- the fourteen gates, in §26.3 order -------------------------------------

function gateDecisionAlert(input: ConfirmedOpportunityGateInput): ConfirmedOpportunityGateResult {
  const gate = 'DECISION_ALERT' as const;
  if (input.decision === null || input.decision === undefined) return refuse(gate, GENERIC_REFUSAL);
  let decision: AgentDecisionKind;
  try {
    decision = parseAgentDecisionKind(input.decision);
  } catch {
    return refuse(gate, GENERIC_REFUSAL);
  }
  return decision === AgentDecisionKind.ALERT ? pass(gate) : refuse(gate, GENERIC_REFUSAL);
}

function gateNoCriticalRisk(input: ConfirmedOpportunityGateInput): ConfirmedOpportunityGateResult {
  const gate = 'NO_CRITICAL_RISK' as const;
  const critical = input.criticalRisk;
  if (critical === null || critical === undefined) return refuse(gate, GENERIC_REFUSAL);
  if (
    critical.riskState === CandidateRiskState.CRITICAL ||
    critical.riskState === CandidateRiskState.CONFLICTING
  ) {
    return refuse(gate, GENERIC_REFUSAL);
  }
  if (!isNonNegativeInt(critical.criticalVetoCount) || critical.criticalVetoCount > 0) {
    return refuse(gate, GENERIC_REFUSAL);
  }
  return pass(gate);
}

function gateProfileEligibility(
  input: ConfirmedOpportunityGateInput,
): ConfirmedOpportunityGateResult {
  const gate = 'PROFILE_ELIGIBILITY' as const;
  const eligibility = input.profileEligibility;
  if (eligibility === null || eligibility === undefined) return refuse(gate, GENERIC_REFUSAL);
  if (typeof eligibility.profileId !== 'string' || eligibility.profileId.length === 0) {
    return refuse(gate, GENERIC_REFUSAL);
  }
  return eligibility.eligibleUnderActiveProfile === true
    ? pass(gate)
    : refuse(gate, GENERIC_REFUSAL);
}

function gateMinimumDataCoverage(
  input: ConfirmedOpportunityGateInput,
): ConfirmedOpportunityGateResult {
  const gate = 'MINIMUM_DATA_COVERAGE' as const;
  const coverage = input.dataCoverage;
  if (coverage === null || coverage === undefined) return refuse(gate, GENERIC_REFUSAL);
  const { coverageRatio, minimumCoverageRatio } = coverage;
  if (!isFiniteNumber(coverageRatio) || !isFiniteNumber(minimumCoverageRatio)) {
    return refuse(gate, GENERIC_REFUSAL);
  }
  if (minimumCoverageRatio <= 0 || minimumCoverageRatio > 1) return refuse(gate, GENERIC_REFUSAL);
  return coverageRatio >= minimumCoverageRatio ? pass(gate) : refuse(gate, GENERIC_REFUSAL);
}

function gateMinimumIndependentEvidenceGroups(
  input: ConfirmedOpportunityGateInput,
): ConfirmedOpportunityGateResult {
  const gate = 'MINIMUM_INDEPENDENT_EVIDENCE_GROUPS' as const;
  const evidence = input.independentEvidence;
  if (evidence === null || evidence === undefined) return refuse(gate, GENERIC_REFUSAL);
  const count = evidence.independentGroupCount;
  const minimum = evidence.minimumIndependentGroupCount;
  if (!isNonNegativeInt(count) || !isNonNegativeInt(minimum)) return refuse(gate, GENERIC_REFUSAL);
  // A zero threshold would let a confirmation rest on no evidence at all.
  if (minimum <= 0) return refuse(gate, GENERIC_REFUSAL);
  return count >= minimum ? pass(gate) : refuse(gate, GENERIC_REFUSAL);
}

function gateFreshness(input: ConfirmedOpportunityGateInput): ConfirmedOpportunityGateResult {
  const gate = 'FRESHNESS' as const;
  const freshness = input.freshness;
  if (freshness === null || freshness === undefined) return refuse(gate, GENERIC_REFUSAL);
  const ok =
    freshnessBoundPasses(freshness.market) &&
    freshnessBoundPasses(freshness.security) &&
    freshnessBoundPasses(freshness.holder);
  return ok ? pass(gate) : refuse(gate, GENERIC_REFUSAL);
}

function gateSemanticValidation(
  input: ConfirmedOpportunityGateInput,
): ConfirmedOpportunityGateResult {
  const gate = 'SEMANTIC_VALIDATION' as const;
  const semantic = input.semanticValidation;
  if (semantic === null || semantic === undefined) return refuse(gate, GENERIC_REFUSAL);
  return semantic.semanticValidationPassed === true ? pass(gate) : refuse(gate, GENERIC_REFUSAL);
}

function gateUnresolvedConflictThreshold(
  input: ConfirmedOpportunityGateInput,
): ConfirmedOpportunityGateResult {
  const gate = 'UNRESOLVED_CONFLICT_THRESHOLD' as const;
  const conflict = input.unresolvedConflict;
  if (conflict === null || conflict === undefined) return refuse(gate, GENERIC_REFUSAL);
  const count = conflict.unresolvedConflictCount;
  const threshold = conflict.blockingThreshold;
  if (!isNonNegativeInt(count) || !isNonNegativeInt(threshold)) {
    return refuse(gate, GENERIC_REFUSAL);
  }
  return count <= threshold ? pass(gate) : refuse(gate, GENERIC_REFUSAL);
}

function gateFingerprintCooldown(
  input: ConfirmedOpportunityGateInput,
): ConfirmedOpportunityGateResult {
  const gate = 'FINGERPRINT_COOLDOWN' as const;
  const fingerprint = input.fingerprintCooldown;
  if (fingerprint === null || fingerprint === undefined) return refuse(gate, GENERIC_REFUSAL);
  if (fingerprint.duplicateFingerprint === true) {
    return refuse(gate, AlertSuppressionReason.DUPLICATE_FINGERPRINT);
  }
  if (fingerprint.withinCooldown === true) {
    return refuse(gate, AlertSuppressionReason.WITHIN_COOLDOWN);
  }
  return pass(gate);
}

function gateDailyScheduleBudget(
  input: ConfirmedOpportunityGateInput,
): ConfirmedOpportunityGateResult {
  const gate = 'DAILY_SCHEDULE_BUDGET' as const;
  const budget = input.dailyScheduleBudget;
  if (budget === null || budget === undefined) return refuse(gate, GENERIC_REFUSAL);
  const { dailyBudgetRemaining, scheduleBudgetRemaining } = budget;
  if (!isNonNegativeInt(dailyBudgetRemaining) || !isNonNegativeInt(scheduleBudgetRemaining)) {
    return refuse(gate, GENERIC_REFUSAL);
  }
  if (dailyBudgetRemaining <= 0 || scheduleBudgetRemaining <= 0) {
    return refuse(gate, AlertSuppressionReason.DAILY_SCHEDULE_BUDGET_EXHAUSTED);
  }
  return pass(gate);
}

function gateExecutionAwareTradability(
  input: ConfirmedOpportunityGateInput,
): ConfirmedOpportunityGateResult {
  const gate = 'EXECUTION_AWARE_TRADABILITY' as const;
  const tradability = input.executionTradability;
  if (tradability === null || tradability === undefined) return refuse(gate, GENERIC_REFUSAL);
  if (
    typeof tradability.tradabilityAssessmentId !== 'string' ||
    tradability.tradabilityAssessmentId.length === 0
  ) {
    return refuse(gate, GENERIC_REFUSAL);
  }
  if (
    typeof tradability.configuredNotionalUsd !== 'string' ||
    tradability.configuredNotionalUsd.length === 0
  ) {
    return refuse(gate, GENERIC_REFUSAL);
  }
  if (!isNonNegativeInt(tradability.delaySeconds)) return refuse(gate, GENERIC_REFUSAL);
  return tradability.passed === true ? pass(gate) : refuse(gate, GENERIC_REFUSAL);
}

function gateAlertNotExpired(input: ConfirmedOpportunityGateInput): ConfirmedOpportunityGateResult {
  const gate = 'ALERT_NOT_EXPIRED' as const;
  const actionability = input.expiryActionability;
  if (actionability === null || actionability === undefined) return refuse(gate, GENERIC_REFUSAL);
  const state = actionability.actionability;
  if (state === ActionabilityState.EXPIRED || state === ActionabilityState.CANCELLED) {
    return refuse(gate, AlertSuppressionReason.EXPIRED_ACTIONABILITY);
  }
  if (state !== ActionabilityState.ACTIONABLE && state !== ActionabilityState.EXPIRING) {
    return refuse(gate, GENERIC_REFUSAL);
  }
  return pass(gate);
}

function gateSolanaSecurityChecks(
  input: ConfirmedOpportunityGateInput,
): ConfirmedOpportunityGateResult {
  const gate = 'SOLANA_SECURITY_CHECKS' as const;
  const security = input.solanaSecurity;
  if (security === null || security === undefined) return refuse(gate, GENERIC_REFUSAL);
  if (security.deterministicChecksPassed === true) return pass(gate);
  // An approved profile fallback must NAME the profile that covers the check;
  // a bare boolean is not an approved fallback (§26.3 rule 13).
  if (
    security.approvedProfileFallback === true &&
    typeof security.fallbackProfileId === 'string' &&
    security.fallbackProfileId.length > 0
  ) {
    return pass(gate);
  }
  return refuse(gate, GENERIC_REFUSAL);
}

function gateStrictFreeCostPolicy(
  input: ConfirmedOpportunityGateInput,
): ConfirmedOpportunityGateResult {
  const gate = 'STRICT_FREE_COST_POLICY' as const;
  const cost = input.costPolicy;
  if (cost === null || cost === undefined) return refuse(gate, GENERIC_REFUSAL);
  let result: CostPolicyResult;
  try {
    result = parseCostPolicyResult(cost.costPolicyResult);
  } catch {
    return refuse(gate, GENERIC_REFUSAL);
  }
  // `STRICT_FREE` requires PASS: DEGRADED implies a paid/unknown-cost operation.
  return result === CostPolicyResult.PASS ? pass(gate) : refuse(gate, GENERIC_REFUSAL);
}

const GATE_EVALUATORS: Readonly<
  Record<
    ConfirmedOpportunityGate,
    (input: ConfirmedOpportunityGateInput) => ConfirmedOpportunityGateResult
  >
> = Object.freeze({
  DECISION_ALERT: gateDecisionAlert,
  NO_CRITICAL_RISK: gateNoCriticalRisk,
  PROFILE_ELIGIBILITY: gateProfileEligibility,
  MINIMUM_DATA_COVERAGE: gateMinimumDataCoverage,
  MINIMUM_INDEPENDENT_EVIDENCE_GROUPS: gateMinimumIndependentEvidenceGroups,
  FRESHNESS: gateFreshness,
  SEMANTIC_VALIDATION: gateSemanticValidation,
  UNRESOLVED_CONFLICT_THRESHOLD: gateUnresolvedConflictThreshold,
  FINGERPRINT_COOLDOWN: gateFingerprintCooldown,
  DAILY_SCHEDULE_BUDGET: gateDailyScheduleBudget,
  EXECUTION_AWARE_TRADABILITY: gateExecutionAwareTradability,
  ALERT_NOT_EXPIRED: gateAlertNotExpired,
  SOLANA_SECURITY_CHECKS: gateSolanaSecurityChecks,
  STRICT_FREE_COST_POLICY: gateStrictFreeCostPolicy,
});

/**
 * The one total, ordered, pure §26.3 gate function. Returns every gate result
 * in canonical order; a missing input is a refusal, never a silent pass.
 */
export function evaluateConfirmedOpportunityGates(
  input: ConfirmedOpportunityGateInput | null | undefined,
): readonly ConfirmedOpportunityGateResult[] {
  if (input === null || input === undefined) {
    return ALL_CONFIRMED_OPPORTUNITY_GATES.map((gate) => refuse(gate, GENERIC_REFUSAL));
  }
  return ALL_CONFIRMED_OPPORTUNITY_GATES.map((gate) => GATE_EVALUATORS[gate](input));
}

/** True iff all fourteen gates passed; an incomplete/foreign set is false. */
export function confirmedOpportunityPasses(
  input: ConfirmedOpportunityGateInput | null | undefined,
): boolean {
  return confirmedOpportunityEligible(evaluateConfirmedOpportunityGates(input));
}

/** The first refusal in order, or null when every gate passed. */
export function firstRefusedGate(
  results: readonly ConfirmedOpportunityGateResult[],
): ConfirmedOpportunityGateResult | null {
  return results.find((result) => !result.passed) ?? null;
}

/**
 * Validate an already-computed gate-result list: unknown gate ids refuse with
 * `ALERT_GATE_UNKNOWN`, a missing/duplicated/foreign set with
 * `ALERT_GATE_SET_INCOMPLETE`. Returns the validated list so callers can consume
 * results owned elsewhere without re-deriving them.
 */
export function validateConfirmedOpportunityGateResults(
  observed: unknown,
): readonly ConfirmedOpportunityGateResult[] {
  if (!Array.isArray(observed)) {
    throw new ForesiftError(
      ErrorCode.ALERT_GATE_SET_INCOMPLETE,
      'the confirmed-opportunity gate set must be an array of gate results',
      { observed: null },
    );
  }
  // An unknown gate id refuses with its own typed code rather than a ZodError.
  for (const entry of observed) {
    if (entry !== null && typeof entry === 'object' && 'gate' in entry) {
      parseConfirmedOpportunityGate((entry as { gate: unknown }).gate);
    }
  }
  const parsed = ConfirmedOpportunityGateResultSchema.array().parse(observed);
  assertConfirmedOpportunityGateSet(parsed.map((result) => result.gate));
  return parsed;
}

/** Throw a typed refusal when the gate set did not pass. */
export function assertConfirmedOpportunityGatesPass(
  results: readonly ConfirmedOpportunityGateResult[],
): void {
  assertConfirmedOpportunityGateSet(results.map((result) => result.gate));
  const refused = firstRefusedGate(results);
  if (refused !== null) {
    throw new ForesiftError(
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      `§26.3 gate ${refused.gate} refused confirmed-opportunity eligibility`,
      { gate: refused.gate, reason: refused.reason },
    );
  }
}
