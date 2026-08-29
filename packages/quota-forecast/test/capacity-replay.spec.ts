/**
 * 30-day capacity replay unit tests (FR-COST-006, FR-COST-009, AC-227, AC-228, AC-229).
 * Tests expected and stress replay across all 9 dimension families,
 * activation blocking when ceilings exceeded, and replay determinism.
 */
import { describe, expect, it } from 'bun:test';
import { run30DayCapacityReplay, type CapacityReplayInput } from '../src/capacity-replay.ts';
import {
  BASELINE_OBSERVED_USAGE,
  CEILING_EXCEEDED_OBSERVED_USAGE,
  VALID_PLAN_LIMITS,
} from '../../../tests/fixtures/cost/plans.ts';

describe('capacity-replay', () => {
  it('passes 30-day expected replay when all 9 dimensions are within ceiling', () => {
    const input: CapacityReplayInput = {
      mode: 'EXPECTED',
      planLimits: VALID_PLAN_LIMITS,
      observedUsage: BASELINE_OBSERVED_USAGE,
      simulationDays: 30,
    };

    const result = run30DayCapacityReplay(input);
    expect(result.activationBlocked).toBe(false);
    expect(result.exceededCeilings.length).toBe(0);
    expect(result.dimensionsEvaluated.length).toBeGreaterThanOrEqual(9);
  });

  it('blocks activation when any single verified ceiling is exceeded in replay', () => {
    const input: CapacityReplayInput = {
      mode: 'STRESS',
      planLimits: VALID_PLAN_LIMITS,
      observedUsage: CEILING_EXCEEDED_OBSERVED_USAGE,
      simulationDays: 30,
    };

    const result = run30DayCapacityReplay(input);
    expect(result.activationBlocked).toBe(true);
    expect(result.exceededCeilings.length).toBeGreaterThan(0);
  });

  it('produces bit-for-bit deterministic replay output for identical inputs', () => {
    const input: CapacityReplayInput = {
      mode: 'EXPECTED',
      planLimits: VALID_PLAN_LIMITS,
      observedUsage: BASELINE_OBSERVED_USAGE,
      simulationDays: 30,
    };

    const run1 = run30DayCapacityReplay(input);
    const run2 = run30DayCapacityReplay(input);

    expect(run1).toEqual(run2);
  });
});
