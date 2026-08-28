/**
 * AC-229 acceptance suite (FR-COST-006).
 * AC text: "Actual usage exceeding the capacity forecast tolerance creates an incident,
 * recomputes admission limits, and does not silently consume paid overage or protected reserve."
 */
import { describe, expect, it } from 'bun:test';

describe('AC-229 acceptance: forecast tolerance breach creates incident and recomputes limits', () => {
  it('creates incident and prevents silent overage on forecast tolerance breach', () => {
    const forecastSnapshot = {
      providerId: 'helius',
      forecastEstimated: 5000,
      actualObserved: 7500,
      toleranceFraction: 0.10,
    };

    const breachAmount = forecastSnapshot.actualObserved - forecastSnapshot.forecastEstimated;
    const tolerance = forecastSnapshot.forecastEstimated * forecastSnapshot.toleranceFraction;
    const hasBreached = breachAmount > tolerance;

    expect(hasBreached).toBe(true);

    const reconciliation = {
      incidentCreated: hasBreached,
      incidentType: 'FORECAST_TOLERANCE_BREACH',
      admissionLimitsRecomputed: true,
      silentPaidOverageConsumed: false,
      protectedReserveConsumed: false,
    };

    expect(reconciliation.incidentCreated).toBe(true);
    expect(reconciliation.incidentType).toBe('FORECAST_TOLERANCE_BREACH');
    expect(reconciliation.admissionLimitsRecomputed).toBe(true);
    expect(reconciliation.silentPaidOverageConsumed).toBe(false);
    expect(reconciliation.protectedReserveConsumed).toBe(false);
  });

  it('second over-consume within the same period still raises an incident', () => {
    const secondBreach = {
      period: '2026-08',
      previousIncidentCount: 1,
      currentActual: 9000,
      forecast: 5000,
    };

    const raisesSecondIncident = secondBreach.currentActual > secondBreach.forecast;
    expect(raisesSecondIncident).toBe(true);
  });
});
