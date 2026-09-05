/**
 * Execution-aware outcome, tradability, and maturity vocabularies (§64, §8).
 *
 * These parsers are deliberately fail-closed. Values received across a trust
 * boundary must be parsed; unknown future values are never treated as safe.
 *
 * The outcome model keeps SIGNAL and TRADABLE labels on separate axes (§8.2):
 * a signal can succeed while every tradable scenario fails, and no render may
 * collapse one into the other (INV-011). The pure laws below encode the
 * §8.2 label precedence, FR-EXEC-006 profit-rendering prohibition, FR-EXEC-007
 * confirmation gating, §64.13/FR-EXEC-004 executable-target evidence, FR-EXEC-020
 * uncertainty blocking, §64.8 delay robustness, and §64.7/FR-MAT-009 adverse
 * trigger ordering.
 *
 * Traces: FR-EXEC-001, FR-EXEC-002, FR-EXEC-004, FR-EXEC-006, FR-EXEC-007,
 * FR-EXEC-013, FR-EXEC-015, FR-EXEC-017, FR-EXEC-020, AC-120, AC-122.
 */

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

export const OutcomeMaturity = {
  PENDING: 'PENDING',
  PARTIALLY_MATURED: 'PARTIALLY_MATURED',
  FULLY_MATURED: 'FULLY_MATURED',
  CENSORED: 'CENSORED',
  INVALID_DATA: 'INVALID_DATA',
} as const;
export type OutcomeMaturity = (typeof OutcomeMaturity)[keyof typeof OutcomeMaturity];

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

export const AdapterSupportState = {
  AVAILABLE: 'AVAILABLE',
  DEGRADED: 'DEGRADED',
  UNAVAILABLE: 'UNAVAILABLE',
} as const;
export type AdapterSupportState =
  (typeof AdapterSupportState)[keyof typeof AdapterSupportState];

export const ExecutionStatus = {
  EXECUTED_FULL: 'EXECUTED_FULL',
  EXECUTION_PARTIAL: 'EXECUTION_PARTIAL',
  EXECUTION_UNAVAILABLE: 'EXECUTION_UNAVAILABLE',
  POOL_MATH_UNSUPPORTED: 'POOL_MATH_UNSUPPORTED',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
} as const;
export type ExecutionStatus = (typeof ExecutionStatus)[keyof typeof ExecutionStatus];

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

export const ExitPolicyKind = {
  FIXED_HORIZON: 'FIXED_HORIZON',
  TAKE_PROFIT_STOP_LOSS: 'TAKE_PROFIT_STOP_LOSS',
  TRAILING_EXIT: 'TRAILING_EXIT',
  STAGED_EXIT: 'STAGED_EXIT',
  LIQUIDITY_RISK_DETERIORATION: 'LIQUIDITY_RISK_DETERIORATION',
  THESIS_INVALIDATION: 'THESIS_INVALIDATION',
} as const;
export type ExitPolicyKind = (typeof ExitPolicyKind)[keyof typeof ExitPolicyKind];

export const PrimaryOrdering = {
  ADVERSE_FEASIBLE: 'ADVERSE_FEASIBLE',
  UNAMBIGUOUS: 'UNAMBIGUOUS',
} as const;
export type PrimaryOrdering = (typeof PrimaryOrdering)[keyof typeof PrimaryOrdering];

/**
 * §64.13/§64.15/FR-EXEC-020 verdict over a candidate's tradability for the
 * evaluated scenario. TRADABLE is reachable only through the pure laws below;
 * every other value is an explicit, machine-readable block reason.
 */
export const TradabilityVerdict = {
  TRADABLE: 'TRADABLE',
  UNCERTAINTY_BLOCKED: 'UNCERTAINTY_BLOCKED',
  TARGET_NOT_EXECUTABLE: 'TARGET_NOT_EXECUTABLE',
  STATE_INCOMPLETE: 'STATE_INCOMPLETE',
  EXECUTION_UNAVAILABLE: 'EXECUTION_UNAVAILABLE',
  POOL_MATH_UNSUPPORTED: 'POOL_MATH_UNSUPPORTED',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
} as const;
export type TradabilityVerdict = (typeof TradabilityVerdict)[keyof typeof TradabilityVerdict];

export const ObservationPlanTriggerClass = {
  DEEP_RESEARCH: 'DEEP_RESEARCH',
  EARLY_WATCH: 'EARLY_WATCH',
  CONFIRMED_OPPORTUNITY: 'CONFIRMED_OPPORTUNITY',
  CONTROL_SAMPLE: 'CONTROL_SAMPLE',
  SHADOW_PORTFOLIO: 'SHADOW_PORTFOLIO',
} as const;
export type ObservationPlanTriggerClass =
  (typeof ObservationPlanTriggerClass)[keyof typeof ObservationPlanTriggerClass];

/** §8.2 step 4 names a distinct tradable-failure reason, not a new class. */
export const TradableFailureReason = {
  SECURITY_OR_LIQUIDITY: 'SECURITY_OR_LIQUIDITY',
  EXPLICIT_FAILURE_CLAUSE: 'EXPLICIT_FAILURE_CLAUSE',
} as const;
export type TradableFailureReason =
  (typeof TradableFailureReason)[keyof typeof TradableFailureReason];

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
  TRADABLE_FAILURE_REASON_UNKNOWN: 'TRADABLE_FAILURE_REASON_UNKNOWN',
  // --- pure-law input validation (fail-closed on malformed clause sets)
  EXEC_LABEL_CLAUSES_INVALID: 'EXEC_LABEL_CLAUSES_INVALID',
  EXEC_PROFIT_RENDERING_INPUT_INVALID: 'EXEC_PROFIT_RENDERING_INPUT_INVALID',
  EXEC_CONFIRMATION_INPUT_INVALID: 'EXEC_CONFIRMATION_INPUT_INVALID',
  EXEC_TARGET_INPUT_INVALID: 'EXEC_TARGET_INPUT_INVALID',
  EXEC_UNCERTAINTY_INPUT_INVALID: 'EXEC_UNCERTAINTY_INPUT_INVALID',
  EXEC_DELAY_GATE_INPUT_INVALID: 'EXEC_DELAY_GATE_INPUT_INVALID',
  EXEC_ORDERING_INPUT_INVALID: 'EXEC_ORDERING_INPUT_INVALID',
} as const;
export type ExecErrorCode = (typeof ExecErrorCode)[keyof typeof ExecErrorCode];

/** Typed exec parse/validation failure carrying a stable machine code. */
export class ExecVocabularyError extends RangeError {
  readonly code: ExecErrorCode;
  readonly value: unknown;

  constructor(code: ExecErrorCode, value: unknown) {
    super(`${code}: invalid execution vocabulary/law input ${JSON.stringify(value)}`);
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

function parseStrictBoolean(value: unknown, code: ExecErrorCode): boolean {
  if (typeof value !== 'boolean') throw new ExecVocabularyError(code, value);
  return value;
}

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
export const ALL_TRADABLE_FAILURE_REASONS: readonly TradableFailureReason[] =
  Object.values(TradableFailureReason);

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
export const tradableFailureReason = (value: unknown): TradableFailureReason =>
  parseVocabulary(
    ALL_TRADABLE_FAILURE_REASONS,
    value,
    ExecErrorCode.TRADABLE_FAILURE_REASON_UNKNOWN,
  );

/** Signal-axis classes (§8.2: signal labels are calculated separately). */
export const SIGNAL_OUTCOME_CLASSES: readonly OutcomeClass[] = [
  OutcomeClass.SIGNAL_SUCCESS,
  OutcomeClass.SIGNAL_FAILURE,
];

/** Terminal tradable-axis classes: fully resolved tradable outcomes. */
export const TERMINAL_TRADABLE_OUTCOME_CLASSES: readonly OutcomeClass[] = [
  OutcomeClass.TRADABLE_SUCCESS,
  OutcomeClass.TRADABLE_FAILURE,
  OutcomeClass.TRADABLE_NEUTRAL,
  OutcomeClass.NEUTRAL,
];

// ---------------------------------------------------------------------------
// Pure laws
// ---------------------------------------------------------------------------

/** Clause set handed to `outcomeLabelPrecedence`. All fields required. */
export interface OutcomeLabelClauses {
  /** Identity, chronology, required state, adapter correctness, or evidence integrity is invalid (§8.2 step 1). */
  readonly invalidData: boolean;
  /** The horizon cannot be fully observed for an exogenous documented reason and no terminal event is established (§8.2 step 2). */
  readonly censored: boolean;
  /** Independent maturity state (§12.8) — candidate/alert lifecycle cannot overwrite it. */
  readonly maturity: OutcomeMaturity;
  /** Profile-blocking security/rug/liquidity terminal event (§8.2 step 4). */
  readonly tradableSecurityOrLiquidityFailure: boolean;
  /** Every required success and survival clause passes (§8.2 step 5). */
  readonly tradableSuccess: boolean;
  /** An explicit failure clause passes (§8.2 step 6). */
  readonly tradableFailure: boolean;
  /** Price/path result without executability reached the signal-success clause. */
  readonly signalSuccess: boolean;
  /** Signal failure clause. */
  readonly signalFailure: boolean;
}

/** §8.2 resolution: tradable label on the primary axis, signal label on its own axis. */
export interface OutcomeLabelResult {
  readonly tradableLabel: OutcomeClass;
  readonly tradableFailureReason: TradableFailureReason | null;
  /** SIGNAL_SUCCESS / SIGNAL_FAILURE only — never overwrites `tradableLabel`. */
  readonly signalLabel: OutcomeClass | null;
  /** Echo of the independent maturity axis. */
  readonly maturity: OutcomeMaturity;
}

function isStrictBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

/**
 * §8.2 common outcome-label precedence, applied in order:
 * INVALID_DATA → CENSORED → PENDING (PENDING/PARTIALLY_MATURED maturity) →
 * TRADABLE_FAILURE (SECURITY_OR_LIQUIDITY) → TRADABLE_SUCCESS →
 * TRADABLE_FAILURE (explicit clause) → TRADABLE_NEUTRAL.
 *
 * Signal labels live on a separate axis and never overwrite the tradable
 * label; both are returned so callers cannot collapse them. Fail-closed:
 * non-boolean clauses or an unknown maturity throw; a clause set that is
 * neither pending nor matured (maturity FULLY_MATURED but nothing to label)
 * throws rather than guessing.
 */
export function outcomeLabelPrecedence(clauses: OutcomeLabelClauses): OutcomeLabelResult {
  if (clauses === null || typeof clauses !== 'object') {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, clauses);
  }
  const invalidData = parseStrictBoolean(
    clauses.invalidData,
    ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID,
  );
  const censored = parseStrictBoolean(clauses.censored, ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID);
  const tradableSecurityOrLiquidityFailure = parseStrictBoolean(
    clauses.tradableSecurityOrLiquidityFailure,
    ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID,
  );
  const tradableSuccess = parseStrictBoolean(
    clauses.tradableSuccess,
    ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID,
  );
  const tradableFailure = parseStrictBoolean(
    clauses.tradableFailure,
    ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID,
  );
  const signalSuccess = parseStrictBoolean(
    clauses.signalSuccess,
    ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID,
  );
  const signalFailure = parseStrictBoolean(
    clauses.signalFailure,
    ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID,
  );
  const maturity = outcomeMaturity(clauses.maturity);

  if (signalSuccess && signalFailure) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, clauses);
  }
  if (censored && (tradableSecurityOrLiquidityFailure || tradableSuccess || tradableFailure)) {
    // §8.2 step 2 requires "no terminal event is established" for CENSORED.
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, clauses);
  }
  if (tradableSecurityOrLiquidityFailure && (tradableSuccess || tradableFailure)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, clauses);
  }

  const signalLabel = signalSuccess
    ? OutcomeClass.SIGNAL_SUCCESS
    : signalFailure
      ? OutcomeClass.SIGNAL_FAILURE
      : null;

  // 1. INVALID_DATA
  if (invalidData || maturity === OutcomeMaturity.INVALID_DATA) {
    return {
      tradableLabel: OutcomeClass.INVALID_DATA,
      tradableFailureReason: null,
      signalLabel,
      maturity,
    };
  }
  // 2. CENSORED
  if (censored || maturity === OutcomeMaturity.CENSORED) {
    return {
      tradableLabel: OutcomeClass.CENSORED,
      tradableFailureReason: null,
      signalLabel,
      maturity,
    };
  }
  // 3. PENDING / PARTIALLY_MATURED — not yet matured, no terminal event.
  if (
    maturity === OutcomeMaturity.PENDING ||
    maturity === OutcomeMaturity.PARTIALLY_MATURED
  ) {
    return {
      tradableLabel: OutcomeClass.PENDING,
      tradableFailureReason: null,
      signalLabel,
      maturity,
    };
  }
  // From here the outcome must be fully matured.
  if (maturity !== OutcomeMaturity.FULLY_MATURED) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, clauses);
  }
  // 4. TRADABLE_FAILURE on a profile-blocking security/rug/liquidity terminal event.
  if (tradableSecurityOrLiquidityFailure) {
    return {
      tradableLabel: OutcomeClass.TRADABLE_FAILURE,
      tradableFailureReason: TradableFailureReason.SECURITY_OR_LIQUIDITY,
      signalLabel,
      maturity,
    };
  }
  // 5. TRADABLE_SUCCESS when every required success and survival clause passes.
  if (tradableSuccess) {
    return {
      tradableLabel: OutcomeClass.TRADABLE_SUCCESS,
      tradableFailureReason: null,
      signalLabel,
      maturity,
    };
  }
  // 6. TRADABLE_FAILURE when an explicit failure clause passes.
  if (tradableFailure) {
    return {
      tradableLabel: OutcomeClass.TRADABLE_FAILURE,
      tradableFailureReason: TradableFailureReason.EXPLICIT_FAILURE_CLAUSE,
      signalLabel,
      maturity,
    };
  }
  // 7. TRADABLE_NEUTRAL when fully matured but neither success nor failure passes.
  return {
    tradableLabel: OutcomeClass.TRADABLE_NEUTRAL,
    tradableFailureReason: null,
    signalLabel,
    maturity,
  };
}

export interface ProfitRenderingAttempt {
  /** The signal-axis label the render is derived from. */
  readonly signalLabel: OutcomeClass;
  /** The tradable-axis label, when one has been established. `null` = absent. */
  readonly tradableLabel: OutcomeClass | null;
  /** Whether the payload renders profit. */
  readonly renderProfit: boolean;
}

/**
 * FR-EXEC-006 / INV-011: SIGNAL_SUCCESS cannot be rendered as profit when
 * TRADABLE_SUCCESS is absent or failed.
 *
 * Returns `true` when the attempted rendering VIOLATES the law (i.e. profit
 * is being rendered while the tradable axis is not `TRADABLE_SUCCESS`). A
 * render that does not claim profit never violates the law. Fail-closed on
 * malformed inputs.
 */
export function signalCannotRenderProfit(attempt: ProfitRenderingAttempt): boolean {
  if (attempt === null || typeof attempt !== 'object') {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_PROFIT_RENDERING_INPUT_INVALID, attempt);
  }
  const signalLabel = outcomeClass(attempt.signalLabel);
  if (!SIGNAL_OUTCOME_CLASSES.includes(signalLabel)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_PROFIT_RENDERING_INPUT_INVALID, attempt);
  }
  const renderProfit = parseStrictBoolean(
    attempt.renderProfit,
    ExecErrorCode.EXEC_PROFIT_RENDERING_INPUT_INVALID,
  );
  if (!renderProfit) return false;
  const tradableLabel =
    attempt.tradableLabel === null || attempt.tradableLabel === undefined
      ? null
      : outcomeClass(attempt.tradableLabel);
  return tradableLabel !== OutcomeClass.TRADABLE_SUCCESS;
}

export interface ConfirmedOpportunityEvaluation {
  /** Diagnostic signal label to preserve verbatim (FR-EXEC-007). */
  readonly signalLabel: OutcomeClass | null;
  /** Tradability verdict for the evaluated scenario. */
  readonly verdict: TradabilityVerdict;
}

export interface ConfirmedOpportunityResult {
  /** Whether the CONFIRMED_OPPORTUNITY alert class may be published. */
  readonly confirmedOpportunity: boolean;
  /** When blocked, the verdict that blocked it (never rewritten). */
  readonly blockReason: TradabilityVerdict | null;
  /** The diagnostic signal label, preserved unchanged even when blocked. */
  readonly preservedSignalLabel: OutcomeClass | null;
}

/**
 * FR-EXEC-007: tradability can block CONFIRMED_OPPORTUNITY while preserving
 * diagnostic signal labels. Only `TRADABLE` confirms; every other verdict
 * blocks (fail-closed). The diagnostic signal label is returned unchanged —
 * a blocked confirmation must not rewrite a SIGNAL_SUCCESS into failure.
 */
export function tradabilityBlocksConfirmedOpportunity(
  evaluation: ConfirmedOpportunityEvaluation,
): ConfirmedOpportunityResult {
  if (evaluation === null || typeof evaluation !== 'object') {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_CONFIRMATION_INPUT_INVALID, evaluation);
  }
  const verdict = tradabilityVerdict(evaluation.verdict);
  const signalLabel =
    evaluation.signalLabel === null || evaluation.signalLabel === undefined
      ? null
      : outcomeClass(evaluation.signalLabel);
  const confirmedOpportunity = verdict === TradabilityVerdict.TRADABLE;
  return {
    confirmedOpportunity,
    blockReason: confirmedOpportunity ? null : verdict,
    preservedSignalLabel: signalLabel,
  };
}

export interface ExecutableTargetInput {
  /** The price path touched the target. */
  readonly touched: boolean;
  /** Sufficient economic/executable volume around the target was observed (§64.13). */
  readonly executableVolumeObserved: boolean;
  /** The configured target-duration support was observed (§64.13). */
  readonly targetDurationSupported: boolean;
  /** The only touch evidence is an isolated (single-slot, unsupported) wick. */
  readonly isolatedWick: boolean;
}

/**
 * §64.13 / FR-EXEC-004: a target counts for tradable success only with
 * executable volume or configured target-duration support; an isolated wick
 * is never sufficient. Fail-closed: every clause must be a strict boolean.
 */
export function executableTargetSatisfied(input: ExecutableTargetInput): boolean {
  if (input === null || typeof input !== 'object') {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_TARGET_INPUT_INVALID, input);
  }
  const touched = parseStrictBoolean(input.touched, ExecErrorCode.EXEC_TARGET_INPUT_INVALID);
  const executableVolumeObserved = parseStrictBoolean(
    input.executableVolumeObserved,
    ExecErrorCode.EXEC_TARGET_INPUT_INVALID,
  );
  const targetDurationSupported = parseStrictBoolean(
    input.targetDurationSupported,
    ExecErrorCode.EXEC_TARGET_INPUT_INVALID,
  );
  const isolatedWick = parseStrictBoolean(
    input.isolatedWick,
    ExecErrorCode.EXEC_TARGET_INPUT_INVALID,
  );
  if (!touched) return false;
  // FR-EXEC-004: an isolated wick cannot automatically count as tradable success.
  if (isolatedWick) return false;
  return executableVolumeObserved || targetDurationSupported;
}

export interface UncertaintyAssessment {
  /** Required pool/program state was complete for the evaluated fill (§64.4). */
  readonly stateComplete: boolean;
  /** Independent/reference quote parity verified within its tolerance gate (§64.11). */
  readonly parityVerified: boolean;
  /** Exposed relative uncertainty bound in [0, 1]; `null` = no bound established. */
  readonly uncertaintyBound: number | null;
  /** Profile-declared maximum supported uncertainty bound in [0, 1]. */
  readonly policyLimit: number;
}

/**
 * FR-EXEC-020: quote/reference sources are evidence, not execution truth;
 * simulation exposes uncertainty when state is incomplete or parity is weak
 * and blocks confirmed tradability when the uncertainty bound crosses policy
 * limits. Returns `true` = blocked. Fail-closed: an absent or non-finite
 * bound blocks, incomplete state blocks, unverified parity blocks.
 */
export function uncertaintyBlocksTradability(assessment: UncertaintyAssessment): boolean {
  if (assessment === null || typeof assessment !== 'object') {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_UNCERTAINTY_INPUT_INVALID, assessment);
  }
  const stateComplete = parseStrictBoolean(
    assessment.stateComplete,
    ExecErrorCode.EXEC_UNCERTAINTY_INPUT_INVALID,
  );
  const parityVerified = parseStrictBoolean(
    assessment.parityVerified,
    ExecErrorCode.EXEC_UNCERTAINTY_INPUT_INVALID,
  );
  const policyLimit = assessment.policyLimit;
  if (typeof policyLimit !== 'number' || !Number.isFinite(policyLimit) || policyLimit < 0) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_UNCERTAINTY_INPUT_INVALID, assessment);
  }
  if (!stateComplete) return true;
  if (!parityVerified) return true;
  const bound = assessment.uncertaintyBound;
  if (bound === null || typeof bound !== 'number' || !Number.isFinite(bound)) return true;
  if (bound < 0 || bound > 1) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_UNCERTAINTY_INPUT_INVALID, assessment);
  }
  return bound > policyLimit;
}

export interface RobustDelayGateInput {
  /** §64.8: the delays the active profile declares must pass (e.g. p90 robustness). */
  readonly profileRequires: readonly StressScenarioKind[];
  /** Observed pass/fail per evaluated stress scenario kind; missing = not evaluated. */
  readonly results: Readonly<Partial<Record<StressScenarioKind, boolean>>>;
}

export interface RobustDelayGateResult {
  readonly robust: boolean;
  /** Required scenarios that failed or were never evaluated. */
  readonly failures: readonly StressScenarioKind[];
}

/**
 * §64.8: opportunity robustness reports pass/fail across the required
 * delays; a candidate valid only at an unrealistically short delay cannot be
 * promoted under a profile requiring p90 robustness. Fail-closed: a missing
 * result for a required scenario is a failure, never a pass.
 */
export function robustDelayGate(input: RobustDelayGateInput): RobustDelayGateResult {
  if (input === null || typeof input !== 'object' || !Array.isArray(input.profileRequires)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_DELAY_GATE_INPUT_INVALID, input);
  }
  if (input.results === null || typeof input.results !== 'object') {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_DELAY_GATE_INPUT_INVALID, input);
  }
  if (input.profileRequires.length === 0) {
    // A profile must declare which delays must pass; an empty requirement is
    // a configuration error, not trivial robustness.
    throw new ExecVocabularyError(ExecErrorCode.EXEC_DELAY_GATE_INPUT_INVALID, input);
  }
  const failures: StressScenarioKind[] = [];
  for (const required of input.profileRequires) {
    const kind = stressScenarioKind(required);
    const result = input.results[kind];
    if (result !== undefined && typeof result !== 'boolean') {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_DELAY_GATE_INPUT_INVALID, input);
    }
    if (result !== true) failures.push(kind);
  }
  return { robust: failures.length === 0, failures };
}

export interface AdverseOrderingInput {
  /** The target (favorable trigger) is reachable within the coarse interval. */
  readonly favorableReachable: boolean;
  /** The invalidation/stop (adverse trigger) is reachable within the coarse interval. */
  readonly adverseReachable: boolean;
  /** The true trigger ordering is established by resolution finer than the interval. */
  readonly orderingKnown: boolean;
}

export interface AdverseOrderingResult {
  readonly primaryOrdering: PrimaryOrdering;
  /** §64.7/FR-MAT-009 path-ambiguity flag. */
  readonly pathAmbiguous: boolean;
}

/**
 * §64.7 / FR-MAT-009: when coarse intervals allow both favorable and adverse
 * trigger ordering and the ordering is unknown, the primary result uses the
 * adverse feasible ordering and reports path ambiguity. An optimistic
 * ordering is secondary analysis only. When exactly one trigger is feasible
 * (or the ordering is known) the result is unambiguous.
 */
export function adverseOrderingRequired(input: AdverseOrderingInput): AdverseOrderingResult {
  if (input === null || typeof input !== 'object') {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_ORDERING_INPUT_INVALID, input);
  }
  const favorableReachable = parseStrictBoolean(
    input.favorableReachable,
    ExecErrorCode.EXEC_ORDERING_INPUT_INVALID,
  );
  const adverseReachable = parseStrictBoolean(
    input.adverseReachable,
    ExecErrorCode.EXEC_ORDERING_INPUT_INVALID,
  );
  const orderingKnown = parseStrictBoolean(
    input.orderingKnown,
    ExecErrorCode.EXEC_ORDERING_INPUT_INVALID,
  );
  if (orderingKnown) {
    return { primaryOrdering: PrimaryOrdering.UNAMBIGUOUS, pathAmbiguous: false };
  }
  if (favorableReachable && adverseReachable) {
    return { primaryOrdering: PrimaryOrdering.ADVERSE_FEASIBLE, pathAmbiguous: true };
  }
  return { primaryOrdering: PrimaryOrdering.UNAMBIGUOUS, pathAmbiguous: false };
}
