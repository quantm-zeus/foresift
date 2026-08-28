/** Closed free-first cost and capacity vocabularies (FR-COST-001…010). */
import { ErrorCode, ForesiftError } from './errors.ts';

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
  RATE_LIMIT: 'RATE_LIMIT',
  FIXED_WINDOW: 'FIXED_WINDOW',
  ROLLING_WINDOW: 'ROLLING_WINDOW',
  CALENDAR_DAY: 'CALENDAR_DAY',
  CALENDAR_MONTH: 'CALENDAR_MONTH',
  CREDIT_BALANCE: 'CREDIT_BALANCE',
  NEVER: 'NEVER',
  PROVIDER_DEFINED: 'PROVIDER_DEFINED',
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

export const CostMode = {
  STRICT_FREE: 'STRICT_FREE',
  PAID_ENABLED: 'PAID_ENABLED',
} as const;
export type CostMode = (typeof CostMode)[keyof typeof CostMode];
export const ALL_COST_MODES: readonly CostMode[] = Object.values(CostMode);

function parseClosed<T extends string>(
  value: unknown,
  values: readonly T[],
  code: ErrorCode,
  label: string,
): T {
  if (typeof value === 'string' && (values as readonly string[]).includes(value)) return value as T;
  throw new ForesiftError(code, `unknown ${label}`, {
    value: typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value)),
  });
}

export function costClass(value: unknown): CostClass {
  return parseClosed(value, ALL_COST_CLASSES, ErrorCode.COST_CLASS_UNKNOWN, 'cost class');
}

export function resetPolicyKind(value: unknown): ResetPolicyKind {
  return parseClosed(
    value,
    ALL_RESET_POLICY_KINDS,
    ErrorCode.RESET_POLICY_KIND_UNKNOWN,
    'reset policy kind',
  );
}

export function reserveId(value: unknown): ReserveId {
  return parseClosed(value, ALL_RESERVE_IDS, ErrorCode.RESERVE_ID_UNKNOWN, 'reserve id');
}

export function resourceBudgetKind(value: unknown): ResourceBudgetKind {
  return parseClosed(
    value,
    ALL_RESOURCE_BUDGET_KINDS,
    ErrorCode.RESOURCE_BUDGET_KIND_UNKNOWN,
    'resource budget kind',
  );
}

export function costMode(value: unknown): CostMode {
  return parseClosed(value, ALL_COST_MODES, ErrorCode.COST_MODE_UNKNOWN, 'cost mode');
}

// QuotaModel and quotaModel are intentionally defined once in tool.ts and
// re-exported by the package entrypoint; cost consumers reuse that contract.
