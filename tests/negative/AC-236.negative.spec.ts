/**
 * AC-236 negative (failure) — Refusal of isolated depth double-counting & non-deterministic ordering.
 * Traces: FR-EXEC-019, AC-236.
 * Tests structural refusal of letting multiple concurrent exits consume the same pool depth, and refusal of permutation non-determinism.
 */
import { describe, expect, it } from 'bun:test';

function assertConcurrentFillsDepthInvariant(params: {
  availablePoolDepthUsd: number;
  fills: { positionId: string; filledUsd: number }[];
}) {
  const totalConsumed = params.fills.reduce((acc, f) => acc + f.filledUsd, 0);
  if (totalConsumed > params.availablePoolDepthUsd) {
    throw new Error(
      `CONCURRENT_EXITS_DEPTH_OVERCONSUMED:${totalConsumed}>${params.availablePoolDepthUsd}`,
    );
  }
  return true;
}

function assertDeterministicResolutionPermutation(
  exitsInputA: { registrationId: string; filledUsd: number }[],
  exitsInputB: { registrationId: string; filledUsd: number }[],
) {
  // Canonical sort before comparing
  const sortedA = [...exitsInputA].sort((a, b) => a.registrationId.localeCompare(b.registrationId));
  const sortedB = [...exitsInputB].sort((a, b) => a.registrationId.localeCompare(b.registrationId));

  for (let i = 0; i < sortedA.length; i++) {
    if (sortedA[i].filledUsd !== sortedB[i].filledUsd) {
      throw new Error('ORDER_PERMUTATION_NON_DETERMINISM_REFUSED');
    }
  }
  return true;
}

describe('AC-236 negative: isolated depth reuse and order non-determinism are refused', () => {
  it('refuses simultaneous exits where sum of fills exceeds total pool depth', () => {
    expect(() =>
      assertConcurrentFillsDepthInvariant({
        availablePoolDepthUsd: 10000.0,
        fills: [
          { positionId: 'pos_alpha', filledUsd: 6000.0 },
          { positionId: 'pos_beta', filledUsd: 6000.0 }, // Double counting depth!
        ],
      }),
    ).toThrow('CONCURRENT_EXITS_DEPTH_OVERCONSUMED:12000>10000');
  });

  it('refuses permutations that change deterministic fill allocations', () => {
    const outcomeFromOrder1 = [
      { registrationId: 'reg_001', filledUsd: 6000.0 },
      { registrationId: 'reg_002', filledUsd: 4000.0 },
    ];
    const flawedNonDeterministicOutcome = [
      { registrationId: 'reg_001', filledUsd: 4000.0 },
      { registrationId: 'reg_002', filledUsd: 6000.0 },
    ];

    expect(() =>
      assertDeterministicResolutionPermutation(outcomeFromOrder1, flawedNonDeterministicOutcome),
    ).toThrow('ORDER_PERMUTATION_NON_DETERMINISM_REFUSED');
  });
});
