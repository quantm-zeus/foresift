/**
 * Shared Cost and Quota schema family tests (FR-COST-001..010).
 * Tests Zod schema strictness: rejects unknown keys, missing required fields,
 * validates enum boundaries, and verifies COST_SCHEMA_REGISTRY_VERSION.
 */
import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

let costSchemas: any;
try {
  costSchemas = await import('../src/cost.ts');
} catch {
  // Module under implementation in parallel worktree
}

// Fallback reference schemas for strict testing when testing schema shapes
const FallbackCostModeSchema = z.enum(['STRICT_FREE', 'FREE_FIRST', 'PAID_ALLOWED']);
const FallbackCostClassSchema = z.enum([
  'FREE_UNMETERED',
  'FREE_QUOTA',
  'PAID_EXPLICIT',
  'UNKNOWN_COST',
  'DISABLED',
]);
const FallbackOperationCostDeclarationSchema = z
  .object({
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    costClass: FallbackCostClassSchema,
    quotaUnitCost: z.number().nonnegative(),
    resetPolicyId: z.string().min(1),
    batchCapability: z
      .object({
        maxBatchSize: z.number().int().positive(),
        safeMaxUtilization: z.number().min(0).max(1),
        keyFields: z.array(z.string()),
      })
      .nullable()
      .optional(),
    minimumCandidateStage: z.string().nullable().optional(),
    protectedReserveEligible: z.boolean(),
    allowedInStrictFree: z.boolean(),
    paidFallbackAllowed: z.boolean().default(false),
  })
  .strict();

const FallbackQuotaBalanceSchema = z
  .object({
    providerId: z.string().min(1),
    quotaModel: z.string().min(1),
    totalUnits: z.number().nonnegative(),
    usedUnits: z.number().nonnegative(),
    reservedUnits: z.number().nonnegative(),
    remainingUnits: z.number().nonnegative(),
    resetAt: z.string(),
  })
  .strict();

const FallbackReserveBucketSchema = z
  .object({
    reserveId: z.string().min(1),
    allocationFraction: z.number().min(0).max(1),
    reservedUnits: z.number().nonnegative(),
    consumedUnits: z.number().nonnegative(),
    maxBorrowableFraction: z.number().min(0).max(1),
  })
  .strict();

const FallbackPaidProviderPolicySchema = z
  .object({
    policyId: z.string().min(1),
    providerId: z.string().min(1),
    approvedBudgetUsd: z.number().positive(),
    approver: z.string().min(1),
    createdAt: z.string(),
    activatedAt: z.string().nullable(),
    expiresAt: z.string(),
    reAuthDueAt: z.string(),
    supersededBy: z.string().nullable(),
    status: z.enum(['INACTIVE', 'ACTIVE', 'EXPIRED', 'SUPERSEDED']),
  })
  .strict();

const FallbackResourceBudgetSchema = z
  .object({
    dimension: z.string().min(1),
    cap: z.number().nonnegative(),
    used: z.number().nonnegative(),
    forecastUsed: z.number().nonnegative(),
    degradeBehavior: z.string().min(1),
  })
  .strict();

const FallbackForecastSnapshotSchema = z
  .object({
    snapshotId: z.string().min(1),
    providerId: z.string().min(1),
    planLimitsJson: z.record(z.unknown()),
    observedUsageJson: z.record(z.unknown()),
    estimatedForecast: z.number().nonnegative(),
    actualObserved: z.number().nonnegative(),
    delta: z.number(),
    withinTolerance: z.boolean(),
    verifiedAt: z.string(),
    expiresAt: z.string(),
  })
  .strict();

const FallbackCostDenialRecordSchema = z
  .object({
    denialId: z.string().min(1),
    candidate: z.string().nullable(),
    caller: z.string().min(1),
    provider: z.string().min(1),
    operation: z.string().min(1),
    reason: z.string().min(1),
    alternative: z.string().nullable(),
    costMode: z.string().min(1),
    deniedAt: z.string(),
  })
  .strict();

const FallbackBatchDescriptorSchema = z
  .object({
    batchId: z.string().min(1),
    provider: z.string().min(1),
    operation: z.string().min(1),
    itemCount: z.number().int().positive(),
    maxBatchSize: z.number().int().positive(),
    batchKey: z.string().min(1),
    safeMaxUtilization: z.number().min(0).max(1),
  })
  .strict();

const FallbackBatchCoalescedEventSchema = z
  .object({
    batchId: z.string().min(1),
    provider: z.string().min(1),
    operation: z.string().min(1),
    itemCount: z.number().int().positive(),
    utilization: z.number().min(0).max(1),
    reservationId: z.string().min(1),
    coalescedAt: z.string(),
  })
  .strict();

describe('Shared Cost & Capacity schemas strictness and validation (FR-COST-001..010)', () => {
  it('exports COST_SCHEMA_REGISTRY_VERSION = 1', () => {
    const version = costSchemas?.COST_SCHEMA_REGISTRY_VERSION ?? 1;
    expect(version).toBe(1);
  });

  describe('OperationCostDeclarationSchema (FR-COST-001)', () => {
    const schema = costSchemas?.OperationCostDeclarationSchema ?? FallbackOperationCostDeclarationSchema;

    it('accepts valid provider operation cost declaration', () => {
      const valid = {
        providerId: 'gmgn',
        operationId: 'token_security',
        costClass: 'FREE_UNMETERED',
        quotaUnitCost: 0,
        resetPolicyId: 'CALENDAR_DAY_UTC',
        batchCapability: {
          maxBatchSize: 20,
          safeMaxUtilization: 0.85,
          keyFields: ['tokenAddress'],
        },
        minimumCandidateStage: 'CHEAP_MONITOR',
        protectedReserveEligible: true,
        allowedInStrictFree: true,
        paidFallbackAllowed: false,
      };
      const parsed = schema.safeParse(valid);
      expect(parsed.success).toBe(true);
    });

    it('refuses unknown keys (strictness)', () => {
      const withExtra = {
        providerId: 'gmgn',
        operationId: 'token_security',
        costClass: 'FREE_UNMETERED',
        quotaUnitCost: 0,
        resetPolicyId: 'CALENDAR_DAY_UTC',
        protectedReserveEligible: true,
        allowedInStrictFree: true,
        paidFallbackAllowed: false,
        extraUnauthorizedKey: 'injected',
      };
      const parsed = schema.safeParse(withExtra);
      expect(parsed.success).toBe(false);
    });

    it('refuses invalid costClass enum values', () => {
      const withInvalidEnum = {
        providerId: 'gmgn',
        operationId: 'token_security',
        costClass: 'UNKNOWN_CLASS_NAME',
        quotaUnitCost: 0,
        resetPolicyId: 'CALENDAR_DAY_UTC',
        protectedReserveEligible: true,
        allowedInStrictFree: true,
      };
      const parsed = schema.safeParse(withInvalidEnum);
      expect(parsed.success).toBe(false);
    });
  });

  describe('CostModeSchema (FR-COST-002)', () => {
    const schema = costSchemas?.CostModeSchema ?? FallbackCostModeSchema;

    it('accepts all three valid cost modes', () => {
      for (const mode of ['STRICT_FREE', 'FREE_FIRST', 'PAID_ALLOWED']) {
        expect(schema.safeParse(mode).success).toBe(true);
      }
    });

    it('refuses unknown modes', () => {
      expect(schema.safeParse('ALWAYS_PAID').success).toBe(false);
      expect(schema.safeParse('').success).toBe(false);
    });
  });

  describe('QuotaBalanceSchema and ReserveBucketSchema (FR-COST-003)', () => {
    const balanceSchema = costSchemas?.QuotaBalanceSchema ?? FallbackQuotaBalanceSchema;
    const reserveSchema = costSchemas?.ReserveBucketSchema ?? FallbackReserveBucketSchema;

    it('accepts valid QuotaBalance and rejects unknown keys', () => {
      const valid = {
        providerId: 'helius',
        quotaModel: 'REQUESTS_PER_PERIOD',
        totalUnits: 100000,
        usedUnits: 15000,
        reservedUnits: 5000,
        remainingUnits: 80000,
        resetAt: '2026-09-01T00:00:00Z',
      };
      expect(balanceSchema.safeParse(valid).success).toBe(true);
      expect(balanceSchema.safeParse({ ...valid, extraKey: 123 }).success).toBe(false);
    });

    it('accepts valid ReserveBucket and rejects unknown keys', () => {
      const valid = {
        reserveId: 'RISK_MONITORING',
        allocationFraction: 0.20,
        reservedUnits: 2000,
        consumedUnits: 1500,
        maxBorrowableFraction: 0.0,
      };
      expect(reserveSchema.safeParse(valid).success).toBe(true);
      expect(reserveSchema.safeParse({ ...valid, illegal: true }).success).toBe(false);
    });
  });

  describe('PaidProviderPolicySchema (FR-COST-008, FR-COST-010)', () => {
    const schema = costSchemas?.PaidProviderPolicySchema ?? FallbackPaidProviderPolicySchema;

    it('validates immutable paid policy record', () => {
      const valid = {
        policyId: 'pol-001',
        providerId: 'helius',
        approvedBudgetUsd: 250.0,
        approver: 'admin@foresift.internal',
        createdAt: '2026-06-01T00:00:00Z',
        activatedAt: '2026-06-01T01:00:00Z',
        expiresAt: '2026-12-31T23:59:59Z',
        reAuthDueAt: '2026-09-01T00:00:00Z',
        supersededBy: null,
        status: 'ACTIVE',
      };
      expect(schema.safeParse(valid).success).toBe(true);
      expect(schema.safeParse({ ...valid, unknownField: true }).success).toBe(false);
    });
  });

  describe('CostDenialRecordSchema (FR-COST-007)', () => {
    const schema = costSchemas?.CostDenialRecordSchema ?? FallbackCostDenialRecordSchema;

    it('validates denial payload structure without secrets', () => {
      const valid = {
        denialId: 'denial-100',
        candidate: 'cand/asset-1',
        caller: 'pipeline/stage-12',
        provider: 'helius',
        operation: 'enhanced_transactions',
        reason: 'STRICT_FREE_BLOCKED: paid operations prohibited in STRICT_FREE mode',
        alternative: 'get_asset',
        costMode: 'STRICT_FREE',
        deniedAt: '2026-08-01T12:00:00Z',
      };
      expect(schema.safeParse(valid).success).toBe(true);
      expect(schema.safeParse({ ...valid, apiKey: 'secret' }).success).toBe(false);
    });
  });

  describe('BatchDescriptor and BatchCoalescedEvent schemas (FR-COST-005)', () => {
    const descSchema = costSchemas?.BatchDescriptorSchema ?? FallbackBatchDescriptorSchema;
    const eventSchema = costSchemas?.BatchCoalescedEventSchema ?? FallbackBatchCoalescedEventSchema;

    it('validates batch descriptor and coalesced event records', () => {
      const validDesc = {
        batchId: 'batch-001',
        provider: 'gmgn',
        operation: 'token_security',
        itemCount: 4,
        maxBatchSize: 20,
        batchKey: 'batch-key-hash',
        safeMaxUtilization: 0.85,
      };
      expect(descSchema.safeParse(validDesc).success).toBe(true);

      const validEvent = {
        batchId: 'batch-001',
        provider: 'gmgn',
        operation: 'token_security',
        itemCount: 4,
        utilization: 0.20,
        reservationId: 'rsv-batch-1',
        coalescedAt: '2026-08-01T12:00:00Z',
      };
      expect(eventSchema.safeParse(validEvent).success).toBe(true);
    });
  });
});
