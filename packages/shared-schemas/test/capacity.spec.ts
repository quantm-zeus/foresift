/**
 * Sustainable Capacity, Budget Dimensions, Degradation, and Reconciliation schema tests (FR-COST-011…017).
 * Tests Zod mirrors, strict unknown-key refusals on all envelopes, refine constraints,
 * registry v2 bump, and G0 regression lock.
 */
import { describe, expect, it } from 'bun:test';
// @ts-expect-error - Domain vocabularies pending in parallel wave (T001)
import { ALL_ATTRIBUTION_UNIT_KINDS, ALL_BUDGET_DIMENSIONS, ALL_CONTRACT_RESULTS, ALL_DEGRADATION_STEPS, ALL_PROVIDER_MODES, ALL_RECONCILIATION_BREACH_KINDS, ALL_RECONCILIATION_DIMENSIONS, ALL_RENDERED_SPEND_CLASSES, ALL_RESERVE_CLASSES } from '@foresift/domain';
// @ts-expect-error - Product schemas pending in parallel wave (T004)
import { AttributionUnitKindSchema, BorrowedReserveSchema, BudgetConsumptionTotalsSchema, BudgetDimensionSchema, BudgetPolicySchema, CapacityCandidateLoadSchema, CapacityProviderEnvelopeItemSchema, CapacitySystemEnvelopeSchema, ContractResultSchema, CostAttributionSchema, DegradationOrderStepSchema, DegradationPolicyRowSchema, DegradationStepSchema, ForecastReconciliationSchema, ProviderModeSchema, ReconciliationBreachKindSchema, ReconciliationDimensionSchema, RenderedSpendClassSchema, ReserveClassSchema, SustainableCapacityContractSchema } from '../src/capacity.ts';
import {
  COST_SCHEMAS,
  COST_SCHEMA_REGISTRY_VERSION,
  OperationCostDeclarationSchema,
  PaidProviderPolicySchema,
} from '../src/cost.ts';

const validRenderedClasses = {
  PAID_DATA_SPEND: 0,
  FREE_QUOTA_CONSUMPTION: 500,
  MODEL_SPEND: 12.5,
  INFRASTRUCTURE_SPEND: 5.0,
  STORAGE_EGRESS_SPEND: 2.1,
  NOTIFICATION_SPEND: 0.5,
  HUMAN_REVIEW_EFFORT: 0,
};

const validCandidateLoad = {
  newAssetsPerDayExpected: 50,
  newAssetsPerDayStress: 200,
  cheapMonitorRowsPerDay: 10000,
  promotedCandidatesPerDay: 15,
  activeRiskCandidatesPerDay: 40,
  highResolutionOutcomeCasesPerDay: 10,
  interactiveInvestigationsPerDay: 25,
};

const validProviderEnvelopeItem = {
  operationId: 'op_helius_das',
  callsExpected: 5000,
  callsStress: 20000,
  quotaUnitsExpected: 5000,
  quotaUnitsStress: 20000,
  streamedBytesExpected: 1048576,
  streamedBytesStress: 5242880,
  retryAllowance: 500,
  reserveClass: 'RISK_MONITORING',
};

const validSystemEnvelope = {
  modelInputTokens: 1000000,
  modelOutputTokens: 200000,
  modelSpendUsd: 15.5,
  workflowSteps: 50000,
  schedulerMessages: 100000,
  databaseReads: 250000,
  databaseWrites: 75000,
  databaseStorageBytes: 1073741824,
  objectOperations: 10000,
  objectStorageBytes: 5368709120,
  egressBytes: 2147483648,
  notificationSends: 5000,
  concurrency: 16,
};

const validSustainableCapacityContract = {
  contractId: 'cap_contract_v1_001',
  version: '1.0.0',
  scheduleRef: 'schedule_main_discovery_v1',
  profileRef: 'profile_full_scan_v1',
  horizonDays: 30,
  candidateLoad: validCandidateLoad,
  providerEnvelope: [validProviderEnvelopeItem],
  systemEnvelope: validSystemEnvelope,
  retryAllowance: 1000,
  protectedReserves: {
    RISK_MONITORING: 0.2,
    ALERT_VERIFICATION: 0.15,
    INTERACTIVE_MCP: 0.1,
    EMERGENCY_BACKFILL: 0.1,
    OUTCOME_COLLECTION: 0.1,
    SCHEDULED_CANDIDATE_VERIFICATION: 0.15,
    DEEP_RESEARCH: 0.1,
    FIRST_PARTY_COLLECTOR: 0.05,
    EXPLORATION_PROBES: 0.05,
  },
  minimumHeadroomFraction: 0.15,
  safetyMarginFraction: 0.1,
  degradationPolicyVersion: 'v1',
  verifiedAt: '2026-09-01T00:00:00.000Z',
  expiresAt: '2026-10-01T00:00:00.000Z',
  result: 'PASS',
};

describe('capacity domain vocabulary mirrors match domain constants', () => {
  const parity = [
    ['BudgetDimensionSchema', BudgetDimensionSchema, ALL_BUDGET_DIMENSIONS],
    ['ProviderModeSchema', ProviderModeSchema, ALL_PROVIDER_MODES],
    ['ReserveClassSchema', ReserveClassSchema, ALL_RESERVE_CLASSES],
    ['DegradationStepSchema', DegradationStepSchema, ALL_DEGRADATION_STEPS],
    ['ContractResultSchema', ContractResultSchema, ALL_CONTRACT_RESULTS],
    ['ReconciliationDimensionSchema', ReconciliationDimensionSchema, ALL_RECONCILIATION_DIMENSIONS],
    ['ReconciliationBreachKindSchema', ReconciliationBreachKindSchema, ALL_RECONCILIATION_BREACH_KINDS],
    ['AttributionUnitKindSchema', AttributionUnitKindSchema, ALL_ATTRIBUTION_UNIT_KINDS],
    ['RenderedSpendClassSchema', RenderedSpendClassSchema, ALL_RENDERED_SPEND_CLASSES],
  ] as const;

  for (const [name, schema, all] of parity) {
    it(`${name} accepts exactly the domain set`, () => {
      expect((schema as { options: unknown }).options).toEqual(all as never);
    });
  }
});

describe('BudgetPolicySchema accept/refuse laws (ADR-1, FR-COST-011)', () => {
  it('accepts valid DATA_PROVIDER policy with providerMode', () => {
    const valid = {
      policyId: 'pol_data_1',
      dimension: 'DATA_PROVIDER',
      providerMode: 'STRICT_FREE',
      capLimit: 1000,
      currencyOrUnit: 'USD',
      version: '1.0.0',
      active: true,
      activatedAt: '2026-09-01T00:00:00.000Z',
      supersededBy: null,
    };
    expect(BudgetPolicySchema.safeParse(valid).success).toBe(true);
  });

  it('accepts non-DATA_PROVIDER policy when providerMode is null or undefined', () => {
    const validModel = {
      policyId: 'pol_model_1',
      dimension: 'MODEL',
      providerMode: null,
      capLimit: 500,
      currencyOrUnit: 'USD',
      version: '1.0.0',
      active: true,
      activatedAt: '2026-09-01T00:00:00.000Z',
      supersededBy: null,
    };
    expect(BudgetPolicySchema.safeParse(validModel).success).toBe(true);
  });

  it('refuses providerMode on non-DATA_PROVIDER dimensions (refine gate)', () => {
    const invalidModel = {
      policyId: 'pol_model_bad',
      dimension: 'MODEL',
      providerMode: 'STRICT_FREE', // Forbidden on MODEL dimension!
      capLimit: 500,
      currencyOrUnit: 'USD',
      version: '1.0.0',
      active: true,
      activatedAt: '2026-09-01T00:00:00.000Z',
      supersededBy: null,
    };
    expect(BudgetPolicySchema.safeParse(invalidModel).success).toBe(false);
  });
});

describe('SustainableCapacityContractSchema strictness & envelope parsing (§62.5)', () => {
  it('parses valid SustainableCapacityContract successfully', () => {
    expect(SustainableCapacityContractSchema.safeParse(validSustainableCapacityContract).success).toBe(true);
  });

  it('refuses unknown keys on candidateLoad envelope', () => {
    const withUnknown = {
      ...validCandidateLoad,
      unknownKey: 123,
    };
    expect(CapacityCandidateLoadSchema.safeParse(withUnknown).success).toBe(false);
  });

  it('refuses unknown keys on providerEnvelope item', () => {
    const withUnknown = {
      ...validProviderEnvelopeItem,
      unknownKey: 123,
    };
    expect(CapacityProviderEnvelopeItemSchema.safeParse(withUnknown).success).toBe(false);
  });

  it('refuses unknown keys on systemEnvelope (all 13 fields pinned)', () => {
    const withUnknown = {
      ...validSystemEnvelope,
      unknownKey: 123,
    };
    expect(CapacitySystemEnvelopeSchema.safeParse(withUnknown).success).toBe(false);
  });
});

describe('DegradationPolicyRowSchema and DegradationOrderStepSchema', () => {
  it('parses valid degradation policy and order step records', () => {
    const policy = {
      policyVersion: 'v1',
      activatedAt: '2026-09-01T00:00:00.000Z',
      retiredAt: null,
    };
    const step = {
      policyVersion: 'v1',
      stepIndex: 1,
      stepName: 'SKIP_ENRICHMENT_NOTEBOOK_ANALOG_COUNTERFACTUAL',
      protectedClass: null,
    };
    expect(DegradationPolicyRowSchema.safeParse(policy).success).toBe(true);
    expect(DegradationOrderStepSchema.safeParse(step).success).toBe(true);
  });
});

describe('ForecastReconciliationSchema refine laws (FR-COST-016)', () => {
  it('accepts reconciliation record without breach (both breachKind and incidentId are null)', () => {
    const noBreach = {
      reconciliationId: 'rec_001',
      contractId: 'cap_contract_v1_001',
      dimension: 'WORKLOAD',
      subjectId: 'workload_discovery',
      forecastValue: 1000,
      actualValue: 950,
      toleranceFraction: 0.1,
      breachKind: null,
      incidentId: null,
      reconciledAt: '2026-09-01T00:00:00.000Z',
    };
    expect(ForecastReconciliationSchema.safeParse(noBreach).success).toBe(true);
  });

  it('accepts reconciliation record with breach and matching incidentId', () => {
    const withBreach = {
      reconciliationId: 'rec_002',
      contractId: 'cap_contract_v1_001',
      dimension: 'OPERATION',
      subjectId: 'op_helius_das',
      forecastValue: 1000,
      actualValue: 1500,
      toleranceFraction: 0.1,
      breachKind: 'MATERIAL_UNDERESTIMATION',
      incidentId: 'inc_forecast_123',
      reconciledAt: '2026-09-01T00:00:00.000Z',
    };
    expect(ForecastReconciliationSchema.safeParse(withBreach).success).toBe(true);
  });

  it('refuses breachKind without incidentId (symmetry refine)', () => {
    const asymmetric1 = {
      reconciliationId: 'rec_003',
      contractId: 'cap_contract_v1_001',
      dimension: 'OPERATION',
      subjectId: 'op_helius_das',
      forecastValue: 1000,
      actualValue: 1500,
      toleranceFraction: 0.1,
      breachKind: 'MATERIAL_UNDERESTIMATION',
      incidentId: null, // Asymmetric!
      reconciledAt: '2026-09-01T00:00:00.000Z',
    };
    expect(ForecastReconciliationSchema.safeParse(asymmetric1).success).toBe(false);
  });

  it('refuses incidentId without breachKind (symmetry refine)', () => {
    const asymmetric2 = {
      reconciliationId: 'rec_004',
      contractId: 'cap_contract_v1_001',
      dimension: 'OPERATION',
      subjectId: 'op_helius_das',
      forecastValue: 1000,
      actualValue: 900,
      toleranceFraction: 0.1,
      breachKind: null,
      incidentId: 'inc_orphan', // Asymmetric!
      reconciledAt: '2026-09-01T00:00:00.000Z',
    };
    expect(ForecastReconciliationSchema.safeParse(asymmetric2).success).toBe(false);
  });
});

describe('CostAttributionSchema & BudgetConsumptionTotalsSchema 7-class pin (FR-COST-017, §62.12)', () => {
  it('accepts attribution carrying all 7 rendered spend classes', () => {
    const attribution = {
      attributionId: 'attr_001',
      contractId: 'cap_contract_v1_001',
      unitKind: 'RESEARCHED_CANDIDATE',
      subjectId: 'cand_sol_123',
      marginalCost: 0.05,
      totalCost: 20.1,
      renderedClasses: validRenderedClasses,
      attributedAt: '2026-09-01T00:00:00.000Z',
    };
    expect(CostAttributionSchema.safeParse(attribution).success).toBe(true);
  });

  it('refuses attribution missing one of the 7 rendered spend classes', () => {
    const incompleteClasses = { ...validRenderedClasses };
    delete (incompleteClasses as Record<string, unknown>).HUMAN_REVIEW_EFFORT;

    const attribution = {
      attributionId: 'attr_002',
      contractId: 'cap_contract_v1_001',
      unitKind: 'RESEARCHED_CANDIDATE',
      subjectId: 'cand_sol_123',
      marginalCost: 0.05,
      totalCost: 20.1,
      renderedClasses: incompleteClasses,
      attributedAt: '2026-09-01T00:00:00.000Z',
    };
    expect(CostAttributionSchema.safeParse(attribution).success).toBe(false);
  });

  it('accepts BudgetConsumptionTotals carrying all 7 rendered spend classes', () => {
    const consumption = {
      dimension: 'DATA_PROVIDER',
      periodWindowStart: '2026-09-01T00:00:00.000Z',
      periodResetAt: '2026-09-02T00:00:00.000Z',
      capLimit: 1000,
      consumed: 250,
      renderedClasses: validRenderedClasses,
    };
    expect(BudgetConsumptionTotalsSchema.safeParse(consumption).success).toBe(true);
  });
});

describe('BorrowedReserveSchema refine laws (§62.4)', () => {
  it('accepts borrowing when borrowedByClass is distinct from reserveClass', () => {
    const borrow = {
      borrowId: 'borrow_001',
      contractId: 'cap_contract_v1_001',
      reserveClass: 'RISK_MONITORING',
      borrowedByClass: 'ALERT_VERIFICATION',
      units: 100,
      policyVersion: 'v1',
      occurredAt: '2026-09-01T00:00:00.000Z',
    };
    expect(BorrowedReserveSchema.safeParse(borrow).success).toBe(true);
  });

  it('refuses borrowing when borrowedByClass === reserveClass (cannot borrow from oneself)', () => {
    const invalidBorrow = {
      borrowId: 'borrow_002',
      contractId: 'cap_contract_v1_001',
      reserveClass: 'RISK_MONITORING',
      borrowedByClass: 'RISK_MONITORING', // Same class!
      units: 100,
      policyVersion: 'v1',
      occurredAt: '2026-09-01T00:00:00.000Z',
    };
    expect(BorrowedReserveSchema.safeParse(invalidBorrow).success).toBe(false);
  });
});

describe('Cost schema registry version & G0 schema regression lock', () => {
  it('registry version is bumped to 2 for G1 additive schemas', () => {
    expect(COST_SCHEMA_REGISTRY_VERSION).toBe(2);
  });

  it('G0 schemas still parse successfully (regression lock)', () => {
    const validG0Op = {
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
    expect(OperationCostDeclarationSchema.safeParse(validG0Op).success).toBe(true);

    const validG0Policy = {
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
    expect(PaidProviderPolicySchema.safeParse(validG0Policy).success).toBe(true);
  });
});
