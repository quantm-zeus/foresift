/**
 * AC-236 negative (failure) — independent full-depth consumption and permutation non-determinism refused.
 * Traces: FR-EXEC-019, AC-236.
 * Refusal: Permitting simultaneous shadow positions to independently consume the same pool depth without aggregate impact,
 * or non-deterministic execution ordering across runs, is refused.
 */
import { describe, expect, it } from 'bun:test';

function aggregateConcurrentFills(params: {
  positions: { registrationId: string; requestedUsd: number }[];
  poolAvailableDepthUsd: number;
  allowIsolatedDepthDuplication?: boolean;
}) {
  if (params.allowIsolatedDepthDuplication) {
    throw new Error('ISOLATED_DEPTH_DUPLICATION_REFUSED');
  }

  // Deterministic tie-break by registrationId
  const sorted = [...params.positions].sort((a, b) => a.registrationId.localeCompare(b.registrationId));

  let remainingDepth = params.poolAvailableDepthUsd;
  const results: Record<string, number> = {};

  for (const pos of sorted) {
    const fill = Math.min(pos.requestedUsd, remainingDepth);
    results[pos.registrationId] = fill;
    remainingDepth = Math.max(0, remainingDepth - fill);
  }

  return { results, executionOrder: sorted.map((p) => p.registrationId) };
}

describe('AC-236 negative: independent depth consumption refused & ordering must be deterministic', () => {
  it('throws when isolated depth duplication is permitted across concurrent positions', () => {
    expect(() =>
      aggregateConcurrentFills({
        positions: [
          { registrationId: 'pos_01', requestedUsd: 1000 },
          { registrationId: 'pos_02', requestedUsd: 1000 },
        ],
        poolAvailableDepthUsd: 1000,
        allowIsolatedDepthDuplication: true,
      }),
    ).toThrow('ISOLATED_DEPTH_DUPLICATION_REFUSED');
  });

  it('proves deterministic tie-break ordering independent of array input order', () => {
    const inputOrder1 = [
      { registrationId: 'pos_beta', requestedUsd: 800 },
      { registrationId: 'pos_alpha', requestedUsd: 800 },
    ];
    const inputOrder2 = [
      { registrationId: 'pos_alpha', requestedUsd: 800 },
      { registrationId: 'pos_beta', requestedUsd: 800 },
    ];

    const res1 = aggregateConcurrentFills({ positions: inputOrder1, poolAvailableDepthUsd: 1000 });
    const res2 = aggregateConcurrentFills({ positions: inputOrder2, poolAvailableDepthUsd: 1000 });

    expect(res1.executionOrder).toEqual(['pos_alpha', 'pos_beta']);
    expect(res2.executionOrder).toEqual(['pos_alpha', 'pos_beta']);
    expect(res1.results).toEqual(res2.results);
  });
});
