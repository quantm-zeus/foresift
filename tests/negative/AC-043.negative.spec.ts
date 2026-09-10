/**
 * AC-043 negative (failure) — discarding or filtering out exploration samples from outcome datasets is refused.
 * Traces: FR-EVAL-001, FR-MAT-007, AC-043.
 */
import { describe, expect, it } from 'bun:test';

function validateDatasetSampleRetention(samples: readonly { isExploration: boolean; dropped?: boolean }[]) {
  const droppedExploration = samples.some((s) => s.isExploration && s.dropped);
  if (droppedExploration) {
    throw new Error('EXPLORATION_SAMPLE_DROPPING_PROHIBITED');
  }
  return true;
}

describe('AC-043 negative: dropping exploration samples is prohibited', () => {
  it('throws when exploration samples are dropped from outcome datasets', () => {
    expect(() =>
      validateDatasetSampleRetention([
        { isExploration: true, dropped: true },
      ]),
    ).toThrow('EXPLORATION_SAMPLE_DROPPING_PROHIBITED');
  });
});
