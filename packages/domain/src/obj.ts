/** Closed objective-governance vocabularies and pure laws (FR-OBJ-001…010). */
import type { ErrorDetail } from './errors.ts';

/**
 * Fourteen closed vocabularies govern the primary production objective and
 * every performance claim. The SQL CHECK literal lists in plan.md's data
 * model are the vocabulary authority; the const objects below transcribe
 * them verbatim. No writer may invent, rename, or omit members.
 *
 * `ObjError` is intentionally standalone (it does not extend
 * `ForesiftError`): no lane in this wave owns
 * `packages/domain/src/errors.ts`, so the OBJ_* codes cannot enter the
 * central `ErrorCode` union. The codes below are stable — values never
 * change once released — and callers branch on `code`, never on prose.
 */

export const ComparisonDimension = {
  CANDIDATE_UNIVERSE: 'CANDIDATE_UNIVERSE',
  POPULATION_CLAIM: 'POPULATION_CLAIM',
  CAPITAL: 'CAPITAL',
  TIME_WINDOW: 'TIME_WINDOW',
  EXECUTION_SCENARIO: 'EXECUTION_SCENARIO',
  DELAY_POLICY: 'DELAY_POLICY',
  DATA_CUTOFF: 'DATA_CUTOFF',
  CORRELATED_EXPOSURE: 'CORRELATED_EXPOSURE',
} as const;
export type ComparisonDimension = (typeof ComparisonDimension)[keyof typeof ComparisonDimension];

export const RunComparability = {
  COMPARABLE: 'COMPARABLE',
  EXPLORATORY_ONLY: 'EXPLORATORY_ONLY',
} as const;
export type RunComparability = (typeof RunComparability)[keyof typeof RunComparability];

export const HardConstraintKind = {
  SECURITY: 'SECURITY',
  EXECUTION: 'EXECUTION',
  RIGHTS: 'RIGHTS',
  LEAKAGE: 'LEAKAGE',
  PUBLIC_CLAIM: 'PUBLIC_CLAIM',
  CAPACITY: 'CAPACITY',
  TAIL_RISK: 'TAIL_RISK',
} as const;
export type HardConstraintKind = (typeof HardConstraintKind)[keyof typeof HardConstraintKind];

export const HardConstraintVerdict = {
  PASS: 'PASS',
  FAIL: 'FAIL',
} as const;
export type HardConstraintVerdict =
  (typeof HardConstraintVerdict)[keyof typeof HardConstraintVerdict];

export const UtilityLineKind = {
  GROSS_RETURN: 'GROSS_RETURN',
  EXECUTION_COSTS: 'EXECUTION_COSTS',
  FAILED_PARTIAL_FILLS: 'FAILED_PARTIAL_FILLS',
  DRAWDOWN: 'DRAWDOWN',
  CVAR: 'CVAR',
  CAPITAL_UTILIZATION: 'CAPITAL_UTILIZATION',
  TURNOVER: 'TURNOVER',
  OPPORTUNITY_COST: 'OPPORTUNITY_COST',
  CONCENTRATION: 'CONCENTRATION',
  SHARED_LIQUIDITY_IMPACT: 'SHARED_LIQUIDITY_IMPACT',
  PROVIDER_MODEL_INFRA_COST: 'PROVIDER_MODEL_INFRA_COST',
  UNCERTAINTY: 'UNCERTAINTY',
} as const;
export type UtilityLineKind = (typeof UtilityLineKind)[keyof typeof UtilityLineKind];

export const DiagnosticKind = {
  PER_ALERT_PRECISION: 'PER_ALERT_PRECISION',
  TRADABLE_SUCCESS_RATE: 'TRADABLE_SUCCESS_RATE',
  RECALL: 'RECALL',
  ALERTS_PER_RESEARCHED_CANDIDATE: 'ALERTS_PER_RESEARCHED_CANDIDATE',
} as const;
export type DiagnosticKind = (typeof DiagnosticKind)[keyof typeof DiagnosticKind];

export const IntegritySignalKind = {
  DENOMINATOR_GAMING: 'DENOMINATOR_GAMING',
  SELECTIVE_UNIVERSE_CHANGE: 'SELECTIVE_UNIVERSE_CHANGE',
  REDUCED_EXPLORATION: 'REDUCED_EXPLORATION',
  DELAYED_OUTCOME_OMISSION: 'DELAYED_OUTCOME_OMISSION',
  HORIZON_SWITCHING: 'HORIZON_SWITCHING',
  SCENARIO_CHERRY_PICKING: 'SCENARIO_CHERRY_PICKING',
  REPEATED_HOLDOUT_INSPECTION: 'REPEATED_HOLDOUT_INSPECTION',
} as const;
export type IntegritySignalKind = (typeof IntegritySignalKind)[keyof typeof IntegritySignalKind];

export const IntegrityVerdict = {
  PASS: 'PASS',
  FAIL_BLOCKS_PROMOTION: 'FAIL_BLOCKS_PROMOTION',
} as const;
export type IntegrityVerdict = (typeof IntegrityVerdict)[keyof typeof IntegrityVerdict];

export const ClaimScopeField = {
  SUPPORTED_POPULATION: 'SUPPORTED_POPULATION',
  PROFILE: 'PROFILE',
  POLICY: 'POLICY',
  EXECUTION_SCENARIO: 'EXECUTION_SCENARIO',
  DELAY_DISTRIBUTION: 'DELAY_DISTRIBUTION',
  CALENDAR_INTERVAL: 'CALENDAR_INTERVAL',
  MARKET_REGIMES: 'MARKET_REGIMES',
  CAPABILITY_STATE: 'CAPABILITY_STATE',
  SAMPLE_SIZE: 'SAMPLE_SIZE',
  CLUSTER_EFFECTIVE_SAMPLE_SIZE: 'CLUSTER_EFFECTIVE_SAMPLE_SIZE',
  UNCERTAINTY_METHOD: 'UNCERTAINTY_METHOD',
} as const;
export type ClaimScopeField = (typeof ClaimScopeField)[keyof typeof ClaimScopeField];

export const DelayScenario = {
  P50: 'P50',
  P90: 'P90',
  CONSERVATIVE_TAIL: 'CONSERVATIVE_TAIL',
} as const;
export type DelayScenario = (typeof DelayScenario)[keyof typeof DelayScenario];

export const SensitivityDimension = {
  CAPITAL: 'CAPITAL',
  NOTIONAL: 'NOTIONAL',
  CONCURRENCY: 'CONCURRENCY',
  ROUTE_CAPACITY: 'ROUTE_CAPACITY',
  ALERT_LATENCY: 'ALERT_LATENCY',
  EXIT_POLICY: 'EXIT_POLICY',
  RISK_AVERSION: 'RISK_AVERSION',
} as const;
export type SensitivityDimension = (typeof SensitivityDimension)[keyof typeof SensitivityDimension];

export const ProhibitedClaimKind = {
  GUARANTEED_PROFIT: 'GUARANTEED_PROFIT',
  ASSURED_RETURN: 'ASSURED_RETURN',
  RISK_FREE_PROFIT: 'RISK_FREE_PROFIT',
  CERTAIN_GAIN: 'CERTAIN_GAIN',
} as const;
export type ProhibitedClaimKind = (typeof ProhibitedClaimKind)[keyof typeof ProhibitedClaimKind];

export const PromotionVerdict = {
  PROMOTE: 'PROMOTE',
  HOLD_EXPLORATORY_ONLY: 'HOLD_EXPLORATORY_ONLY',
  BLOCK: 'BLOCK',
} as const;
export type PromotionVerdict = (typeof PromotionVerdict)[keyof typeof PromotionVerdict];

/** Stable machine-readable objective-governance error codes. Values never change once released. */
export const ObjErrorCode = {
  OBJ_DIMENSION_UNKNOWN: 'OBJ_DIMENSION_UNKNOWN',
  OBJ_COMPARABILITY_UNKNOWN: 'OBJ_COMPARABILITY_UNKNOWN',
  OBJ_CONSTRAINT_KIND_UNKNOWN: 'OBJ_CONSTRAINT_KIND_UNKNOWN',
  OBJ_CONSTRAINT_VERDICT_UNKNOWN: 'OBJ_CONSTRAINT_VERDICT_UNKNOWN',
  OBJ_LINE_KIND_UNKNOWN: 'OBJ_LINE_KIND_UNKNOWN',
  OBJ_DIAGNOSTIC_KIND_UNKNOWN: 'OBJ_DIAGNOSTIC_KIND_UNKNOWN',
  OBJ_INTEGRITY_SIGNAL_UNKNOWN: 'OBJ_INTEGRITY_SIGNAL_UNKNOWN',
  OBJ_CLAIM_FIELD_UNKNOWN: 'OBJ_CLAIM_FIELD_UNKNOWN',
  OBJ_DELAY_SCENARIO_UNKNOWN: 'OBJ_DELAY_SCENARIO_UNKNOWN',
  OBJ_SENSITIVITY_DIMENSION_UNKNOWN: 'OBJ_SENSITIVITY_DIMENSION_UNKNOWN',
  OBJ_PROHIBITED_CLAIM_UNKNOWN: 'OBJ_PROHIBITED_CLAIM_UNKNOWN',
  OBJ_PROMOTION_VERDICT_UNKNOWN: 'OBJ_PROMOTION_VERDICT_UNKNOWN',
  OBJ_INCOMPARABLE_PROMOTION_REFUSED: 'OBJ_INCOMPARABLE_PROMOTION_REFUSED',
  OBJ_HARD_CONSTRAINT_FAILED: 'OBJ_HARD_CONSTRAINT_FAILED',
  OBJ_DIAGNOSTIC_AS_OBJECTIVE_REFUSED: 'OBJ_DIAGNOSTIC_AS_OBJECTIVE_REFUSED',
  OBJ_INTEGRITY_FAILURE_BLOCKS_PROMOTION: 'OBJ_INTEGRITY_FAILURE_BLOCKS_PROMOTION',
  OBJ_CLAIM_SCOPE_INCOMPLETE: 'OBJ_CLAIM_SCOPE_INCOMPLETE',
  OBJ_SINGLE_DELAY_EVIDENCE_REFUSED: 'OBJ_SINGLE_DELAY_EVIDENCE_REFUSED',
  OBJ_FROZEN_EXPERIMENT_REWRITE_REFUSED: 'OBJ_FROZEN_EXPERIMENT_REWRITE_REFUSED',
  OBJ_GUARANTEED_LANGUAGE_REFUSED: 'OBJ_GUARANTEED_LANGUAGE_REFUSED',
  OBJ_UNCERTAINTY_DISCLOSURE_MISSING: 'OBJ_UNCERTAINTY_DISCLOSURE_MISSING',
  OBJ_FLOAT_ARITHMETIC_REFUSED: 'OBJ_FLOAT_ARITHMETIC_REFUSED',
} as const;
export type ObjErrorCode = (typeof ObjErrorCode)[keyof typeof ObjErrorCode];

/** Base class for every objective-governance refusal. Fail-closed by construction. */
export class ObjError extends Error {
  readonly code: ObjErrorCode;
  readonly detail: ErrorDetail;

  constructor(code: ObjErrorCode, message: string, detail: ErrorDetail = {}) {
    super(`${code}: ${message}`);
    this.name = 'ObjError';
    this.code = code;
    this.detail = detail;
  }
}

/** Narrowing guard for objective-governance errors. */
export function isObjError(value: unknown): value is ObjError {
  return value instanceof ObjError;
}

function parseClosed<T extends string>(
  values: readonly T[],
  value: unknown,
  code: ObjErrorCode,
  label: string,
): T {
  if (typeof value === 'string' && (values as readonly string[]).includes(value)) return value as T;
  throw new ObjError(
    code,
    `unknown ${label}`,
    { value: typeof value === 'string' ? value : null },
  );
}

export const ALL_COMPARISON_DIMENSIONS: readonly ComparisonDimension[] =
  Object.values(ComparisonDimension);
export const COMPARISON_DIMENSIONS = ALL_COMPARISON_DIMENSIONS;
export const ALL_RUN_COMPARABILITIES: readonly RunComparability[] =
  Object.values(RunComparability);
export const RUN_COMPARABILITIES = ALL_RUN_COMPARABILITIES;
export const ALL_HARD_CONSTRAINT_KINDS: readonly HardConstraintKind[] =
  Object.values(HardConstraintKind);
export const HARD_CONSTRAINT_KINDS = ALL_HARD_CONSTRAINT_KINDS;
export const ALL_HARD_CONSTRAINT_VERDICTS: readonly HardConstraintVerdict[] =
  Object.values(HardConstraintVerdict);
export const HARD_CONSTRAINT_VERDICTS = ALL_HARD_CONSTRAINT_VERDICTS;
export const ALL_UTILITY_LINE_KINDS: readonly UtilityLineKind[] = Object.values(UtilityLineKind);
export const UTILITY_LINE_KINDS = ALL_UTILITY_LINE_KINDS;
export const ALL_DIAGNOSTIC_KINDS: readonly DiagnosticKind[] = Object.values(DiagnosticKind);
export const DIAGNOSTIC_KINDS = ALL_DIAGNOSTIC_KINDS;
export const ALL_INTEGRITY_SIGNAL_KINDS: readonly IntegritySignalKind[] =
  Object.values(IntegritySignalKind);
export const INTEGRITY_SIGNAL_KINDS = ALL_INTEGRITY_SIGNAL_KINDS;
export const ALL_INTEGRITY_VERDICTS: readonly IntegrityVerdict[] =
  Object.values(IntegrityVerdict);
export const INTEGRITY_VERDICTS = ALL_INTEGRITY_VERDICTS;
export const ALL_CLAIM_SCOPE_FIELDS: readonly ClaimScopeField[] = Object.values(ClaimScopeField);
export const CLAIM_SCOPE_FIELDS = ALL_CLAIM_SCOPE_FIELDS;
export const ALL_DELAY_SCENARIOS: readonly DelayScenario[] = Object.values(DelayScenario);
export const DELAY_SCENARIOS = ALL_DELAY_SCENARIOS;
export const ALL_SENSITIVITY_DIMENSIONS: readonly SensitivityDimension[] =
  Object.values(SensitivityDimension);
export const SENSITIVITY_DIMENSIONS = ALL_SENSITIVITY_DIMENSIONS;
export const ALL_PROHIBITED_CLAIM_KINDS: readonly ProhibitedClaimKind[] =
  Object.values(ProhibitedClaimKind);
export const PROHIBITED_CLAIM_KINDS = ALL_PROHIBITED_CLAIM_KINDS;
export const ALL_PROMOTION_VERDICTS: readonly PromotionVerdict[] =
  Object.values(PromotionVerdict);
export const PROMOTION_VERDICTS = ALL_PROMOTION_VERDICTS;
export const ALL_OBJ_ERROR_CODES: readonly ObjErrorCode[] = Object.values(ObjErrorCode);
export const OBJ_ERROR_CODES = ALL_OBJ_ERROR_CODES;

export const parseComparisonDimension = (value: unknown): ComparisonDimension =>
  parseClosed(ALL_COMPARISON_DIMENSIONS, value, ObjErrorCode.OBJ_DIMENSION_UNKNOWN, 'comparison dimension');
export const parseRunComparability = (value: unknown): RunComparability =>
  parseClosed(ALL_RUN_COMPARABILITIES, value, ObjErrorCode.OBJ_COMPARABILITY_UNKNOWN, 'run comparability');
export const parseHardConstraintKind = (value: unknown): HardConstraintKind =>
  parseClosed(ALL_HARD_CONSTRAINT_KINDS, value, ObjErrorCode.OBJ_CONSTRAINT_KIND_UNKNOWN, 'hard constraint kind');
export const parseHardConstraintVerdict = (value: unknown): HardConstraintVerdict =>
  parseClosed(
    ALL_HARD_CONSTRAINT_VERDICTS,
    value,
    ObjErrorCode.OBJ_CONSTRAINT_VERDICT_UNKNOWN,
    'hard constraint verdict',
  );
export const parseUtilityLineKind = (value: unknown): UtilityLineKind =>
  parseClosed(ALL_UTILITY_LINE_KINDS, value, ObjErrorCode.OBJ_LINE_KIND_UNKNOWN, 'utility line kind');
export const parseDiagnosticKind = (value: unknown): DiagnosticKind =>
  parseClosed(ALL_DIAGNOSTIC_KINDS, value, ObjErrorCode.OBJ_DIAGNOSTIC_KIND_UNKNOWN, 'diagnostic kind');
export const parseIntegritySignal = (value: unknown): IntegritySignalKind =>
  parseClosed(
    ALL_INTEGRITY_SIGNAL_KINDS,
    value,
    ObjErrorCode.OBJ_INTEGRITY_SIGNAL_UNKNOWN,
    'integrity signal kind',
  );
/**
 * Integrity verdicts are computed outputs, never parsed from untrusted
 * input — so there is no OBJ_INTEGRITY_VERDICT_UNKNOWN code. An
 * unrecognized verdict string refuses fail-closed as an integrity failure
 * (it cannot be PASS, so it must block promotion).
 */
export const parseIntegrityVerdict = (value: unknown): IntegrityVerdict =>
  parseClosed(
    ALL_INTEGRITY_VERDICTS,
    value,
    ObjErrorCode.OBJ_INTEGRITY_FAILURE_BLOCKS_PROMOTION,
    'integrity verdict',
  );
export const parseClaimScopeField = (value: unknown): ClaimScopeField =>
  parseClosed(ALL_CLAIM_SCOPE_FIELDS, value, ObjErrorCode.OBJ_CLAIM_FIELD_UNKNOWN, 'claim scope field');
export const parseDelayScenario = (value: unknown): DelayScenario =>
  parseClosed(ALL_DELAY_SCENARIOS, value, ObjErrorCode.OBJ_DELAY_SCENARIO_UNKNOWN, 'delay scenario');
export const parseSensitivityDimension = (value: unknown): SensitivityDimension =>
  parseClosed(
    ALL_SENSITIVITY_DIMENSIONS,
    value,
    ObjErrorCode.OBJ_SENSITIVITY_DIMENSION_UNKNOWN,
    'sensitivity dimension',
  );
export const parseProhibitedClaim = (value: unknown): ProhibitedClaimKind =>
  parseClosed(
    ALL_PROHIBITED_CLAIM_KINDS,
    value,
    ObjErrorCode.OBJ_PROHIBITED_CLAIM_UNKNOWN,
    'prohibited claim kind',
  );
export const parsePromotionVerdict = (value: unknown): PromotionVerdict =>
  parseClosed(
    ALL_PROMOTION_VERDICTS,
    value,
    ObjErrorCode.OBJ_PROMOTION_VERDICT_UNKNOWN,
    'promotion verdict',
  );

export const comparisonDimension = parseComparisonDimension;
export const runComparability = parseRunComparability;
export const hardConstraintKind = parseHardConstraintKind;
export const hardConstraintVerdict = parseHardConstraintVerdict;
export const utilityLineKind = parseUtilityLineKind;
export const diagnosticKind = parseDiagnosticKind;
export const integritySignal = parseIntegritySignal;
export const integrityVerdict = parseIntegrityVerdict;
export const claimScopeField = parseClaimScopeField;
export const delayScenario = parseDelayScenario;
export const sensitivityDimension = parseSensitivityDimension;
export const prohibitedClaim = parseProhibitedClaim;
export const promotionVerdict = parsePromotionVerdict;

/** Pinned one-sided-95% z constant at 1e6 scale (1.644854 × 1e6, rounded). ADR-OBJ-01. */
export const Z_ONE_SIDED_95_MICROS = 1644854 as const;
/** Micro-unit scale: 1 unit of capital = 1e6 micro-units. All utility arithmetic is integer. */
export const MICRO_UNIT_SCALE = 1000000 as const;

/**
 * Mandatory research-signal disclosure carried by every screened
 * opportunity output (FR-OBJ-010). Exact sentence; outputs must include it
 * verbatim.
 */
export const UNCERTAINTY_DISCLOSURE_TEXT =
  'Opportunity outputs are evidence-backed research signals whose realized outcome remains uncertain.' as const;

/** Frozen run record consumed by the comparability law (FR-OBJ-002). */
export interface ObjectiveComparisonRecord {
  readonly runId: string;
  readonly dimensions: Readonly<Partial<Record<ComparisonDimension, string>>>;
}

/**
 * Comparability requires exact pairwise equality on all eight dimensions.
 * A missing record — or a record missing any dimension value — refuses
 * (never a verdict). A mismatch is a verdict (`EXPLORATORY_ONLY`), and an
 * exploratory run cannot promote a policy.
 */
export function comparabilityRequiresAllDimensions(
  a: ObjectiveComparisonRecord | null | undefined,
  b: ObjectiveComparisonRecord | null | undefined,
): RunComparability {
  if (a === null || a === undefined)
    throw new ObjError(
      ObjErrorCode.OBJ_INCOMPARABLE_PROMOTION_REFUSED,
      'comparison requires two frozen run records',
      { missing: 'a' },
    );
  if (b === null || b === undefined)
    throw new ObjError(
      ObjErrorCode.OBJ_INCOMPARABLE_PROMOTION_REFUSED,
      'comparison requires two frozen run records',
      { missing: 'b' },
    );
  for (const dimension of ALL_COMPARISON_DIMENSIONS) {
    const left = a.dimensions[dimension];
    const right = b.dimensions[dimension];
    if (typeof left !== 'string' || typeof right !== 'string')
      throw new ObjError(ObjErrorCode.OBJ_DIMENSION_UNKNOWN, 'comparison dimension value missing', {
        dimension,
        runId: typeof left !== 'string' ? a.runId : b.runId,
      });
    if (left !== right) return RunComparability.EXPLORATORY_ONLY;
  }
  return RunComparability.COMPARABLE;
}

/**
 * Hard constraints precede utility: all seven kinds must evaluate PASS
 * before utility is consulted. Any FAIL — or any unevaluated kind —
 * refuses. Weighted scores are not inputs to this function by design.
 */
export function hardConstraintsPrecedeUtility(
  evaluations: Readonly<Partial<Record<HardConstraintKind, HardConstraintVerdict>>>,
): void {
  for (const kind of ALL_HARD_CONSTRAINT_KINDS) {
    const verdict = evaluations[kind];
    if (verdict !== HardConstraintVerdict.PASS)
      throw new ObjError(
        ObjErrorCode.OBJ_HARD_CONSTRAINT_FAILED,
        'hard constraint is not satisfied',
        { kind, verdict: verdict ?? null },
      );
  }
}

/** Ceiling division for positive divisors; the single rounding step of the LCB core. */
export function ceilDiv(dividend: bigint, divisor: bigint): bigint {
  if (divisor <= 0n)
    throw new ObjError(ObjErrorCode.OBJ_FLOAT_ARITHMETIC_REFUSED, 'division requires a positive divisor', {
      divisor: divisor.toString(),
    });
  return dividend >= 0n ? (dividend + divisor - 1n) / divisor : dividend / divisor;
}

/** Floor division for positive divisors (bigint `/` truncates toward zero, which is wrong for negatives). */
export function floorDiv(dividend: bigint, divisor: bigint): bigint {
  if (divisor <= 0n)
    throw new ObjError(ObjErrorCode.OBJ_FLOAT_ARITHMETIC_REFUSED, 'division requires a positive divisor', {
      divisor: divisor.toString(),
    });
  return dividend >= 0n ? dividend / divisor : -ceilDiv(-dividend, divisor);
}

/** Integer square root, floored. Binary search — no binary floating point in the objective path. */
export function isqrtFloor(value: bigint): bigint {
  if (value < 0n)
    throw new ObjError(ObjErrorCode.OBJ_FLOAT_ARITHMETIC_REFUSED, 'square root requires a non-negative value', {});
  if (value < 2n) return value;
  let low = 1n;
  let high = value;
  while (low <= high) {
    const mid = (low + high) / 2n;
    const square = mid * mid;
    if (square === value) return mid;
    if (square < value) low = mid + 1n;
    else high = mid - 1n;
  }
  return high;
}

/** Integer square root, ceiled — the conservative direction for the LCB margin. */
export function isqrtCeil(value: bigint): bigint {
  const floored = isqrtFloor(value);
  return floored * floored === value ? floored : floored + 1n;
}

/**
 * Coerce an integer micro-unit value. Accepts safe-integer numbers and
 * bigints; binary floats, unsafe integers, and every other type refuse —
 * the objective path is integer-only (ADR-OBJ-01).
 */
export function assertIntegerMicros(value: number | bigint, what: string): bigint {
  if (typeof value === 'bigint') return value;
  if (Number.isSafeInteger(value)) return BigInt(value);
  throw new ObjError(ObjErrorCode.OBJ_FLOAT_ARITHMETIC_REFUSED, 'integer micro-units required', {
    what,
  });
}

export interface LowerBoundUtilityInput {
  /** Sum of daily net utilities in integer micro-units. */
  readonly sumMicros: number | bigint;
  /** Sum of squared daily net utilities in integer micro-units². */
  readonly sumSquaresMicros: number | bigint;
  /** Count of capital-days in the frozen series. Must be ≥ 1. */
  readonly count: number | bigint;
}

/**
 * Conservative lower confidence bound of mean daily net utility
 * (FR-OBJ-001): `floor(mean) − ceil(z·sd/√n)` computed entirely in
 * integer micro-units with the pinned one-sided-95% z constant. The mean
 * rounds down and the margin rounds up, so the result never exceeds the
 * true LCB. Empty or non-integer series refuse.
 */
export function lowerBoundUtility(input: LowerBoundUtilityInput): bigint {
  const count = assertIntegerMicros(input.count, 'count');
  if (count < 1n)
    throw new ObjError(
      ObjErrorCode.OBJ_FLOAT_ARITHMETIC_REFUSED,
      'lower-bound utility requires a non-empty series',
      {},
    );
  const sum = assertIntegerMicros(input.sumMicros, 'sumMicros');
  const sumSquares = assertIntegerMicros(input.sumSquaresMicros, 'sumSquaresMicros');
  // Exact-arithmetic variance numerator Σ(x−x̄)²·n ≥ 0; clamp is unreachable
  // with consistent inputs and keeps the function total.
  const varianceNumerator = sumSquares * count - sum * sum;
  const nonNegativeVariance = varianceNumerator < 0n ? 0n : varianceNumerator;
  const meanFloor = floorDiv(sum, count);
  // margin ≥ z·√var/(n·√n·S): ceiled numerator root, floored denominator root.
  const margin = ceilDiv(
    BigInt(Z_ONE_SIDED_95_MICROS) * isqrtCeil(nonNegativeVariance),
    count * isqrtFloor(count) * BigInt(MICRO_UNIT_SCALE),
  );
  return meanFloor - margin;
}

/** Twelve decomposition lines in integer micro-units (FR-OBJ-004). */
export type UtilityLines = Readonly<Partial<Record<UtilityLineKind, number | bigint>>>;

/**
 * Twelve lines sum exactly to net. Predicate form returns false on any
 * defect (missing/non-integer line, sum mismatch); the asserting form
 * refuses with a typed error.
 */
export function decompositionReconciles(lines: UtilityLines, netMicros: number | bigint): boolean {
  const net = assertIntegerMicros(netMicros, 'netMicros');
  let total = 0n;
  for (const kind of ALL_UTILITY_LINE_KINDS) {
    const line = lines[kind];
    if (typeof line === 'bigint') total += line;
    else if (typeof line === 'number' && Number.isSafeInteger(line)) total += BigInt(line);
    else return false;
  }
  return total === net;
}

/** Asserting form of `decompositionReconciles`. */
export function assertDecompositionReconciles(lines: UtilityLines, netMicros: number | bigint): void {
  for (const kind of ALL_UTILITY_LINE_KINDS) {
    const line = lines[kind];
    if (typeof line !== 'bigint' && !Number.isSafeInteger(line))
      throw new ObjError(ObjErrorCode.OBJ_FLOAT_ARITHMETIC_REFUSED, 'utility line must be integer micro-units', {
        kind,
      });
  }
  const net = assertIntegerMicros(netMicros, 'netMicros');
  let total = 0n;
  for (const kind of ALL_UTILITY_LINE_KINDS) total += BigInt(lines[kind] as number | bigint);
  if (total !== net)
    throw new ObjError(ObjErrorCode.OBJ_CLAIM_SCOPE_INCOMPLETE, 'decomposition lines do not reconcile to net', {
      total: total.toString(),
      net: net.toString(),
    });
}

/**
 * Diagnostics are excluded from the promotion verdict by construction:
 * the verdict input type carries no diagnostic fields, and this law
 * refuses any candidate carrying one (FR-OBJ-005).
 */
export interface PromotionVerdictInput {
  readonly runId: string;
  readonly comparability: RunComparability;
  readonly hardConstraints: Readonly<Record<HardConstraintKind, HardConstraintVerdict>>;
  readonly integrityVerdict: IntegrityVerdict;
  readonly lowerBoundUtilityMicros: bigint;
  readonly delayGatePassed: boolean;
  readonly claimScopeHash: string;
}

/** Keys that must never appear on a promotion-verdict input. */
export const DIAGNOSTIC_INPUT_KEYS: readonly string[] = ALL_DIAGNOSTIC_KINDS;

/** Runtime half of `diagnosticsExcludedByConstruction`: refuses diagnostic-bearing inputs. */
export function diagnosticsExcludedByConstruction(candidate: unknown): void {
  if (typeof candidate !== 'object' || candidate === null) return;
  for (const key of DIAGNOSTIC_INPUT_KEYS) {
    if (key in candidate)
      throw new ObjError(
        ObjErrorCode.OBJ_DIAGNOSTIC_AS_OBJECTIVE_REFUSED,
        'diagnostic metric cannot enter the promotion verdict',
        { key },
      );
  }
}

/**
 * Any firing integrity signal blocks promotion (FR-OBJ-006). All seven
 * detectors must report; a missing (unevaluated) detector refuses
 * fail-closed rather than defaulting to pass.
 */
export function integrityFailureBlocksPromotion(
  signals: Readonly<Partial<Record<IntegritySignalKind, boolean>>>,
): void {
  const firing: IntegritySignalKind[] = [];
  const unevaluated: IntegritySignalKind[] = [];
  for (const signal of ALL_INTEGRITY_SIGNAL_KINDS) {
    const fired = signals[signal];
    if (typeof fired !== 'boolean') unevaluated.push(signal);
    else if (fired) firing.push(signal);
  }
  if (unevaluated.length > 0 || firing.length > 0)
    throw new ObjError(
      ObjErrorCode.OBJ_INTEGRITY_FAILURE_BLOCKS_PROMOTION,
      'objective-integrity failure blocks promotion',
      { firing: firing.join(','), unevaluated: unevaluated.join(',') },
    );
}

/** Eleven claim-scope fields; values are the exact supporting evidence refs. */
export type ClaimScope = Readonly<Partial<Record<ClaimScopeField, string>>>;

/** Fields missing (absent or blank) from a claim scope. Empty means complete. */
export function claimScopeMissing(scope: ClaimScope | null | undefined): ClaimScopeField[] {
  const missing: ClaimScopeField[] = [];
  if (scope === null || scope === undefined) return [...ALL_CLAIM_SCOPE_FIELDS];
  for (const field of ALL_CLAIM_SCOPE_FIELDS) {
    const value = scope[field];
    if (typeof value !== 'string' || value.length === 0) missing.push(field);
  }
  return missing;
}

/**
 * Eleven-for-eleven or refusal (FR-OBJ-007): every objective or
 * performance claim identifies the exact supported population, profile,
 * policy, execution scenario, delay distribution, calendar interval,
 * market regimes, capability state, sample size, cluster effective sample
 * size, and uncertainty method.
 */
export function claimScopeComplete(scope: ClaimScope | null | undefined): void {
  const missing = claimScopeMissing(scope);
  if (missing.length > 0)
    throw new ObjError(ObjErrorCode.OBJ_CLAIM_SCOPE_INCOMPLETE, 'claim scope is incomplete', {
      missing: missing.join(','),
    });
}

/** Per-scenario delay evidence consumed by the robust-delay law (FR-OBJ-008). */
export interface DelayScenarioEvidence {
  readonly evidenced: boolean;
  readonly passed: boolean;
}

export interface RobustDelayInput {
  readonly results: Readonly<Partial<Record<DelayScenario, DelayScenarioEvidence>>>;
  /** Declared robust-delay gate: the non-empty scenario set the active policy must pass. */
  readonly declaredGate: readonly DelayScenario[];
}

/**
 * All three scenarios evidenced, declared gate passed. Missing evidence —
 * including a single favorable fixed delay standing in for the
 * distribution — refuses; a fully evidenced but failed gate returns
 * false (a verdict, not a refusal).
 */
export function robustDelayRequired(input: RobustDelayInput): boolean {
  const missing: DelayScenario[] = [];
  for (const scenario of ALL_DELAY_SCENARIOS) {
    const result = input.results[scenario];
    if (result === undefined || result.evidenced !== true) missing.push(scenario);
  }
  if (missing.length > 0)
    throw new ObjError(
      ObjErrorCode.OBJ_SINGLE_DELAY_EVIDENCE_REFUSED,
      'robust delay requires evidence for all three scenarios',
      { missing: missing.join(',') },
    );
  if (input.declaredGate.length === 0)
    throw new ObjError(
      ObjErrorCode.OBJ_SINGLE_DELAY_EVIDENCE_REFUSED,
      'robust delay requires a declared non-empty gate',
      {},
    );
  for (const scenario of input.declaredGate) {
    const result = input.results[scenario];
    if (result === undefined || result.passed !== true) return false;
  }
  return true;
}

/**
 * The frozen record is immutable: sensitivity derives (copies) and never
 * mutates (FR-OBJ-009). Deep-freezes the record in place and returns it
 * as readonly; downstream derivatives spread from the frozen record and
 * carry the parent content hash instead of editing it.
 */
export function frozenRecordImmutable<T extends object>(record: T): Readonly<T> {
  const seen = new WeakSet<object>();
  const stack: object[] = [record];
  while (stack.length > 0) {
    const current = stack.pop() as object;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const value of Object.values(current)) {
      if (typeof value === 'object' && value !== null && !seen.has(value)) stack.push(value);
    }
    Object.freeze(current);
  }
  return record;
}

/** Derivative record referencing the frozen record it was derived from. */
export interface FrozenDerivative {
  readonly parentContentHash: string;
}

/**
 * A derivative claiming any parent other than the frozen record's hash —
 * or no parent at all — is a frozen-experiment rewrite and refuses.
 */
export function assertFrozenParentHash(
  derived: FrozenDerivative | null | undefined,
  expectedParentHash: string,
): void {
  const claimed = derived?.parentContentHash;
  if (typeof claimed !== 'string' || claimed.length === 0 || claimed !== expectedParentHash)
    throw new ObjError(
      ObjErrorCode.OBJ_FROZEN_EXPERIMENT_REWRITE_REFUSED,
      'sensitivity derivative must reference its frozen parent',
      { claimed: typeof claimed === 'string' ? claimed : null },
    );
}

/** Screened opportunity output carrying (or missing) its disclosure. */
export interface ScreenedOutput {
  readonly disclosure: unknown;
}

/**
 * Every screened output carries the research-signal disclosure verbatim
 * (FR-OBJ-010). A missing or altered disclosure refuses.
 */
export function uncertaintyDisclosureRequired(screened: ScreenedOutput | null | undefined): void {
  const disclosure = screened?.disclosure;
  if (typeof disclosure !== 'string' || !disclosure.includes(UNCERTAINTY_DISCLOSURE_TEXT))
    throw new ObjError(
      ObjErrorCode.OBJ_UNCERTAINTY_DISCLOSURE_MISSING,
      'screened output must carry the research-signal disclosure',
      {},
    );
}
