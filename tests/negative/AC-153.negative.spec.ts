/**
 * AC-153 negative (failure) — throttling or shedding protected outcome observation during degradation is refused.
 * Traces: FR-MAT-010, FR-EVAL-001, AC-153.
 */
import { describe, expect, it } from 'bun:test';

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
