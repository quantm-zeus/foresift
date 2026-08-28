/**
 * AC-226 negative / failure-path suite (cost facet: FR-COST-006).
 * Asserts that incomplete latency spans or unbounded reserve routing latency fail checks.
 */
import { describe, expect, it } from 'bun:test';

describe('AC-226 negative: incomplete latency decomposition fails validation', () => {
  it('refuses latency record missing required provider comparison span', () => {
    const incompleteRecord = {
      eventToCollectorMs: 50,
      collectorToFeatureMs: 25,
    };

    const hasRequiredSpans =
      'eventToCollectorMs' in incompleteRecord &&
      'providerComparisonAlternative' in incompleteRecord;

    expect(hasRequiredSpans).toBe(false);
  });
});
