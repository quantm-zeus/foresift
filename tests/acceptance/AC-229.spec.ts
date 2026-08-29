/**
 * AC-229 acceptance (positive) — cost-capacity facet.
 * Traces: FR-COST-006.
 * AC text (manifest §39): "Actual usage exceeding forecast tolerance creates an incident,
 * recomputes admission limits, and does not silently consume paid overage or protected reserve."
 *
 * Facet scope (cost-capacity):
 * - Evaluates usage exceeding tolerance threshold.
 * - Confirms incident creation with machine prefix FORECAST_TOLERANCE_EXCEEDED.
 * - Recomputes admission limits without touching paid overage or protected reserves.
 */
import { describe, expect, it } from 'bun:test';
import { computeCostForecast } from '../../packages/quota-forecast/src/forecast.ts';
import { TOLERANCE_BREACH_OBSERVED_USAGE, VALID_PLAN_LIMITS } from '../fixtures/cost/plans.ts';

describe('AC-229 acceptance (positive): forecast tolerance breach incident & cap recomputation', () => {
  it('raises incident and recomputes limits downward when usage exceeds forecast tolerance', () => {
    const forecastResult = computeCostForecast({
      planLimits: VALID_PLAN_LIMITS,
      observedUsage: TOLERANCE_BREACH_OBSERVED_USAGE,
      projectedUsage: { credits: 30000 },
      tolerancePercent: 15,
    });

    expect(forecastResult.withinTolerance).toBe(false);
    expect(forecastResult.incidentRaised).toBe(true);
    expect(forecastResult.incidentReason).toContain('FORECAST_TOLERANCE_EXCEEDED');
    expect(forecastResult.recomputedCapLimit).toBeLessThan(VALID_PLAN_LIMITS.creditsPerMonth);
    expect(forecastResult.silentOverageConsumed).toBe(false);
    expect(forecastResult.silentReserveConsumed).toBe(false);
  });
});
