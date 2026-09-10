/** Closed outcome-maturity vocabularies and pure laws (FR-MAT-001…012). */
import { ErrorCode, MatError, type ErrorCode as ForesiftErrorCode } from './errors.ts';

export const Horizon = {
  FIVE_MINUTES: '5M',
  TWENTY_FOUR_HOURS: '24H',
  SEVEN_DAYS: '7D',
  THIRTY_DAYS: '30D',
} as const;
export type Horizon = (typeof Horizon)[keyof typeof Horizon];

export const MaturityState = {
  PENDING: 'PENDING',
  PARTIALLY_MATURED: 'PARTIALLY_MATURED',
  FULLY_MATURED: 'FULLY_MATURED',
  CENSORED: 'CENSORED',
  INVALID_DATA: 'INVALID_DATA',
} as const;
export type MaturityState = (typeof MaturityState)[keyof typeof MaturityState];

export const CensorReason = {
  RIGHTS_DRIVEN_DELETION: 'RIGHTS_DRIVEN_DELETION',
  PERMANENT_IDENTITY_AMBIGUITY: 'PERMANENT_IDENTITY_AMBIGUITY',
  UNRECOVERABLE_OBSERVATION_GAP: 'UNRECOVERABLE_OBSERVATION_GAP',
  UNSUPPORTED_HISTORICAL_POOL_STATE: 'UNSUPPORTED_HISTORICAL_POOL_STATE',
  CHAIN_ARCHIVE_UNAVAILABILITY: 'CHAIN_ARCHIVE_UNAVAILABILITY',
} as const;
export type CensorReason = (typeof CensorReason)[keyof typeof CensorReason];

export const InvalidReason = {
  CORRUPTED_SAMPLING_ASSIGNMENT: 'CORRUPTED_SAMPLING_ASSIGNMENT',
  IMPOSSIBLE_TIME_ORDER: 'IMPOSSIBLE_TIME_ORDER',
  FAILED_POOL_PARITY: 'FAILED_POOL_PARITY',
  UNRESOLVABLE_DECIMALS: 'UNRESOLVABLE_DECIMALS',
  AVAILABILITY_CANNOT_BE_ESTABLISHED: 'AVAILABILITY_CANNOT_BE_ESTABLISHED',
} as const;
export type InvalidReason = (typeof InvalidReason)[keyof typeof InvalidReason];

export const DenominatorDisclosureClass = {
  FULLY_MATURED_VALID: 'FULLY_MATURED_VALID',
  PENDING: 'PENDING',
  PARTIALLY_MATURED: 'PARTIALLY_MATURED',
  CENSORED: 'CENSORED',
  INVALID_DATA: 'INVALID_DATA',
  LOW_RESOLUTION: 'LOW_RESOLUTION',
  RIGHTS_BLOCKED: 'RIGHTS_BLOCKED',
  UNOBSERVED: 'UNOBSERVED',
  SIGNAL_ONLY: 'SIGNAL_ONLY',
} as const;
export type DenominatorDisclosureClass =
  (typeof DenominatorDisclosureClass)[keyof typeof DenominatorDisclosureClass];

export const OutcomeLabelFamily = {
  OBJECTIVE_SIGNAL_OUTCOME: 'OBJECTIVE_SIGNAL_OUTCOME',
  OBJECTIVE_TRADABLE_OUTCOME: 'OBJECTIVE_TRADABLE_OUTCOME',
  OBJECTIVE_PORTFOLIO_UTILITY: 'OBJECTIVE_PORTFOLIO_UTILITY',
  SUBJECTIVE_USER_UTILITY: 'SUBJECTIVE_USER_UTILITY',
  HUMAN_EXPERT_JUDGMENT: 'HUMAN_EXPERT_JUDGMENT',
} as const;
export type OutcomeLabelFamily = (typeof OutcomeLabelFamily)[keyof typeof OutcomeLabelFamily];

export const EvidenceResolution = {
  COARSE_SIGNAL: 'COARSE_SIGNAL',
  HIGH_RESOLUTION_EXECUTION: 'HIGH_RESOLUTION_EXECUTION',
  EXACT_CONFIGURATION_EXECUTION: 'EXACT_CONFIGURATION_EXECUTION',
} as const;
export type EvidenceResolution = (typeof EvidenceResolution)[keyof typeof EvidenceResolution];

export const ExpirySideEffect = {
  ALERT_EXPIRED: 'ALERT_EXPIRED',
  ALERT_CANCELLED: 'ALERT_CANCELLED',
  THESIS_INVALIDATED: 'THESIS_INVALIDATED',
} as const;
export type ExpirySideEffect = (typeof ExpirySideEffect)[keyof typeof ExpirySideEffect];

export const PromotionOutcomeLabel = {
  SIGNAL_SUCCESS: 'SIGNAL_SUCCESS',
  SIGNAL_FAILURE: 'SIGNAL_FAILURE',
  TRADABLE_SUCCESS: 'TRADABLE_SUCCESS',
  TRADABLE_FAILURE: 'TRADABLE_FAILURE',
  NEUTRAL: 'NEUTRAL',
  PENDING: 'PENDING',
  CENSORED: 'CENSORED',
  INVALID_DATA: 'INVALID_DATA',
} as const;
export type PromotionOutcomeLabel =
  (typeof PromotionOutcomeLabel)[keyof typeof PromotionOutcomeLabel];

export const MatPrimaryOrdering = {
  ADVERSE_FEASIBLE: 'ADVERSE_FEASIBLE',
  UNAMBIGUOUS: 'UNAMBIGUOUS',
} as const;
export type MatPrimaryOrdering = (typeof MatPrimaryOrdering)[keyof typeof MatPrimaryOrdering];

function parseClosed<T extends string>(
  values: readonly T[],
  value: unknown,
  code: ForesiftErrorCode,
  label: string,
): T {
  if (typeof value === 'string' && (values as readonly string[]).includes(value)) return value as T;
  throw new MatError(`unknown ${label}`, { value: typeof value === 'string' ? value : null }, code);
}

export const ALL_MAT_HORIZONS: readonly Horizon[] = Object.values(Horizon);
export const MAT_HORIZONS = ALL_MAT_HORIZONS;
export type MatHorizon = Horizon;
export const ALL_MATURITY_STATES: readonly MaturityState[] = Object.values(MaturityState);
export const MATURITY_STATES = ALL_MATURITY_STATES;
export const ALL_CENSOR_REASONS: readonly CensorReason[] = Object.values(CensorReason);
export const CENSOR_REASONS = ALL_CENSOR_REASONS;
export const ALL_INVALID_REASONS: readonly InvalidReason[] = Object.values(InvalidReason);
export const ALL_INVALID_DATA_REASONS = ALL_INVALID_REASONS;
export const INVALID_DATA_REASONS = ALL_INVALID_REASONS;
export type InvalidDataReason = InvalidReason;
export const ALL_DENOMINATOR_DISCLOSURE_CLASSES: readonly DenominatorDisclosureClass[] =
  Object.values(DenominatorDisclosureClass);
export const ALL_OUTCOME_LABEL_FAMILIES: readonly OutcomeLabelFamily[] =
  Object.values(OutcomeLabelFamily);
export const ALL_SUBJECTIVE_LABEL_FAMILIES = [
  OutcomeLabelFamily.SUBJECTIVE_USER_UTILITY,
  OutcomeLabelFamily.HUMAN_EXPERT_JUDGMENT,
] as const;
export type SubjectiveLabelFamily = (typeof ALL_SUBJECTIVE_LABEL_FAMILIES)[number];
export const SUBJECTIVE_LABEL_FAMILIES = ALL_SUBJECTIVE_LABEL_FAMILIES;
export const ALL_EVIDENCE_RESOLUTIONS: readonly EvidenceResolution[] =
  Object.values(EvidenceResolution);
export const EVIDENCE_RESOLUTIONS = ALL_EVIDENCE_RESOLUTIONS;
export const ALL_EXPIRY_SIDE_EFFECTS: readonly ExpirySideEffect[] = Object.values(ExpirySideEffect);
export const EXPIRY_SIDE_EFFECTS = ALL_EXPIRY_SIDE_EFFECTS;
export const ALL_PROMOTION_OUTCOME_LABELS: readonly PromotionOutcomeLabel[] =
  Object.values(PromotionOutcomeLabel);
export const PROMOTION_OUTCOME_LABELS = ALL_PROMOTION_OUTCOME_LABELS;
export const ALL_MAT_PRIMARY_ORDERINGS: readonly MatPrimaryOrdering[] =
  Object.values(MatPrimaryOrdering);
export const MAT_PRIMARY_ORDERINGS = ALL_MAT_PRIMARY_ORDERINGS;

export const parseHorizon = (value: unknown): Horizon =>
  parseClosed(ALL_MAT_HORIZONS, value, ErrorCode.MAT_HORIZON_UNKNOWN, 'maturity horizon');
export const parseCensorReason = (value: unknown): CensorReason =>
  parseClosed(ALL_CENSOR_REASONS, value, ErrorCode.MAT_CENSOR_REASON_UNKNOWN, 'censor reason');
export const parseInvalidReason = (value: unknown): InvalidReason =>
  parseClosed(ALL_INVALID_REASONS, value, ErrorCode.MAT_INVALID_REASON_UNKNOWN, 'invalid reason');
export const parseDenominatorDisclosureClass = (value: unknown): DenominatorDisclosureClass =>
  parseClosed(
    ALL_DENOMINATOR_DISCLOSURE_CLASSES,
    value,
    ErrorCode.MAT_DISCLOSURE_CLASS_UNKNOWN,
    'denominator disclosure class',
  );
export const parseOutcomeLabelFamily = (value: unknown): OutcomeLabelFamily =>
  parseClosed(
    ALL_OUTCOME_LABEL_FAMILIES,
    value,
    ErrorCode.MAT_LABEL_FAMILY_UNKNOWN,
    'outcome label family',
  );
export const parseEvidenceResolution = (value: unknown): EvidenceResolution =>
  parseClosed(
    ALL_EVIDENCE_RESOLUTIONS,
    value,
    ErrorCode.MAT_EVIDENCE_RESOLUTION_UNKNOWN,
    'evidence resolution',
  );
export const parseExpirySideEffect = (value: unknown): ExpirySideEffect =>
  parseClosed(
    ALL_EXPIRY_SIDE_EFFECTS,
    value,
    ErrorCode.MAT_SIDE_EFFECT_UNKNOWN,
    'expiry side effect',
  );

export const horizon = parseHorizon;
export const censorReason = parseCensorReason;
export const invalidReason = parseInvalidReason;
export const denominatorDisclosureClass = parseDenominatorDisclosureClass;
export const outcomeLabelFamily = parseOutcomeLabelFamily;
export const evidenceResolution = parseEvidenceResolution;
export const expirySideEffect = parseExpirySideEffect;

/** Only forward progress is legal; terminal states are absorbing. */
export function maturityNeverResets(from: MaturityState, to: MaturityState): boolean {
  if (from === MaturityState.PENDING) return to !== MaturityState.PENDING;
  if (from === MaturityState.PARTIALLY_MATURED)
    return (
      to === MaturityState.FULLY_MATURED ||
      to === MaturityState.CENSORED ||
      to === MaturityState.INVALID_DATA
    );
  return false;
}

export function assertMaturityTransition(from: MaturityState, to: MaturityState): void {
  if (!maturityNeverResets(from, to))
    throw new MatError(
      'maturity transition is not monotone',
      { from, to },
      ErrorCode.MAT_TRANSITION_ILLEGAL,
    );
}

/** Censored and invalid observations are never failure labels. */
export function censorNeverBecomesFailure(
  maturity: MaturityState,
  label: PromotionOutcomeLabel,
): boolean {
  if (maturity !== MaturityState.CENSORED && maturity !== MaturityState.INVALID_DATA) return true;
  return (
    label !== PromotionOutcomeLabel.SIGNAL_FAILURE &&
    label !== PromotionOutcomeLabel.TRADABLE_FAILURE
  );
}

const SUBJECTIVE_FAMILIES: ReadonlySet<OutcomeLabelFamily> = new Set(ALL_SUBJECTIVE_LABEL_FAMILIES);

/** Subjective input is ignored by the objective-label function. */
export function subjectiveCannotAlterObjective<T>(
  objectiveLabel: T,
  _subjectiveLabel: unknown,
  family: OutcomeLabelFamily = OutcomeLabelFamily.SUBJECTIVE_USER_UTILITY,
): T {
  if (!SUBJECTIVE_FAMILIES.has(family))
    throw new MatError(
      'the supplied family is not subjective',
      { family },
      ErrorCode.MAT_SUBJECTIVE_JOIN_REFUSED,
    );
  return objectiveLabel;
}

export interface OrderingAssessment {
  readonly targetFeasible: boolean;
  readonly adverseFeasible: boolean;
  readonly orderingKnown: boolean;
  readonly optimisticSensitivity?: unknown;
}

export function adverseOrderingPrimacy(
  bothFeasible: boolean,
  orderKnown: boolean,
  knownOrder?: 'TARGET_FIRST' | 'STOP_FIRST',
): 'ADVERSE_STOP_OUT' | 'TARGET_REACHED';
export function adverseOrderingPrimacy(input: OrderingAssessment): {
  readonly primaryOrdering: MatPrimaryOrdering;
  readonly pathAmbiguous: boolean;
  readonly optimisticSensitivity: unknown | null;
};
export function adverseOrderingPrimacy(
  input: OrderingAssessment | boolean,
  _orderKnown?: boolean,
  knownOrder?: 'TARGET_FIRST' | 'STOP_FIRST',
):
  | {
      readonly primaryOrdering: MatPrimaryOrdering;
      readonly pathAmbiguous: boolean;
      readonly optimisticSensitivity: unknown | null;
    }
  | 'ADVERSE_STOP_OUT'
  | 'TARGET_REACHED' {
  if (typeof input === 'boolean') {
    return knownOrder === 'TARGET_FIRST' ? 'TARGET_REACHED' : 'ADVERSE_STOP_OUT';
  }
  const pathAmbiguous = input.targetFeasible && input.adverseFeasible && !input.orderingKnown;
  return {
    primaryOrdering: pathAmbiguous
      ? MatPrimaryOrdering.ADVERSE_FEASIBLE
      : MatPrimaryOrdering.UNAMBIGUOUS,
    pathAmbiguous,
    optimisticSensitivity: pathAmbiguous ? (input.optimisticSensitivity ?? null) : null,
  };
}

/** A gain strictly after a terminating side effect is non-actionable. */
export function postExpiryGainsExcluded(
  gainObservedAt: string | number | Date | null,
  sideEffectAt: string | number | Date | null,
): boolean {
  if (gainObservedAt === null || sideEffectAt === null) return false;
  const gain = new Date(gainObservedAt).getTime();
  const expiry = new Date(sideEffectAt).getTime();
  return Number.isFinite(gain) && Number.isFinite(expiry) && gain > expiry;
}

export interface ExactMatureEvidence {
  readonly outcomeLabel: PromotionOutcomeLabel;
  readonly maturityState: MaturityState;
  readonly evidenceResolution: EvidenceResolution;
  readonly notionalMatches: boolean;
  readonly delayPolicyMatches: boolean;
  readonly adapterMatches: boolean;
  readonly routeMatches: boolean;
  readonly exitPolicyMatches: boolean;
}

export interface LegacyExactMatureEvidence {
  readonly notionalMatch: boolean;
  readonly delayPolicyMatch: boolean;
  readonly adapterMatch: boolean;
  readonly routeMatch: boolean;
  readonly exitPolicyMatch: boolean;
  readonly isHighResolution: boolean;
  readonly maturityState: string;
}

export function promotionRequiresExactMatureEvidence(
  input: ExactMatureEvidence | LegacyExactMatureEvidence,
): boolean {
  if ('notionalMatch' in input) {
    return (
      input.maturityState === MaturityState.FULLY_MATURED &&
      input.isHighResolution &&
      input.notionalMatch &&
      input.delayPolicyMatch &&
      input.adapterMatch &&
      input.routeMatch &&
      input.exitPolicyMatch
    );
  }
  return (
    input.outcomeLabel === PromotionOutcomeLabel.TRADABLE_SUCCESS &&
    input.maturityState === MaturityState.FULLY_MATURED &&
    input.evidenceResolution !== EvidenceResolution.COARSE_SIGNAL &&
    input.notionalMatches &&
    input.delayPolicyMatches &&
    input.adapterMatches &&
    input.routeMatches &&
    input.exitPolicyMatches
  );
}

export interface CapacityDisclosure {
  readonly capacityLimited: boolean;
  readonly maximumExecutableNotional: string | null;
  readonly deployablePortfolioCapacity: string | null;
  readonly requestedNotional?: string | null;
  readonly largerNotionalSimulationPresent?: boolean;
}

export interface LegacyCapacityDisclosure {
  readonly maxExecutableNotionalUsd?: number;
  readonly portfolioCapacityUsd?: number;
}

export function capacityDisclosureRequired(
  input: CapacityDisclosure | LegacyCapacityDisclosure,
): boolean {
  if (!('capacityLimited' in input)) {
    return (
      typeof input.maxExecutableNotionalUsd === 'number' &&
      input.maxExecutableNotionalUsd > 0 &&
      typeof input.portfolioCapacityUsd === 'number' &&
      input.portfolioCapacityUsd > 0
    );
  }
  if (!input.capacityLimited) return true;
  if (input.maximumExecutableNotional === null || input.deployablePortfolioCapacity === null)
    return false;
  if (input.requestedNotional === null || input.requestedNotional === undefined) return true;
  const requested = Number(input.requestedNotional);
  const maximum = Number(input.maximumExecutableNotional);
  if (!Number.isFinite(requested) || !Number.isFinite(maximum)) return false;
  return requested <= maximum || input.largerNotionalSimulationPresent === true;
}
