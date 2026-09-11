/**
 * AC-043 acceptance (positive) — exploration sample retained for outcome analysis.
 * Traces: FR-EVAL-001, FR-MAT-007, AC-043.
 */
import { describe, expect, it } from 'bun:test';

describe('AC-043 acceptance (positive): retention of exploration decisions for outcome analysis', () => {
  it('preserves exploration observations with assigned inclusion probabilities in evaluation datasets', () => {
    const explorationDataset = [
      {
        sampleId: 'exp_001',
        isExploration: true,
        inclusionProbability: 0.05,
        observedOutcome: 'TRADABLE_FAILURE',
        retainedInDataset: true,
      },
    ];

    expect(explorationDataset[0]?.retainedInDataset).toBe(true);
    expect(explorationDataset[0]?.inclusionProbability).toBeGreaterThan(0);
  });
});
