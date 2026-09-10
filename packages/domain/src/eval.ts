/** Closed evaluation vocabularies and pure statistical-integrity laws. */
import { ErrorCode, EvalError, type ErrorCode as ForesiftErrorCode } from './errors.ts';

export const DatasetPartition = {
  TRAIN: 'TRAIN',
  CALIBRATION: 'CALIBRATION',
  VALIDATION: 'VALIDATION',
  FINAL_HOLDOUT: 'FINAL_HOLDOUT',
  LIVE_SHADOW: 'LIVE_SHADOW',
  FORWARD_CONFIRMATION: 'FORWARD_CONFIRMATION',
} as const;
export type DatasetPartition = (typeof DatasetPartition)[keyof typeof DatasetPartition];

export const HoldoutExposure = {
  UNEXPOSED: 'UNEXPOSED',
  METRIC_ONLY_EXPOSED: 'METRIC_ONLY_EXPOSED',
  OWNER_REVIEWED: 'OWNER_REVIEWED',
  TUNING_EXPOSED: 'TUNING_EXPOSED',
  EXHAUSTED: 'EXHAUSTED',
} as const;
export type HoldoutExposure = (typeof HoldoutExposure)[keyof typeof HoldoutExposure];

export const ReplayKind = {
  BACKTEST: 'BACKTEST',
  CROSS_FIT: 'CROSS_FIT',
  FORWARD_SHADOW: 'FORWARD_SHADOW',
  LIVE_SHADOW: 'LIVE_SHADOW',
  ACTIVE_PRODUCTION: 'ACTIVE_PRODUCTION',
} as const;
export type ReplayKind = (typeof ReplayKind)[keyof typeof ReplayKind];

export const MultipleTestingFamily = {
  BENJAMINI_HOCHBERG: 'BENJAMINI_HOCHBERG',
  BONFERRONI: 'BONFERRONI',
  HOLM: 'HOLM',
  FAMILY_WISE_ERROR: 'FAMILY_WISE_ERROR',
  FALSE_DISCOVERY_RATE: 'FALSE_DISCOVERY_RATE',
  HIERARCHICAL_TESTING: 'HIERARCHICAL_TESTING',
  RANDOMIZATION_INFERENCE: 'RANDOMIZATION_INFERENCE',
  REGISTERED_OTHER: 'REGISTERED_OTHER',
} as const;
export type MultipleTestingFamily =
  (typeof MultipleTestingFamily)[keyof typeof MultipleTestingFamily];

export const ControlKind = {
  OUTCOME_LABEL_PERMUTATION: 'OUTCOME_LABEL_PERMUTATION',
  FEATURE_TIMESTAMP_SHIFT: 'FEATURE_TIMESTAMP_SHIFT',
  DELAYED_PROVIDER_PLACEBO: 'DELAYED_PROVIDER_PLACEBO',
  BACKFILLED_AVAILABILITY_PLACEBO: 'BACKFILLED_AVAILABILITY_PLACEBO',
  SYNTHETIC_NULL_FEATURES: 'SYNTHETIC_NULL_FEATURES',
  FORBIDDEN_FUTURE_COLUMN_SCAN: 'FORBIDDEN_FUTURE_COLUMN_SCAN',
  OUTCOME_COLUMN_SCAN: 'OUTCOME_COLUMN_SCAN',
  SAME_ASSET_LEAKAGE_SCAN: 'SAME_ASSET_LEAKAGE_SCAN',
  SAME_ENTITY_LEAKAGE_SCAN: 'SAME_ENTITY_LEAKAGE_SCAN',
  OVERLAPPING_WINDOW_LEAKAGE_SCAN: 'OVERLAPPING_WINDOW_LEAKAGE_SCAN',
  PROVIDER_ID_ONLY_PREDICTOR: 'PROVIDER_ID_ONLY_PREDICTOR',
  SOURCE_ID_ONLY_PREDICTOR: 'SOURCE_ID_ONLY_PREDICTOR',
  RANDOMIZED_MODEL_OUTPUT_CONTROL: 'RANDOMIZED_MODEL_OUTPUT_CONTROL',
  RANDOMIZED_TOOL_SELECTION_CONTROL: 'RANDOMIZED_TOOL_SELECTION_CONTROL',
} as const;
export type ControlKind = (typeof ControlKind)[keyof typeof ControlKind];

export const IncidentTrigger = {
  LEAKAGE_OR_NEGATIVE_CONTROL_FAILURE: 'LEAKAGE_OR_NEGATIVE_CONTROL_FAILURE',
  EXHAUSTED_HOLDOUT_AS_UNTOUCHED: 'EXHAUSTED_HOLDOUT_AS_UNTOUCHED',
  INVALID_SAMPLING_OR_EVIDENCE_PROPENSITY: 'INVALID_SAMPLING_OR_EVIDENCE_PROPENSITY',
  MULTIPLE_TESTING_REGISTRY_MISMATCH: 'MULTIPLE_TESTING_REGISTRY_MISMATCH',
  CLUSTER_ESS_BELOW_GATE: 'CLUSTER_ESS_BELOW_GATE',
  ACTION_TIME_ASYMMETRY: 'ACTION_TIME_ASYMMETRY',
  POOL_ADAPTER_PARITY_INVALIDATION: 'POOL_ADAPTER_PARITY_INVALIDATION',
  POPULATION_CLAIM_EXCEEDS_UNIVERSE: 'POPULATION_CLAIM_EXCEEDS_UNIVERSE',
  CHAMPION_CHALLENGER_MATERIAL_DIVERGENCE: 'CHAMPION_CHALLENGER_MATERIAL_DIVERGENCE',
} as const;
export type IncidentTrigger = (typeof IncidentTrigger)[keyof typeof IncidentTrigger];

export const BaselineKind = {
  RANDOM_ELIGIBLE_CANDIDATE: 'RANDOM_ELIGIBLE_CANDIDATE',
  PROVIDER_TRENDING_RANK: 'PROVIDER_TRENDING_RANK',
  FIRST_PARTY_EVENT_RECENCY_RANK: 'FIRST_PARTY_EVENT_RECENCY_RANK',
  NEW_POOL_RANK: 'NEW_POOL_RANK',
  LIQUIDITY_ECONOMIC_VOLUME_HEURISTIC: 'LIQUIDITY_ECONOMIC_VOLUME_HEURISTIC',
  HOLDER_BUYER_GROWTH_HEURISTIC: 'HOLDER_BUYER_GROWTH_HEURISTIC',
  SECURITY_EXECUTION_HARD_GATE: 'SECURITY_EXECUTION_HARD_GATE',
  MARKET_ONLY_DETERMINISTIC_RANK_WITHOUT_LLM: 'MARKET_ONLY_DETERMINISTIC_RANK_WITHOUT_LLM',
  PARETO_LEXICOGRAPHIC_DETERMINISTIC_RANK: 'PARETO_LEXICOGRAPHIC_DETERMINISTIC_RANK',
  OWNER_MANUAL_SHORTLIST: 'OWNER_MANUAL_SHORTLIST',
} as const;
export type BaselineKind = (typeof BaselineKind)[keyof typeof BaselineKind];

export const IntervalMethod = {
  CLUSTER_BOOTSTRAP: 'CLUSTER_BOOTSTRAP',
  BLOCK_BOOTSTRAP_CALENDAR: 'BLOCK_BOOTSTRAP_CALENDAR',
  BLOCK_BOOTSTRAP_REGIME: 'BLOCK_BOOTSTRAP_REGIME',
  RANDOMIZATION_INFERENCE: 'RANDOMIZATION_INFERENCE',
} as const;
export type IntervalMethod = (typeof IntervalMethod)[keyof typeof IntervalMethod];

export const ClusterDefinition = {
  CALENDAR: 'CALENDAR',
  DEPLOYER: 'DEPLOYER',
  FUNDING_CLUSTER: 'FUNDING_CLUSTER',
  WALLET_ENTITY: 'WALLET_ENTITY',
  LAUNCHPAD: 'LAUNCHPAD',
  NARRATIVE: 'NARRATIVE',
  POOL: 'POOL',
  SOURCE: 'SOURCE',
  REGIME: 'REGIME',
} as const;
export type ClusterDefinition = (typeof ClusterDefinition)[keyof typeof ClusterDefinition];

export const DriftControlKind = {
  FEATURE_DISTRIBUTION_DRIFT: 'FEATURE_DISTRIBUTION_DRIFT',
  CALIBRATION_DRIFT: 'CALIBRATION_DRIFT',
  OUTCOME_DRIFT: 'OUTCOME_DRIFT',
  REGIME_DRIFT: 'REGIME_DRIFT',
  EXECUTION_DIVERGENCE: 'EXECUTION_DIVERGENCE',
} as const;
export type DriftControlKind = (typeof DriftControlKind)[keyof typeof DriftControlKind];

export const ClaimRestriction = {
  DECLARED_UNIVERSE: 'DECLARED_UNIVERSE',
  RESTRICT_TO_OBSERVED_SUBSET: 'RESTRICT_TO_OBSERVED_SUBSET',
  RESTRICT_TO_WEIGHTED_STRATA: 'RESTRICT_TO_WEIGHTED_STRATA',
} as const;
export type ClaimRestriction = (typeof ClaimRestriction)[keyof typeof ClaimRestriction];

function parseClosed<T extends string>(
  values: readonly T[], value: unknown, code: ForesiftErrorCode, label: string,
): T {
  if (typeof value === 'string' && (values as readonly string[]).includes(value)) return value as T;
  throw new EvalError(`unknown ${label}`, { value: typeof value === 'string' ? value : null }, code);
}

export const ALL_EVALUATION_PARTITIONS: readonly DatasetPartition[] = Object.values(DatasetPartition);
export const EVALUATION_PARTITIONS = ALL_EVALUATION_PARTITIONS;
export type EvaluationPartition = DatasetPartition;
export const ALL_HOLDOUT_EXPOSURES: readonly HoldoutExposure[] = Object.values(HoldoutExposure);
export const HOLDOUT_EXPOSURES = ALL_HOLDOUT_EXPOSURES;
export const ALL_EVALUATION_REPLAY_KINDS: readonly ReplayKind[] = Object.values(ReplayKind);
export const EVALUATION_REPLAY_KINDS = ALL_EVALUATION_REPLAY_KINDS;
export type EvaluationReplayKind = ReplayKind;
export const ALL_MULTIPLE_TESTING_FAMILIES: readonly MultipleTestingFamily[] = Object.values(MultipleTestingFamily);
export const MULTIPLE_TESTING_FAMILIES = ALL_MULTIPLE_TESTING_FAMILIES;
export const ALL_NEGATIVE_CONTROL_KINDS: readonly ControlKind[] = Object.values(ControlKind);
export const NEGATIVE_CONTROL_KINDS = ALL_NEGATIVE_CONTROL_KINDS;
export type NegativeControlKind = ControlKind;
export const ALL_EVALUATION_INCIDENT_TRIGGERS: readonly IncidentTrigger[] = Object.values(IncidentTrigger);
export const EVALUATION_INCIDENT_TRIGGERS = ALL_EVALUATION_INCIDENT_TRIGGERS;
export type EvaluationIncidentTrigger = IncidentTrigger;
export const ALL_BASELINE_KINDS: readonly BaselineKind[] = Object.values(BaselineKind);
export const BASELINE_KINDS = ALL_BASELINE_KINDS;
export const ALL_INTERVAL_METHODS: readonly IntervalMethod[] = Object.values(IntervalMethod);
export const INTERVAL_METHODS = ALL_INTERVAL_METHODS;
export const ALL_CLUSTER_DEFINITIONS: readonly ClusterDefinition[] = Object.values(ClusterDefinition);
export const CLUSTER_DEFINITIONS = ALL_CLUSTER_DEFINITIONS;
export const ALL_DRIFT_CONTROL_KINDS: readonly DriftControlKind[] = Object.values(DriftControlKind);
export const DRIFT_CONTROL_KINDS = ALL_DRIFT_CONTROL_KINDS;
export const ALL_CLAIM_RESTRICTIONS: readonly ClaimRestriction[] = Object.values(ClaimRestriction);
export const CLAIM_RESTRICTIONS = ALL_CLAIM_RESTRICTIONS;

export const parseDatasetPartition = (value: unknown): DatasetPartition =>
  parseClosed(ALL_EVALUATION_PARTITIONS, value, ErrorCode.EVAL_PARTITION_UNKNOWN, 'dataset partition');
export const parseHoldoutExposure = (value: unknown): HoldoutExposure =>
  parseClosed(ALL_HOLDOUT_EXPOSURES, value, ErrorCode.EVAL_HOLDOUT_EXPOSURE_UNKNOWN, 'holdout exposure');
export const parseReplayKind = (value: unknown): ReplayKind =>
  parseClosed(ALL_EVALUATION_REPLAY_KINDS, value, ErrorCode.EVAL_REPLAY_KIND_UNKNOWN, 'replay kind');
export const parseMultipleTestingFamily = (value: unknown): MultipleTestingFamily =>
  parseClosed(ALL_MULTIPLE_TESTING_FAMILIES, value, ErrorCode.EVAL_TESTING_FAMILY_UNKNOWN, 'multiple-testing family');
export const parseControlKind = (value: unknown): ControlKind =>
  parseClosed(ALL_NEGATIVE_CONTROL_KINDS, value, ErrorCode.EVAL_CONTROL_KIND_UNKNOWN, 'control kind');
export const parseIncidentTrigger = (value: unknown): IncidentTrigger =>
  parseClosed(ALL_EVALUATION_INCIDENT_TRIGGERS, value, ErrorCode.EVAL_INCIDENT_TRIGGER_UNKNOWN, 'incident trigger');
export const parseBaselineKind = (value: unknown): BaselineKind =>
  parseClosed(ALL_BASELINE_KINDS, value, ErrorCode.EVAL_BASELINE_KIND_UNKNOWN, 'baseline kind');
export const parseIntervalMethod = (value: unknown): IntervalMethod =>
  parseClosed(ALL_INTERVAL_METHODS, value, ErrorCode.EVAL_INTERVAL_METHOD_UNKNOWN, 'interval method');
export const parseClusterDefinition = (value: unknown): ClusterDefinition =>
  parseClosed(ALL_CLUSTER_DEFINITIONS, value, ErrorCode.EVAL_CLUSTER_DEFINITION_UNKNOWN, 'cluster definition');
export const parseDriftControlKind = (value: unknown): DriftControlKind =>
  parseClosed(ALL_DRIFT_CONTROL_KINDS, value, ErrorCode.EVAL_DRIFT_KIND_UNKNOWN, 'drift control kind');
export const parseClaimRestriction = (value: unknown): ClaimRestriction =>
  parseClosed(ALL_CLAIM_RESTRICTIONS, value, ErrorCode.EVAL_CLAIM_RESTRICTION_UNKNOWN, 'claim restriction');

export const datasetPartition = parseDatasetPartition;
export const holdoutExposure = parseHoldoutExposure;
export const replayKind = parseReplayKind;
export const multipleTestingFamily = parseMultipleTestingFamily;
export const controlKind = parseControlKind;
export const incidentTrigger = parseIncidentTrigger;
export const baselineKind = parseBaselineKind;
export const intervalMethod = parseIntervalMethod;
export const clusterDefinition = parseClusterDefinition;
export const driftControlKind = parseDriftControlKind;
export const claimRestriction = parseClaimRestriction;

export interface UniversalActionTimeInput {
  readonly decisionReadyAt: string;
  readonly policyDecidedAt: string;
  readonly deliveryAt: string;
  readonly scenarioDelayMilliseconds?: number;
  readonly scenarioDelaySeconds?: number;
  readonly executionStateAvailableAt: string;
  readonly securityEvidenceAvailableAt: string;
  readonly requiredStateAvailableAt?: readonly string[];
}

/** §31.4 exact arm-independent T_actionable formula, returned as canonical UTC. */
export function universalActionTime(input: UniversalActionTimeInput): string {
  const delay = input.scenarioDelayMilliseconds ??
    ((input.scenarioDelaySeconds ?? 0) * 1_000);
  if (!Number.isFinite(delay) || delay < 0)
    throw new EvalError('scenario delay must be non-negative', { delay }, ErrorCode.EVAL_ACTION_TIME_ASYMMETRY);
  const named = [
    input.decisionReadyAt,
    input.policyDecidedAt,
    input.deliveryAt,
    input.executionStateAvailableAt,
    input.securityEvidenceAvailableAt,
    ...(input.requiredStateAvailableAt ?? []),
  ];
  const times = named.map(Date.parse);
  if (times.some((value) => !Number.isFinite(value)))
    throw new EvalError('action-time input contains an invalid timestamp', {}, ErrorCode.EVAL_ACTION_TIME_ASYMMETRY);
  times[2] = times[2]! + delay;
  return new Date(Math.max(...times)).toISOString();
}

export interface HoldoutGuardInput {
  readonly partition: DatasetPartition;
  readonly exposure: HoldoutExposure;
  readonly usedForMaterialTuning?: boolean;
  readonly materiallyInspected?: boolean;
  readonly requestedRelabel?: HoldoutExposure;
}

export function holdoutExposureGuards(input: HoldoutGuardInput): {
  readonly exposure: HoldoutExposure;
  readonly promotionEligible: boolean;
} {
  const exhausted = input.exposure === HoldoutExposure.EXHAUSTED ||
    input.usedForMaterialTuning === true || input.materiallyInspected === true;
  const exposure = exhausted ? HoldoutExposure.EXHAUSTED : input.exposure;
  if (input.exposure === HoldoutExposure.EXHAUSTED && input.requestedRelabel &&
      input.requestedRelabel !== HoldoutExposure.EXHAUSTED)
    throw new EvalError('an exhausted holdout cannot be relabeled', {}, ErrorCode.EVAL_HOLDOUT_EXHAUSTED_REUSED);
  return {
    exposure,
    promotionEligible: input.partition !== DatasetPartition.FINAL_HOLDOUT ||
      exposure === HoldoutExposure.UNEXPOSED,
  };
}

export interface WeightingDiagnostics {
  readonly positivity: boolean;
  readonly overlap: boolean;
  readonly weightStability: boolean;
  readonly modelDiagnostics: boolean;
}

export function weightingRequiresDiagnostics(input: WeightingDiagnostics): ClaimRestriction {
  if (input.positivity && input.overlap && input.weightStability && input.modelDiagnostics)
    return ClaimRestriction.DECLARED_UNIVERSE;
  return input.positivity && input.overlap
    ? ClaimRestriction.RESTRICT_TO_WEIGHTED_STRATA
    : ClaimRestriction.RESTRICT_TO_OBSERVED_SUBSET;
}

export function populationClaimSupported(
  declaredPopulation: string,
  resultPopulation: string,
  supportedPopulations: readonly string[] = [declaredPopulation],
): boolean {
  return declaredPopulation.length > 0 && resultPopulation === declaredPopulation &&
    supportedPopulations.includes(resultPopulation);
}

export function assertPopulationClaimSupported(
  declaredPopulation: string,
  resultPopulation: string,
  supportedPopulations?: readonly string[],
): void {
  if (!populationClaimSupported(declaredPopulation, resultPopulation, supportedPopulations))
    throw new EvalError('population claim exceeds its declared universe', { declaredPopulation, resultPopulation }, ErrorCode.EVAL_POPULATION_CLAIM_UNSUPPORTED);
}

export function essGate(
  effectiveIndependentSampleSize: number,
  minimumEffectiveSampleSize: number,
): boolean {
  if (!Number.isFinite(effectiveIndependentSampleSize) || !Number.isFinite(minimumEffectiveSampleSize) ||
      effectiveIndependentSampleSize < 0 || minimumEffectiveSampleSize <= 0)
    throw new EvalError('invalid effective-sample-size gate', {}, ErrorCode.EVAL_ESS_BELOW_GATE);
  return effectiveIndependentSampleSize >= minimumEffectiveSampleSize;
}

export function materialLiftDetector(
  observedLift: number,
  registeredMaterialLiftThreshold: number,
): { readonly material: boolean; readonly promotionBlocked: boolean; readonly incidentRequired: boolean } {
  if (!Number.isFinite(observedLift) || !Number.isFinite(registeredMaterialLiftThreshold) ||
      registeredMaterialLiftThreshold < 0)
    throw new EvalError('invalid material-lift control input', {}, ErrorCode.EVAL_WEIGHTING_INVALID);
  const material = Math.abs(observedLift) >= registeredMaterialLiftThreshold;
  return { material, promotionBlocked: material, incidentRequired: material };
}

export interface PurgeWindow {
  readonly startAt: string;
  readonly endAt: string;
}

/** Purge when outcome horizons or feature windows overlap; embargo extends the right edge. */
export function horizonPurge(
  left: PurgeWindow,
  right: PurgeWindow,
  embargoMilliseconds = 0,
): boolean {
  const leftStart = Date.parse(left.startAt);
  const leftEnd = Date.parse(left.endAt);
  const rightStart = Date.parse(right.startAt);
  const rightEnd = Date.parse(right.endAt);
  if ([leftStart, leftEnd, rightStart, rightEnd, embargoMilliseconds].some((value) => !Number.isFinite(value)) ||
      leftEnd < leftStart || rightEnd < rightStart || embargoMilliseconds < 0)
    throw new EvalError('invalid purge/embargo window', {}, ErrorCode.EVAL_ACTION_TIME_ASYMMETRY);
  return leftStart <= rightEnd + embargoMilliseconds &&
    rightStart <= leftEnd + embargoMilliseconds;
}

// Supplemental closed contracts consumed by persisted evaluation schemas.
export const EVALUATION_METRIC_KINDS = [
  'LCB95_NET_SHADOW_PORTFOLIO_UTILITY_PER_CAPITAL_DAY', 'NET_PNL', 'EXPECTANCY',
  'PROFIT_FACTOR', 'DRAWDOWN', 'CVAR', 'CAPITAL_UTILIZATION', 'TURNOVER',
  'CONCENTRATION', 'OPPORTUNITY_COST', 'PRECISION_AT_K', 'RECALL_AT_ELIGIBLE_GEMS',
  'NDCG_AT_K', 'FALSE_DISCOVERY_RATE', 'FALSE_REJECTION_RATE',
  'MEDIAN_SUCCESSFUL_ASSET_RANK', 'MEDIAN_ACTIONABLE_LEAD_TIME', 'MFE', 'MAE',
  'TARGET_DURATION', 'LIQUIDITY_SURVIVAL', 'SECURITY_SURVIVAL',
  'TRADABLE_SUCCESS_BY_NOTIONAL', 'TRADABLE_SUCCESS_DETERMINISTIC_DELAY',
  'TRADABLE_SUCCESS_P50_DELAY', 'TRADABLE_SUCCESS_P90_DELAY', 'FILL_EXIT_SURVIVAL',
  'PARTIAL_FILL_RATE', 'SIGNAL_TO_TRADABLE_DIVERGENCE', 'OUTCOME_MATURITY_RATE',
  'OUTCOME_CENSORING_RATE', 'OUTCOME_INVALID_DATA_RATE',
  'EXECUTABLE_TARGET_FALSE_POSITIVE_RATE', 'DISCOVERY_COVERAGE', 'SOURCE_OVERLAP',
] as const;
export type EvaluationMetricKind = (typeof EVALUATION_METRIC_KINDS)[number];
export const ALL_EVALUATION_METRIC_KINDS = EVALUATION_METRIC_KINDS;
export const MATURITY_SCOPES = ['FINAL_FULLY_MATURED', 'PROVISIONAL_MATURED_AND_PARTIAL', 'PROVISIONAL_ALL_STATES'] as const;
export type MaturityScope = (typeof MATURITY_SCOPES)[number];
export const ALL_MATURITY_SCOPES = MATURITY_SCOPES;
export const MISS_CLASSIFICATIONS = [
  'NOT_IN_CLAIMED_UNIVERSE', 'NOT_DISCOVERED', 'COLLECTOR_FILTER_MISS', 'COLLECTOR_GAP',
  'PROVIDER_LATE', 'IDENTITY_FAILURE', 'DATA_STALE', 'DATA_MISSING',
  'EVIDENCE_NOT_REQUESTED', 'EVIDENCE_COST_BLOCKED', 'EVIDENCE_QUOTA_BLOCKED',
  'CAPABILITY_UNAVAILABLE', 'ELIGIBILITY_FALSE_NEGATIVE', 'SECURITY_FALSE_POSITIVE',
  'MANIPULATION_MISSED', 'WALLET_CLUSTER_MISSED', 'SOURCE_INDEPENDENCE_OVERESTIMATED',
  'RANK_BELOW_CUTOFF', 'DIVERSITY_EXCLUDED', 'BUDGET_EXHAUSTED', 'TOOL_SELECTION_ERROR',
  'MODEL_REASONING_ERROR', 'UNSUPPORTED_CLAIM', 'POLICY_TOO_STRICT', 'POLICY_TOO_LOOSE',
  'ALERT_TOO_LATE', 'EXECUTION_MODEL_ERROR', 'POOL_ADAPTER_UNSUPPORTED',
  'QUOTE_PARITY_FAILURE', 'OUTCOME_UNOBSERVED', 'OUTCOME_LOW_RESOLUTION',
  'SAMPLING_WEIGHT_INVALID', 'ACTION_TIME_ASYMMETRY', 'MARKET_REGIME_SHIFT',
] as const;
export type MissClassification = (typeof MISS_CLASSIFICATIONS)[number];
export const ALL_MISS_CLASSIFICATIONS = MISS_CLASSIFICATIONS;
export const DRIFT_RESPONSES = ['WARN', 'DEGRADE_CONFIDENCE', 'MOVE_TO_SHADOW', 'DISABLE_POLICY', 'REQUIRE_RECALIBRATION'] as const;
export type DriftResponse = (typeof DRIFT_RESPONSES)[number];
export const ALL_DRIFT_RESPONSES = DRIFT_RESPONSES;
export const SELECTION_DIAGNOSTIC_KINDS = [
  'INCLUSION_PROBABILITY', 'WEIGHT_STABILITY', 'EFFECTIVE_SAMPLE_SIZE',
  'COVARIATE_BALANCE', 'OVERLAP_SUPPORT', 'RANDOMIZED_PROBE', 'WINNERS_CURSE',
] as const;
export type SelectionDiagnosticKind = (typeof SELECTION_DIAGNOSTIC_KINDS)[number];
export const ALL_SELECTION_DIAGNOSTIC_KINDS = SELECTION_DIAGNOSTIC_KINDS;
export const ESTIMATOR_KINDS = [
  'UNWEIGHTED', 'DESIGN_WEIGHTED', 'PROPENSITY_WEIGHTED', 'DOUBLY_ROBUST', 'OBSERVED_SUBSET_ONLY',
] as const;
export type EstimatorKind = (typeof ESTIMATOR_KINDS)[number];
export const ALL_ESTIMATOR_KINDS = ESTIMATOR_KINDS;
