/**
 * Whole-configuration admission control unit tests (FR-COST-012, FR-COST-014, AC-103, AC-227, PRD §62.6).
 * Aligned to the landed T012 product API (1850119): admitConfiguration(contract,
 * resolvedConfig, usage, options) returns a typed AdmissionVerdict
 * (ADMIT | REDUCE{nextStep} | REJECT{reason}) — the six §62.6 block conditions
 * surface as typed reasons across the verdicts.
 */
import { describe, expect, it } from 'bun:test';
import {
  admitConfiguration,
  AdmissionBlockReason,
  type ConfigurationUsage,
  type ResolvedCapacityConfiguration,
} from '../src/admission.ts';
import { DEFAULT_POLICY_V1 } from '@foresift/domain';
import type { SustainableCapacityContract } from '@foresift/domain';

const baseUsage: ConfigurationUsage = {
  creditsUsed: 0,
  streamBytesUsed: 0,
  modelTokensUsed: 0,
  workflowStepsUsed: 0,
  dbGrowthBytesUsed: 0,
  objectStorageBytesUsed: 0,
  egressBytesUsed: 0,
  retriesUsed: 0,
  notificationsUsed: 0,
  reserveUnitsUsed: 0,
};

const resolvedConfig: ResolvedCapacityConfiguration = {
  scheduleRef: 'schedule_main_discovery_v1',
  profileRef: 'profile_full_scan_v1',
};

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
    expiresAt: '2027-10-01T00:00:00Z',
    result: 'PASS',
    ...overrides,
  };
}

describe('admitConfiguration outcome evaluation (FR-COST-014, §62.6)', () => {
  it('returns ADMIT when configuration and replay stay within all ceilings', () => {
    const contract = makeBaseContract();
    const verdict = admitConfiguration(contract, resolvedConfig, baseUsage, {
      at: new Date('2026-09-08T00:00:00Z'),
    });
    expect(verdict.decision).toBe('ADMIT');
    expect(verdict.contractId).toBe('cap_contract_v1_001');
  });

  it('blocks activation when contract result is FAIL or UNVERIFIED (FR-COST-012)', () => {
    const failVerdict = admitConfiguration(
      makeBaseContract({ result: 'FAIL' }),
      resolvedConfig,
      baseUsage,
    );
    expect(failVerdict.decision).toBe('REJECT');

    const unverifiedVerdict = admitConfiguration(
      makeBaseContract({ result: 'UNVERIFIED' }),
      resolvedConfig,
      baseUsage,
    );
    expect(unverifiedVerdict.decision).toBe('REJECT');
  });

  it('rejects without any active contract (additive law: only the G0 planner path runs bare)', () => {
    const verdict = admitConfiguration(null, resolvedConfig, baseUsage);
    expect(verdict.decision).toBe('REJECT');
    expect(verdict.contractId).toBeNull();
  });
});

describe('The Six §62.6 Block Conditions as typed reasons', () => {
  it('1. surfaces STRESS_LIMIT_EXCEEDED when stress usage surpasses provider capacity', () => {
    const contract = makeBaseContract();
    const verdict = admitConfiguration(contract, resolvedConfig, {
      ...baseUsage,
      workflowStepsUsed: 60000, // stress replay exceeds the 50000-step ceiling
      stress: { workflowStepsUsed: 60000 },
    });
    expect(['REJECT', 'REDUCE']).toContain(verdict.decision);
    if (verdict.decision === 'REJECT') {
      expect(verdict.reason).toBe(AdmissionBlockReason.STRESS_LIMIT_EXCEEDED);
    } else {
      expect(verdict.reason).toBe(AdmissionBlockReason.STRESS_LIMIT_EXCEEDED);
    }
  });

  it('4. rejects with PLAN_EXPIRES_WITHIN_HORIZON when the contract already expired', () => {
    const contract = makeBaseContract({
      verifiedAt: '2026-08-01T00:00:00Z',
      expiresAt: '2026-09-01T00:00:00Z', // already past the evaluation instant
    });
    const verdict = admitConfiguration(contract, resolvedConfig, baseUsage, {
      at: new Date('2026-09-08T00:00:00Z'),
    });
    expect(verdict.decision).toBe('REJECT');
    expect(verdict.reason).toBe(AdmissionBlockReason.PLAN_EXPIRES_WITHIN_HORIZON);
  });

  it('4b. reduces (or rejects without a step) when the contract expires within the 30-day horizon (AC-103)', () => {
    const contract = makeBaseContract({
      verifiedAt: '2026-09-01T00:00:00Z',
      expiresAt: '2026-09-20T00:00:00Z', // 12 days out, inside the 30-day horizon
    });
    const verdict = admitConfiguration(contract, resolvedConfig, baseUsage, {
      at: new Date('2026-09-08T00:00:00Z'),
      degradationOrder: DEFAULT_POLICY_V1,
    });
    // A reducible verdict is the §62.6 safe fallback; without a step it rejects.
    expect(['REDUCE', 'REJECT']).toContain(verdict.decision);
    expect(verdict.reason).toBe(AdmissionBlockReason.PLAN_EXPIRES_WITHIN_HORIZON);
  });

  it('6. rejects with CRITICAL_STARVED when the protected reserve floor would be consumed', () => {
    const contract = makeBaseContract();
    // Floor = floor(50000 workflowSteps * 0.15) = 7500 units. Reserve
    // consumption crosses the floor AND pushes the replay past a ceiling so
    // the starved branch (never reducible) evaluates.
    const verdict = admitConfiguration(contract, resolvedConfig, {
      ...baseUsage,
      reserveUnitsUsed: 7500,
      modelTokensUsed: 2_000_000, // beyond the 1.2M declared envelope → replay exceeds
      stress: { modelTokensUsed: 2_000_000 },
    });
    expect(verdict.decision).toBe('REJECT');
    expect(verdict.reason).toBe(AdmissionBlockReason.CRITICAL_STARVED);
  });
});

describe('REDUCE step resolution on non-critical pressure', () => {
  it('proposes the FIRST non-protected §62.8 step when pressure is reducible', () => {
    const contract = makeBaseContract();
    const verdict = admitConfiguration(
      contract,
      resolvedConfig,
      {
        ...baseUsage,
        modelTokensUsed: 10_000_000, // far beyond the declared envelope → replay exceeds
        stress: { modelTokensUsed: 10_000_000 },
      },
      { degradationOrder: DEFAULT_POLICY_V1 },
    );
    expect(verdict.decision).toBe('REDUCE');
    if (verdict.decision === 'REDUCE') {
      expect(typeof verdict.nextStep).toBe('string');
      expect(verdict.nextStep.length).toBeGreaterThan(0);
    }
  });
});
