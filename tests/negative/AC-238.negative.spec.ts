/**
 * AC-238 negative (failure) — optimistic primary ordering under coarse ambiguity is refused.
 * Traces: FR-EXEC-002, FR-EXEC-018, AC-238.
 * Refusal: Setting primary ordering to OPTIMISTIC when both target and invalidation are reachable within coarse candle bounds,
 * or failing to flag path ambiguity, is refused.
 */
import { describe, expect, it } from 'bun:test';

function resolveCandleOrdering(params: {
  targetReachable: boolean;
  invalidationReachable: boolean;
  primaryOrdering: 'ADVERSE_FEASIBLE' | 'OPTIMISTIC' | 'UNAMBIGUOUS';
  hasPathAmbiguity: boolean;
}) {
  const isAmbiguous = params.targetReachable && params.invalidationReachable;

  if (isAmbiguous) {
    if (!params.hasPathAmbiguity) {
      throw new Error('MISSING_PATH_AMBIGUITY_FLAG_REFUSED');
    }
    if (params.primaryOrdering === 'OPTIMISTIC') {
      throw new Error('OPTIMISTIC_PRIMARY_ORDERING_UNDER_AMBIGUITY_REFUSED');
    }
  }

  return true;
}

describe('AC-238 negative: optimistic primary ordering or missing ambiguity flag refused', () => {
  it('throws when primary ordering is set to OPTIMISTIC under coarse candle ambiguity', () => {
    expect(() =>
      resolveCandleOrdering({
        targetReachable: true,
        invalidationReachable: true,
        primaryOrdering: 'OPTIMISTIC',
        hasPathAmbiguity: true,
      }),
    ).toThrow('OPTIMISTIC_PRIMARY_ORDERING_UNDER_AMBIGUITY_REFUSED');
  });

  it('throws when path ambiguity flag is false despite both levels being reachable', () => {
    expect(() =>
      resolveCandleOrdering({
        targetReachable: true,
        invalidationReachable: true,
        primaryOrdering: 'ADVERSE_FEASIBLE',
        hasPathAmbiguity: false,
      }),
    ).toThrow('MISSING_PATH_AMBIGUITY_FLAG_REFUSED');
  });
});
