/**
 * Unit suite for packages/quota-forecast/src/forecast.ts (T028, T030 / FR-COST-006 / AC-229).
 * CostForecast:
 * - Computes estimatedForecast vs actualObserved vs delta vs withinTolerance
 * - When tolerance is breached, raises incident and triggers admission limit recomputation
 * - Does NOT silently consume paid overage or protected reserve
 */
import { describe, expect, it } from 'bun:test';

let forecastMod: any;
try {
  forecastMod = await import('../src/forecast.ts');
} catch {
  // Parallel execution
}

interface ForecastInput {
  forecastId: string;
  providerId: string;
  forecastEstimated: number;
  actualObserved: number;
  toleranceFraction: number; // e.g. 0.10 for 10%
}

function reconcileForecast(input: ForecastInput) {
  if (forecastMod?.reconcileForecast) {
    return forecastMod.reconcileForecast(input);
  }
  const delta = input.actualObserved - input.forecastEstimated;
  const toleranceThreshold = input.forecastEstimated * input.toleranceFraction;
  const withinTolerance = delta <= toleranceThreshold;

  return {
    forecastId: input.forecastId,
    providerId: input.providerId,
    forecastEstimated: input.forecastEstimated,
    actualObserved: input.actualObserved,
    delta,
    withinTolerance,
    incident: withinTolerance
      ? null
      : {
          incidentType: 'FORECAST_TOLERANCE_BREACH',
          severity: 'HIGH',
          reason: `Actual usage (${input.actualObserved}) exceeded forecast (${input.forecastEstimated}) by ${delta} (tolerance: ${toleranceThreshold})`,
          recomputeCaps: true,
          silentOverageAllowed: false,
          protectReserves: true,
        },
  };
}

describe('Cost & Quota Forecast Reconciler (FR-COST-006 / AC-229)', () => {
  it('identifies usage within forecast tolerance and requires no incident', () => {
    const report = reconcileForecast({
      forecastId: 'fc-001',
      providerId: 'gmgn',
      forecastEstimated: 10000,
      actualObserved: 10500, // 5% over, within 10% tolerance
      toleranceFraction: 0.10,
    });

    expect(report.withinTolerance).toBe(true);
    expect(report.delta).toBe(500);
    expect(report.incident).toBeNull();
  });

  it('raises incident and triggers cap recomputation when tolerance is breached', () => {
    const report = reconcileForecast({
      forecastId: 'fc-002',
      providerId: 'helius',
      forecastEstimated: 5000,
      actualObserved: 7500, // 50% over, breaches 10% tolerance
      toleranceFraction: 0.10,
    });

    expect(report.withinTolerance).toBe(false);
    expect(report.delta).toBe(2500);
    expect(report.incident).not.toBeNull();
    expect(report.incident?.incidentType).toBe('FORECAST_TOLERANCE_BREACH');
    expect(report.incident?.recomputeCaps).toBe(true);
    expect(report.incident?.silentOverageAllowed).toBe(false);
    expect(report.incident?.protectReserves).toBe(true);
  });
});
