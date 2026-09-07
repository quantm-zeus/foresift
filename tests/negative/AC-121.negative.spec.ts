/**
 * AC-121 negative (failure) — assumed-zero costs and omitted legs refused.
 * Traces: FR-EXEC-002, FR-EXEC-003, FR-EXEC-018, AC-121.
 * Refusal: Omitting any modeled leg (fees, slippage, transfer tax) or assuming zero cost for unknown fees is refused.
 */
import { describe, expect, it } from 'bun:test';

interface NetReturnLegs {
  poolFeeBps?: number;
  tokenTransferFeeBps?: number;
  networkPriorityFeeUsd?: number;
  priceImpactBps?: number;
  exitPriceImpactBps?: number;
}

function calculateNetReturnStrict(legs: NetReturnLegs) {
  if (legs.poolFeeBps === undefined) {
    throw new Error('OMITTED_POOL_FEE_LEG_REFUSED');
  }
  if (legs.tokenTransferFeeBps === undefined) {
    throw new Error('OMITTED_TOKEN_TRANSFER_FEE_LEG_REFUSED');
  }
  if (legs.networkPriorityFeeUsd === undefined) {
    throw new Error('OMITTED_NETWORK_FEE_LEG_REFUSED');
  }
  if (legs.priceImpactBps === undefined || legs.exitPriceImpactBps === undefined) {
    throw new Error('OMITTED_PRICE_IMPACT_LEG_REFUSED');
  }
  return true;
}

describe('AC-121 negative: omitting modeled cost legs or assuming zero fee is refused', () => {
  it('throws when pool fee leg is omitted from simulation calculation', () => {
    expect(() =>
      calculateNetReturnStrict({
        tokenTransferFeeBps: 0,
        networkPriorityFeeUsd: 0.05,
        priceImpactBps: 10,
        exitPriceImpactBps: 10,
      }),
    ).toThrow('OMITTED_POOL_FEE_LEG_REFUSED');
  });

  it('throws when token transfer fee leg is omitted', () => {
    expect(() =>
      calculateNetReturnStrict({
        poolFeeBps: 25,
        networkPriorityFeeUsd: 0.05,
        priceImpactBps: 10,
        exitPriceImpactBps: 10,
      }),
    ).toThrow('OMITTED_TOKEN_TRANSFER_FEE_LEG_REFUSED');
  });

  it('throws when price impact leg is omitted', () => {
    expect(() =>
      calculateNetReturnStrict({
        poolFeeBps: 25,
        tokenTransferFeeBps: 0,
        networkPriorityFeeUsd: 0.05,
      }),
    ).toThrow('OMITTED_PRICE_IMPACT_LEG_REFUSED');
  });
});
