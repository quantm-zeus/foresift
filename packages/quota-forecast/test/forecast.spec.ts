/**
 * Forecast computation and tolerance incident unit tests (FR-COST-006, AC-229).
 * Tests estimatedForecast vs actualObserved, delta, withinTolerance boolean,
 * and incident creation upon tolerance breach.
 */
import { describe, expect, it } from 'bun:test';
import {
  computeCostForecast,
  type ForecastEvaluationResult,
} from '../src/forecast.ts';
import {
  BASELINE_OBSERVED_USAGE,
  TOLERANCE_BREACH_OBSERVED_USAGE,
  VALID_PLAN_LIMITS,
} from '../../../tests/fixtures/cost/plans.ts';

describe('computeCostForecast', () => {
  it('computes forecast and marks withinTolerance=true when within bounds', () => {
    const result = computeCostForecast({
      planLimits: VALID_PLAN_LIMITS,
      observedUsage: BASELINE_OBSERVED_USAGE,
      projectedUsage: { credits: 28000 },
      tolerancePercent: 15,
    });

    expect(result.withinTolerance).toBe(true);
    expect(result.incidentRaised).toBe(false);
    expect(result.delta).toBeDefined();
  });

  it('raises incident and sets withinTolerance=false when usage breaches tolerance', () => {
    const result = computeCostForecast({
      planLimits: VALID_PLAN_LIMITS,
      observedUsage: TOLERANCE_BREACH_OBSERVED_USAGE,
      projectedUsage: { credits: 30000 },
      tolerancePercent: 15,
    });

    expect(result.withinTolerance).toBe(false);
    expect(result.incidentRaised).toBe(true);
    expect(result.incidentReason).toContain('FORECAST_TOLERANCE_EXCEEDED');
  });

  it('recomputes recommended admission caps downward upon tolerance breach', () => {
    const result = computeCostForecast({
      planLimits: VALID_PLAN_LIMITS,
      observedUsage: TOLERANCE_BREACH_OBSERVED_USAGE,
      projectedUsage: { credits: 30000 },
      tolerancePercent: 15,
    });

    expect(result.recomputedCapLimit).toBeLessThan(VALID_PLAN_LIMITS.creditsPerMonth);
  });
});
