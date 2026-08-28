/** Pure free-first cost and sustainable-capacity vocabularies (FR-COST-001…010). */
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
  NEVER: 'NEVER',
  FIXED_WINDOW: 'FIXED_WINDOW',
  ROLLING_WINDOW: 'ROLLING_WINDOW',
  TOKEN_BUCKET: 'TOKEN_BUCKET',
  CALENDAR_PERIOD: 'CALENDAR_PERIOD',
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

function parseEnum<T extends string>(
  value: unknown,
  values: readonly T[],
  code: ErrorCode,
  label: string,
): T {
  if (typeof value === 'string' && (values as readonly string[]).includes(value)) return value as T;
  throw new ForesiftError(code, `unknown ${label}`, {
    value: typeof value === 'string' ? value : String(value),
  });
}

export const costClass = (value: unknown): CostClass =>
  parseEnum(value, ALL_COST_CLASSES, ErrorCode.COST_CLASS_UNKNOWN, 'cost class');
export const resetPolicyKind = (value: unknown): ResetPolicyKind =>
  parseEnum(
    value,
    ALL_RESET_POLICY_KINDS,
    ErrorCode.RESET_POLICY_KIND_UNKNOWN,
    'reset policy kind',
  );
export const reserveId = (value: unknown): ReserveId =>
  parseEnum(value, ALL_RESERVE_IDS, ErrorCode.RESERVE_ID_UNKNOWN, 'reserve id');
export const resourceBudgetKind = (value: unknown): ResourceBudgetKind =>
  parseEnum(
    value,
    ALL_RESOURCE_BUDGET_KINDS,
    ErrorCode.RESOURCE_BUDGET_KIND_UNKNOWN,
    'resource budget kind',
  );
export const costMode = (value: unknown): CostMode =>
  parseEnum(value, ALL_COST_MODES, ErrorCode.COST_MODE_UNKNOWN, 'cost mode');
