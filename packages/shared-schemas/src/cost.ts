/** Authoritative ADR-0013 schemas for free-first cost and capacity contracts. */
import { z } from 'zod';
import { QuotaModelSchema } from './core.ts';

/** Registry version changes only when a published shape changes incompatibly. */
export const COST_SCHEMA_REGISTRY_VERSION = 1;

export const CostClassSchema = z.enum([
  'FREE_UNMETERED',
  'FREE_QUOTA',
  'PAID_EXPLICIT',
  'UNKNOWN_COST',
  'DISABLED',
]);
export const CostModeSchema = z.enum(['STRICT_FREE', 'PAID_ENABLED']);
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
const Id = z.string().min(1);
const Units = z.number().finite().nonnegative();
const Timestamp = z.string().datetime({ offset: true });

const ModernCostBatchCapabilitySchema = z
  .object({
    maxBatchSize: z.number().int().positive(),
    safeMaxUtilization: z.number().finite().gt(0).max(1),
    keyFields: z.array(Id).min(1),
    coalescingWindowMs: z.number().int().nonnegative().default(0),
    maxPayloadBytes: z.number().int().positive().optional(),
  })
  .strict();

/** Existing provider rows used maxEntities/maxBytes; normalize them at the read view. */
const LegacyCostBatchCapabilitySchema = z
  .object({
    maxEntities: z.number().int().positive(),
    maxBytes: z.number().int().positive().optional(),
  })
  .strict()
  .transform((value) => ({
    maxBatchSize: value.maxEntities,
    safeMaxUtilization: 1,
    keyFields: ['chain', 'fieldProjection', 'freshnessPolicy', 'asOf', 'licensePolicyId'],
    coalescingWindowMs: 0,
    ...(value.maxBytes === undefined ? {} : { maxPayloadBytes: value.maxBytes }),
  }));

export const CostBatchCapabilitySchema = z.union([
  ModernCostBatchCapabilitySchema,
  LegacyCostBatchCapabilitySchema,
]);

export const OperationCostDeclarationSchema = z
  .object({
    providerId: Id,
    operationId: Id,
    version: Id,
    costClass: CostClassSchema,
    quotaModel: QuotaModelSchema,
    quotaUnitCost: Units,
    resetPolicyId: Id,
    batchCapability: CostBatchCapabilitySchema.nullable(),
    minimumCandidateStage: Id.nullable(),
    protectedReserveEligible: z.boolean(),
    allowedInStrictFree: z.boolean(),
    paidFallbackAllowed: z.boolean().default(false),
    verificationExpiresAt: Timestamp.optional(),
  })
  .strict();

export const QuotaBalanceSchema = z
  .object({
    providerId: Id,
    quotaModelId: Id,
    periodWindowStart: Timestamp,
    periodWindowEnd: Timestamp,
    capLimit: Units,
    consumedReserved: Units,
    consumedCommitted: Units,
    remainingUnits: Units,
    resetPolicyId: Id,
    verificationExpiresAt: Timestamp.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const expected = value.capLimit - value.consumedReserved - value.consumedCommitted;
    if (Math.abs(value.remainingUnits - expected) > Number.EPSILON) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'remainingUnits must equal capLimit - consumedReserved - consumedCommitted',
      });
    }
  });

export const ReserveBucketSchema = z
  .object({
    reserveId: ReserveIdSchema,
    providerId: Id,
    periodWindowStart: Timestamp,
    capLimit: Units,
    consumedUnits: Units,
    remainingUnits: Units,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Math.abs(value.remainingUnits - (value.capLimit - value.consumedUnits)) > Number.EPSILON) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'reserve remainingUnits must equal capLimit - consumedUnits',
      });
    }
  });

export const PaidProviderPolicySchema = z
  .object({
    policyId: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    providerId: Id,
    budgetUnits: z.number().finite().positive(),
    approvedBy: Id,
    approvedAt: Timestamp,
    activatedAt: Timestamp.nullable(),
    reAuthDueAt: Timestamp,
    active: z.boolean(),
    supersededBy: Id.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.activatedAt !== null &&
      new Date(value.reAuthDueAt).getTime() <= new Date(value.activatedAt).getTime()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'reAuthDueAt must follow activatedAt',
      });
    }
    if (value.active && value.activatedAt === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'active paid policy requires activatedAt',
      });
    }
  });

export const ResourceBudgetSchema = z
  .object({
    kind: ResourceBudgetKindSchema,
    capLimit: Units,
    used: Units,
    forecastUsed: Units,
    degradeBehavior: Id,
    ceilingExceededAt: Timestamp.nullable(),
  })
  .strict()
  .refine((value) => value.used <= value.capLimit, 'used must not exceed capLimit');

const NumericDimensionMap = z.record(z.number().finite().nonnegative());
export const ForecastSnapshotSchema = z
  .object({
    snapshotId: Id,
    planVersionId: Id,
    verifiedAt: Timestamp,
    expiresAt: Timestamp,
    planLimitsJson: NumericDimensionMap,
    observedUsageJson: NumericDimensionMap,
    estimatedForecastJson: NumericDimensionMap,
  })
  .strict();

export const CostDenialRecordSchema = z
  .object({
    candidate: Id,
    caller: Id,
    reason: Id,
    alternative: Id,
    provider: Id.optional(),
    operation: Id.optional(),
    blockedAt: Timestamp.optional(),
  })
  .strict();

export const BatchDescriptorSchema = z
  .object({
    batchId: Id,
    provider: Id,
    operation: Id,
    operationVersion: Id.optional(),
    requestIds: z.array(Id).min(1),
    deterministicKey: Id,
    maxBatchSize: z.number().int().positive(),
    utilization: z.number().finite().min(0).max(1),
  })
  .strict();

export const BatchCoalescedEventSchema = z
  .object({
    batchId: Id,
    provider: Id,
    operation: Id,
    itemCount: z.number().int().positive(),
    maxBatchSize: z.number().int().positive(),
    utilization: z.number().finite().gt(0).max(1),
    reservationCount: z.literal(1),
    coalescedAt: Timestamp,
  })
  .strict();

export type OperationCostDeclaration = z.infer<typeof OperationCostDeclarationSchema>;
export type CostBatchCapability = z.infer<typeof CostBatchCapabilitySchema>;
export type QuotaBalance = z.infer<typeof QuotaBalanceSchema>;
export type ReserveBucket = z.infer<typeof ReserveBucketSchema>;
export type PaidProviderPolicy = z.infer<typeof PaidProviderPolicySchema>;
export type ResourceBudget = z.infer<typeof ResourceBudgetSchema>;
export type ForecastSnapshot = z.infer<typeof ForecastSnapshotSchema>;
export type CostDenialRecord = z.infer<typeof CostDenialRecordSchema>;
export type BatchDescriptor = z.infer<typeof BatchDescriptorSchema>;
export type BatchCoalescedEvent = z.infer<typeof BatchCoalescedEventSchema>;

/** Named registry used by catalog parity and release-conformance probes. */
export const COST_SCHEMA_REGISTRY = Object.freeze({
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
});

export const COST_SCHEMAS = COST_SCHEMA_REGISTRY;
export type CostSchemaName = keyof typeof COST_SCHEMAS;

export function parseCostSchema<T extends CostSchemaName>(
  name: T,
  payload: unknown,
): z.infer<(typeof COST_SCHEMAS)[T]> {
  return COST_SCHEMAS[name].parse(payload) as z.infer<(typeof COST_SCHEMAS)[T]>;
}
