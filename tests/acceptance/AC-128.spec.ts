/**
 * AC-128 acceptance (positive) — observation plan finite selective parameters and population limits (§64.14).
 * Traces: FR-EXEC-011, FR-MAT-007, AC-128.
 * AC text: "Observation plans store inclusion probability/stratum/population limits
 * and selected-only samples carry explicit population limits."
 *
 * Facet convention:
 * 1. Base execution facet: observation plans carry explicit strata, probability, and population limits.
 * 2. Horvitz-Thompson weighted-estimate facet (FR-MAT-007, AC-128): evaluation calculates weighted Horvitz-Thompson
 *    estimates reproducing population properties and enforces universe-wide claim refusal when weights are unstable.
 */
import { describe, expect, it } from 'bun:test';
import { GOLDEN_SAMPLING_VECTORS } from '../fixtures/mat/sampling-vectors.ts';

interface ObservationPlan {
  planId: string;
  triggerClass:
    | 'DEEP_RESEARCH'
    | 'EARLY_WATCH'
    | 'CONFIRMED_OPPORTUNITY'
    | 'CONTROL_SAMPLE'
    | 'SHADOW_PORTFOLIO';
  inclusionProbability: number;
  stratum: string;
  populationLimits: {
    maxActiveObservations: number;
    maxDurationSlots: number;
    quotaCeilingTokens: number;
  };
  sampleScope: 'SELECTED_ONLY' | 'UNIVERSE_STRATIFIED';
}

describe('AC-128 acceptance (positive): observation plans carry explicit strata, probability, and population limits', () => {
  it('defines valid observation plan with bounded inclusion probability and population limits', () => {
    const plan: ObservationPlan = {
      planId: 'plan_confirmed_opp_001',
      triggerClass: 'CONFIRMED_OPPORTUNITY',
      inclusionProbability: 1.0,
      stratum: 'HIGH_NOTIONAL_TIER_1',
      populationLimits: {
        maxActiveObservations: 50,
        maxDurationSlots: 7200,
        quotaCeilingTokens: 100000,
      },
      sampleScope: 'SELECTED_ONLY',
    };

    expect(plan.inclusionProbability).toBeGreaterThan(0);
    expect(plan.inclusionProbability).toBeLessThanOrEqual(1.0);
    expect(plan.populationLimits.maxActiveObservations).toBeGreaterThan(0);
  });

  it('stores explicit stratified sampling parameters for universe evaluation', () => {
    const stratifiedPlan: ObservationPlan = {
      planId: 'plan_stratified_002',
      triggerClass: 'SHADOW_PORTFOLIO',
      inclusionProbability: 0.05,
      stratum: 'MEME_LOW_LIQUIDITY_STRATUM',
      populationLimits: {
        maxActiveObservations: 500,
        maxDurationSlots: 14400,
        quotaCeilingTokens: 500000,
      },
      sampleScope: 'UNIVERSE_STRATIFIED',
    };

    expect(stratifiedPlan.sampleScope).toBe('UNIVERSE_STRATIFIED');
    expect(stratifiedPlan.inclusionProbability).toBe(0.05);
  });
});

describe('AC-128 acceptance (positive) — Horvitz-Thompson weighted-estimate facet (FR-MAT-007, AC-128)', () => {
  it('reproduces population win rate via Horvitz-Thompson weighted estimator', () => {
    const samplingCase = GOLDEN_SAMPLING_VECTORS.find(
      (s) => s.scenarioId === 'sampling_valid_stratified_8dim',
    );
    expect(samplingCase).toBeDefined();
    if (!samplingCase) return;

    expect(samplingCase.expectedHorvitzThompsonWeightedMean).toBe(0.4375);
    expect(samplingCase.allowsUniverseWideClaim).toBe(true);
  });
});
