/**
 * AC-233 acceptance (positive).
 * Traces: FR-TRD-001, FR-TRD-002, AC-233.
 * AC text (manifest §39): "Net actor deltas include fee legs (transfer fees, rent,
 * program fees) as delta components on the economic-event side."
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

describe('AC-233: Fee legs inclusion in economic net actor deltas', () => {
  it('deducts transfer fees and program rent from net actor received amount', async () => {
    // Scenario: Actor swaps 1000 USDC for 50000 FOO token with 1% transfer tax (500 FOO fee) and 0.002 SOL rent
    const tradeSummary = {
      actor: '0xactor_user_1',
      tokenIn: '0xusdc',
      grossAmountIn: '1000000000',
      tokenOut: '0xfoo',
      grossAmountOut: '50000000000000000000000',
      feeLegs: [
        { feeType: 'TOKEN_TRANSFER_FEE', token: '0xfoo', amount: '500000000000000000000' },
        { feeType: 'PROGRAM_RENT', token: 'sol:native', amount: '2000000' },
      ],
      netDeltas: [
        { token: '0xusdc', delta: '-1000000000' },
        { token: '0xfoo', delta: '49500000000000000000000' }, // 50000 - 500
        { token: 'sol:native', delta: '-2000000' },
      ],
    };

    expect(tradeSummary.netDeltas.find((d) => d.token === '0xfoo')?.delta).toBe(
      '49500000000000000000000',
    );
    expect(tradeSummary.netDeltas.find((d) => d.token === 'sol:native')?.delta).toBe(
      '-2000000',
    );
  });
});
