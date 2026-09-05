/**
 * AC-238 acceptance (positive) — coarse candle ordering ambiguity & adverse feasible primary (§64.7).
 * Traces: FR-EXEC-002, FR-EXEC-018, AC-238.
 * AC text: "A coarse price candle whose target and invalidation are both reachable yields
 * the adverse feasible primary ordering and a path-ambiguity flag, with the optimistic ordering secondary only."
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('AC-238 acceptance (positive): coarse candle ambiguity yields adverse primary and ambiguity flag', () => {
  it('selects adverse feasible primary ordering with path ambiguity flag when both levels touched', () => {
    const fixturePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../fixtures/exec/coarse-candles.json',
    );
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

    const ambiguousCandle = fixture.candles.find(
      (c: Record<string, unknown>) => c.candleId === 'candle_ambiguous_both_touched',
    );

    expect(ambiguousCandle.targetReachable).toBe(true);
    expect(ambiguousCandle.invalidationReachable).toBe(true);
    expect(ambiguousCandle.hasPathAmbiguity).toBe(true);
    expect(ambiguousCandle.primaryOrdering).toBe('ADVERSE_FEASIBLE');
    expect(ambiguousCandle.primaryExitType).toBe('STOP_LOSS');
    expect(ambiguousCandle.secondaryExitType).toBe('TAKE_PROFIT');
    expect(ambiguousCandle.primaryOutcome).toBe('TRADABLE_FAILURE');
  });

  it('selects unambiguous ordering when only target is reachable', () => {
    const fixturePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../fixtures/exec/coarse-candles.json',
    );
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

    const targetOnlyCandle = fixture.candles.find(
      (c: Record<string, unknown>) => c.candleId === 'candle_unambiguous_target_only',
    );

    expect(targetOnlyCandle.targetReachable).toBe(true);
    expect(targetOnlyCandle.invalidationReachable).toBe(false);
    expect(targetOnlyCandle.hasPathAmbiguity).toBe(false);
    expect(targetOnlyCandle.primaryOrdering).toBe('UNAMBIGUOUS');
    expect(targetOnlyCandle.primaryOutcome).toBe('TRADABLE_SUCCESS');
  });
});
