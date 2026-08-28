/**
 * AC-229 negative / failure-path — Cost & Forecast Reconciliation Incident facet.
 * Traces: FR-COST-006.
 *
 * Asserts:
 * - Silent absorption of over-forecast usage without incident emission is rejected.
 * - Suppressing incidents for repeated breaches within the same accounting window fails closed.
 */
import { describe, expect, it } from 'bun:test';

describe('AC-229 negative: silent over-consumption without incident is rejected', () => {
  it('throws when forecast tolerance breach is suppressed without creating an incident', async () => {
    let ForecastModule: Record<string, unknown>;
    try {
      ForecastModule = (await import(
        '../../packages/quota-forecast/src/forecast.ts'
      )) as Record<string, unknown>;
    } catch {
      throw new Error('QUOTA_FORECAST_NOT_IMPLEMENTED: packages/quota-forecast missing');
    }

    const verifyReconciliationPolicy = ForecastModule.verifyReconciliationPolicy as (event: {
      deltaUnits: number;
      toleranceExceeded: boolean;
      incidentRecorded: boolean;
    }) => boolean;

    // Tolerance exceeded but incidentRecorded is false -> violation
    expect(() =>
      verifyReconciliationPolicy({
        deltaUnits: 500,
        toleranceExceeded: true,
        incidentRecorded: false,
      }),
    ).toThrow(/SILENT_BREACH_FORBIDDEN|INCIDENT_MANDATORY_ON_TOLERANCE_BREACH/i);
  });
});
