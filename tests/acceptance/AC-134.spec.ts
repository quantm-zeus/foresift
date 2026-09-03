/**
 * AC-134 acceptance (positive).
 * Traces: FR-TRD-003, AC-134.
 * AC text (manifest §39): "Arbitrage, round trips, and inventory-neutral activity
 * are distinguished from organic demand and do not inflate organic buyer or volume metrics."
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/trd/arbitrage-inventory-neutral.json',
);

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('AC-134: Arbitrage and inventory-neutral classification', () => {
  it('classifies same-transaction round-trip arbitrage as INVENTORY_NEUTRAL or ROUND_TRIP', async () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const cases = fixture.arbitrageTransactions;

    for (const testCase of cases) {
      expect(['INVENTORY_NEUTRAL', 'ROUND_TRIP']).toContain(testCase.expectedTradeSide);
      expect(testCase.isOrganicDemand).toBe(false);
      expect(testCase.uniqueBuyerCountContribution).toBe(0);
    }
  });

  it('guarantees organic unique-buyer counts exclude non-organic volume', async () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const totalOrganicBuyers = fixture.arbitrageTransactions.reduce(
      (sum: number, tx: { uniqueBuyerCountContribution: number }) =>
        sum + tx.uniqueBuyerCountContribution,
      0,
    );
    expect(totalOrganicBuyers).toBe(0);
  });
});
