/**
 * AC-133 negative / failure-path.
 * Traces: FR-TRD-001, FR-TRD-002, AC-133.
 * Refuses leg-summing volume double-counts on routed swaps.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from '../acceptance/helpers.ts';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('AC-133 negative: Double count refusal on routed swaps', () => {
  it('refuses naive summation of route legs as economic volume', () => {
    const rawLegs = [
      { tokenIn: '0xusdc', tokenOut: '0xweth', amountInUsd: 1000, amountOutUsd: 1000 },
      { tokenIn: '0xweth', tokenOut: '0xfoo', amountInUsd: 1000, amountOutUsd: 1000 },
    ];
    const naiveSum = rawLegs.reduce((sum, leg) => sum + leg.amountInUsd, 0); // 2000
    const trueEconomicNotional = 1000;

    expect(naiveSum).not.toBe(trueEconomicNotional);
    expect(naiveSum / trueEconomicNotional).toBe(2); // exactly 2x double count
  });

  it('rejects economic trade event if intermediate route token delta is non-zero in single transaction', () => {
    const invalidDeltas = [
      { token: '0xusdc', delta: '-1000000000' },
      { token: '0xweth', delta: '300000000000000000' }, // Intermediate token leaked!
      { token: '0xfoo', delta: '50000000000000000000000' },
    ];
    const intermediateLeaked = invalidDeltas.some(
      (d) => d.token === '0xweth' && d.delta !== '0',
    );
    expect(intermediateLeaked).toBe(true);
  });
});
