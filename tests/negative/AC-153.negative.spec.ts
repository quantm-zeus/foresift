/**
 * AC-153 negative (failure) — throttling or shedding protected outcome observation during degradation is refused.
 * Traces: FR-MAT-010, FR-EVAL-001, AC-153.
 */
import { describe, expect, it } from 'bun:test';
import {
  assertBestEffortPreservesProtectedDimensions,
  assertCapacityDegradationPreservesProtectedDimensions,
} from '@foresift/capability-registry';
import {
  PROD_BEST_EFFORT_OMITS_PROTECTED,
  PROD_BEST_EFFORT_WEAKENING,
  PROD_SLA_BACKED_WEAKENING,
} from '../fixtures/prod/index.ts';

function enforceProtectedReserveIntegrity(degradationPlan: { throttledItems: readonly string[] }) {
  const protectedItems = [
    'OUTCOME_OBSERVATION',
    'AUDIT_CHAIN_INTEGRITY',
    'CRITICAL_RISK_MONITORING',
    'DEDUPLICATION_STATE',
  ];

  for (const item of degradationPlan.throttledItems) {
    if (protectedItems.includes(item)) {
      throw new Error(`PROTECTED_RESERVE_CANNOT_BE_THROTTLED: ${item}`);
    }
  }
  return true;
}

describe('AC-153 negative: shedding protected outcome reserves under degradation is prohibited', () => {
  it('throws when degradation plan attempts to shed outcome observation', () => {
    expect(() =>
      enforceProtectedReserveIntegrity({
        throttledItems: ['OUTCOME_OBSERVATION'],
      }),
    ).toThrow('PROTECTED_RESERVE_CANNOT_BE_THROTTLED: OUTCOME_OBSERVATION');
  });

  it('throws when degradation plan attempts to shed critical risk monitoring', () => {
    expect(() =>
      enforceProtectedReserveIntegrity({
        throttledItems: ['CRITICAL_RISK_MONITORING'],
      }),
    ).toThrow('PROTECTED_RESERVE_CANNOT_BE_THROTTLED: CRITICAL_RISK_MONITORING');
  });
});

// --- prod-scoped additions (T036, FR-PROD-004, AC-153) -----------------------

describe('AC-153 prod-scoped negatives: weakening any protected dimension is refused', () => {
  it('refuses a declaration that weakens the protected audit dimension', () => {
    expect(() =>
      assertBestEffortPreservesProtectedDimensions(PROD_BEST_EFFORT_WEAKENING),
    ).toThrowError(expect.objectContaining({ code: 'PROD_BEST_EFFORT_PROTECTED_DIMENSION' }));
  });

  it('refuses an SLA_BACKED posture that weakens anything', () => {
    expect(() =>
      assertBestEffortPreservesProtectedDimensions(PROD_SLA_BACKED_WEAKENING),
    ).toThrowError(expect.objectContaining({ code: 'PROD_BEST_EFFORT_PROTECTED_DIMENSION' }));
  });

  it('refuses a declaration that omits a protected dimension by omission', () => {
    expect(() =>
      assertBestEffortPreservesProtectedDimensions(PROD_BEST_EFFORT_OMITS_PROTECTED),
    ).toThrowError(expect.objectContaining({ code: 'PROD_BEST_EFFORT_PROTECTED_DIMENSION' }));
  });

  it('refuses a capacity degradation that tries to shed critical risk monitoring', () => {
    expect(() => assertCapacityDegradationPreservesProtectedDimensions(['audit'])).toThrowError(
      expect.objectContaining({ code: 'PROD_BEST_EFFORT_PROTECTED_DIMENSION' }),
    );
  });
});
