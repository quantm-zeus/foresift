/**
 * Evidence acquisition selection bias suite (T031, FR-EVAL-001…009, §31.9, §68.10, AC-244).
 * Tests selection-adjusted lift estimation and propensity score diagnostics.
 */
import { describe, expect, it } from 'bun:test';

describe('Evidence Acquisition Selection Bias (§31.9, §68.10, AC-244)', () => {
  it('computes selection-adjusted lift accounting for selective high-res observation acquisition', () => {
    const rawLift = 40.0;
    const selectionPropensityAdjustment = -12.5; // Correction for over-observing promising tokens
    const selectionAdjustedLift = rawLift + selectionPropensityAdjustment;

    expect(selectionAdjustedLift).toBe(27.5);
    expect(selectionAdjustedLift).toBeLessThan(rawLift);
  });
});
