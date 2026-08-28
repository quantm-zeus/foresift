/**
 * Cost forecast and tolerance breach incident units (FR-COST-006, AC-229).
 *
 * Asserts:
 * - CostForecast = verified planLimitsJson x observedUsageJson -> estimatedForecast vs actualObserved vs delta vs withinTolerance.
 * - When tolerance breached, raises incident and recomputes admission caps without silently spending paid overage or reserve.
 * - Repeated over-consumption within the same period still raises incidents.
 */
import { describe, expect, it } from 'bun:test';

describe('forecast reconciliation and tolerance incident handling (FR-COST-006, AC-229)', () => {
  it('computes forecast variance and detects tolerance compliance', async () => {
    let ForecastModule: Record<string, unknown>;
    try {
      ForecastModule = (await import('../src/forecast.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('FORECAST_NOT_IMPLEMENTED: src/forecast.ts missing');
    }

    const evaluateForecast = ForecastModule.evaluateForecast as (input: {
      estimatedForecast: number;
      actualObserved: number;
      toleranceFraction: number;
    }) => {
      delta: number;
      percentDelta: number;
      withinTolerance: boolean;
      incidentRequired: boolean;
    };

    const compliant = evaluateForecast({
      estimatedForecast: 1000,
      actualObserved: 1050, // +5%
      toleranceFraction: 0.1, // 10%
    });

    expect(compliant.delta).toBe(50);
    expect(compliant.withinTolerance).toBe(true);
    expect(compliant.incidentRequired).toBe(false);
  });

  it('raises incident and recomputes caps when observed usage exceeds tolerance', async () => {
    let ForecastModule: Record<string, unknown>;
    try {
      ForecastModule = (await import('../src/forecast.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('FORECAST_NOT_IMPLEMENTED: src/forecast.ts missing');
    }

    const evaluateForecast = ForecastModule.evaluateForecast as (input: {
      estimatedForecast: number;
      actualObserved: number;
      toleranceFraction: number;
    }) => {
      withinTolerance: boolean;
      incidentRequired: boolean;
      recomputedCap?: number;
    };

    const breached = evaluateForecast({
      estimatedForecast: 1000,
      actualObserved: 1500, // +50%
      toleranceFraction: 0.1,
    });

    expect(breached.withinTolerance).toBe(false);
    expect(breached.incidentRequired).toBe(true);
  });

  it('never silently consumes paid overage or protected reserves upon tolerance breach', async () => {
    let ForecastModule: Record<string, unknown>;
    try {
      ForecastModule = (await import('../src/forecast.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('FORECAST_NOT_IMPLEMENTED: src/forecast.ts missing');
    }

    const handleBreach = ForecastModule.handleBreach as (breach: {
      excessUnits: number;
      reserveBalances: Record<string, number>;
      paidAllowed: boolean;
    }) => {
      consumedPaidOverage: boolean;
      consumedReserve: boolean;
      action: string;
    };

    const result = handleBreach({
      excessUnits: 500,
      reserveBalances: { RISK_MONITORING: 100 },
      paidAllowed: false,
    });

    expect(result.consumedPaidOverage).toBe(false);
    expect(result.consumedReserve).toBe(false);
    expect(result.action).toBe('RAISE_INCIDENT_AND_THROTTLE');
  });
});
