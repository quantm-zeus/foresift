/**
 * AC-151 acceptance (positive) — cluster/block intervals diverge from naive intervals on correlated fixtures (§68.6).
 * Traces: FR-MAT-005, AC-151.
 */
import { describe, expect, it } from 'bun:test';
import { GOLDEN_INTERVAL_CASES } from '../fixtures/eval/intervals-vectors.ts';

describe('AC-151 acceptance (positive): cluster-robust confidence intervals diverge from naive intervals on correlated tokens', () => {
  it('confirms that cluster-robust interval is significantly wider than naive interval on correlated tokens', () => {
    const correlatedCase = GOLDEN_INTERVAL_CASES.find((c) => c.caseId === 'int_correlated_deployer_clusters');
    expect(correlatedCase).toBeDefined();
    if (!correlatedCase) return;

    expect(correlatedCase.clusteredMetrics.ciWidth).toBeGreaterThan(correlatedCase.naiveMetrics.ciWidth);
    expect(correlatedCase.divergenceFactor).toBeGreaterThan(2.0);
  });
});
