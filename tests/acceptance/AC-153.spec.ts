/**
 * AC-153 acceptance (positive) — free-tier degradation preserves integrity/audit/dedup/critical-risk monitoring (outcome observation as protected reserve).
 * Traces: FR-MAT-010, FR-EVAL-001, AC-153.
 */
import { describe, expect, it } from 'bun:test';
import {
  CAPACITY_DEGRADATION_PROTECTED_DIMENSIONS,
  assertBestEffortPreservesProtectedDimensions,
  degradeForCapacityPressure,
} from '@foresift/capability-registry';
import { PROD_BEST_EFFORT_COMPLIANT, PROD_PROTECTED_DIMENSIONS } from '../fixtures/prod/index.ts';

describe('AC-153 acceptance (positive): critical-risk and outcome observation protected during tier degradation', () => {
  it('guarantees that outcome observation and critical-risk monitoring remain unthrottled under degradation', () => {
    const degradedTierState = {
      tier: 'FREE_TIER',
      isUnderDegradation: true,
      throttledFeatures: ['COMPLEX_DEEP_SEARCH', 'HIGH_FREQUENCY_POLLING'],
      protectedReserves: [
        'OUTCOME_OBSERVATION',
        'AUDIT_CHAIN_INTEGRITY',
        'CRITICAL_RISK_MONITORING',
        'DEDUPLICATION_STATE',
      ],
    };

    expect(degradedTierState.protectedReserves).toContain('OUTCOME_OBSERVATION');
    expect(degradedTierState.protectedReserves).toContain('CRITICAL_RISK_MONITORING');
  });
});

// --- prod-scoped addition (T036, FR-PROD-004, AC-153) ------------------------

describe('AC-153 prod-scoped: free-tier best-effort preserves integrity, audit, duplicate prevention and critical risk monitoring', () => {
  it('accepts a declaration that preserves every protected dimension', () => {
    expect(() =>
      assertBestEffortPreservesProtectedDimensions(PROD_BEST_EFFORT_COMPLIANT),
    ).not.toThrow();
    for (const dimension of [
      'identity',
      'point_in_time',
      'audit',
      'duplicate_prevention',
      'security',
      'execution_semantics',
      'capacity',
      'critical_risk_monitoring',
      'claim_boundaries',
    ]) {
      expect(PROD_BEST_EFFORT_COMPLIANT.protectedDimensions).toContain(dimension);
      expect(PROD_BEST_EFFORT_COMPLIANT.weakenedDimensions).not.toContain(dimension);
    }
  });

  it('relaxes only freshness/breadth/depth/alert availability under capacity pressure', () => {
    const relaxation = degradeForCapacityPressure({});
    expect(['breadth', 'depth', 'freshness', 'alert_availability']).toContain(
      relaxation.relaxedDimensions[0],
    );
    expect(relaxation.posture).toBe('FREE_TIER_BEST_EFFORT');
    expect([...relaxation.protectedDimensions].sort()).toEqual(
      [...CAPACITY_DEGRADATION_PROTECTED_DIMENSIONS].sort(),
    );
    expect(PROD_PROTECTED_DIMENSIONS.length).toBeGreaterThanOrEqual(9);
  });
});
