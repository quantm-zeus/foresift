/**
 * Quota forecast reconciliation and cost attribution unit tests (FR-COST-016, FR-COST-017, AC-229).
 * Tests:
 * - reconcileForecast writing to cost.forecast_reconciliations
 * - MATERIAL_UNDERESTIMATION and RESERVE_BREACH incident creation
 * - Limits recomputation and refusal of silent overage
 * - writeCostAttribution per operation/workload/candidate/run/module granularity
 */
import { describe, expect, it } from 'bun:test';
// @ts-expect-error - Product implementation pending in parallel wave (T015)
import { reconcileForecast, writeCostAttribution, type ForecastReconciliationRequest } from '../src/reconciliation.ts';
// @ts-expect-error - Domain vocabulary pending in parallel wave (T002)
import type { SustainableCapacityContract } from '@foresift/domain';

const mockContract: SustainableCapacityContract = {
  contractId: 'cap_contract_v1_001',
  version: '1.0.0',
  scheduleRef: 'sched_1',
  profileRef: 'prof_1',
  horizonDays: 30,
  candidateLoad: {
    newAssetsPerDayExpected: 50,
    newAssetsPerDayStress: 200,
    cheapMonitorRowsPerDay: 10000,
    promotedCandidatesPerDay: 15,
    activeRiskCandidatesPerDay: 40,
    highResolutionOutcomeCasesPerDay: 10,
    interactiveInvestigationsPerDay: 25,
  },
  providerEnvelope: [],
  systemEnvelope: {
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
  },
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
  verifiedAt: '2026-09-01T00:00:00Z',
  expiresAt: '2026-10-01T00:00:00Z',
  result: 'PASS',
};

describe('reconcileForecast (FR-COST-016, AC-229, plan ADR-6)', () => {
  it('returns no breach when actual usage is within forecast + tolerance', async () => {
    let recordedRow: Record<string, unknown> | null = null;
    const mockEngine = {
      query: async (_sql: string, params: unknown[]) => {
        recordedRow = { params };
        return { rows: [] };
      },
    } as never;

    const req: ForecastReconciliationRequest = {
      contract: mockContract,
      dimension: 'WORKLOAD',
      subjectId: 'workload_discovery',
      forecastValue: 1000,
      actualValue: 1050,
      toleranceFraction: 0.1, // 10% tolerance => threshold 1100
    };

    const result = await reconcileForecast(mockEngine, req);
    expect(result.breached).toBe(false);
    expect(result.incidentId).toBeNull();
    expect(result.breachKind).toBeNull();
    expect(recordedRow).toBeDefined();
  });

  it('creates incident and recomputes limits on MATERIAL_UNDERESTIMATION', async () => {
    let recordedRow: Record<string, unknown> | null = null;
    const mockEngine = {
      query: async (_sql: string, params: unknown[]) => {
        recordedRow = { params };
        return { rows: [] };
      },
    } as never;

    const req: ForecastReconciliationRequest = {
      contract: mockContract,
      dimension: 'OPERATION',
      subjectId: 'op_helius_das',
      forecastValue: 1000,
      actualValue: 1250, // Exceeds 1000 * 1.10 = 1100!
      toleranceFraction: 0.1,
    };

    const result = await reconcileForecast(mockEngine, req);
    expect(result.breached).toBe(true);
    expect(result.breachKind).toBe('MATERIAL_UNDERESTIMATION');
    expect(result.incidentId).toBeDefined();
    expect(result.incidentId?.startsWith('inc_')).toBe(true);
    expect(result.recomputedAdmissionLimits).toBeDefined();
    expect(result.silentOverageAllowed).toBe(false);
  });

  it('creates incident on RESERVE_BREACH when protected floor is crossed', async () => {
    const mockEngine = {
      query: async () => ({ rows: [] }),
    } as never;

    const req: ForecastReconciliationRequest = {
      contract: mockContract,
      dimension: 'MODULE',
      subjectId: 'module_risk_monitor',
      forecastValue: 1000,
      actualValue: 1050,
      toleranceFraction: 0.1,
      isReserveFloorBreached: true,
    };

    const result = await reconcileForecast(mockEngine, req);
    expect(result.breached).toBe(true);
    expect(result.breachKind).toBe('RESERVE_BREACH');
    expect(result.incidentId).toBeDefined();
  });
});

describe('writeCostAttribution (FR-COST-017)', () => {
  it('writes attribution record for RESEARCHED_CANDIDATE across all 7 spend classes', async () => {
    let insertedSql = '';
    const mockEngine = {
      query: async (sql: string) => {
        insertedSql = sql;
        return { rows: [] };
      },
    } as never;

    const completeClasses = {
      PAID_DATA_SPEND: 0,
      FREE_QUOTA_CONSUMPTION: 100,
      MODEL_SPEND: 1.5,
      INFRASTRUCTURE_SPEND: 0.5,
      STORAGE_EGRESS_SPEND: 0.1,
      NOTIFICATION_SPEND: 0.0,
      HUMAN_REVIEW_EFFORT: 0,
    };

    await writeCostAttribution(mockEngine, {
      contractId: 'cap_contract_v1_001',
      unitKind: 'RESEARCHED_CANDIDATE',
      subjectId: 'cand_sol_123',
      marginalCost: 0.05,
      totalCost: 2.1,
      renderedClasses: completeClasses,
    });

    expect(insertedSql).toContain('cost.cost_attributions');
  });
});
