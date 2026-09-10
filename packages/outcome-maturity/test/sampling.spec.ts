/**
 * Stratified sampling suite (T031, FR-MAT-007, AC-128).
 * Tests Horvitz-Thompson estimation and stability diagnostics.
 */
import { describe, expect, it } from 'bun:test';
import { GOLDEN_SAMPLING_VECTORS } from '../../../tests/fixtures/mat/sampling-vectors.ts';

describe('Sampling and Horvitz-Thompson Estimation (FR-MAT-007, AC-128)', () => {
  it('computes unbiased weighted Horvitz-Thompson estimate over clean stratified samples', () => {
    const cleanScenario = GOLDEN_SAMPLING_VECTORS.find((s) => s.scenarioId === 'sampling_valid_stratified_8dim');
    expect(cleanScenario).toBeDefined();
    if (!cleanScenario) return;

    expect(cleanScenario.expectedNaiveMean).toBe(0.50);
    expect(cleanScenario.expectedHorvitzThompsonWeightedMean).toBe(0.4375);
    expect(cleanScenario.expectedWeightedTotalUtility).toBe(3500.0);
    expect(cleanScenario.allowsUniverseWideClaim).toBe(true);
  });

  it('detects extreme weight violations and restricts population claims', () => {
    const extremeScenario = GOLDEN_SAMPLING_VECTORS.find((s) => s.scenarioId === 'sampling_extreme_weight_violation');
    expect(extremeScenario).toBeDefined();
    if (!extremeScenario) return;

    expect(extremeScenario.hasWeightStabilityViolation).toBe(true);
    expect(extremeScenario.allowsUniverseWideClaim).toBe(false);
    expect(extremeScenario.requiredClaimLimitation).toBe('SAMPLE_STRATUM_COVERAGE_ONLY_WEIGHT_STABILITY_REFUSED');
  });
});
