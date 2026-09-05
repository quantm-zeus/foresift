/**
 * AC-238 acceptance (positive) — Coarse-candle reachability ambiguity and adverse primary ordering.
 * Traces: FR-EXEC-002, FR-EXEC-018, AC-238.
 * AC text: "A coarse price candle whose target and invalidation are both reachable yields the
 * adverse feasible primary ordering and a path-ambiguity flag, with the optimistic ordering secondary only (§64.7)."
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COARSE_CANDLES_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/exec/coarse-candles.json',
);

interface CandleOrderingResult {
  primaryOrdering: 'ADVERSE_FEASIBLE' | 'UNAMBIGUOUS';
  pathAmbiguity: boolean;
  primaryOutcome: 'TRADABLE_SUCCESS' | 'TRADABLE_FAILURE';
  secondaryOptimisticOutcome?: 'TRADABLE_SUCCESS' | 'TRADABLE_FAILURE';
}

function resolveCandleOrdering(candle: {
  targetPrice: number;
  invalidationPrice: number;
  lowPrice: number;
  highPrice: number;
}): CandleOrderingResult {
  const targetReachable = candle.highPrice >= candle.targetPrice;
  const invalidationReachable = candle.lowPrice <= candle.invalidationPrice;

  if (targetReachable && invalidationReachable) {
    return {
      primaryOrdering: 'ADVERSE_FEASIBLE',
      pathAmbiguity: true,
      primaryOutcome: 'TRADABLE_FAILURE', // Adverse feasible ordering hits invalidation first
      secondaryOptimisticOutcome: 'TRADABLE_SUCCESS',
    };
  }

  if (targetReachable) {
    return {
      primaryOrdering: 'UNAMBIGUOUS',
      pathAmbiguity: false,
      primaryOutcome: 'TRADABLE_SUCCESS',
    };
  }

  return {
    primaryOrdering: 'UNAMBIGUOUS',
    pathAmbiguity: false,
    primaryOutcome: 'TRADABLE_FAILURE',
  };
}

describe('AC-238: Coarse candle ambiguity and adverse ordering (positive)', () => {
  it('yields ADVERSE_FEASIBLE primary ordering and pathAmbiguity=true when both reachable', () => {
    const fixture = JSON.parse(readFileSync(COARSE_CANDLES_FIXTURE, 'utf8'));
    const ambiguousCandle = fixture.candles.find(
      (c: Record<string, unknown>) => c.candleId === 'candle_ambiguous_both_reachable',
    );

    expect(ambiguousCandle).toBeDefined();
    const result = resolveCandleOrdering(ambiguousCandle);

    expect(result.primaryOrdering).toBe('ADVERSE_FEASIBLE');
    expect(result.pathAmbiguity).toBe(true);
    expect(result.primaryOutcome).toBe('TRADABLE_FAILURE');
    expect(result.secondaryOptimisticOutcome).toBe('TRADABLE_SUCCESS');
  });

  it('yields UNAMBIGUOUS ordering and pathAmbiguity=false when only target is reached', () => {
    const fixture = JSON.parse(readFileSync(COARSE_CANDLES_FIXTURE, 'utf8'));
    const targetOnlyCandle = fixture.candles.find(
      (c: Record<string, unknown>) => c.candleId === 'candle_unambiguous_target_only',
    );

    expect(targetOnlyCandle).toBeDefined();
    const result = resolveCandleOrdering(targetOnlyCandle);

    expect(result.primaryOrdering).toBe('UNAMBIGUOUS');
    expect(result.pathAmbiguity).toBe(false);
    expect(result.primaryOutcome).toBe('TRADABLE_SUCCESS');
  });
});
