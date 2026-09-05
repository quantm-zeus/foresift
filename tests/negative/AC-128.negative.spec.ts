/**
 * AC-128 negative (failure) — invalid probability, missing population limits, universe-wide claims refused.
 * Traces: FR-EXEC-011, AC-128.
 * Refusal: Out-of-range inclusion probability, missing population limits, or asserting universe-wide claims
 * from selected-only observation samples is refused.
 */
import { describe, expect, it } from 'bun:test';

function validateObservationPlan(plan: {
  inclusionProbability: number;
  populationLimits?: { maxActiveObservations: number };
  sampleScope: 'SELECTED_ONLY' | 'UNIVERSE_STRATIFIED';
  assertsUniverseWideInference?: boolean;
}) {
  if (plan.inclusionProbability <= 0 || plan.inclusionProbability > 1.0) {
    throw new Error('INCLUSION_PROBABILITY_OUT_OF_BOUNDS_REFUSED');
  }
  if (!plan.populationLimits || plan.populationLimits.maxActiveObservations <= 0) {
    throw new Error('MISSING_OR_INVALID_POPULATION_LIMITS_REFUSED');
  }
  if (plan.sampleScope === 'SELECTED_ONLY' && plan.assertsUniverseWideInference) {
    throw new Error('UNIVERSE_WIDE_INFERENCE_FROM_SELECTED_ONLY_SAMPLE_REFUSED');
  }
  return true;
}

describe('AC-128 negative: invalid probability, missing limits, or universe inference refused', () => {
  it('throws when inclusion probability is greater than 1.0 or non-positive', () => {
    expect(() =>
      validateObservationPlan({
        inclusionProbability: 1.5,
        populationLimits: { maxActiveObservations: 10 },
        sampleScope: 'SELECTED_ONLY',
      }),
    ).toThrow('INCLUSION_PROBABILITY_OUT_OF_BOUNDS_REFUSED');

    expect(() =>
      validateObservationPlan({
        inclusionProbability: 0.0,
        populationLimits: { maxActiveObservations: 10 },
        sampleScope: 'SELECTED_ONLY',
      }),
    ).toThrow('INCLUSION_PROBABILITY_OUT_OF_BOUNDS_REFUSED');
  });

  it('throws when population limits are missing', () => {
    expect(() =>
      validateObservationPlan({
        inclusionProbability: 0.5,
        sampleScope: 'SELECTED_ONLY',
      }),
    ).toThrow('MISSING_OR_INVALID_POPULATION_LIMITS_REFUSED');
  });

  it('throws when universe-wide inference is claimed from selected-only sample', () => {
    expect(() =>
      validateObservationPlan({
        inclusionProbability: 1.0,
        populationLimits: { maxActiveObservations: 50 },
        sampleScope: 'SELECTED_ONLY',
        assertsUniverseWideInference: true,
      }),
    ).toThrow('UNIVERSE_WIDE_INFERENCE_FROM_SELECTED_ONLY_SAMPLE_REFUSED');
  });
});
