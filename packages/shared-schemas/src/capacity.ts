/**
 * Zod mirrors for the G1 capacity-governance contracts (PRD §62.2, §62.4, §62.5,
 * §62.8, §62.9, §62.12 — FR-COST-011, FR-COST-012, FR-COST-013, FR-COST-016,
 * FR-COST-017). Where a vocabulary exists in `@foresift/domain`
 * (packages/domain/src/capacity.ts) it is imported, never restated — budget
 * dimensions, provider modes, reserve classes, degradation steps, contract
 * results, reconciliation dimensions/breach kinds, attribution unit kinds, and
 * rendered spend classes are compile-linked so domain drift fails to compile.
 *
 * Every envelope object is `.strict()` (unknown keys refused) so the JSONB
 * contract groups persisted per plan ADR-3 cannot smuggle undeclared fields.
 * The §62.12 rendered-spend-class surfaces pin all seven classes — a 6-class
 * composition is refused, never rendered as "zero total cost" (AC-105).
 */
import { z } from 'zod';
import {
  ALL_ATTRIBUTION_UNIT_KINDS,
  ALL_BUDGET_DIMENSIONS,
  ALL_CONTRACT_RESULTS,
  ALL_DEGRADATION_STEPS,
  ALL_PROVIDER_MODES,
  ALL_RECONCILIATION_BREACH_KINDS,
  ALL_RECONCILIATION_DIMENSIONS,
  ALL_RENDERED_SPEND_CLASSES,
  ALL_RESERVE_CLASSES,
} from '@foresift/domain';
import { UtcTimestampSchema } from './data.ts';

function domainEnum<T extends string>(values: readonly T[]) {
  return z.enum([...values] as [T, ...T[]]);
}

// ---------------------------------------------------------------------------
// Domain-mirrored closed vocabularies (compile-linked, never restated)
// ---------------------------------------------------------------------------

export const BudgetDimensionSchema = domainEnum(ALL_BUDGET_DIMENSIONS);
export const ProviderModeSchema = domainEnum(ALL_PROVIDER_MODES);
export const ReserveClassSchema = domainEnum(ALL_RESERVE_CLASSES);
export const DegradationStepSchema = domainEnum(ALL_DEGRADATION_STEPS);
export const ContractResultSchema = domainEnum(ALL_CONTRACT_RESULTS);
export const ReconciliationDimensionSchema = domainEnum(ALL_RECONCILIATION_DIMENSIONS);
export const ReconciliationBreachKindSchema = domainEnum(ALL_RECONCILIATION_BREACH_KINDS);
export const AttributionUnitKindSchema = domainEnum(ALL_ATTRIBUTION_UNIT_KINDS);
export const RenderedSpendClassSchema = domainEnum(ALL_RENDERED_SPEND_CLASSES);

/** All seven §62.12 rendered spend classes, each a non-negative number. */
export const RenderedSpendClassesSchema = z
  .object({
    PAID_DATA_SPEND: z.number().nonnegative(),
    FREE_QUOTA_CONSUMPTION: z.number().nonnegative(),
    MODEL_SPEND: z.number().nonnegative(),
    INFRASTRUCTURE_SPEND: z.number().nonnegative(),
    STORAGE_EGRESS_SPEND: z.number().nonnegative(),
    NOTIFICATION_SPEND: z.number().nonnegative(),
    HUMAN_REVIEW_EFFORT: z.number().nonnegative(),
  })
  .strict();
export type RenderedSpendClasses = z.infer<typeof RenderedSpendClassesSchema>;

// ---------------------------------------------------------------------------
// Budget policies (FR-COST-011, §62.2, plan ADR-1)
// ---------------------------------------------------------------------------

/**
 * A per-dimension budget policy row. `providerMode` exists ONLY on the
 * DATA_PROVIDER dimension (plan ADR-1): the refine refuses a provider mode on
 * any other dimension and the SQL CHECK mirrors the same law.
 */
export const BudgetPolicySchema = z
  .object({
    policyId: z.string().min(1),
    dimension: BudgetDimensionSchema,
    providerMode: ProviderModeSchema.nullable(),
    capLimit: z.number().nonnegative(),
    currencyOrUnit: z.string().min(1),
    version: z.string().min(1),
    active: z.boolean(),
    activatedAt: UtcTimestampSchema.nullable(),
    supersededBy: z.string().min(1).nullable(),
  })
  .strict()
  .refine((v) => v.providerMode === null || v.providerMode === undefined || v.dimension === 'DATA_PROVIDER', {
    message: 'providerMode is only assignable to the DATA_PROVIDER dimension',
  });
export type BudgetPolicy = z.infer<typeof BudgetPolicySchema>;

/** Per-dimension consumption actuals; `renderedClasses` carries all 7 §62.12 classes. */
export const BudgetConsumptionTotalsSchema = z
  .object({
    dimension: BudgetDimensionSchema,
    periodWindowStart: UtcTimestampSchema,
    periodResetAt: UtcTimestampSchema,
    capLimit: z.number().nonnegative(),
    consumed: z.number().nonnegative(),
    renderedClasses: RenderedSpendClassesSchema,
  })
  .strict()
  .refine((v) => Date.parse(v.periodResetAt) > Date.parse(v.periodWindowStart), {
    message: 'periodResetAt must follow periodWindowStart',
  });
export type BudgetConsumptionTotals = z.infer<typeof BudgetConsumptionTotalsSchema>;

// ---------------------------------------------------------------------------
// Sustainable Capacity Contract (FR-COST-012, FR-COST-013, §62.5 exact, ADR-3)
// ---------------------------------------------------------------------------

const MIN_HORIZON_DAYS = 30;

export const CapacityCandidateLoadSchema = z
  .object({
    newAssetsPerDayExpected: z.number(),
    newAssetsPerDayStress: z.number(),
    cheapMonitorRowsPerDay: z.number().nonnegative(),
    promotedCandidatesPerDay: z.number().nonnegative(),
    activeRiskCandidatesPerDay: z.number().nonnegative(),
    highResolutionOutcomeCasesPerDay: z.number().nonnegative(),
    interactiveInvestigationsPerDay: z.number().nonnegative(),
  })
  .strict()
  .refine((v) => v.newAssetsPerDayStress >= v.newAssetsPerDayExpected, {
    message: 'stress load must be >= expected load',
  });
export type CapacityCandidateLoad = z.infer<typeof CapacityCandidateLoadSchema>;

export const CapacityProviderEnvelopeItemSchema = z
  .object({
    operationId: z.string().min(1),
    callsExpected: z.number(),
    callsStress: z.number(),
    quotaUnitsExpected: z.number(),
    quotaUnitsStress: z.number(),
    streamedBytesExpected: z.number().nonnegative().optional(),
    streamedBytesStress: z.number().nonnegative().optional(),
    retryAllowance: z.number().nonnegative(),
    reserveClass: ReserveClassSchema.optional(),
  })
  .strict()
  .refine((v) => v.callsStress >= v.callsExpected && v.quotaUnitsStress >= v.quotaUnitsExpected, {
    message: 'stress must be >= expected on calls and quota units',
  })
  .refine(
    (v) => (v.streamedBytesStress ?? 0) >= (v.streamedBytesExpected ?? 0),
    { message: 'streamedBytesStress must be >= streamedBytesExpected' },
  );
export type CapacityProviderEnvelopeItem = z.infer<typeof CapacityProviderEnvelopeItemSchema>;

/** All 13 declared system quantities (FR-COST-013; `concurrency` included per ADR-3). */
export const CapacitySystemEnvelopeSchema = z
  .object({
    modelInputTokens: z.number().nonnegative(),
    modelOutputTokens: z.number().nonnegative(),
    modelSpendUsd: z.number().nonnegative(),
    workflowSteps: z.number().nonnegative(),
    schedulerMessages: z.number().nonnegative(),
    databaseReads: z.number().nonnegative(),
    databaseWrites: z.number().nonnegative(),
    databaseStorageBytes: z.number().nonnegative(),
    objectOperations: z.number().nonnegative(),
    objectStorageBytes: z.number().nonnegative(),
    egressBytes: z.number().nonnegative(),
    notificationSends: z.number().nonnegative(),
    concurrency: z.number().nonnegative(),
  })
  .strict();
export type CapacitySystemEnvelope = z.infer<typeof CapacitySystemEnvelopeSchema>;

/** §62.4 protected reserve fractions keyed by ReserveClass; partial maps allowed, sum ≤ 1. */
const FRACTION_SUM_EPSILON = 1e-9;
const ProtectedReservesSchema = z
  .record(ReserveClassSchema, z.number().min(0).max(1))
  .superRefine((reserves, ctx) => {
    const sum = Object.values(reserves).reduce((acc, v) => acc + v, 0);
    if (sum > 1 + FRACTION_SUM_EPSILON) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'protected reserve fractions must sum to <= 1',
      });
    }
  });

/**
 * The §62.5 Sustainable Capacity Contract, transcribed field-for-field.
 * Strict at every level so the persisted JSONB envelope groups (ADR-3) carry
 * exactly the declared fields and nothing else.
 */
export const SustainableCapacityContractSchema = z
  .object({
    contractId: z.string().min(1),
    version: z.string().min(1),
    scheduleRef: z.string().min(1),
    profileRef: z.string().min(1),
    horizonDays: z.number().int().min(MIN_HORIZON_DAYS),
    candidateLoad: CapacityCandidateLoadSchema,
    providerEnvelope: z.array(CapacityProviderEnvelopeItemSchema),
    systemEnvelope: CapacitySystemEnvelopeSchema,
    retryAllowance: z.number().nonnegative(),
    protectedReserves: ProtectedReservesSchema,
    minimumHeadroomFraction: z.number().min(0).max(1),
    safetyMarginFraction: z.number().min(0).max(1),
    degradationPolicyVersion: z.string().min(1),
    verifiedAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema,
    result: ContractResultSchema,
  })
  .strict()
  .refine((v) => Date.parse(v.expiresAt) > Date.parse(v.verifiedAt), {
    message: 'expiresAt must follow verifiedAt',
  });
export type SustainableCapacityContractPayload = z.infer<typeof SustainableCapacityContractSchema>;

// ---------------------------------------------------------------------------
// Degradation policies (FR-COST-015, §62.8, ADR-4)
// ---------------------------------------------------------------------------

export const DegradationPolicyRowSchema = z
  .object({
    policyVersion: z.string().min(1),
    activatedAt: UtcTimestampSchema,
    retiredAt: UtcTimestampSchema.nullable(),
  })
  .strict();
export type DegradationPolicyRow = z.infer<typeof DegradationPolicyRowSchema>;

export const DegradationOrderStepSchema = z
  .object({
    policyVersion: z.string().min(1),
    stepIndex: z.number().int().min(1),
    stepName: DegradationStepSchema,
    protectedClass: ReserveClassSchema.nullable(),
  })
  .strict();
export type DegradationOrderStep = z.infer<typeof DegradationOrderStepSchema>;

// ---------------------------------------------------------------------------
// Forecast reconciliation (FR-COST-016, §62.9/62.11, ADR-6)
// ---------------------------------------------------------------------------

/**
 * A reconciliation row. The breach⇔incident symmetry refine mirrors the SQL
 * CHECK `(breach_kind IS NULL) = (incident_id IS NULL)`: an incident id exists
 * iff a breach kind was recorded, never one without the other.
 */
export const ForecastReconciliationSchema = z
  .object({
    reconciliationId: z.string().min(1),
    contractId: z.string().min(1),
    dimension: ReconciliationDimensionSchema,
    subjectId: z.string().min(1),
    forecastValue: z.number().nonnegative(),
    actualValue: z.number().nonnegative(),
    toleranceFraction: z.number().nonnegative(),
    breachKind: ReconciliationBreachKindSchema.nullable(),
    incidentId: z.string().min(1).nullable(),
    reconciledAt: UtcTimestampSchema,
  })
  .strict()
  .refine((v) => (v.breachKind === null) === (v.incidentId === null), {
    message: 'breachKind and incidentId must be set together or not at all',
  });
export type ForecastReconciliation = z.infer<typeof ForecastReconciliationSchema>;

// ---------------------------------------------------------------------------
// Cost attribution (FR-COST-017, §62.9/62.12) and reserve borrowing (§62.4)
// ---------------------------------------------------------------------------

/**
 * A marginal/total cost attribution row. `renderedClasses` is pinned to ALL
 * seven §62.12 classes — a 6-class composition is refused so "zero total
 * cost" can never be claimed while any class is positive (AC-105, §62.12).
 */
export const CostAttributionSchema = z
  .object({
    attributionId: z.string().min(1),
    contractId: z.string().min(1),
    unitKind: AttributionUnitKindSchema,
    subjectId: z.string().min(1),
    marginalCost: z.number().nonnegative(),
    totalCost: z.number().nonnegative(),
    renderedClasses: RenderedSpendClassesSchema,
    attributedAt: UtcTimestampSchema,
  })
  .strict();
export type CostAttribution = z.infer<typeof CostAttributionSchema>;

/** A §62.4 reserve borrowing record; a class can never "borrow" from itself. */
export const BorrowedReserveSchema = z
  .object({
    borrowId: z.string().min(1),
    contractId: z.string().min(1),
    reserveClass: ReserveClassSchema,
    borrowedByClass: ReserveClassSchema,
    units: z.number().positive(),
    policyVersion: z.string().min(1),
    occurredAt: UtcTimestampSchema.optional(),
  })
  .strict()
  .refine((v) => v.borrowedByClass !== v.reserveClass, {
    message: 'borrowedByClass must differ from reserveClass',
  });
export type BorrowedReserve = z.infer<typeof BorrowedReserveSchema>;
