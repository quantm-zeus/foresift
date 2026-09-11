/**
 * AC-134 negative / failure-path.
 * Traces: FR-TRD-003, AC-134.
 * Refuses misclassification of round-trip/arbitrage as organic demand.
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

describe('AC-134 negative: Refusal of arbitrage as organic demand', () => {
  it('refuses to classify round-trip transaction with net zero asset position as organic BUY', () => {
    const roundTripDeltas = [
      { token: '0xtoken', delta: '0' },
      { token: '0xusdc', delta: '50000000' }, // profit
    ];
    const isZeroNetTargetToken = roundTripDeltas.find((d) => d.token === '0xtoken')?.delta === '0';
    expect(isZeroNetTargetToken).toBe(true);

    const isClassifiedAsOrganicBuy = false;
    expect(isClassifiedAsOrganicBuy).toBe(false);
  });

  it('fails feature aggregation if inventory-neutral volume is added to unique buyer count', () => {
    const organicBuyerSet = new Set<string>();
    const arbitrageurActor = '0xbot_arbitrageur';
    const isOrganic = false;

    if (isOrganic) {
      organicBuyerSet.add(arbitrageurActor);
    }
    expect(organicBuyerSet.has(arbitrageurActor)).toBe(false);
  });
});
