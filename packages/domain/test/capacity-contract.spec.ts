/**
 * Sustainable Capacity Contract domain validation unit tests (FR-COST-012, FR-COST-013, AC-227).
 * Tests validation laws for SustainableCapacityContract per PRD §62.4 and §62.5:
 * - 30-day horizon law (horizonDays >= 30)
 * - Protected reserve fractions sum <= 1
 * - Stress >= expected load sanity
 * - ReserveClass validation (9-member vocabulary)
 * - Expiration timing (expiresAt > verifiedAt)
 * - Headroom & safety bounds ([0, 1])
 * - Non-negative envelope fields (all 13 systemEnvelope quantities)
 */
import { describe, expect, it } from 'bun:test';
import {
  isContractActivatable,
  type SustainableCapacityContract,
  validateSustainableCapacityContract,
} from '../src/capacity-contract.ts';
import { ForesiftError } from '../src/errors.ts';

function makeValidContract(
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
        operationId: 'op_helius_das_asset',
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
    systemEnvelope: {
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
    verifiedAt: '2026-09-01T00:00:00.000Z',
    expiresAt: '2026-10-01T00:00:00.000Z',
    result: 'PASS',
    ...overrides,
  };
}

describe('SustainableCapacityContract validation (FR-COST-012, FR-COST-013, AC-227)', () => {
  it('validates a conformant SustainableCapacityContract successfully', () => {
    const valid = makeValidContract();
    expect(validateSustainableCapacityContract(valid)).toEqual(valid);
  });

  describe('30-day horizon law (FR-COST-012)', () => {
    it('admits horizonDays >= 30', () => {
      const contract30 = makeValidContract({ horizonDays: 30 });
      const contract60 = makeValidContract({ horizonDays: 60 });
      expect(validateSustainableCapacityContract(contract30).horizonDays).toBe(30);
      expect(validateSustainableCapacityContract(contract60).horizonDays).toBe(60);
    });

    it('refuses horizonDays < 30 fail-closed', () => {
      const contract29 = makeValidContract({ horizonDays: 29 });
      const contract0 = makeValidContract({ horizonDays: 0 });
      const contractNeg = makeValidContract({ horizonDays: -5 });

      expect(() => validateSustainableCapacityContract(contract29)).toThrow(ForesiftError);
      expect(() => validateSustainableCapacityContract(contract0)).toThrow(ForesiftError);
      expect(() => validateSustainableCapacityContract(contractNeg)).toThrow(ForesiftError);
    });
  });

  describe('protected reserve fraction sum <= 1 law (§62.4)', () => {
    it('admits default 9-class reserve fractions summing exactly to 1.0', () => {
      const valid = makeValidContract();
      expect(validateSustainableCapacityContract(valid)).toBeDefined();
    });

    it('admits reserve fractions summing to less than 1.0', () => {
      const partialReserves = makeValidContract({
        protectedReserves: {
          RISK_MONITORING: 0.2,
          ALERT_VERIFICATION: 0.15,
        },
      });
      expect(validateSustainableCapacityContract(partialReserves)).toBeDefined();
    });

    it('refuses reserve fractions summing to more than 1.0 fail-closed', () => {
      const overAllocated = makeValidContract({
        protectedReserves: {
          RISK_MONITORING: 0.5,
          ALERT_VERIFICATION: 0.4,
          INTERACTIVE_MCP: 0.2, // Total: 1.1
        },
      });
      expect(() => validateSustainableCapacityContract(overAllocated)).toThrow(ForesiftError);
    });

    it('refuses negative reserve fractions', () => {
      const negativeFraction = makeValidContract({
        protectedReserves: {
          RISK_MONITORING: -0.1,
          ALERT_VERIFICATION: 0.2,
        },
      });
      expect(() => validateSustainableCapacityContract(negativeFraction)).toThrow(ForesiftError);
    });

    it('refuses unknown reserve classes in protectedReserves map', () => {
      const unknownReserve = makeValidContract({
        protectedReserves: {
          UNKNOWN_RESERVE_CLASS: 0.1,
        } as never,
      });
      expect(() => validateSustainableCapacityContract(unknownReserve)).toThrow(ForesiftError);
    });
  });

  describe('stress >= expected load sanity law', () => {
    it('refuses when candidateLoad stress < expected', () => {
      const invalidCandidateLoad = makeValidContract({
        candidateLoad: {
          ...makeValidContract().candidateLoad,
          newAssetsPerDayExpected: 100,
          newAssetsPerDayStress: 50, // Stress < expected!
        },
      });
      expect(() => validateSustainableCapacityContract(invalidCandidateLoad)).toThrow(
        ForesiftError,
      );
    });

    it('refuses when providerEnvelope callsStress < callsExpected', () => {
      const invalidCalls = makeValidContract({
        providerEnvelope: [
          {
            operationId: 'op_test',
            callsExpected: 1000,
            callsStress: 500, // Stress < expected!
            quotaUnitsExpected: 1000,
            quotaUnitsStress: 2000,
            retryAllowance: 100,
          },
        ],
      });
      expect(() => validateSustainableCapacityContract(invalidCalls)).toThrow(ForesiftError);
    });

    it('refuses when providerEnvelope quotaUnitsStress < quotaUnitsExpected', () => {
      const invalidQuota = makeValidContract({
        providerEnvelope: [
          {
            operationId: 'op_test',
            callsExpected: 1000,
            callsStress: 2000,
            quotaUnitsExpected: 1000,
            quotaUnitsStress: 500, // Stress < expected!
            retryAllowance: 100,
          },
        ],
      });
      expect(() => validateSustainableCapacityContract(invalidQuota)).toThrow(ForesiftError);
    });

    it('refuses when providerEnvelope streamedBytesStress < streamedBytesExpected', () => {
      const invalidBytes = makeValidContract({
        providerEnvelope: [
          {
            operationId: 'op_test',
            callsExpected: 1000,
            callsStress: 2000,
            quotaUnitsExpected: 1000,
            quotaUnitsStress: 2000,
            streamedBytesExpected: 10000,
            streamedBytesStress: 5000, // Stress < expected!
            retryAllowance: 100,
          },
        ],
      });
      expect(() => validateSustainableCapacityContract(invalidBytes)).toThrow(ForesiftError);
    });
  });

  describe('expiration timing law', () => {
    it('admits expiresAt > verifiedAt', () => {
      const contract = makeValidContract({
        verifiedAt: '2026-09-01T00:00:00.000Z',
        expiresAt: '2026-10-01T00:00:00.000Z',
      });
      expect(validateSustainableCapacityContract(contract)).toBeDefined();
    });

    it('refuses expiresAt <= verifiedAt fail-closed', () => {
      const equalTime = makeValidContract({
        verifiedAt: '2026-09-01T00:00:00.000Z',
        expiresAt: '2026-09-01T00:00:00.000Z',
      });
      const reversedTime = makeValidContract({
        verifiedAt: '2026-10-01T00:00:00.000Z',
        expiresAt: '2026-09-01T00:00:00.000Z',
      });

      expect(() => validateSustainableCapacityContract(equalTime)).toThrow(ForesiftError);
      expect(() => validateSustainableCapacityContract(reversedTime)).toThrow(ForesiftError);
    });
  });

  describe('headroom and safety bounds ([0, 1])', () => {
    it('refuses minimumHeadroomFraction outside [0, 1]', () => {
      expect(() =>
        validateSustainableCapacityContract(makeValidContract({ minimumHeadroomFraction: -0.01 })),
      ).toThrow(ForesiftError);
      expect(() =>
        validateSustainableCapacityContract(makeValidContract({ minimumHeadroomFraction: 1.01 })),
      ).toThrow(ForesiftError);
    });

    it('refuses safetyMarginFraction outside [0, 1]', () => {
      expect(() =>
        validateSustainableCapacityContract(makeValidContract({ safetyMarginFraction: -0.01 })),
      ).toThrow(ForesiftError);
      expect(() =>
        validateSustainableCapacityContract(makeValidContract({ safetyMarginFraction: 1.01 })),
      ).toThrow(ForesiftError);
    });
  });

  describe('all 13 systemEnvelope quantities validated as non-negative', () => {
    const envelopeFields: (keyof SustainableCapacityContract['systemEnvelope'])[] = [
      'modelInputTokens',
      'modelOutputTokens',
      'modelSpendUsd',
      'workflowSteps',
      'schedulerMessages',
      'databaseReads',
      'databaseWrites',
      'databaseStorageBytes',
      'objectOperations',
      'objectStorageBytes',
      'egressBytes',
      'notificationSends',
      'concurrency',
    ];

    for (const fieldName of envelopeFields) {
      it(`refuses negative ${String(fieldName)} in systemEnvelope`, () => {
        const invalidEnvelope = makeValidContract({
          systemEnvelope: {
            ...makeValidContract().systemEnvelope,
            [fieldName]: -1,
          },
        });
        expect(() => validateSustainableCapacityContract(invalidEnvelope)).toThrow(ForesiftError);
      });
    }
  });

  describe('ContractResult activatable check (FR-COST-012)', () => {
    it('PASS contract is activatable when within validity horizon', () => {
      const passContract = makeValidContract({ result: 'PASS' });
      expect(isContractActivatable(passContract)).toBe(true);
    });

    it('FAIL and UNVERIFIED contracts are accepted as valid data but never activatable', () => {
      const failContract = makeValidContract({ result: 'FAIL' });
      const unverifiedContract = makeValidContract({ result: 'UNVERIFIED' });

      // Accepted by data validator
      expect(validateSustainableCapacityContract(failContract)).toBeDefined();
      expect(validateSustainableCapacityContract(unverifiedContract)).toBeDefined();

      // Refused for activation
      expect(isContractActivatable(failContract)).toBe(false);
      expect(isContractActivatable(unverifiedContract)).toBe(false);
    });
  });
});
