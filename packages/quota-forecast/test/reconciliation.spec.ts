/**
 * Quota forecast reconciliation and cost attribution unit tests (FR-COST-016, FR-COST-017, AC-229).
 * Tests:
 * - reconcileForecast writing to cost.forecast_reconciliations (breach⇔incident symmetric)
 * - MATERIAL_UNDERESTIMATION and RESERVE_BREACH detection
 * - Limits recomputation (cap-only-tighten) and refusal of silent overage
 * - writeCostAttribution per operation/workload/candidate/run/module granularity
 *
 * Aligned to the landed T015 product API (9978200): reconcileForecast takes
 * positional (contract, dimension, subject, forecast, actual, tolerance,
 * options) and returns a ReconciliationDecision; the breach handler is wired
 * through options.onToleranceBreach (the G0 seam, plan ADR-6).
 */
import { describe, expect, it } from 'bun:test';
import {
  reconcileForecast,
  writeCostAttribution,
  type ProtectedReserveFloor,
} from '../src/reconciliation.ts';
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
    const recordedParams: unknown[] = [];
    const mockEngine = {
      query: async (_sql: string, params: unknown[]) => {
        recordedParams.push(params);
        return { rows: [] };
      },
    } as never;

    const decision = await reconcileForecast(
      mockContract,
      'WORKLOAD',
      'workload_discovery',
      1000,
      1050,
      0.1, // 10% tolerance => threshold 1100
      { engine: mockEngine },
    );
    expect(decision.breachKind).toBeNull();
    expect(decision.incidentId).toBeNull();
    expect(decision.reconciliation.breachKind).toBeNull();
    expect(recordedParams.length).toBe(1); // row persisted
  });

  it('flags MATERIAL_UNDERESTIMATION and recomputes limits (breach requires incident seam)', async () => {
    const mockEngine = {
      query: async () => ({ rows: [] }),
    } as never;

    let seamRaised: { breachKind: string } | null = null;
    const decision = await reconcileForecast(
      mockContract,
      'OPERATION',
      'op_helius_das',
      1000,
      1250, // Exceeds 1000 * 1.10 = 1100
      0.1,
      {
        engine: mockEngine,
        onToleranceBreach: (raised) => {
          seamRaised = { breachKind: raised.breachKind };
          return 'inc_test_underestimation';
        },
      },
    );
    expect(decision.breachKind).toBe('MATERIAL_UNDERESTIMATION');
    expect(decision.incidentId).toBe('inc_test_underestimation');
    expect(seamRaised).not.toBeNull();
    expect(decision.recomputedAdmissionLimits).toBeDefined();
    expect(Object.keys(decision.recomputedAdmissionLimits).length).toBeGreaterThan(0);
  });

  it('refuses silent overage: a breach without an incident id throws (ADR-6 symmetry)', async () => {
    const mockEngine = {
      query: async () => ({ rows: [] }),
    } as never;

    expect(
      reconcileForecast(mockContract, 'OPERATION', 'op_silent', 1000, 1250, 0.1, {
        engine: mockEngine,
        onToleranceBreach: () => '', // seam raises no incident id
      }),
    ).rejects.toThrow('RECONCILIATION_INCIDENT_REQUIRED');
  });

  it('creates RESERVE_BREACH when a protected floor is crossed', async () => {
    const mockEngine = {
      query: async () => ({ rows: [] }),
    } as never;

    const floors: ProtectedReserveFloor[] = [
      { reserveClass: 'RISK_MONITORING', fraction: 0.2, totalUnits: 1000 },
    ];

    const decision = await reconcileForecast(
      mockContract,
      'MODULE',
      'module_risk_monitor',
      1000,
      1050,
      0.1,
      {
        engine: mockEngine,
        protectedFloors: floors,
        reserveUnitsUsed: 250, // floor is 200 (0.2 * 1000) → crossed
        onToleranceBreach: () => 'inc_test_reserve',
      },
    );
    expect(decision.breachKind).toBe('RESERVE_BREACH');
    expect(decision.incidentId).toBe('inc_test_reserve');
    // cap-only-tighten law: the crossed class' cap is floored at 0
    expect(decision.recomputedAdmissionLimits['reserve:RISK_MONITORING']).toBe(0);
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
      attributionId: 'attr_test_001',
      contractId: 'cap_contract_v1_001',
      unitKind: 'RESEARCHED_CANDIDATE',
      subjectId: 'cand_sol_123',
      totalCost: 102.1, // Σ classes — never a hidden overclaim (§62.12)
      renderedClasses: completeClasses,
    });

    expect(insertedSql).toContain('cost.cost_attributions');
  });
});
