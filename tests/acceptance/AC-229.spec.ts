/**
 * AC-229 acceptance (positive) — Cost & Forecast Reconciliation Incident facet.
 * Traces: FR-COST-006.
 * AC text: "Actual usage exceeding the capacity forecast tolerance creates an incident,
 * recomputes admission limits, and does not silently consume paid overage or protected reserve."
 *
 * Asserts:
 * - When actual usage exceeds forecasted usage by more than the configured tolerance fraction:
 *   1. An incident record is created in the incident ledger.
 *   2. Admission control limits are recomputed and throttled.
 *   3. No silent consumption of paid overage or protected reserves occurs.
 *   4. A second over-consumption event in the same period still raises an incident.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('AC-229 acceptance: forecast tolerance breach triggers incident & recomputation', () => {
  it('creates incident and recomputes limits without silent paid/reserve consumption', async () => {
    let ForecastModule: Record<string, unknown>;
    try {
      ForecastModule = (await import(
        '../../packages/quota-forecast/src/forecast.ts'
      )) as Record<string, unknown>;
    } catch {
      throw new Error('QUOTA_FORECAST_NOT_IMPLEMENTED: packages/quota-forecast missing');
    }

    const ForecastReconciliationEngine = ForecastModule.ForecastReconciliationEngine as new (
      engine: unknown,
    ) => {
      reconcileUsage: (params: {
        operation: string;
        forecastUnits: number;
        actualUnits: number;
        tolerancePercent: number;
      }) => Promise<{
        incidentCreated: boolean;
        incidentId?: string;
        recomputedLimit: number;
        consumedPaidOverage: boolean;
        consumedReserve: boolean;
      }>;
    };

    const recon = new ForecastReconciliationEngine(tdb.engine);

    // 1000 forecast, 1600 actual (+60% > 15% tolerance)
    const result1 = await recon.reconcileUsage({
      operation: 'gmgn:token_security',
      forecastUnits: 1000,
      actualUnits: 1600,
      tolerancePercent: 0.15,
    });

    expect(result1.incidentCreated).toBe(true);
    expect(result1.incidentId).toBeDefined();
    expect(result1.consumedPaidOverage).toBe(false);
    expect(result1.consumedReserve).toBe(false);
    expect(result1.recomputedLimit).toBeLessThan(1600);

    // Second over-consume in same period
    const result2 = await recon.reconcileUsage({
      operation: 'gmgn:token_security',
      forecastUnits: result1.recomputedLimit,
      actualUnits: result1.recomputedLimit + 500,
      tolerancePercent: 0.15,
    });

    expect(result2.incidentCreated).toBe(true);
  });
});
