/**
 * Admission control unit tests (FR-COST-012, FR-COST-014, AC-103, AC-227, PRD §62.6).
 * Tests whole-configuration forecasting before activation:
 * - ADMIT on valid compliant contract & usage
 * - REDUCE(nextStep) on recoverable quota pressure
 * - REJECT(reason) on the six §62.6 block conditions:
 *   1. STRESS_LIMIT_EXCEEDED
 *   2. HEADROOM_NOT_PRESERVED
 *   3. PROTECTED_RESERVE_EXHAUSTIBLE
 *   4. PLAN_EXPIRES_WITHIN_HORIZON
 *   5. STORAGE_EGRESS_RETENTION_EXCEEDED
 *   6. CRITICAL_STARVED
 * - Activation refused without active PASS contract
 */
import { describe, expect, it } from 'bun:test';
import {
  admitConfiguration,
  AdmissionBlockReason,
  type AdmissionRequest,
} from '../src/admission.ts';
import type { SustainableCapacityContract } from '@foresift/domain';

function makeBaseContract(
  overrides: Partial<SustainableCapacityContract> = {},
): SustainableCapacityContract {
  return {
    contractId: 'cap_contract_v1_001',
    version: '1.0.0',
    scheduleRef: 'schedule_main_discovery_v1',
    profileRef: 'profile_full_scan_v1',
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
    providerEnvelope: [
      {
        operationId: 'op_helius_das',
        callsExpected: 5000,
        callsStress: 20000,
        quotaUnitsExpected: 5000,
        quotaUnitsStress: 20000,
        retryAllowance: 500,
        reserveClass: 'RISK_MONITORING',
      },
    ],
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
    ...overrides,
  };
}

describe('admitConfiguration outcome evaluation (FR-COST-014, §62.6)', () => {
  it('returns ADMIT when configuration and forecast stay within all ceilings', () => {
    const contract = makeBaseContract();
    const req: AdmissionRequest = {
      contract,
      resolvedConfig: { concurrency: 8, scheduleIntervalSeconds: 60 },
      observedUsage: { callsUsed: 2000, quotaUsed: 2000 },
      planExpiry: '2027-01-01T00:00:00Z',
    };

    const verdict = admitConfiguration(req);
    expect(verdict.outcome).toBe('ADMIT');
  });

  it('blocks activation when contract result is FAIL or UNVERIFIED (FR-COST-012)', () => {
    const failContract = makeBaseContract({ result: 'FAIL' });
    const unverifiedContract = makeBaseContract({ result: 'UNVERIFIED' });

    const failVerdict = admitConfiguration({
      contract: failContract,
      resolvedConfig: {},
      observedUsage: {},
    });
    expect(failVerdict.outcome).toBe('REJECT');

    const unverifiedVerdict = admitConfiguration({
      contract: unverifiedContract,
      resolvedConfig: {},
      observedUsage: {},
    });
    expect(unverifiedVerdict.outcome).toBe('REJECT');
  });

  describe('The Six §62.6 Block Conditions as typed reasons', () => {
    it('1. rejects with STRESS_LIMIT_EXCEEDED when stress usage surpasses provider capacity', () => {
      const contract = makeBaseContract();
      const verdict = admitConfiguration({
        contract,
        resolvedConfig: {},
        observedUsage: { callsStressProjected: 50000 }, // Surpasses 20000 limit
      });

      expect(verdict.outcome).toBe('REJECT');
      expect(verdict.reason).toBe(AdmissionBlockReason.STRESS_LIMIT_EXCEEDED);
    });

    it('2. rejects with HEADROOM_NOT_PRESERVED when remaining headroom < minimumHeadroomFraction', () => {
      const contract = makeBaseContract({ minimumHeadroomFraction: 0.2 });
      const verdict = admitConfiguration({
        contract,
        resolvedConfig: {},
        observedUsage: { projectedUtilization: 0.9 }, // Headroom is only 0.10, below 0.20
      });

      expect(verdict.outcome).toBe('REJECT');
      expect(verdict.reason).toBe(AdmissionBlockReason.HEADROOM_NOT_PRESERVED);
    });

    it('3. rejects with PROTECTED_RESERVE_EXHAUSTIBLE when reserve balance is insufficient', () => {
      const contract = makeBaseContract();
      const verdict = admitConfiguration({
        contract,
        resolvedConfig: {},
        observedUsage: { reserveBalance: { RISK_MONITORING: 0 } },
      });

      expect(verdict.outcome).toBe('REJECT');
      expect(verdict.reason).toBe(AdmissionBlockReason.PROTECTED_RESERVE_EXHAUSTIBLE);
    });

    it('4. rejects with PLAN_EXPIRES_WITHIN_HORIZON when plan expires before contract horizon (AC-103)', () => {
      const contract = makeBaseContract({
        verifiedAt: '2026-09-01T00:00:00Z',
        expiresAt: '2026-10-01T00:00:00Z',
      });
      const verdict = admitConfiguration({
        contract,
        resolvedConfig: {},
        observedUsage: {},
        planExpiry: '2026-09-15T00:00:00Z', // Expires in 14 days, within 30-day horizon!
      });

      expect(verdict.outcome).toBe('REJECT');
      expect(verdict.reason).toBe(AdmissionBlockReason.PLAN_EXPIRES_WITHIN_HORIZON);
    });

    it('5. rejects with STORAGE_EGRESS_RETENTION_EXCEEDED when storage growth violates retention', () => {
      const contract = makeBaseContract();
      const verdict = admitConfiguration({
        contract,
        resolvedConfig: {},
        observedUsage: { projectedObjectStorageBytes: 10737418240 }, // Exceeds 5GB
      });

      expect(verdict.outcome).toBe('REJECT');
      expect(verdict.reason).toBe(AdmissionBlockReason.STORAGE_EGRESS_RETENTION_EXCEEDED);
    });

    it('6. rejects with CRITICAL_STARVED when critical obligations cannot be met', () => {
      const contract = makeBaseContract();
      const verdict = admitConfiguration({
        contract,
        resolvedConfig: {},
        observedUsage: { criticalObligationsSatisfiable: false },
      });

      expect(verdict.outcome).toBe('REJECT');
      expect(verdict.reason).toBe(AdmissionBlockReason.CRITICAL_STARVED);
    });
  });

  describe('REDUCE step resolution on non-critical pressure', () => {
    it('returns REDUCE with next degradation step when non-critical pressure is detected', () => {
      const contract = makeBaseContract();
      const verdict = admitConfiguration({
        contract,
        resolvedConfig: {},
        observedUsage: { nonCriticalPressure: true, activeDegradationSteps: [] },
      });

      expect(verdict.outcome).toBe('REDUCE');
      expect(verdict.nextStep).toBe('SKIP_ENRICHMENT_NOTEBOOK_ANALOG_COUNTERFACTUAL');
    });
  });
});
