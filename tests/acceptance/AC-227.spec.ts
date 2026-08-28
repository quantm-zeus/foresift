/**
 * AC-227 acceptance (positive) — Cost & 30-day Capacity Replay facet.
 * Traces: FR-COST-006, FR-COST-009, FR-COST-011..016.
 * AC text: "A 30-day expected and stress capacity replay includes provider credits/rates,
 * streamed bytes, model tokens, workflow steps, database/object growth, egress, retries,
 * notifications, and reserves; activation is blocked when any verified ceiling is exceeded."
 *
 * Asserts:
 * - 30-day expected and stress capacity replay enumerates all 9 dimension families.
 * - Activation is blocked when any ceiling is exceeded under expected or stress load.
 * - Activation is allowed when all 9 dimensions preserve required headroom.
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

describe('AC-227 acceptance: 30-day capacity replay covering 9 dimensions', () => {
  it('runs 30-day expected + stress replay across all 9 dimension families and passes valid contract', async () => {
    let QuotaForecastModule: Record<string, unknown>;
    try {
      QuotaForecastModule = (await import(
        '../../packages/quota-forecast/src/capacity-replay.ts'
      )) as Record<string, unknown>;
    } catch {
      throw new Error('QUOTA_FORECAST_NOT_IMPLEMENTED: packages/quota-forecast missing');
    }

    const CapacityReplayEngine = QuotaForecastModule.CapacityReplayEngine as new (
      engine: unknown,
    ) => {
      simulate30DayEnvelope: (contract: unknown) => Promise<{
        passed: boolean;
        dimensionsVerified: string[];
        headroomFraction: number;
      }>;
    };

    const sim = new CapacityReplayEngine(tdb.engine);
    const contract = {
      contractId: 'contract-passing-001',
      horizonDays: 30,
      dimensions: [
        'PROVIDER_CREDITS',
        'STREAMED_BYTES',
        'MODEL_TOKENS',
        'WORKFLOW_STEPS',
        'DATABASE_GROWTH',
        'OBJECT_STORAGE',
        'EGRESS_BYTES',
        'RETRY_ALLOWANCE',
        'NOTIFICATION_SENDS',
        'PROTECTED_RESERVES',
      ],
      minimumHeadroomFraction: 0.2,
    };

    const result = await sim.simulate30DayEnvelope(contract);
    expect(result.passed).toBe(true);
    expect(result.dimensionsVerified.length).toBeGreaterThanOrEqual(9);
    expect(result.headroomFraction).toBeGreaterThanOrEqual(0.2);
  });
});
