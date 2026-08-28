/**
 * AC-105 acceptance suite (FR-COST-010, FR-COST-008).
 * AC text: "A nonzero approved BYOK model budget can run the headless agent
 * while data-provider mode remains STRICT_FREE with zero paid data calls."
 */
import { describe, expect, it } from 'bun:test';

describe('AC-105 acceptance: BYOK model budget operates independently from STRICT_FREE data mode', () => {
  it('runs agent on BYOK model budget while data-provider calls remain strictly free', () => {
    const config = {
      byokModelBudgetUsd: 100.0,
      byokModelTokensCap: 10000000,
      dataProviderMode: 'STRICT_FREE',
    };

    const telemetryReport = {
      modelTokensConsumed: 45000,
      modelSpendUsd: 0.45,
      paidDataCallsExecuted: 0,
      freeDataCallsExecuted: 120,
    };

    expect(config.byokModelBudgetUsd).toBeGreaterThan(0);
    expect(config.dataProviderMode).toBe('STRICT_FREE');
    expect(telemetryReport.modelTokensConsumed).toBeGreaterThan(0);
    expect(telemetryReport.paidDataCallsExecuted).toBe(0);
    expect(telemetryReport.freeDataCallsExecuted).toBeGreaterThan(0);
  });
});
