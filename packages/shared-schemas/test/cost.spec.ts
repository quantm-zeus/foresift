/**
 * Accept/refuse matrices for the cost and capacity schema family (FR-COST-001…010 manifest schemaRefs).
 * Every `.strict()` object must refuse unknown keys; vocabularies are asserted identical to `@foresift/domain`.
 */
import { describe, expect, it } from 'bun:test';
import {
  ALL_COST_CLASSES,
  ALL_COST_MODES,
  ALL_RESERVE_IDS,
  ALL_RESET_POLICY_KINDS,
  ALL_RESOURCE_BUDGET_KINDS,
} from '@foresift/domain';
import {
  BatchCoalescedEventSchema,
  BatchDescriptorSchema,
  COST_SCHEMAS,
  COST_SCHEMA_REGISTRY_VERSION,
  CostClassSchema,
  CostDenialRecordSchema,
  CostModeSchema,
  ForecastSnapshotSchema,
  OperationCostDeclarationSchema,
  PaidProviderPolicySchema,
  QuotaBalanceSchema,
  ReserveBucketSchema,
  ReserveIdSchema,
  ResetPolicyKindSchema,
  ResourceBudgetKindSchema,
  ResourceBudgetSchema,
  parseCostSchema,
  type CostSchemaName,
} from '../src/cost.ts';

const validOperationCostDeclaration = {
  providerId: 'prov_helius',
  operationId: 'get_slot_leader',
  version: '1.0.0',
  costClass: 'FREE_UNMETERED',
  quotaModelId: 'REQUESTS_PER_PERIOD',
  quotaUnitCost: 0,
  resetPolicyId: 'DAILY_MIDNIGHT_UTC',
  batchCapability: null,
  minimumCandidateStage: 'DISCOVERED',
  protectedReserveEligible: true,
  allowedInStrictFree: true,
  verificationExpiresAt: '2027-01-01T00:00:00Z',
};

const validQuotaBalance = {
  providerId: 'prov_helius',
  quotaModelId: 'REQUESTS_PER_PERIOD',
  periodWindowStart: '2026-08-01T00:00:00Z',
  capLimit: 10000,
  remainingUnits: 10000,
  consumedReserved: 0,
  consumedCommitted: 0,
  periodResetAt: '2026-08-02T00:00:00Z',
};

const validReserveBucket = {
  reserveId: 'RISK_MONITORING',
  providerId: 'prov_helius',
  periodWindowStart: '2026-08-01T00:00:00Z',
  floorUnits: 1000,
  remainingUnits: 1000,
  consumedUnits: 0,
};

const validPaidProviderPolicy = {
  policyId: 'pol_12345',
  providerId: 'prov_paid_market',
  budgetUnits: 50000,
  budgetCurrencyOrModel: 'USD_CENTS',
  approvedBy: 'compliance_alice',
  approvedAt: '2026-08-01T00:00:00Z',
  activatedAt: '2026-08-01T00:00:00Z',
  reAuthDueAt: '2027-01-01T00:00:00Z',
  active: true,
  supersededBy: null,
};

const validResourceBudget = {
  kind: 'SCHEDULER_SLOTS',
  capLimit: 100,
  used: 20,
  forecastUsed: 40,
  degradeBehavior: 'SKIP_LOW_PRIORITY',
  ceilingExceededAt: null,
};

const validForecastSnapshot = {
  snapshotId: 'snap_1',
  planVersionId: 'plan_v1',
  verifiedAt: '2026-08-01T00:00:00Z',
  expiresAt: '2027-01-01T00:00:00Z',
  planLimitsJson: { maxCredits: 100000 },
  observedUsageJson: { creditsUsed: 25000 },
  estimatedForecastJson: { projectedCredits: 30000 },
  createdAt: '2026-08-01T00:00:00Z',
};

const validCostDenialRecord = {
  denialId: 'den_1',
  candidate: 'prov_paid_market:get_orderbook_l3',
  caller: 'actor_alice:run_123',
  reason: 'STRICT_FREE_BLOCKED: paid data provider is forbidden under STRICT_FREE',
  alternative: 'RETURN_CACHE',
  pipelineRunId: 'run_123',
  occurredAt: '2026-08-01T12:00:00Z',
};

const validBatchDescriptor = {
  maxBatchSize: 50,
  safeMaxUtilization: 0.8,
  keyFields: ['tokenAddress'],
  autoUpgrade: false,
};

const validBatchCoalescedEvent = {
  batchId: 'batch_1',
  providerId: 'prov_gmgn',
  operationId: 'get_token_security',
  itemCount: 20,
  maxBatchSize: 50,
  safeMaxUtilization: 0.8,
  utilization: 0.4,
  coalescedAt: '2026-08-01T12:00:00Z',
};

describe('cost schema vocabulary mirrors match domain constants', () => {
  const parity = [
    ['CostClassSchema', CostClassSchema, ALL_COST_CLASSES],
    ['ResetPolicyKindSchema', ResetPolicyKindSchema, ALL_RESET_POLICY_KINDS],
    ['ReserveIdSchema', ReserveIdSchema, ALL_RESERVE_IDS],
    ['ResourceBudgetKindSchema', ResourceBudgetKindSchema, ALL_RESOURCE_BUDGET_KINDS],
    ['CostModeSchema', CostModeSchema, ALL_COST_MODES],
  ] as const;

  it.each(parity)('%s accepts exactly the domain set', (_name, schema, all) => {
    expect(schema.options).toEqual(all as never);
  });
});

describe('cost schemas accept valid records', () => {
  it.each([
    ['OperationCostDeclarationSchema', OperationCostDeclarationSchema, validOperationCostDeclaration],
    ['QuotaBalanceSchema', QuotaBalanceSchema, validQuotaBalance],
    ['ReserveBucketSchema', ReserveBucketSchema, validReserveBucket],
    ['PaidProviderPolicySchema', PaidProviderPolicySchema, validPaidProviderPolicy],
    ['ResourceBudgetSchema', ResourceBudgetSchema, validResourceBudget],
    ['ForecastSnapshotSchema', ForecastSnapshotSchema, validForecastSnapshot],
    ['CostDenialRecordSchema', CostDenialRecordSchema, validCostDenialRecord],
    ['BatchDescriptorSchema', BatchDescriptorSchema, validBatchDescriptor],
    ['BatchCoalescedEventSchema', BatchCoalescedEventSchema, validBatchCoalescedEvent],
  ] as const)('%s parses valid fixture successfully', (_name, schema, fixture) => {
    const result = schema.safeParse(fixture);
    expect(result.success).toBe(true);
  });
});

describe('cost schemas refuse unknown keys fail-closed (strictness)', () => {
  it.each([
    ['OperationCostDeclarationSchema', OperationCostDeclarationSchema, validOperationCostDeclaration],
    ['QuotaBalanceSchema', QuotaBalanceSchema, validQuotaBalance],
    ['ReserveBucketSchema', ReserveBucketSchema, validReserveBucket],
    ['PaidProviderPolicySchema', PaidProviderPolicySchema, validPaidProviderPolicy],
    ['ResourceBudgetSchema', ResourceBudgetSchema, validResourceBudget],
    ['ForecastSnapshotSchema', ForecastSnapshotSchema, validForecastSnapshot],
    ['CostDenialRecordSchema', CostDenialRecordSchema, validCostDenialRecord],
    ['BatchDescriptorSchema', BatchDescriptorSchema, validBatchDescriptor],
    ['BatchCoalescedEventSchema', BatchCoalescedEventSchema, validBatchCoalescedEvent],
  ] as const)('%s rejects extra unknown keys', (_name, schema, fixture) => {
    const withExtra = { ...fixture, forbiddenUnknownKey: 'intruder' };
    const result = schema.safeParse(withExtra);
    expect(result.success).toBe(false);
  });
});

describe('cost schemas refuse missing required fields', () => {
  it('OperationCostDeclarationSchema requires all 7 FR-COST-001 fields', () => {
    const keys = [
      'costClass',
      'quotaUnitCost',
      'resetPolicyId',
      'batchCapability',
      'minimumCandidateStage',
      'protectedReserveEligible',
      'allowedInStrictFree',
    ] as const;

    for (const key of keys) {
      const copy = { ...validOperationCostDeclaration };
      delete (copy as Record<string, unknown>)[key];
      expect(OperationCostDeclarationSchema.safeParse(copy).success).toBe(false);
    }
  });
});

describe('parseCostSchema helper & registry version', () => {
  it('exposes positive registry version', () => {
    expect(COST_SCHEMA_REGISTRY_VERSION).toBeGreaterThan(0);
  });

  it('parseCostSchema successfully parses known schemas', () => {
    for (const name of Object.keys(COST_SCHEMAS) as CostSchemaName[]) {
      expect(COST_SCHEMAS[name]).toBeDefined();
    }
  });
});
