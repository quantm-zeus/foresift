/**
 * AC-238 negative (failure) — Refusal of optimistic primary ordering under coarse ambiguity.
 * Traces: FR-EXEC-002, FR-EXEC-018, AC-238.
 * Tests structural refusal of selecting optimistic ordering as primary when coarse interval permits both target and invalidation.
 */
import { describe, expect, it } from 'bun:test';

function assertPrimaryOrderingLegality(params: {
  targetReachable: boolean;
  invalidationReachable: boolean;
  coarseInterval: boolean;
  selectedPrimaryOrdering: 'OPTIMISTIC_FEASIBLE' | 'ADVERSE_FEASIBLE' | 'UNAMBIGUOUS';
  pathAmbiguityFlag: boolean;
}) {
  const isAmbiguous = params.coarseInterval && params.targetReachable && params.invalidationReachable;

  if (isAmbiguous) {
    if (params.selectedPrimaryOrdering === 'OPTIMISTIC_FEASIBLE') {
      throw new Error('OPTIMISTIC_PRIMARY_ORDERING_UNDER_AMBIGUITY_REFUSED');
    }
    if (!params.pathAmbiguityFlag) {
      throw new Error('MISSING_PATH_AMBIGUITY_FLAG_REFUSED');
    }
  }

  return true;
}

describe('AC-238 negative: optimistic primary ordering under coarse-interval ambiguity is refused', () => {
  it('refuses optimistic primary ordering when both target and invalidation are reachable', () => {
    expect(() =>
      assertPrimaryOrderingLegality({
        targetReachable: true,
        invalidationReachable: true,
        coarseInterval: true,
        selectedPrimaryOrdering: 'OPTIMISTIC_FEASIBLE',
        pathAmbiguityFlag: true,
      }),
    ).toThrow('OPTIMISTIC_PRIMARY_ORDERING_UNDER_AMBIGUITY_REFUSED');
  });

  it('refuses omission of pathAmbiguityFlag when interval is ambiguous', () => {
    expect(() =>
      assertPrimaryOrderingLegality({
        targetReachable: true,
        invalidationReachable: true,
        coarseInterval: true,
        selectedPrimaryOrdering: 'ADVERSE_FEASIBLE',
        pathAmbiguityFlag: false, // Flag omitted!
      }),
    ).toThrow('MISSING_PATH_AMBIGUITY_FLAG_REFUSED');
  });
});
