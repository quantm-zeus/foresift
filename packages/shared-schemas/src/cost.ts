/** Authoritative ADR-0013 runtime contracts for FR-COST-001…010. */
import { z } from 'zod';
import { UtcTimestampSchema } from './data.ts';

/** Bump only when an existing public shape changes incompatibly. */
export const COST_SCHEMA_REGISTRY_VERSION = 1;

export const CostClassSchema = z.enum([
  'FREE_UNMETERED',
  'FREE_QUOTA',
  'PAID_EXPLICIT',
  'UNKNOWN_COST',
  'DISABLED',
]);
export const ReserveIdSchema = z.enum([
  'RISK_MONITORING',
  'ALERT_VERIFICATION',
  'INTERACTIVE_MCP',
  'EMERGENCY_BACKFILL',
]);
export const ResourceBudgetKindSchema = z.enum([
  'SCHEDULER_SLOTS',
  'WORKFLOW_STEPS',
  'DATABASE_BYTES',
  'OBJECT_STORE_BYTES',
  'NOTIFICATION_RATE',
  'MODEL_TOKENS_BYOK',
]);
export const CostModeSchema = z.enum(['STRICT_FREE', 'PAID_ENABLED']);

export const CostBatchCapabilitySchema = z
  .object({
    maxBatchSize: z.number().int().positive(),
    safeMaxUtilization: z.number().positive().max(1),
    keyFields: z.array(z.string().min(1)).min(1),
    coalescingWindowMs: z.number().int().nonnegative().default(0),
  })
  .strict();

export const OperationCostDeclarationSchema = z
  .object({
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    version: z.string().min(1),
    costClass: CostClassSchema,
    quotaModelId: z.string().min(1),
    quotaUnitCost: z.number().finite().nonnegative(),
    resetPolicyId: z.string().min(1),
    batchCapability: CostBatchCapabilitySchema.nullable(),
    minimumCandidateStage: z.string().min(1),
    protectedReserveEligible: z.boolean(),
    allowedInStrictFree: z.boolean(),
    paidFallbackAllowed: z.boolean().default(false),
    verificationExpiresAt: UtcTimestampSchema,
  })
  .strict();

export const QuotaBalanceSchema = z
  .object({
    providerId: z.string().min(1),
    quotaModelId: z.string().min(1),
    periodWindowStart: UtcTimestampSchema,
    periodWindowEnd: UtcTimestampSchema,
    capLimit: z.number().finite().nonnegative(),
    consumedReserved: z.number().finite().nonnegative(),
    consumedCommitted: z.number().finite().nonnegative(),
    remainingUnits: z.number().finite().nonnegative(),
  })
  .strict()
  .refine(
    (v) =>
      v.periodWindowEnd > v.periodWindowStart &&
      v.remainingUnits === v.capLimit - v.consumedReserved - v.consumedCommitted,
    { message: 'quota balance arithmetic or period window is invalid' },
  );

export const ReserveBucketSchema = z
  .object({
    reserveId: ReserveIdSchema,
    providerId: z.string().min(1),
    periodWindowStart: UtcTimestampSchema,
    capLimit: z.number().finite().nonnegative(),
    consumedUnits: z.number().finite().nonnegative(),
    remainingUnits: z.number().finite().nonnegative(),
  })
  .strict()
  .refine((v) => v.remainingUnits === v.capLimit - v.consumedUnits, {
    message: 'reserve bucket arithmetic is invalid',
  });

export const PaidProviderPolicySchema = z
  .object({
    policyId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    providerId: z.string().min(1),
    budgetUnits: z.number().finite().positive(),
    approvedBy: z.string().min(1),
    approvedAt: UtcTimestampSchema,
    activatedAt: UtcTimestampSchema.nullable(),
    reAuthDueAt: UtcTimestampSchema,
    active: z.boolean(),
    supersededBy: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .nullable(),
  })
  .strict()
  .refine((v) => v.activatedAt === null || v.reAuthDueAt > v.activatedAt, {
    message: 'reAuthDueAt must be after activatedAt',
  });

export const ResourceBudgetSchema = z
  .object({
    kind: ResourceBudgetKindSchema,
    capLimit: z.number().finite().nonnegative(),
    used: z.number().finite().nonnegative(),
    forecastUsed: z.number().finite().nonnegative(),
    degradeBehavior: z.string().min(1),
    ceilingExceededAt: UtcTimestampSchema.nullable(),
  })
  .strict()
  .refine((v) => v.used <= v.capLimit, { message: 'used exceeds capLimit' });

const NumericMapSchema = z.record(z.number().finite().nonnegative());
export const ForecastSnapshotSchema = z
  .object({
    snapshotId: z.string().min(1),
    planVersionId: z.string().min(1),
    verifiedAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema,
    planLimitsJson: NumericMapSchema,
    observedUsageJson: NumericMapSchema,
    estimatedForecastJson: NumericMapSchema,
  })
  .strict()
  .refine((v) => v.expiresAt > v.verifiedAt, { message: 'snapshot expiresAt must be later' });

export const CostDenialRecordSchema = z
  .object({
    candidate: z.string().min(1),
    caller: z.string().min(1),
    reason: z
      .string()
      .regex(
        /^(STRICT_FREE_BLOCKED|PAID_BLOCKED|UNKNOWN_COST|AUTO_UPGRADE_BLOCKED|PAID_FALLBACK_BLOCKED|QUOTA_EXHAUSTED):/,
      ),
    alternative: z.string().min(1),
  })
  .strict();

export const BatchDescriptorSchema = z
  .object({
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    batchKey: z.string().min(1),
    itemCount: z.number().int().positive(),
    maxBatchSize: z.number().int().positive(),
    utilization: z.number().nonnegative().max(1),
  })
  .strict()
  .refine((v) => v.itemCount <= v.maxBatchSize, { message: 'batch exceeds maxBatchSize' });

export const BatchCoalescedEventSchema = z
  .object({
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    batchKey: z.string().min(1),
    itemCount: z.number().int().positive(),
    maxBatchSize: z.number().int().positive(),
    utilization: z.number().nonnegative().max(1),
    coalescedAt: UtcTimestampSchema,
  })
  .strict()
  .refine((v) => v.itemCount <= v.maxBatchSize, { message: 'batch exceeds maxBatchSize' });

export type OperationCostDeclaration = z.infer<typeof OperationCostDeclarationSchema>;
export type CostModeValue = z.infer<typeof CostModeSchema>;
export type QuotaBalance = z.infer<typeof QuotaBalanceSchema>;
export type ReserveBucket = z.infer<typeof ReserveBucketSchema>;
export type PaidProviderPolicy = z.infer<typeof PaidProviderPolicySchema>;
export type ResourceBudget = z.infer<typeof ResourceBudgetSchema>;
export type ForecastSnapshot = z.infer<typeof ForecastSnapshotSchema>;
export type CostDenialRecord = z.infer<typeof CostDenialRecordSchema>;
export type BatchDescriptor = z.infer<typeof BatchDescriptorSchema>;
export type BatchCoalescedEvent = z.infer<typeof BatchCoalescedEventSchema>;

/** Catalog parity surface: event fields are generated from these stable lists. */
export const COST_CATALOG_FIELDS = {
  'cost.blocked': ['candidate', 'caller', 'reason', 'alternative'],
  'cost.batch_coalesced': [
    'providerId',
    'operationId',
    'batchKey',
    'itemCount',
    'maxBatchSize',
    'utilization',
    'coalescedAt',
  ],
  'cost.quota_committed': [
    'providerId',
    'quotaModelId',
    'periodWindowStart',
    'periodWindowEnd',
    'capLimit',
    'consumedReserved',
    'consumedCommitted',
    'remainingUnits',
  ],
  'cost.quota_released': ['providerId', 'quotaModelId', 'periodWindowStart', 'remainingUnits'],
  'cost.quota_expired': ['providerId', 'quotaModelId', 'periodWindowStart', 'remainingUnits'],
  'cost.reserve_consumed': [
    'reserveId',
    'providerId',
    'periodWindowStart',
    'capLimit',
    'consumedUnits',
    'remainingUnits',
  ],
  'cost.forecast_computed': [
    'snapshotId',
    'planVersionId',
    'verifiedAt',
    'expiresAt',
    'planLimitsJson',
    'observedUsageJson',
    'estimatedForecastJson',
  ],
  'cost.plan_unverified': ['snapshotId', 'planVersionId', 'expiresAt'],
  'cost.paid_policy_activated': [
    'policyId',
    'providerId',
    'budgetUnits',
    'approvedBy',
    'approvedAt',
    'activatedAt',
    'reAuthDueAt',
    'active',
    'supersededBy',
  ],
  'cost.capacity_replay_blocked': [
    'snapshotId',
    'planVersionId',
    'planLimitsJson',
    'estimatedForecastJson',
  ],
  'cost.resource_budget_exhausted': [
    'kind',
    'capLimit',
    'used',
    'forecastUsed',
    'degradeBehavior',
    'ceilingExceededAt',
  ],
  'cost.forecast_tolerance_breached': [
    'snapshotId',
    'planLimitsJson',
    'observedUsageJson',
    'estimatedForecastJson',
  ],
} as const;

export const COST_SCHEMAS = {
  OperationCostDeclaration: OperationCostDeclarationSchema,
  CostMode: CostModeSchema,
  QuotaBalance: QuotaBalanceSchema,
  ReserveBucket: ReserveBucketSchema,
  PaidProviderPolicy: PaidProviderPolicySchema,
  ResourceBudget: ResourceBudgetSchema,
  ForecastSnapshot: ForecastSnapshotSchema,
  CostDenialRecord: CostDenialRecordSchema,
  BatchDescriptor: BatchDescriptorSchema,
  BatchCoalescedEvent: BatchCoalescedEventSchema,
} as const;

export type CostSchemaName = keyof typeof COST_SCHEMAS;

export function parseCostSchema<T extends CostSchemaName>(
  name: T,
  payload: unknown,
): z.infer<(typeof COST_SCHEMAS)[T]> {
  return COST_SCHEMAS[name].parse(payload) as z.infer<(typeof COST_SCHEMAS)[T]>;
}
