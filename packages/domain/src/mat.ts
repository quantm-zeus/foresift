/** Closed outcome-maturity vocabularies (FR-MAT-001…012). */

export const MAT_HORIZONS = ['5M', '24H', '7D', '30D'] as const;
export type MatHorizon = (typeof MAT_HORIZONS)[number];

export const MATURITY_STATES = [
  'PENDING',
  'PARTIALLY_MATURED',
  'FULLY_MATURED',
  'CENSORED',
  'INVALID_DATA',
] as const;
export type MaturityState = (typeof MATURITY_STATES)[number];

export const CENSOR_REASONS = [
  'RIGHTS_DRIVEN_DELETION',
  'PERMANENT_IDENTITY_AMBIGUITY',
  'UNRECOVERABLE_OBSERVATION_GAP',
  'UNSUPPORTED_HISTORICAL_POOL_STATE',
  'CHAIN_ARCHIVE_UNAVAILABILITY',
] as const;
export type CensorReason = (typeof CENSOR_REASONS)[number];

export const INVALID_DATA_REASONS = [
  'CORRUPTED_SAMPLING_ASSIGNMENT',
  'IMPOSSIBLE_TIME_ORDER',
  'FAILED_POOL_PARITY',
  'UNRESOLVABLE_DECIMALS',
  'AVAILABILITY_CANNOT_BE_ESTABLISHED',
] as const;
export type InvalidDataReason = (typeof INVALID_DATA_REASONS)[number];

export const SUBJECTIVE_LABEL_FAMILIES = [
  'SUBJECTIVE_USER_UTILITY',
  'HUMAN_EXPERT_JUDGMENT',
] as const;
export type SubjectiveLabelFamily = (typeof SUBJECTIVE_LABEL_FAMILIES)[number];

export const PROMOTION_OUTCOME_LABELS = [
  'SIGNAL_SUCCESS',
  'SIGNAL_FAILURE',
  'TRADABLE_SUCCESS',
  'TRADABLE_FAILURE',
  'NEUTRAL',
  'PENDING',
  'CENSORED',
  'INVALID_DATA',
] as const;
export type PromotionOutcomeLabel = (typeof PROMOTION_OUTCOME_LABELS)[number];

export const EVIDENCE_RESOLUTIONS = [
  'COARSE_SIGNAL',
  'HIGH_RESOLUTION_EXECUTION',
  'EXACT_CONFIGURATION_EXECUTION',
] as const;
export type EvidenceResolution = (typeof EVIDENCE_RESOLUTIONS)[number];

export const MAT_PRIMARY_ORDERINGS = ['ADVERSE_FEASIBLE', 'UNAMBIGUOUS'] as const;
export type MatPrimaryOrdering = (typeof MAT_PRIMARY_ORDERINGS)[number];

export const EXPIRY_SIDE_EFFECTS = [
  'ALERT_EXPIRED',
  'ALERT_CANCELLED',
  'THESIS_INVALIDATED',
] as const;
export type ExpirySideEffect = (typeof EXPIRY_SIDE_EFFECTS)[number];

// Consistent ALL_* aliases make these values easy to consume at runtime
// while preserving literal-union inference.
export const ALL_MAT_HORIZONS = MAT_HORIZONS;
export const ALL_MATURITY_STATES = MATURITY_STATES;
export const ALL_CENSOR_REASONS = CENSOR_REASONS;
export const ALL_INVALID_DATA_REASONS = INVALID_DATA_REASONS;
export const ALL_SUBJECTIVE_LABEL_FAMILIES = SUBJECTIVE_LABEL_FAMILIES;
export const ALL_PROMOTION_OUTCOME_LABELS = PROMOTION_OUTCOME_LABELS;
export const ALL_EVIDENCE_RESOLUTIONS = EVIDENCE_RESOLUTIONS;
export const ALL_MAT_PRIMARY_ORDERINGS = MAT_PRIMARY_ORDERINGS;
export const ALL_EXPIRY_SIDE_EFFECTS = EXPIRY_SIDE_EFFECTS;
