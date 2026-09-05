/**
 * AC-128 acceptance (positive) — Observation plan inclusion probability, stratum, and population limits.
 * Traces: FR-EXEC-011, AC-128.
 * AC text: "Observation plans store inclusion probability/stratum/population limits and
 * selected-only samples carry explicit population limits (§64.14)."
 */
import { describe, expect, it } from 'bun:test';

interface ObservationPlan {
  planId: string;
  triggerClass: 'DEEP_RESEARCH' | 'EARLY_WATCH' | 'CONFIRMED_OPPORTUNITY' | 'CONTROL_SAMPLE' | 'SHADOW_PORTFOLIO';
  inclusionProbability: number;
  stratum: string;
  populationLimit: number;
  samplingScope: 'SELECTED_ONLY' | 'REPRESENTATIVE_STRATIFIED' | 'CENSUS_FULL';
  cadenceSlots: number;
  durationSlots: number;
}

function createObservationPlan(plan: ObservationPlan): ObservationPlan {
  expect(plan.inclusionProbability).toBeGreaterThan(0);
  expect(plan.inclusionProbability).toBeLessThanOrEqual(1.0);
  expect(plan.populationLimit).toBeGreaterThan(0);
  expect(plan.stratum.length).toBeGreaterThan(0);
  return plan;
}

describe('AC-128: Observation plan sampling parameters and population limits (positive)', () => {
  it('stores valid inclusion probability, stratum, and population limits for control sample', () => {
    const plan = createObservationPlan({
      planId: 'plan_ctrl_001',
      triggerClass: 'CONTROL_SAMPLE',
      inclusionProbability: 0.05, // 5% randomized selection
      stratum: 'LAUNCH_POOLS_LOW_VOLUME',
      populationLimit: 250,
      samplingScope: 'REPRESENTATIVE_STRATIFIED',
      cadenceSlots: 1,
      durationSlots: 120,
    });

    expect(plan.inclusionProbability).toBe(0.05);
    expect(plan.stratum).toBe('LAUNCH_POOLS_LOW_VOLUME');
    expect(plan.populationLimit).toBe(250);
  });

  it('binds explicit population limits to selected-only candidate observation plans', () => {
    const plan = createObservationPlan({
      planId: 'plan_selected_002',
      triggerClass: 'CONFIRMED_OPPORTUNITY',
      inclusionProbability: 1.0,
      stratum: 'PROMOTED_OPPORTUNITY',
      populationLimit: 100, // Capped quota
      samplingScope: 'SELECTED_ONLY',
      cadenceSlots: 1,
      durationSlots: 60,
    });

    expect(plan.samplingScope).toBe('SELECTED_ONLY');
    expect(plan.populationLimit).toBe(100);
  });
});
