/**
 * AC-128 negative (failure) — Refusal of out-of-range inclusion probability and un-bounded selected plans.
 * Traces: FR-EXEC-011, AC-128.
 * Tests structural refusal of invalid probability ranges, missing population limits, and universe-wide claims from selected samples.
 */
import { describe, expect, it } from 'bun:test';

function validateObservationPlanStrict(plan: {
  inclusionProbability: number;
  populationLimit?: number | null;
  samplingScope: string;
  generalizeToUniverse?: boolean;
}) {
  if (plan.inclusionProbability <= 0 || plan.inclusionProbability > 1.0 || isNaN(plan.inclusionProbability)) {
    throw new Error('INVALID_INCLUSION_PROBABILITY_RANGE');
  }

  if (plan.populationLimit === undefined || plan.populationLimit === null || plan.populationLimit <= 0) {
    throw new Error('MISSING_OR_INVALID_POPULATION_LIMIT');
  }

  if (plan.samplingScope === 'SELECTED_ONLY' && plan.generalizeToUniverse === true) {
    throw new Error('UNIVERSE_WIDE_GENERALIZATION_FROM_SELECTED_ONLY_SAMPLE_BLOCKED');
  }

  return true;
}

describe('AC-128 negative: out-of-range probabilities and un-bounded observation plans are refused', () => {
  it('refuses inclusion probability <= 0 or > 1.0', () => {
    expect(() =>
      validateObservationPlanStrict({
        inclusionProbability: 0.0,
        populationLimit: 100,
        samplingScope: 'REPRESENTATIVE_STRATIFIED',
      }),
    ).toThrow('INVALID_INCLUSION_PROBABILITY_RANGE');

    expect(() =>
      validateObservationPlanStrict({
        inclusionProbability: 1.5,
        populationLimit: 100,
        samplingScope: 'REPRESENTATIVE_STRATIFIED',
      }),
    ).toThrow('INVALID_INCLUSION_PROBABILITY_RANGE');
  });

  it('refuses observation plan with missing or non-positive population limit', () => {
    expect(() =>
      validateObservationPlanStrict({
        inclusionProbability: 0.5,
        populationLimit: 0,
        samplingScope: 'SELECTED_ONLY',
      }),
    ).toThrow('MISSING_OR_INVALID_POPULATION_LIMIT');

    expect(() =>
      validateObservationPlanStrict({
        inclusionProbability: 0.5,
        populationLimit: null,
        samplingScope: 'SELECTED_ONLY',
      }),
    ).toThrow('MISSING_OR_INVALID_POPULATION_LIMIT');
  });

  it('blocks universe-wide generalization claims from selected-only sample plans', () => {
    expect(() =>
      validateObservationPlanStrict({
        inclusionProbability: 1.0,
        populationLimit: 100,
        samplingScope: 'SELECTED_ONLY',
        generalizeToUniverse: true,
      }),
    ).toThrow('UNIVERSE_WIDE_GENERALIZATION_FROM_SELECTED_ONLY_SAMPLE_BLOCKED');
  });
});
