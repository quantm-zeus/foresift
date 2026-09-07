/**
 * Sustainable Capacity Contract test fixtures (PRD §62.4, §62.5, FR-COST-012, FR-COST-013, AC-227).
 * Provides PASS/FAIL/UNVERIFIED contract fixtures, horizon-30 vectors,
 * reserve fraction vectors (sum <= 1 and §62.4 defaults), borrowing pairs, and stress envelopes.
 */
import type { SustainableCapacityContract } from '@foresift/domain';

export const DEFAULT_9_CLASS_RESERVES = {
  RISK_MONITORING: 0.2,
  ALERT_VERIFICATION: 0.15,
  INTERACTIVE_MCP: 0.1,
  EMERGENCY_BACKFILL: 0.1,
  OUTCOME_COLLECTION: 0.1,
  SCHEDULED_CANDIDATE_VERIFICATION: 0.15,
  DEEP_RESEARCH: 0.1,
  FIRST_PARTY_COLLECTOR: 0.05,
  EXPLORATION_PROBES: 0.05,
} as const;

export const STANDARD_CANDIDATE_LOAD = {
  newAssetsPerDayExpected: 50,
  newAssetsPerDayStress: 200,
  cheapMonitorRowsPerDay: 10000,
  promotedCandidatesPerDay: 15,
  activeRiskCandidatesPerDay: 40,
  highResolutionOutcomeCasesPerDay: 10,
  interactiveInvestigationsPerDay: 25,
} as const;

export const STANDARD_SYSTEM_ENVELOPE = {
  modelInputTokens: 1000000,
  modelOutputTokens: 200000,
  modelSpendUsd: 15.5,
  workflowSteps: 50000,
  schedulerMessages: 100000,
  databaseReads: 250000,
  databaseWrites: 75000,
  databaseStorageBytes: 1073741824, // 1GB
  objectOperations: 10000,
  objectStorageBytes: 5368709120, // 5GB
  egressBytes: 2147483648, // 2GB
  notificationSends: 5000,
  concurrency: 16,
} as const;

export const VALID_CAPACITY_CONTRACT_PASS: SustainableCapacityContract = {
  contractId: 'cap_contract_pass_001',
  version: '1.0.0',
  scheduleRef: 'schedule_main_discovery_v1',
  profileRef: 'profile_full_scan_v1',
  horizonDays: 30,
  candidateLoad: STANDARD_CANDIDATE_LOAD,
  providerEnvelope: [
    {
      operationId: 'op_helius_das',
      callsExpected: 5000,
      callsStress: 20000,
      quotaUnitsExpected: 5000,
      quotaUnitsStress: 20000,
      streamedBytesExpected: 1048576,
      streamedBytesStress: 5242880,
      retryAllowance: 500,
      reserveClass: 'RISK_MONITORING',
    },
    {
      operationId: 'op_birdeye_trades',
      callsExpected: 2000,
      callsStress: 8000,
      quotaUnitsExpected: 2000,
      quotaUnitsStress: 8000,
      retryAllowance: 200,
      reserveClass: 'ALERT_VERIFICATION',
    },
  ],
  systemEnvelope: STANDARD_SYSTEM_ENVELOPE,
  retryAllowance: 1000,
  protectedReserves: DEFAULT_9_CLASS_RESERVES,
  minimumHeadroomFraction: 0.15,
  safetyMarginFraction: 0.1,
  degradationPolicyVersion: 'v1',
  verifiedAt: '2026-09-01T00:00:00.000Z',
  expiresAt: '2026-10-01T00:00:00.000Z',
  result: 'PASS',
};

export const CAPACITY_CONTRACT_FAIL: SustainableCapacityContract = {
  ...VALID_CAPACITY_CONTRACT_PASS,
  contractId: 'cap_contract_fail_001',
  result: 'FAIL',
};

export const CAPACITY_CONTRACT_UNVERIFIED: SustainableCapacityContract = {
  ...VALID_CAPACITY_CONTRACT_PASS,
  contractId: 'cap_contract_unverified_001',
  result: 'UNVERIFIED',
};

export const HORIZON_30_BOUNDARY_CONTRACT: SustainableCapacityContract = {
  ...VALID_CAPACITY_CONTRACT_PASS,
  contractId: 'cap_contract_boundary_30d',
  horizonDays: 30,
};

export const BORROWING_PAIRS_FIXTURES = [
  {
    borrowId: 'borrow_risk_from_alert',
    contractId: 'cap_contract_pass_001',
    reserveClass: 'RISK_MONITORING',
    borrowedByClass: 'ALERT_VERIFICATION',
    units: 100,
    policyVersion: 'v1',
  },
  {
    borrowId: 'borrow_backfill_from_collector',
    contractId: 'cap_contract_pass_001',
    reserveClass: 'EMERGENCY_BACKFILL',
    borrowedByClass: 'FIRST_PARTY_COLLECTOR',
    units: 250,
    policyVersion: 'v1',
  },
] as const;

export const PROTECTED_CLASS_EXHAUSTION_FIXTURES = {
  RISK_MONITORING_EXHAUSTED: {
    ...DEFAULT_9_CLASS_RESERVES,
    RISK_MONITORING: 0,
  },
  ALERT_VERIFICATION_EXHAUSTED: {
    ...DEFAULT_9_CLASS_RESERVES,
    ALERT_VERIFICATION: 0,
  },
};
