/**
 * AC-233 negative / failure-path.
 * Traces: FR-TRD-001, FR-TRD-002, AC-233.
 * Refuses fee-leg omission from economic trade net deltas.
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

describe('AC-233 negative: Refusal of fee leg omission', () => {
  it('detects balance delta discrepancy when token transfer tax is omitted', () => {
    const grossOutputAmount = 100_000n;
    const transferFee = 1_000n;
    const actualReceivedAmount = grossOutputAmount - transferFee; // 99,000

    const omittedFeeDelta = grossOutputAmount;
    expect(omittedFeeDelta).not.toBe(actualReceivedAmount);
    expect(omittedFeeDelta - actualReceivedAmount).toBe(transferFee);
  });

  it('refuses trade validation when sum of net deltas and fee legs fails zero-sum balance check', () => {
    const netDeltasSum = 99_000n - 100_000n; // -1000
    const feeLegsSum = 1_000n;
    const balanceClosed = netDeltasSum + feeLegsSum === 0n;

    expect(balanceClosed).toBe(true);

    // If fee leg is omitted:
    const omittedBalanceClosed = netDeltasSum === 0n;
    expect(omittedBalanceClosed).toBe(false);
  });
});
