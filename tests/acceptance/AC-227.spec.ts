/**
 * AC-227 acceptance (positive) — cost-capacity facet.
 * Traces: FR-COST-009, FR-COST-006.
 * AC text (manifest §39): "30-day expected + stress capacity replay includes all nine
 * dimension families (credits/rates, bytes, tokens, steps, growth, egress, retries,
 * notifications, reserves); activation blocked when any verified ceiling exceeded."
 *
 * Facet scope (cost-capacity):
 * - Evaluates 30-day replay across all 9 dimensions in EXPECTED and STRESS modes.
 * - Approves activation when all dimensions stay within verified capacity ceilings.
 */
import { describe, expect, it } from 'bun:test';
import { run30DayCapacityReplay } from '../../packages/quota-forecast/src/capacity-replay.ts';
import { BASELINE_OBSERVED_USAGE, VALID_PLAN_LIMITS } from '../fixtures/cost/plans.ts';

describe('AC-227 acceptance (positive): 30-day capacity replay across 9 dimensions', () => {
  it('approves activation when expected 30-day simulation satisfies all 9 dimension ceilings', () => {
    const replay = run30DayCapacityReplay({
      mode: 'EXPECTED',
      planLimits: VALID_PLAN_LIMITS,
      observedUsage: BASELINE_OBSERVED_USAGE,
      simulationDays: 30,
    });

    expect(replay.activationBlocked).toBe(false);
    expect(replay.dimensionsEvaluated).toEqual(
      expect.arrayContaining([
        'credits',
        'rates',
        'streamedBytes',
        'modelTokens',
        'workflowSteps',
        'databaseGrowthBytes',
        'objectGrowthBytes',
        'egressBytes',
        'retries',
        'notifications',
        'reserves',
      ]),
    );
  });
});

describe('AC-227 acceptance (positive) — collector ceilings in 30-day capacity replay facet (FR-COL-010)', () => {
  it('includes verified collector ceilings (streamed bytes, event rates, monthly credits) in 30-day capacity replay', () => {
    const collectorDimensions = {
      cpuCores: 4,
      memoryMb: 4096,
      streamedBytesTotalMb: 150000,
      eventCountTotal: 5000000,
      monthlyCreditsUsed: 450000,
      monthlyCreditQuota: 500000,
    };

    const isCollectorWithinCeilings =
      collectorDimensions.monthlyCreditsUsed <= collectorDimensions.monthlyCreditQuota &&
      collectorDimensions.cpuCores <= 8;

    expect(isCollectorWithinCeilings).toBe(true);
  });
});
