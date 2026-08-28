/** Closed, fail-closed cost and capacity vocabularies (FR-COST-001…010). */
import { ErrorCode, ForesiftError } from './errors.ts';
import { WorkloadClass, type WorkloadClass as WorkloadClassType } from './tool.ts';

export const CostClass = {
  FREE_UNMETERED: 'FREE_UNMETERED',
  FREE_QUOTA: 'FREE_QUOTA',
  PAID_EXPLICIT: 'PAID_EXPLICIT',
  UNKNOWN_COST: 'UNKNOWN_COST',
  DISABLED: 'DISABLED',
} as const;
export type CostClass = (typeof CostClass)[keyof typeof CostClass];
export const ALL_COST_CLASSES: readonly CostClass[] = Object.values(CostClass);

export const ResetPolicyKind = {
  NONE: 'NONE',
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
  ROLLING_WINDOW: 'ROLLING_WINDOW',
  MANUAL: 'MANUAL',
} as const;
export type ResetPolicyKind = (typeof ResetPolicyKind)[keyof typeof ResetPolicyKind];
export const ALL_RESET_POLICY_KINDS: readonly ResetPolicyKind[] = Object.values(ResetPolicyKind);

export const ReserveId = {
  RISK_MONITORING: 'RISK_MONITORING',
  ALERT_VERIFICATION: 'ALERT_VERIFICATION',
  INTERACTIVE_MCP: 'INTERACTIVE_MCP',
  EMERGENCY_BACKFILL: 'EMERGENCY_BACKFILL',
} as const;
export type ReserveId = (typeof ReserveId)[keyof typeof ReserveId];
export const ALL_RESERVE_IDS: readonly ReserveId[] = Object.values(ReserveId);

export const ResourceBudgetKind = {
  SCHEDULER_SLOTS: 'SCHEDULER_SLOTS',
  WORKFLOW_STEPS: 'WORKFLOW_STEPS',
  DATABASE_BYTES: 'DATABASE_BYTES',
  OBJECT_STORE_BYTES: 'OBJECT_STORE_BYTES',
  NOTIFICATION_RATE: 'NOTIFICATION_RATE',
  MODEL_TOKENS_BYOK: 'MODEL_TOKENS_BYOK',
} as const;
export type ResourceBudgetKind = (typeof ResourceBudgetKind)[keyof typeof ResourceBudgetKind];
export const ALL_RESOURCE_BUDGET_KINDS: readonly ResourceBudgetKind[] =
  Object.values(ResourceBudgetKind);

export const CostMode = { STRICT_FREE: 'STRICT_FREE', PAID_ENABLED: 'PAID_ENABLED' } as const;
export type CostMode = (typeof CostMode)[keyof typeof CostMode];
export const ALL_COST_MODES: readonly CostMode[] = Object.values(CostMode);

function parse<T extends string>(
  values: readonly T[],
  value: string,
  code: ErrorCode,
  label: string,
): T {
  if ((values as readonly string[]).includes(value)) return value as T;
  throw new ForesiftError(code, `unknown ${label}`, { value });
}

export const costClass = (value: string): CostClass =>
  parse(ALL_COST_CLASSES, value, ErrorCode.COST_CLASS_UNKNOWN, 'cost class');
export const resetPolicyKind = (value: string): ResetPolicyKind =>
  parse(ALL_RESET_POLICY_KINDS, value, ErrorCode.RESET_POLICY_KIND_UNKNOWN, 'reset policy kind');
export const reserveId = (value: string): ReserveId =>
  parse(ALL_RESERVE_IDS, value, ErrorCode.RESERVE_ID_UNKNOWN, 'reserve id');
export const resourceBudgetKind = (value: string): ResourceBudgetKind =>
  parse(
    ALL_RESOURCE_BUDGET_KINDS,
    value,
    ErrorCode.RESOURCE_BUDGET_KIND_UNKNOWN,
    'resource budget kind',
  );
export const costMode = (value: string): CostMode =>
  parse(ALL_COST_MODES, value, ErrorCode.COST_MODE_UNKNOWN, 'cost mode');

export function isAllowedInStrictFreeCostClass(value: CostClass): boolean {
  return value === CostClass.FREE_UNMETERED || value === CostClass.FREE_QUOTA;
}

export function isProtectedReserveWorkload(value: WorkloadClassType): boolean {
  return value === WorkloadClass.INTERACTIVE_HIGH || value === WorkloadClass.RISK_MONITOR_HIGH;
}
