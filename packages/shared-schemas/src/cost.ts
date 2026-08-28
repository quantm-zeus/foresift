/** Authoritative strict Zod records for cost/quota/capacity contracts. */
import { z } from 'zod';
import { UtcTimestampSchema } from './data.ts';
import { QuotaModelSchema } from './core.ts';

export const COST_SCHEMA_REGISTRY_VERSION = 1;
export const CostClassSchema = z.enum([
  'FREE_UNMETERED',
  'FREE_QUOTA',
  'PAID_EXPLICIT',
  'UNKNOWN_COST',
  'DISABLED',
]);
export const CostModeSchema = z.enum(['STRICT_FREE', 'PAID_ENABLED']);
export const ResetPolicyKindSchema = z.enum([
  'NONE',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'ROLLING_WINDOW',
  'MANUAL',
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
export const CostBatchCapabilitySchema = z
  .object({
    maxBatchSize: z.number().int().positive(),
    safeMaxUtilization: z.number().positive().max(1),
    keyFields: z.array(z.string().min(1)),
    coalescingWindowMs: z.number().int().nonnegative().optional(),
    automaticUpgrade: z.boolean().optional(),
  })
  .strict();

export const OperationCostDeclarationSchema = z
  .object({
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    costClass: CostClassSchema,
    quotaModelId: QuotaModelSchema,
    quotaUnitCost: z.number().nonnegative(),
    resetPolicyId: z.string().min(1),
    batchCapability: CostBatchCapabilitySchema.nullable(),
    minimumCandidateStage: z.string().min(1),
    protectedReserveEligible: z.boolean(),
    allowedInStrictFree: z.boolean(),
    paidFallbackAllowed: z.boolean().optional(),
    verificationExpiresAt: UtcTimestampSchema.optional(),
  })
  .strict();
export type OperationCostDeclaration = z.infer<typeof OperationCostDeclarationSchema>;

export const QuotaBalanceSchema = z
  .object({
    providerId: z.string().min(1),
    quotaModelId: QuotaModelSchema,
    periodWindowStart: UtcTimestampSchema,
    periodResetAt: UtcTimestampSchema,
    capLimit: z.number().nonnegative(),
    remainingUnits: z.number().nonnegative(),
    consumedReserved: z.number().nonnegative(),
    consumedCommitted: z.number().nonnegative(),
  })
  .strict()
  .refine((v) => v.remainingUnits === v.capLimit - v.consumedReserved - v.consumedCommitted, {
    message: 'remainingUnits must conserve the quota balance',
  });
export type QuotaBalance = z.infer<typeof QuotaBalanceSchema>;

export const ReserveBucketSchema = z
  .object({
    reserveId: ReserveIdSchema,
    providerId: z.string().min(1),
    periodWindowStart: UtcTimestampSchema,
    periodResetAt: UtcTimestampSchema,
    capLimit: z.number().nonnegative(),
    remainingUnits: z.number().nonnegative(),
    consumedReserved: z.number().nonnegative(),
    consumedCommitted: z.number().nonnegative(),
  })
  .strict();
export type ReserveBucket = z.infer<typeof ReserveBucketSchema>;

export const PaidProviderPolicySchema = z
  .object({
    policyId: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    providerId: z.string().min(1),
    budgetUnits: z.number().positive(),
    budgetCurrencyOrModel: z.string().min(1).optional(),
    approvedBy: z.string().min(1),
    approvedAt: UtcTimestampSchema,
    activatedAt: UtcTimestampSchema.nullable(),
    reAuthDueAt: UtcTimestampSchema,
    active: z.boolean(),
    supersededBy: z
      .string()
      .regex(/^sha256:[0-9a-f]{64}$/)
      .nullable(),
  })
  .strict()
  .refine((v) => v.activatedAt === null || v.reAuthDueAt > v.activatedAt, {
    message: 'reAuthDueAt must follow activatedAt',
  });
export type PaidProviderPolicy = z.infer<typeof PaidProviderPolicySchema>;

export const ResourceBudgetSchema = z
  .object({
    kind: ResourceBudgetKindSchema,
    capLimit: z.number().nonnegative(),
    used: z.number().nonnegative(),
    forecastUsed: z.number().nonnegative(),
    degradeBehavior: z.string().min(1),
    ceilingExceededAt: UtcTimestampSchema.nullable(),
  })
  .strict()
  .refine((v) => v.used <= v.capLimit, { message: 'used must not exceed capLimit' });
export type ResourceBudget = z.infer<typeof ResourceBudgetSchema>;

const NumericMapSchema = z.record(z.string(), z.number().nonnegative());
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
  .refine((v) => v.expiresAt > v.verifiedAt, { message: 'expiresAt must follow verifiedAt' });
export type ForecastSnapshot = z.infer<typeof ForecastSnapshotSchema>;

export const CostDenialRecordSchema = z
  .object({
    candidate: z.string().min(1),
    caller: z.string().min(1),
    reason: z.string().min(1),
    alternative: z.string().min(1),
  })
  .strict();
export type CostDenialRecord = z.infer<typeof CostDenialRecordSchema>;

export const BatchDescriptorSchema = z
  .object({
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    batchKey: z.string().min(1),
    itemCount: z.number().int().positive(),
    maxBatchSize: z.number().int().positive(),
    utilization: z.number().min(0).max(1),
  })
  .strict();
export type BatchDescriptor = z.infer<typeof BatchDescriptorSchema>;
export const BatchCoalescedEventSchema = BatchDescriptorSchema.extend({
  coalescedAt: UtcTimestampSchema,
}).strict();
export type BatchCoalescedEvent = z.infer<typeof BatchCoalescedEventSchema>;

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
