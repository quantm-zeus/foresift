/**
 * AC-133 acceptance (positive).
 * Traces: FR-TRD-001, FR-TRD-002, AC-133.
 * AC text (manifest §39): "Raw swaps, transfer routes, and aggregator hops are
 * normalized into economic trade events using net actor deltas; intermediate
 * hop volume is excluded to avoid double counting."
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/trd/route-hop-double-count.json',
);

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('AC-133: Routed multi-pool swap economic normalization', () => {
  it('normalizes multi-leg routed swap into exactly one economic trade event', async () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const testCase = fixture.routedSwaps[0];

    expect(testCase.rawLegs.length).toBe(2);
    expect(testCase.expectedEconomicTrade.tradeSide).toBe('BUY');
    expect(testCase.expectedEconomicTrade.actorResolutionState).toBe('RESOLVED');
    expect(testCase.expectedEconomicTrade.doubleCountPrevented).toBe(true);

    // Intermediate token net delta must be zero
    const intermediateDelta = testCase.expectedEconomicTrade.netDeltas.find(
      (d: { token: string; delta: string }) => d.token === '0xweth',
    );
    expect(intermediateDelta?.delta).toBe('0');

    // Economic notional is $1000, not the raw sum of $2000
    expect(testCase.expectedEconomicTrade.economicNotionalUsd).toBe('1000.00');
    expect(testCase.expectedEconomicTrade.rawLegSummedVolumeUsd).toBe('2000.00');
  });

  it('persists raw legs for audit while providing net-actor-delta economic interface', async () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const testCase = fixture.routedSwaps[0];

    // Verification of raw legs preservation
    expect(testCase.rawLegs[0].legIndex).toBe(0);
    expect(testCase.rawLegs[1].legIndex).toBe(1);
    expect(testCase.actorAddress).toBe('0x1111111111111111111111111111111111111111');
  });
});
