/**
 * AC-227 negative (failure) — cost-capacity facet.
 * Traces: FR-COST-009, FR-COST-006.
 * Tests strict activation blocking if any single ceiling is exceeded during 30-day stress replay.
 */
import { describe, expect, it } from 'bun:test';
import { run30DayCapacityReplay } from '../../packages/quota-forecast/src/capacity-replay.ts';
import { CEILING_EXCEEDED_OBSERVED_USAGE, VALID_PLAN_LIMITS } from '../fixtures/cost/plans.ts';

describe('AC-227 negative: single ceiling breach blocks overall release activation', () => {
  it('blocks activation when credits ceiling is breached during stress replay', () => {
    const replay = run30DayCapacityReplay({
      mode: 'STRESS',
      planLimits: VALID_PLAN_LIMITS,
      observedUsage: CEILING_EXCEEDED_OBSERVED_USAGE,
      simulationDays: 30,
    });

    expect(replay.activationBlocked).toBe(true);
    expect(replay.exceededCeilings.length).toBeGreaterThan(0);
  });
});
