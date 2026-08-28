/**
 * AC-103 acceptance (positive) — Cost & Plan Verification facet.
 * Traces: FR-COST-006.
 * AC text: "Provider plan metadata becoming unverified transitions affected operations
 * to `UNVERIFIED`/blocked rather than assuming old free limits."
 *
 * Asserts:
 * - Provider plan metadata reaching expiration date immediately causes dependent operations
 *   to transition to UNVERIFIED and refuse admission.
 * - Re-verification (with fresh verification TTL) clears the UNVERIFIED state and restores admission.
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

describe('AC-103 acceptance: plan metadata unverified state blocks and re-verification restores', () => {
  it('blocks admission when provider plan expires and restores on re-verification', async () => {
    let ForecastModule: Record<string, unknown>;
    try {
      ForecastModule = (await import(
        '../../packages/quota-forecast/src/plan-verifier.ts'
      )) as Record<string, unknown>;
    } catch {
      throw new Error('QUOTA_FORECAST_NOT_IMPLEMENTED: packages/quota-forecast missing');
    }

    const PlanVerifier = ForecastModule.PlanVerifier as new (engine: unknown) => {
      isOperationAdmissible: (
        opId: string,
        asOf: string,
      ) => Promise<{ admissible: boolean; state: string }>;
      reVerifyOperation: (opId: string, ttlSeconds: number, asOf: string) => Promise<void>;
    };

    const verifier = new PlanVerifier(tdb.engine);
    const opId = 'helius:raw_asset_query';

    // Evaluated at expired time
    const expiredOutcome = await verifier.isOperationAdmissible(opId, '2026-09-02T00:00:00Z');
    expect(expiredOutcome.admissible).toBe(false);
    expect(expiredOutcome.state).toBe('UNVERIFIED');

    // Re-verify with fresh 30-day TTL
    await verifier.reVerifyOperation(opId, 2592000, '2026-09-02T00:00:00Z');

    // Evaluated after re-verification
    const restoredOutcome = await verifier.isOperationAdmissible(opId, '2026-09-02T00:00:01Z');
    expect(restoredOutcome.admissible).toBe(true);
    expect(restoredOutcome.state).toBe('VERIFIED');
  });
});
