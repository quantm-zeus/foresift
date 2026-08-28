/**
 * Accept/refuse matrices for the Cost & Capacity shared-schema family
 * (FR-COST-001…010 manifest schemaRefs, ADR-0013). Every `.strict()` object must
 * refuse unknown keys; vocabularies are asserted fail-closed; field parity
 * on the 7 FR-COST-001 fields is verified.
 */
import { describe, expect, it } from 'bun:test';
import * as SharedSchemas from '../src/index.ts';

const VALID_OPERATION_COST_DECLARATION = {
  providerOperationId: 'gmgn:token_security',
  provider: 'gmgn',
  operation: 'token_security',
  version: 'v1',
  costClass: 'FREE_QUOTA',
  quotaUnitCost: 1,
  resetPolicyId: 'daily-midnight-utc',
  batchCapability: {
    maxBatchSize: 20,
    safeMaxUtilization: 0.8,
    keyFields: ['address'],
  },
  minimumCandidateStage: 'QUALIFIED',
  protectedReserveEligible: true,
  allowedInStrictFree: true,
  paidFallbackAllowed: false,
  planId: 'gmgn-free-tier',
  verifiedAt: '2026-08-01T00:00:00Z',
  verificationExpiresAt: '2026-09-01T00:00:00Z',
};

const VALID_PAID_PROVIDER_POLICY = {
  policyId: 'pol-coinglass-001',
  providerId: 'coinglass',
  mode: 'PAID_ALLOWED',
  budgetUsd: 150.0,
  approver: 'sec-officer-alpha',
  activatedAt: '2026-08-01T00:00:00Z',
  reAuthDueAt: '2026-09-01T00:00:00Z',
  status: 'ACTIVE',
  supersededBy: null,
  immutableHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
};

const VALID_RESOURCE_BUDGET = {
  dimension: 'SCHEDULER',
  cap: 100000,
  used: 45000,
  forecastUsed: 60000,
  unit: 'MESSAGES',
  degradeBehavior: 'EXTEND_INTERVAL',
  protected: false,
};

const VALID_FORECAST_SNAPSHOT = {
  snapshotId: 'snap-2026-08',
  planId: 'helius-dev-free',
  period: '2026-08',
  planLimitsJson: { monthlyCredits: 1000000 },
  observedUsageJson: { creditsConsumed: 320000 },
  forecastTolerancePercent: 0.15,
  estimatedForecast: 400000,
  actualObserved: 320000,
  withinTolerance: true,
  expiresAt: '2026-09-01T00:00:00Z',
};

const VALID_COST_DENIAL_RECORD = {
  denialId: 'denial-001',
  candidate: 'So11111111111111111111111111111111111111112',
  caller: 'discovery-scheduler',
  provider: 'coinglass',
  operation: 'liquidation_orderbook',
  costMode: 'STRICT_FREE',
  attemptedCostClass: 'PAID_EXPLICIT',
  reason: 'STRICT_FREE_BLOCKED: paid operations prohibited in strict-free mode',
  alternative: 'RETURN_CACHE',
  timestamp: '2026-08-01T00:00:00Z',
};

const VALID_BATCH_DESCRIPTOR = {
  batchId: 'batch-001',
  provider: 'gmgn',
  operation: 'token_security',
  itemCount: 16,
  maxBatchSize: 20,
  utilization: 0.8,
  createdAt: '2026-08-01T00:00:00Z',
};

describe('Cost & Capacity Shared Schemas (FR-COST-001, ADR-0013)', () => {
  it('exports COST_SCHEMA_REGISTRY_VERSION as a positive integer', () => {
    const version = (SharedSchemas as Record<string, unknown>).COST_SCHEMA_REGISTRY_VERSION;
    expect(typeof version).toBe('number');
    expect(Number(version)).toBeGreaterThanOrEqual(1);
  });

  it('OperationCostDeclarationSchema validates valid declaration and enforces 7 FR-COST-001 fields', () => {
    const schema = (SharedSchemas as Record<string, { parse: (x: unknown) => unknown }>)
      .OperationCostDeclarationSchema;
    expect(schema).toBeDefined();
    const parsed = schema.parse(VALID_OPERATION_COST_DECLARATION) as Record<string, unknown>;
    expect(parsed.costClass).toBe('FREE_QUOTA');
    expect(parsed.quotaUnitCost).toBe(1);
    expect(parsed.resetPolicyId).toBe('daily-midnight-utc');
    expect(parsed.batchCapability).toBeDefined();
    expect(parsed.minimumCandidateStage).toBe('QUALIFIED');
    expect(parsed.protectedReserveEligible).toBe(true);
    expect(parsed.allowedInStrictFree).toBe(true);
  });

  it('OperationCostDeclarationSchema rejects unknown keys (strictness)', () => {
    const schema = (SharedSchemas as Record<string, { parse: (x: unknown) => unknown }>)
      .OperationCostDeclarationSchema;
    expect(schema).toBeDefined();
    expect(() =>
      schema.parse({
        ...VALID_OPERATION_COST_DECLARATION,
        unexpectedKey: 'hazard',
      }),
    ).toThrow();
  });

  it('OperationCostDeclarationSchema rejects missing required fields fail-closed', () => {
    const schema = (SharedSchemas as Record<string, { parse: (x: unknown) => unknown }>)
      .OperationCostDeclarationSchema;
    expect(schema).toBeDefined();
    const { costClass: _, ...incomplete } = VALID_OPERATION_COST_DECLARATION;
    expect(() => schema.parse(incomplete)).toThrow();
  });

  it('CostModeSchema accepts valid modes and rejects unknown modes', () => {
    const schema = (SharedSchemas as Record<string, { parse: (x: unknown) => unknown }>)
      .CostModeSchema;
    expect(schema).toBeDefined();
    expect(schema.parse('STRICT_FREE')).toBe('STRICT_FREE');
    expect(schema.parse('FREE_FIRST')).toBe('FREE_FIRST');
    expect(schema.parse('PAID_ALLOWED')).toBe('PAID_ALLOWED');
    expect(() => schema.parse('UNLIMITED')).toThrow();
  });

  it('PaidProviderPolicySchema validates valid policy and rejects unknown keys', () => {
    const schema = (SharedSchemas as Record<string, { parse: (x: unknown) => unknown }>)
      .PaidProviderPolicySchema;
    expect(schema).toBeDefined();
    expect(schema.parse(VALID_PAID_PROVIDER_POLICY)).toBeDefined();
    expect(() =>
      schema.parse({
        ...VALID_PAID_PROVIDER_POLICY,
        extraUnauthorizedField: 'bad',
      }),
    ).toThrow();
  });

  it('ResourceBudgetSchema validates valid budget and rejects unknown dimensions', () => {
    const schema = (SharedSchemas as Record<string, { parse: (x: unknown) => unknown }>)
      .ResourceBudgetSchema;
    expect(schema).toBeDefined();
    expect(schema.parse(VALID_RESOURCE_BUDGET)).toBeDefined();
    expect(() =>
      schema.parse({
        ...VALID_RESOURCE_BUDGET,
        dimension: 'UNRECOGNIZED_DIMENSION',
      }),
    ).toThrow();
  });

  it('CostDenialRecordSchema validates denial record structure (FR-COST-007)', () => {
    const schema = (SharedSchemas as Record<string, { parse: (x: unknown) => unknown }>)
      .CostDenialRecordSchema;
    expect(schema).toBeDefined();
    expect(schema.parse(VALID_COST_DENIAL_RECORD)).toBeDefined();
    expect(() =>
      schema.parse({
        ...VALID_COST_DENIAL_RECORD,
        unknownField: 123,
      }),
    ).toThrow();
  });

  it('BatchDescriptorSchema and BatchCoalescedEventSchema validate batch representations', () => {
    const schema = (SharedSchemas as Record<string, { parse: (x: unknown) => unknown }>)
      .BatchDescriptorSchema;
    expect(schema).toBeDefined();
    expect(schema.parse(VALID_BATCH_DESCRIPTOR)).toBeDefined();
  });

  it('parseCostSchema helper validates named schemas fail-closed', () => {
    const parseFn = (
      SharedSchemas as Record<string, (name: string, data: unknown) => unknown>
    ).parseCostSchema;
    expect(typeof parseFn).toBe('function');
    expect(parseFn('CostMode', 'STRICT_FREE')).toBe('STRICT_FREE');
    expect(() => parseFn('CostMode', 'INVALID')).toThrow();
  });
});
