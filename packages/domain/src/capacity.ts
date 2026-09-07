/** Closed, fail-closed capacity-governance vocabularies (PRD §62.2, §62.4, §62.8, §62.9, §62.12). */
import { ErrorCode, ForesiftError } from './errors.ts';

/**
 * Capacity error codes are registered locally because `errors.ts` is owned by another
 * G1 wave lane (parallel-shard write-path isolation). Codes are stable strings that
 * follow the house `<SUBJECT>_UNKNOWN` convention; they are cast to the global
 * `ErrorCode` type so `ForesiftError` keeps a single, consistent runtime shape.
 */
export const CapacityErrorCode = {
  BUDGET_DIMENSION_UNKNOWN: 'BUDGET_DIMENSION_UNKNOWN',
  RESERVE_CLASS_UNKNOWN: 'RESERVE_CLASS_UNKNOWN',
  DEGRADATION_STEP_UNKNOWN: 'DEGRADATION_STEP_UNKNOWN',
  CONTRACT_RESULT_UNKNOWN: 'CONTRACT_RESULT_UNKNOWN',
  RECONCILIATION_BREACH_UNKNOWN: 'RECONCILIATION_BREACH_UNKNOWN',
  ATTRIBUTION_UNIT_UNKNOWN: 'ATTRIBUTION_UNIT_UNKNOWN',
  SPEND_CLASS_UNKNOWN: 'SPEND_CLASS_UNKNOWN',
} as const;
export type CapacityErrorCode = (typeof CapacityErrorCode)[keyof typeof CapacityErrorCode];

export const BudgetDimension = {
  DATA_PROVIDER: 'DATA_PROVIDER',
  MODEL: 'MODEL',
  COMPUTE_WORKFLOW: 'COMPUTE_WORKFLOW',
  DATABASE_STORAGE: 'DATABASE_STORAGE',
  OBJECT_STORAGE_EGRESS: 'OBJECT_STORAGE_EGRESS',
  NOTIFICATION: 'NOTIFICATION',
} as const;
export type BudgetDimension = (typeof BudgetDimension)[keyof typeof BudgetDimension];
export const ALL_BUDGET_DIMENSIONS: readonly BudgetDimension[] = Object.values(BudgetDimension);

export const ProviderMode = {
  STRICT_FREE: 'STRICT_FREE',
  FREE_FIRST: 'FREE_FIRST',
  PAID_ALLOWED: 'PAID_ALLOWED',
} as const;
export type ProviderMode = (typeof ProviderMode)[keyof typeof ProviderMode];
export const ALL_PROVIDER_MODES: readonly ProviderMode[] = Object.values(ProviderMode);

/**
 * The four G0 `ReserveId` spellings (RISK_MONITORING, ALERT_VERIFICATION,
 * INTERACTIVE_MCP, EMERGENCY_BACKFILL) are kept exact for G0 interop (plan ADR-2).
 */
export const ReserveClass = {
  RISK_MONITORING: 'RISK_MONITORING',
  ALERT_VERIFICATION: 'ALERT_VERIFICATION',
  INTERACTIVE_MCP: 'INTERACTIVE_MCP',
  EMERGENCY_BACKFILL: 'EMERGENCY_BACKFILL',
  OUTCOME_COLLECTION: 'OUTCOME_COLLECTION',
  SCHEDULED_CANDIDATE_VERIFICATION: 'SCHEDULED_CANDIDATE_VERIFICATION',
  DEEP_RESEARCH: 'DEEP_RESEARCH',
  FIRST_PARTY_COLLECTOR: 'FIRST_PARTY_COLLECTOR',
  EXPLORATION_PROBES: 'EXPLORATION_PROBES',
} as const;
export type ReserveClass = (typeof ReserveClass)[keyof typeof ReserveClass];
export const ALL_RESERVE_CLASSES: readonly ReserveClass[] = Object.values(ReserveClass);

export const DegradationStep = {
  SKIP_ENRICHMENT_NOTEBOOK_ANALOG_COUNTERFACTUAL:
    'SKIP_ENRICHMENT_NOTEBOOK_ANALOG_COUNTERFACTUAL',
  REDUCE_SOCIAL_NARRATIVE_DEPTH: 'REDUCE_SOCIAL_NARRATIVE_DEPTH',
  REDUCE_WALLET_HISTORY_DEPTH: 'REDUCE_WALLET_HISTORY_DEPTH',
  REDUCE_DEEP_RESEARCH_CANDIDATE_COUNT: 'REDUCE_DEEP_RESEARCH_CANDIDATE_COUNT',
  EXTEND_LOW_PRIORITY_RECHECK_INTERVAL: 'EXTEND_LOW_PRIORITY_RECHECK_INTERVAL',
  REDUCE_CHEAP_MONITOR_BREADTH: 'REDUCE_CHEAP_MONITOR_BREADTH',
  PAUSE_EXPLORATION_ABOVE_PROTECTED_FLOOR: 'PAUSE_EXPLORATION_ABOVE_PROTECTED_FLOOR',
  USE_ACCEPTABLE_CACHE_FOR_MANUAL_NON_ALERT: 'USE_ACCEPTABLE_CACHE_FOR_MANUAL_NON_ALERT',
  STOP_NEW_OPPORTUNITY_RESEARCH: 'STOP_NEW_OPPORTUNITY_RESEARCH',
  PRESERVE_CRITICAL_OBLIGATIONS: 'PRESERVE_CRITICAL_OBLIGATIONS',
  RETURN_PARTIAL_INSUFFICIENT_DATA: 'RETURN_PARTIAL_INSUFFICIENT_DATA',
} as const;
export type DegradationStep = (typeof DegradationStep)[keyof typeof DegradationStep];
export const ALL_DEGRADATION_STEPS: readonly DegradationStep[] = Object.values(DegradationStep);

export const ContractResult = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  UNVERIFIED: 'UNVERIFIED',
} as const;
export type ContractResult = (typeof ContractResult)[keyof typeof ContractResult];
export const ALL_CONTRACT_RESULTS: readonly ContractResult[] = Object.values(ContractResult);

export const ReconciliationDimension = {
  OPERATION: 'OPERATION',
  WORKLOAD: 'WORKLOAD',
  CANDIDATE: 'CANDIDATE',
  RUN: 'RUN',
  MODULE: 'MODULE',
} as const;
export type ReconciliationDimension =
  (typeof ReconciliationDimension)[keyof typeof ReconciliationDimension];
export const ALL_RECONCILIATION_DIMENSIONS: readonly ReconciliationDimension[] =
  Object.values(ReconciliationDimension);

export const ReconciliationBreachKind = {
  MATERIAL_UNDERESTIMATION: 'MATERIAL_UNDERESTIMATION',
  RESERVE_BREACH: 'RESERVE_BREACH',
} as const;
export type ReconciliationBreachKind =
  (typeof ReconciliationBreachKind)[keyof typeof ReconciliationBreachKind];
export const ALL_RECONCILIATION_BREACH_KINDS: readonly ReconciliationBreachKind[] =
  Object.values(ReconciliationBreachKind);

export const AttributionUnitKind = {
  RESEARCHED_CANDIDATE: 'RESEARCHED_CANDIDATE',
  MATURE_OUTCOME: 'MATURE_OUTCOME',
  USEFUL_ALERT: 'USEFUL_ALERT',
  PREVENTED_RISK_EVENT: 'PREVENTED_RISK_EVENT',
  PORTFOLIO_UTILITY_UNIT: 'PORTFOLIO_UTILITY_UNIT',
} as const;
export type AttributionUnitKind = (typeof AttributionUnitKind)[keyof typeof AttributionUnitKind];
export const ALL_ATTRIBUTION_UNIT_KINDS: readonly AttributionUnitKind[] =
  Object.values(AttributionUnitKind);

export const RenderedSpendClass = {
  PAID_DATA_SPEND: 'PAID_DATA_SPEND',
  FREE_QUOTA_CONSUMPTION: 'FREE_QUOTA_CONSUMPTION',
  MODEL_SPEND: 'MODEL_SPEND',
  INFRASTRUCTURE_SPEND: 'INFRASTRUCTURE_SPEND',
  STORAGE_EGRESS_SPEND: 'STORAGE_EGRESS_SPEND',
  NOTIFICATION_SPEND: 'NOTIFICATION_SPEND',
  HUMAN_REVIEW_EFFORT: 'HUMAN_REVIEW_EFFORT',
} as const;
export type RenderedSpendClass = (typeof RenderedSpendClass)[keyof typeof RenderedSpendClass];
export const ALL_RENDERED_SPEND_CLASSES: readonly RenderedSpendClass[] =
  Object.values(RenderedSpendClass);

function parse<T extends string>(values: readonly T[], value: string, code: string, label: string): T {
  if ((values as readonly string[]).includes(value)) return value as T;
  throw new ForesiftError(code as ErrorCode, `unknown ${label}`, { value });
}

export const budgetDimension = (value: string): BudgetDimension =>
  parse(ALL_BUDGET_DIMENSIONS, value, CapacityErrorCode.BUDGET_DIMENSION_UNKNOWN, 'budget dimension');
export const providerMode = (value: string): ProviderMode =>
  parse(ALL_PROVIDER_MODES, value, CapacityErrorCode.BUDGET_DIMENSION_UNKNOWN, 'provider mode');
export const reserveClass = (value: string): ReserveClass =>
  parse(ALL_RESERVE_CLASSES, value, CapacityErrorCode.RESERVE_CLASS_UNKNOWN, 'reserve class');
export const degradationStep = (value: string): DegradationStep =>
  parse(ALL_DEGRADATION_STEPS, value, CapacityErrorCode.DEGRADATION_STEP_UNKNOWN, 'degradation step');
export const contractResult = (value: string): ContractResult =>
  parse(ALL_CONTRACT_RESULTS, value, CapacityErrorCode.CONTRACT_RESULT_UNKNOWN, 'contract result');
export const reconciliationDimension = (value: string): ReconciliationDimension =>
  parse(
    ALL_RECONCILIATION_DIMENSIONS,
    value,
    CapacityErrorCode.BUDGET_DIMENSION_UNKNOWN,
    'reconciliation dimension',
  );
export const reconciliationBreachKind = (value: string): ReconciliationBreachKind =>
  parse(
    ALL_RECONCILIATION_BREACH_KINDS,
    value,
    CapacityErrorCode.RECONCILIATION_BREACH_UNKNOWN,
    'reconciliation breach kind',
  );
export const attributionUnitKind = (value: string): AttributionUnitKind =>
  parse(
    ALL_ATTRIBUTION_UNIT_KINDS,
    value,
    CapacityErrorCode.ATTRIBUTION_UNIT_UNKNOWN,
    'attribution unit kind',
  );
export const renderedSpendClass = (value: string): RenderedSpendClass =>
  parse(ALL_RENDERED_SPEND_CLASSES, value, CapacityErrorCode.SPEND_CLASS_UNKNOWN, 'rendered spend class');
