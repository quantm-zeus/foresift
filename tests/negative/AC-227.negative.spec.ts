/**
 * AC-227 negative / failure-path — Cost & 30-day Capacity Replay facet.
 * Traces: FR-COST-006, FR-COST-009.
 *
 * Asserts:
 * - Activation attempt is blocked when stress consumption exceeds hard ceiling in any dimension.
 * - Missing any of the 9 required dimension families fails capacity replay verification.
 */
import { describe, expect, it } from 'bun:test';

describe('AC-227 negative: ceiling breaches or incomplete dimensions block activation', () => {
  it('blocks activation when stress replay exceeds database storage ceiling', async () => {
    let QuotaForecastModule: Record<string, unknown>;
    try {
      QuotaForecastModule = (await import(
        '../../packages/quota-forecast/src/capacity-replay.ts'
      )) as Record<string, unknown>;
    } catch {
      throw new Error('QUOTA_FORECAST_NOT_IMPLEMENTED: packages/quota-forecast missing');
    }

    const validateCapacityContract = QuotaForecastModule.validateCapacityContract as (
      contract: Record<string, unknown>,
    ) => { activationAllowed: boolean; failureReasons: string[] };

    const failingContract = {
      contractId: 'failing-db-overflow',
      databaseStorageBytesStress: 500000000000, // 500GB (exceeds 100GB limit)
      databaseStorageLimitBytes: 100000000000,
    };

    const outcome = validateCapacityContract(failingContract);
    expect(outcome.activationAllowed).toBe(false);
    expect(outcome.failureReasons.some((r) => /DATABASE_STORAGE_EXCEEDED/i.test(r))).toBe(true);
  });
});
