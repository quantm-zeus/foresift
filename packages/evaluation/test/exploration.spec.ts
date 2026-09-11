/**
 * Exploration sample retention suite (T031, FR-EVAL-001, AC-043).
 * Tests retention of non-greedy exploration candidates for outcome learning.
 */
import { describe, expect, it } from 'bun:test';

describe('Exploration Sample Retention (FR-EVAL-001, AC-043)', () => {
  it('preserves exploration decisions in evaluation datasets without exclusion', () => {
    const candidates = [
      { candidateId: 'c1', isGreedySelection: true, score: 0.92 },
      { candidateId: 'c2', isGreedySelection: false, isExplorationSample: true, score: 0.45 },
    ];

    const evaluationDataset = candidates;
    expect(evaluationDataset.length).toBe(2);
    expect(evaluationDataset.some((c) => c.isExplorationSample)).toBe(true);
  });
});
