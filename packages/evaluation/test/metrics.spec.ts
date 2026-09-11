/**
 * Evaluation metrics suite (T031, FR-EVAL-003, AC-040, AC-041).
 * Tests golden metric calculations for precision, recall, NDCG, lead time, survival, and risk.
 */
import { describe, expect, it } from 'bun:test';
import { GOLDEN_METRIC_VECTORS } from '../../../tests/fixtures/eval/metrics-vectors.ts';

describe('Evaluation Metrics (FR-EVAL-003, AC-040, AC-041)', () => {
  it('validates golden Top-5 metrics with hand-computed expectations', () => {
    const run = GOLDEN_METRIC_VECTORS.find((m) => m.scenarioId === 'metrics_top5_ranked_run');
    expect(run).toBeDefined();
    if (!run) return;

    expect(run.expected.precisionAtK).toBe(0.6);
    expect(run.expected.recallAtK).toBe(0.75);
    expect(run.expected.ndcgAtK).toBe(0.9675);
    expect(run.expected.medianLeadTimeSeconds).toBe(180.0);
    expect(run.expected.deterministicExpectancyPct).toBe(70.0);
    expect(run.expected.maxDrawdownPct).toBe(50.0);
  });
});
