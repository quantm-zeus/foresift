/**
 * Execution-aware outcome, pool math, and tradability vocabularies (§64,
 * §8.1/§8.2) and the pure outcome-labeling laws (FR-EXEC-001…022).
 *
 * These parsers are deliberately fail-closed. Values received across a trust
 * boundary must be parsed; unknown future values are never treated as safe.
 * The pure laws below are the single authority for outcome-label precedence,
 * signal/tradable separation, executable-target satisfaction, uncertainty
 * blocking, delay robustness, and adverse-ordering selection.
 *
 * Traces: FR-EXEC-001, FR-EXEC-004, FR-EXEC-006, FR-EXEC-007, FR-EXEC-013,
 * FR-EXEC-015, FR-EXEC-017, FR-EXEC-020, AC-120, AC-122.
 */

// ---------------------------------------------------------------------------
// Vocabularies (§64.12, §8.1, §64.3 + FR-EXEC-015, FR-EXEC-017, §64.7, §64.14)
// ---------------------------------------------------------------------------

/** §64.12 outcome classes. Values are stable machine codes. */
export const OutcomeClass = {
  SIGNAL_SUCCESS: 'SIGNAL_SUCCESS',
  SIGNAL_FAILURE: 'SIGNAL_FAILURE',
  TRADABLE_SUCCESS: 'TRADABLE_SUCCESS',
  TRADABLE_FAILURE: 'TRADABLE_FAILURE',
  TRADABLE_NEUTRAL: 'TRADABLE_NEUTRAL',
  NEUTRAL: 'NEUTRAL',
  PENDING: 'PENDING',
  CENSORED: 'CENSORED',
  INVALID_DATA: 'INVALID_DATA',
} as const;
export type OutcomeClass = (typeof OutcomeClass)[keyof typeof OutcomeClass];

/** §8.1 per profile × horizon × execution-scenario maturity. */
export const OutcomeMaturity = {
  PENDING: 'PENDING',
  PARTIALLY_MATURED: 'PARTIALLY_MATURED',
  FULLY_MATURED: 'FULLY_MATURED',
  CENSORED: 'CENSORED',
  INVALID_DATA: 'INVALID_DATA',
} as const;
export type OutcomeMaturity = (typeof OutcomeMaturity)[keyof typeof OutcomeMaturity];

/** §64.3 + FR-EXEC-015 adapter families. `UNKNOWN` never resolves to generic math. */
export const AdapterFamily = {
  CONSTANT_PRODUCT_AMM: 'CONSTANT_PRODUCT_AMM',
  CONCENTRATED_LIQUIDITY_AMM: 'CONCENTRATED_LIQUIDITY_AMM',
  DISCRETE_LIQUIDITY_BIN_AMM: 'DISCRETE_LIQUIDITY_BIN_AMM',
  BONDING_CURVE: 'BONDING_CURVE',
  STABLE_CURVE: 'STABLE_CURVE',
  DYNAMIC_FEE_AMM: 'DYNAMIC_FEE_AMM',
  VIRTUAL_RESERVE: 'VIRTUAL_RESERVE',
  AGGREGATED_MULTI_ROUTE_READ_ONLY: 'AGGREGATED_MULTI_ROUTE_READ_ONLY',
  UNKNOWN: 'UNKNOWN',
} as const;
export type AdapterFamily = (typeof AdapterFamily)[keyof typeof AdapterFamily];

/** §64.3/§64.11 registry support states (parity-gated). */
export const AdapterSupportState = {
  AVAILABLE: 'AVAILABLE',
  DEGRADED: 'DEGRADED',
  UNAVAILABLE: 'UNAVAILABLE',
} as const;
export type AdapterSupportState = (typeof AdapterSupportState)[keyof typeof AdapterSupportState];

/** §64.4 execution statuses. Unsupported designs never silently fall back. */
export const ExecutionStatus = {
  EXECUTED_FULL: 'EXECUTED_FULL',
  EXECUTION_PARTIAL: 'EXECUTION_PARTIAL',
  EXECUTION_UNAVAILABLE: 'EXECUTION_UNAVAILABLE',
  POOL_MATH_UNSUPPORTED: 'POOL_MATH_UNSUPPORTED',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
} as const;
export type ExecutionStatus = (typeof ExecutionStatus)[keyof typeof ExecutionStatus];

/** FR-EXEC-017/§64.10 production stress-scenario matrix. */
export const StressScenarioKind = {
  BASE_CASE: 'BASE_CASE',
  P50_DELAY: 'P50_DELAY',
  P90_DELAY: 'P90_DELAY',
  CONSERVATIVE_LATENCY_ADVERSE_SELECTION: 'CONSERVATIVE_LATENCY_ADVERSE_SELECTION',
  LIQUIDITY_DRAWDOWN: 'LIQUIDITY_DRAWDOWN',
  FEE_VOLATILITY: 'FEE_VOLATILITY',
  ROUTE_DEGRADATION: 'ROUTE_DEGRADATION',
  FAILED_PARTIAL_FILL: 'FAILED_PARTIAL_FILL',
} as const;
export type StressScenarioKind = (typeof StressScenarioKind)[keyof typeof StressScenarioKind];

/** §64.7 versioned exit-policy kinds (pre-registered experiments only). */
export const ExitPolicyKind = {
  FIXED_HORIZON: 'FIXED_HORIZON',
  TAKE_PROFIT_STOP_LOSS: 'TAKE_PROFIT_STOP_LOSS',
  TRAILING_EXIT: 'TRAILING_EXIT',
  STAGED_EXIT: 'STAGED_EXIT',
  LIQUIDITY_RISK_DETERIORATION: 'LIQUIDITY_RISK_DETERIORATION',
  THESIS_INVALIDATION: 'THESIS_INVALIDATION',
} as const;
export type ExitPolicyKind = (typeof ExitPolicyKind)[keyof typeof ExitPolicyKind];

/** §64.7 coarse-interval trigger ordering. */
export const PrimaryOrdering = {
  ADVERSE_FEASIBLE: 'ADVERSE_FEASIBLE',
  UNAMBIGUOUS: 'UNAMBIGUOUS',
} as const;
export type PrimaryOrdering = (typeof PrimaryOrdering)[keyof typeof PrimaryOrdering];

/**
 * Tradability-gate verdicts (FR-EXEC-004/007/011/012/015/017/020). Every
 * non-confirming value is an explicit, machine-readable block reason — the
 * gate never returns a bare "no".
 */
export const TradabilityVerdict = {
  CONFIRMED_TRADABLE: 'CONFIRMED_TRADABLE',
  BLOCKED_INCOMPLETE_STATE: 'BLOCKED_INCOMPLETE_STATE',
  BLOCKED_UNCERTAINTY_BOUND: 'BLOCKED_UNCERTAINTY_BOUND',
  BLOCKED_STRESS_PASS_MATRIX: 'BLOCKED_STRESS_PASS_MATRIX',
  BLOCKED_EXECUTION_UNAVAILABLE: 'BLOCKED_EXECUTION_UNAVAILABLE',
  BLOCKED_TARGET_NOT_EXECUTABLE: 'BLOCKED_TARGET_NOT_EXECUTABLE',
  BLOCKED_OBSERVATION_PLAN: 'BLOCKED_OBSERVATION_PLAN',
} as const;
export type TradabilityVerdict = (typeof TradabilityVerdict)[keyof typeof TradabilityVerdict];

/** §64.14 selective observation-plan trigger classes. */
export const ObservationPlanTriggerClass = {
  DEEP_RESEARCH: 'DEEP_RESEARCH',
  EARLY_WATCH: 'EARLY_WATCH',
  CONFIRMED_OPPORTUNITY: 'CONFIRMED_OPPORTUNITY',
  CONTROL_SAMPLE: 'CONTROL_SAMPLE',
  SHADOW_PORTFOLIO: 'SHADOW_PORTFOLIO',
} as const;
export type ObservationPlanTriggerClass =
  (typeof ObservationPlanTriggerClass)[keyof typeof ObservationPlanTriggerClass];

export const ALL_OUTCOME_CLASSES: readonly OutcomeClass[] = Object.values(OutcomeClass);
export const ALL_OUTCOME_MATURITIES: readonly OutcomeMaturity[] = Object.values(OutcomeMaturity);
export const ALL_ADAPTER_FAMILIES: readonly AdapterFamily[] = Object.values(AdapterFamily);
export const ALL_ADAPTER_SUPPORT_STATES: readonly AdapterSupportState[] =
  Object.values(AdapterSupportState);
export const ALL_EXECUTION_STATUSES: readonly ExecutionStatus[] = Object.values(ExecutionStatus);
export const ALL_STRESS_SCENARIO_KINDS: readonly StressScenarioKind[] =
  Object.values(StressScenarioKind);
export const ALL_EXIT_POLICY_KINDS: readonly ExitPolicyKind[] = Object.values(ExitPolicyKind);
export const ALL_PRIMARY_ORDERINGS: readonly PrimaryOrdering[] = Object.values(PrimaryOrdering);
export const ALL_TRADABILITY_VERDICTS: readonly TradabilityVerdict[] =
  Object.values(TradabilityVerdict);
export const ALL_OBSERVATION_PLAN_TRIGGER_CLASSES: readonly ObservationPlanTriggerClass[] =
  Object.values(ObservationPlanTriggerClass);

/** Outcome classes the signal axis may carry (never a TRADABLE_* label). */
export const SIGNAL_AXIS_OUTCOME_CLASSES: readonly OutcomeClass[] = [
  OutcomeClass.SIGNAL_SUCCESS,
  OutcomeClass.SIGNAL_FAILURE,
  OutcomeClass.NEUTRAL,
  OutcomeClass.PENDING,
  OutcomeClass.CENSORED,
  OutcomeClass.INVALID_DATA,
];

// ---------------------------------------------------------------------------
// Fail-closed parsing with stable machine codes
// ---------------------------------------------------------------------------

/** Stable machine-readable exec error codes. Values never change once released. */
export const ExecErrorCode = {
  OUTCOME_CLASS_UNKNOWN: 'OUTCOME_CLASS_UNKNOWN',
  OUTCOME_MATURITY_UNKNOWN: 'OUTCOME_MATURITY_UNKNOWN',
  ADAPTER_FAMILY_UNKNOWN: 'ADAPTER_FAMILY_UNKNOWN',
  ADAPTER_SUPPORT_STATE_UNKNOWN: 'ADAPTER_SUPPORT_STATE_UNKNOWN',
  EXECUTION_STATUS_UNKNOWN: 'EXECUTION_STATUS_UNKNOWN',
  STRESS_SCENARIO_KIND_UNKNOWN: 'STRESS_SCENARIO_KIND_UNKNOWN',
  EXIT_POLICY_KIND_UNKNOWN: 'EXIT_POLICY_KIND_UNKNOWN',
  PRIMARY_ORDERING_UNKNOWN: 'PRIMARY_ORDERING_UNKNOWN',
  TRADABILITY_VERDICT_UNKNOWN: 'TRADABILITY_VERDICT_UNKNOWN',
  OBSERVATION_PLAN_TRIGGER_CLASS_UNKNOWN: 'OBSERVATION_PLAN_TRIGGER_CLASS_UNKNOWN',
  REQUIRED_DELAY_ROBUSTNESS_UNKNOWN: 'REQUIRED_DELAY_ROBUSTNESS_UNKNOWN',
  UNCERTAINTY_BOUND_INVALID: 'UNCERTAINTY_BOUND_INVALID',
  PRECEDENCE_INPUT_INVALID: 'PRECEDENCE_INPUT_INVALID',
} as const;
export type ExecErrorCode = (typeof ExecErrorCode)[keyof typeof ExecErrorCode];

/** Typed parse/law failure carrying a stable, exec-specific machine code. */
export class ExecVocabularyError extends RangeError {
  readonly code: ExecErrorCode;
  readonly value: unknown;

  constructor(code: ExecErrorCode, value: unknown, message?: string) {
    super(message ?? `${code}: unknown execution vocabulary value ${JSON.stringify(value)}`);
    this.name = 'ExecVocabularyError';
    this.code = code;
    this.value = value;
  }
}

function parseVocabulary<T extends string>(
  values: readonly T[],
  value: unknown,
  code: ExecErrorCode,
): T {
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
    throw new ExecVocabularyError(code, value);
  }
  return value as T;
}

export const outcomeClass = (value: unknown): OutcomeClass =>
  parseVocabulary(ALL_OUTCOME_CLASSES, value, ExecErrorCode.OUTCOME_CLASS_UNKNOWN);
export const outcomeMaturity = (value: unknown): OutcomeMaturity =>
  parseVocabulary(ALL_OUTCOME_MATURITIES, value, ExecErrorCode.OUTCOME_MATURITY_UNKNOWN);
export const adapterFamily = (value: unknown): AdapterFamily =>
  parseVocabulary(ALL_ADAPTER_FAMILIES, value, ExecErrorCode.ADAPTER_FAMILY_UNKNOWN);
export const adapterSupportState = (value: unknown): AdapterSupportState =>
  parseVocabulary(ALL_ADAPTER_SUPPORT_STATES, value, ExecErrorCode.ADAPTER_SUPPORT_STATE_UNKNOWN);
export const executionStatus = (value: unknown): ExecutionStatus =>
  parseVocabulary(ALL_EXECUTION_STATUSES, value, ExecErrorCode.EXECUTION_STATUS_UNKNOWN);
export const stressScenarioKind = (value: unknown): StressScenarioKind =>
  parseVocabulary(ALL_STRESS_SCENARIO_KINDS, value, ExecErrorCode.STRESS_SCENARIO_KIND_UNKNOWN);
export const exitPolicyKind = (value: unknown): ExitPolicyKind =>
  parseVocabulary(ALL_EXIT_POLICY_KINDS, value, ExecErrorCode.EXIT_POLICY_KIND_UNKNOWN);
export const primaryOrdering = (value: unknown): PrimaryOrdering =>
  parseVocabulary(ALL_PRIMARY_ORDERINGS, value, ExecErrorCode.PRIMARY_ORDERING_UNKNOWN);
export const tradabilityVerdict = (value: unknown): TradabilityVerdict =>
  parseVocabulary(ALL_TRADABILITY_VERDICTS, value, ExecErrorCode.TRADABILITY_VERDICT_UNKNOWN);
export const observationPlanTriggerClass = (value: unknown): ObservationPlanTriggerClass =>
  parseVocabulary(
    ALL_OBSERVATION_PLAN_TRIGGER_CLASSES,
    value,
    ExecErrorCode.OBSERVATION_PLAN_TRIGGER_CLASS_UNKNOWN,
  );

// ---------------------------------------------------------------------------
// Pure laws
// ---------------------------------------------------------------------------

/** §8.2 precedence steps. `TRADABLE_FAILURE_SECURITY_OR_LIQUIDITY` records the
 * security/liquidity terminal-event subclass of `TRADABLE_FAILURE` (§64.12 has
 * no separate class member; the step preserves the distinction). */
export const PrecedenceStep = {
  INVALID_DATA: 'INVALID_DATA',
  CENSORED: 'CENSORED',
  UNMATURED: 'UNMATURED',
  TRADABLE_FAILURE_SECURITY_OR_LIQUIDITY: 'TRADABLE_FAILURE_SECURITY_OR_LIQUIDITY',
  TRADABLE_SUCCESS: 'TRADABLE_SUCCESS',
  TRADABLE_FAILURE: 'TRADABLE_FAILURE',
  TRADABLE_NEUTRAL: 'TRADABLE_NEUTRAL',
} as const;
export type PrecedenceStep = (typeof PrecedenceStep)[keyof typeof PrecedenceStep];

export const ALL_PRECEDENCE_STEPS: readonly PrecedenceStep[] = Object.values(PrecedenceStep);

export interface OutcomeLabelInput {
  /** Identity, chronology, state, adapter, or evidence integrity is invalid. */
  readonly invalidData: boolean;
  /** The horizon cannot be fully observed for an exogenous documented reason. */
  readonly censored: boolean;
  /** §8.1 maturity of this profile × horizon × execution scenario. */
  readonly maturity: OutcomeMaturity;
  /** Profile-blocking security/rug/liquidity terminal event observed. */
  readonly securityOrLiquidityTerminalEvent: boolean;
  /** Every required success and survival clause passes (§8.2 step 5). */
  readonly tradableSuccessClausesSatisfied: boolean;
  /** An explicit failure clause passes (§8.2 step 6). */
  readonly tradableFailureClauseSatisfied: boolean;
  /** Signal-axis success (price/path result without executability). */
  readonly signalSuccess: boolean;
  /** Signal-axis failure. */
  readonly signalFailure: boolean;
}

export interface OutcomeLabelResult {
  /** Tradable-axis class under the §8.2 precedence order. */
  readonly tradableClass: OutcomeClass;
  /** Signal-axis class, calculated separately (never a TRADABLE_* label). */
  readonly signalClass: OutcomeClass;
  /** The §8.2 step that decided the tradable axis. */
  readonly precedenceStep: PrecedenceStep;
}

/**
 * §8.2 common outcome-label precedence, applied in exact order:
 * INVALID_DATA → CENSORED → PENDING/PARTIALLY_MATURED →
 * TRADABLE_FAILURE_SECURITY_OR_LIQUIDITY → TRADABLE_SUCCESS →
 * TRADABLE_FAILURE → TRADABLE_NEUTRAL. Signal labels are calculated on a
 * separate axis and cannot overwrite tradable labels (§8.2; INV-011).
 *
 * A `CENSORED`/`INVALID_DATA` maturity is treated as the corresponding
 * censoring/invalidity input; `PARTIALLY_MATURED` maps to the `PENDING`
 * outcome class until all required horizons mature.
 */
export function outcomeLabelPrecedence(input: OutcomeLabelInput): OutcomeLabelResult {
  const maturity = outcomeMaturity(input.maturity);
  const invalid = input.invalidData || maturity === OutcomeMaturity.INVALID_DATA;
  const censored = input.censored || maturity === OutcomeMaturity.CENSORED;
  const unmatured =
    maturity === OutcomeMaturity.PENDING || maturity === OutcomeMaturity.PARTIALLY_MATURED;
  if (
    input.tradableSuccessClausesSatisfied &&
    input.tradableFailureClauseSatisfied &&
    !invalid &&
    !censored &&
    !unmatured
  ) {
    // Success and failure clauses cannot both decide the label; such an input
    // is a caller contract violation, not a label choice.
    throw new ExecVocabularyError(
      ExecErrorCode.PRECEDENCE_INPUT_INVALID,
      input,
      'success and failure clauses cannot both be satisfied',
    );
  }

  let tradableClass: OutcomeClass;
  let precedenceStep: PrecedenceStep;
  if (invalid) {
    tradableClass = OutcomeClass.INVALID_DATA;
    precedenceStep = PrecedenceStep.INVALID_DATA;
  } else if (censored) {
    tradableClass = OutcomeClass.CENSORED;
    precedenceStep = PrecedenceStep.CENSORED;
  } else if (unmatured) {
    tradableClass = OutcomeClass.PENDING;
    precedenceStep = PrecedenceStep.UNMATURED;
  } else if (input.securityOrLiquidityTerminalEvent) {
    tradableClass = OutcomeClass.TRADABLE_FAILURE;
    precedenceStep = PrecedenceStep.TRADABLE_FAILURE_SECURITY_OR_LIQUIDITY;
  } else if (input.tradableSuccessClausesSatisfied) {
    tradableClass = OutcomeClass.TRADABLE_SUCCESS;
    precedenceStep = PrecedenceStep.TRADABLE_SUCCESS;
  } else if (input.tradableFailureClauseSatisfied) {
    tradableClass = OutcomeClass.TRADABLE_FAILURE;
    precedenceStep = PrecedenceStep.TRADABLE_FAILURE;
  } else {
    tradableClass = OutcomeClass.TRADABLE_NEUTRAL;
    precedenceStep = PrecedenceStep.TRADABLE_NEUTRAL;
  }

  let signalClass: OutcomeClass;
  if (invalid) {
    signalClass = OutcomeClass.INVALID_DATA;
  } else if (censored) {
    signalClass = OutcomeClass.CENSORED;
  } else if (unmatured) {
    signalClass = OutcomeClass.PENDING;
  } else if (input.signalSuccess) {
    signalClass = OutcomeClass.SIGNAL_SUCCESS;
  } else if (input.signalFailure) {
    signalClass = OutcomeClass.SIGNAL_FAILURE;
  } else {
    signalClass = OutcomeClass.NEUTRAL;
  }

  return { tradableClass, signalClass, precedenceStep };
}

/**
 * FR-EXEC-006 / INV-011: `SIGNAL_SUCCESS` cannot be rendered as profit when
 * `TRADABLE_SUCCESS` is absent or failed. True means profit rendering is
 * forbidden for this label pair.
 */
export function signalCannotRenderProfit(input: {
  readonly signalClass: OutcomeClass;
  readonly tradableClass: OutcomeClass;
}): boolean {
  return (
    outcomeClass(input.signalClass) === OutcomeClass.SIGNAL_SUCCESS &&
    outcomeClass(input.tradableClass) !== OutcomeClass.TRADABLE_SUCCESS
  );
}

export interface ConfirmedOpportunityBlockingInput {
  /** Policy-level opportunity eligibility before the tradability gate. */
  readonly candidateConfirmedOpportunity: boolean;
  /** Verdict produced by the tradability gate (FR-EXEC-004/007/012/017/020). */
  readonly tradabilityVerdict: TradabilityVerdict;
  /** Diagnostic signal label that must survive the block (FR-EXEC-007). */
  readonly diagnosticSignalClass: OutcomeClass;
}

export interface ConfirmedOpportunityBlockingResult {
  /** False whenever tradability did not confirm — blocking is fail-closed. */
  readonly confirmedOpportunity: boolean;
  /** The diagnostic signal label, preserved unchanged through the block. */
  readonly diagnosticSignalClass: OutcomeClass;
  readonly blockedByTradability: boolean;
}

/**
 * FR-EXEC-007: tradability can block `CONFIRMED_OPPORTUNITY` while preserving
 * diagnostic signal labels. Only `CONFIRMED_TRADABLE` lets a candidate
 * opportunity through; every blocking verdict fails closed, and the signal
 * label is echoed untouched.
 */
export function tradabilityBlocksConfirmedOpportunity(
  input: ConfirmedOpportunityBlockingInput,
): ConfirmedOpportunityBlockingResult {
  const verdict = tradabilityVerdict(input.tradabilityVerdict);
  const signalClass = outcomeClass(input.diagnosticSignalClass);
  const confirmed = verdict === TradabilityVerdict.CONFIRMED_TRADABLE;
  return {
    confirmedOpportunity: input.candidateConfirmedOpportunity && confirmed,
    diagnosticSignalClass: signalClass,
    blockedByTradability: !confirmed,
  };
}

export interface ExecutableTargetInput {
  /** The price path touched the target. */
  readonly targetTouched: boolean;
  /** The modeled exit executes within impact, fill, duration, completeness,
   * and survival limits (§64.13). */
  readonly modeledExitExecutable: boolean;
  /** Sufficient economic volume around the target (profile-declared). */
  readonly executableVolumeSatisfied: boolean;
  /** Configured target-duration support (profile-declared). */
  readonly targetDurationSatisfied: boolean;
  /** An isolated wick: no volume, no duration, single-slot touch. */
  readonly isolatedWick: boolean;
}

/**
 * §64.13 / FR-EXEC-004: a target counts for tradable success only when the
 * modeled exit can execute within limits AND the profile-declared executable
 * volume or configured target-duration support is present. An isolated wick
 * is never sufficient (AC-122).
 */
export function executableTargetSatisfied(input: ExecutableTargetInput): boolean {
  return (
    input.targetTouched &&
    input.modeledExitExecutable &&
    !input.isolatedWick &&
    (input.executableVolumeSatisfied || input.targetDurationSatisfied)
  );
}

/**
 * FR-EXEC-020: simulation exposes uncertainty when state is incomplete or
 * parity is weak and blocks confirmed tradability when the uncertainty bound
 * crosses policy limits. Fail-closed: a bound at or beyond the limit blocks,
 * and non-finite or out-of-range inputs throw rather than silently passing.
 */
export function uncertaintyBlocksTradability(input: {
  readonly uncertaintyBound: number;
  readonly policyLimit: number;
}): boolean {
  const { uncertaintyBound, policyLimit } = input;
  if (!Number.isFinite(uncertaintyBound) || uncertaintyBound < 0 || uncertaintyBound > 1) {
    throw new ExecVocabularyError(
      ExecErrorCode.UNCERTAINTY_BOUND_INVALID,
      uncertaintyBound,
      'uncertainty bound must lie in [0,1]',
    );
  }
  if (!Number.isFinite(policyLimit) || policyLimit < 0 || policyLimit > 1) {
    throw new ExecVocabularyError(
      ExecErrorCode.UNCERTAINTY_BOUND_INVALID,
      policyLimit,
      'policy limit must lie in [0,1]',
    );
  }
  return uncertaintyBound >= policyLimit;
}

/** §64.8 profile-declared action-delay robustness requirement. */
export type RequiredDelayRobustness = 'REFERENCE_ONLY' | 'P50' | 'P90' | 'CONSERVATIVE';

export const ALL_REQUIRED_DELAY_ROBUSTNESSES: readonly RequiredDelayRobustness[] = [
  'REFERENCE_ONLY',
  'P50',
  'P90',
  'CONSERVATIVE',
];

/**
 * §64.8 delay ladder: a profile requiring a level implicitly requires every
 * weaker level. `BASE_CASE` is always required; the conservative level adds
 * the conservative latency/adverse-selection scenario on top of p90.
 */
const DELAY_ROBUSTNESS_LADDER: Readonly<
  Record<RequiredDelayRobustness, readonly StressScenarioKind[]>
> = {
  REFERENCE_ONLY: [StressScenarioKind.BASE_CASE],
  P50: [StressScenarioKind.BASE_CASE, StressScenarioKind.P50_DELAY],
  P90: [StressScenarioKind.BASE_CASE, StressScenarioKind.P50_DELAY, StressScenarioKind.P90_DELAY],
  CONSERVATIVE: [
    StressScenarioKind.BASE_CASE,
    StressScenarioKind.P50_DELAY,
    StressScenarioKind.P90_DELAY,
    StressScenarioKind.CONSERVATIVE_LATENCY_ADVERSE_SELECTION,
  ],
};

/**
 * §64.8 robust-delay gate: a candidate valid only at an unrealistically short
 * delay cannot pass a profile requiring p90 (or conservative) robustness.
 * Unknown scenario kinds refuse fail-closed instead of counting as passes.
 */
export function robustDelayGate(input: {
  readonly passedScenarioKinds: readonly unknown[];
  readonly requiredRobustness: RequiredDelayRobustness;
}): boolean {
  const required = DELAY_ROBUSTNESS_LADDER[input.requiredRobustness];
  if (required === undefined) {
    throw new ExecVocabularyError(
      ExecErrorCode.REQUIRED_DELAY_ROBUSTNESS_UNKNOWN,
      input.requiredRobustness,
    );
  }
  const passed = new Set<StressScenarioKind>();
  for (const kind of input.passedScenarioKinds) {
    passed.add(stressScenarioKind(kind));
  }
  return required.every((kind) => passed.has(kind));
}

export interface AdverseOrderingResult {
  readonly primaryOrdering: PrimaryOrdering;
  /** True when coarse intervals allow both favorable and adverse orderings. */
  readonly pathAmbiguity: boolean;
}

/**
 * §64.7: when coarse intervals allow both favorable and adverse trigger
 * ordering, the primary result uses the adverse feasible ordering and reports
 * path ambiguity. When only one ordering is reachable the result is
 * unambiguous with no ambiguity flag.
 */
export function adverseOrderingRequired(input: {
  readonly targetReachable: boolean;
  readonly invalidationReachable: boolean;
}): AdverseOrderingResult {
  const ambiguous = input.targetReachable && input.invalidationReachable;
  return ambiguous
    ? { primaryOrdering: PrimaryOrdering.ADVERSE_FEASIBLE, pathAmbiguity: true }
    : { primaryOrdering: PrimaryOrdering.UNAMBIGUOUS, pathAmbiguity: false };
}
