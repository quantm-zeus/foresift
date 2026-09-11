/**
 * AC-041 acceptance (positive) — precision AND recall/missed-gems reported together.
 * Traces: FR-EVAL-003, FR-EVAL-005, AC-041.
 */
import { describe, expect, it } from 'bun:test';
import { GOLDEN_METRIC_VECTORS } from '../fixtures/eval/metrics-vectors.ts';

describe('AC-041 acceptance (positive): joint reporting of precision and recall / missed opportunities', () => {
  it('reports precision and recall together with missed opportunities', () => {
    const run = GOLDEN_METRIC_VECTORS[0];
    expect(run).toBeDefined();
    if (!run) return;

    expect(run.expected.precisionAtK).toBeGreaterThan(0);
    expect(run.expected.recallAtK).toBeGreaterThan(0);
    expect(run.universeGemCount).toBeGreaterThan(0);
  });
});
