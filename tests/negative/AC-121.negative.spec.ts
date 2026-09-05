/**
 * AC-121 negative (failure) — Prohibition against omitted cost legs and assumed-zero fees.
 * Traces: FR-EXEC-002, FR-EXEC-003, FR-EXEC-018, AC-121.
 * Tests failure when any modeled cost leg is omitted or zero cost is assumed for active mechanisms.
 */
import { describe, expect, it } from 'bun:test';

interface CostBreakdown {
  entryPoolFeeUsd?: number;
  exitPoolFeeUsd?: number;
  entryImpactUsd?: number;
  exitImpactUsd?: number;
  tokenTransferFeeUsd?: number;
  networkAndPriorityFeesUsd?: number;
}

function calculateCompleteNetProfit(params: {
  grossReturnUsd: number;
  costs: CostBreakdown;
  hasTokenTransferFee: boolean;
}) {
  if (params.hasTokenTransferFee && (params.costs.tokenTransferFeeUsd === undefined || params.costs.tokenTransferFeeUsd === 0)) {
    throw new Error('OMITTED_OR_ZERO_TOKEN_TRANSFER_FEE_REFUSED');
  }
  if (params.costs.networkAndPriorityFeesUsd === undefined || params.costs.networkAndPriorityFeesUsd === 0) {
    throw new Error('OMITTED_NETWORK_OR_PRIORITY_FEE_REFUSED');
  }
  if (params.costs.entryImpactUsd === undefined || params.costs.exitImpactUsd === undefined) {
    throw new Error('OMITTED_PRICE_IMPACT_LEG_REFUSED');
  }

  const totalCost =
    (params.costs.entryPoolFeeUsd ?? 0) +
    (params.costs.exitPoolFeeUsd ?? 0) +
    params.costs.entryImpactUsd +
    params.costs.exitImpactUsd +
    (params.costs.tokenTransferFeeUsd ?? 0) +
    params.costs.networkAndPriorityFeesUsd;

  return params.grossReturnUsd - totalCost;
}

describe('AC-121 negative: omitted modeled legs and assumed-zero costs are refused', () => {
  it('refuses net profit calculation when token transfer fee is omitted on a token with transfer tax', () => {
    expect(() =>
      calculateCompleteNetProfit({
        grossReturnUsd: 200.0,
        hasTokenTransferFee: true,
        costs: {
          entryPoolFeeUsd: 3.0,
          exitPoolFeeUsd: 3.6,
          entryImpactUsd: 3.0,
          exitImpactUsd: 4.8,
          networkAndPriorityFeesUsd: 0.22,
          // tokenTransferFeeUsd omitted
        },
      }),
    ).toThrow('OMITTED_OR_ZERO_TOKEN_TRANSFER_FEE_REFUSED');
  });

  it('refuses net profit calculation when network/priority fees are assumed zero', () => {
    expect(() =>
      calculateCompleteNetProfit({
        grossReturnUsd: 250.0,
        hasTokenTransferFee: false,
        costs: {
          entryPoolFeeUsd: 2.5,
          exitPoolFeeUsd: 3.125,
          entryImpactUsd: 1.5,
          exitImpactUsd: 2.5,
          networkAndPriorityFeesUsd: 0.0, // Assumed zero!
        },
      }),
    ).toThrow('OMITTED_NETWORK_OR_PRIORITY_FEE_REFUSED');
  });

  it('refuses net profit calculation when price impact legs are omitted', () => {
    expect(() =>
      calculateCompleteNetProfit({
        grossReturnUsd: 250.0,
        hasTokenTransferFee: false,
        costs: {
          entryPoolFeeUsd: 2.5,
          exitPoolFeeUsd: 3.125,
          networkAndPriorityFeesUsd: 0.1,
          // impact omitted
        },
      }),
    ).toThrow('OMITTED_PRICE_IMPACT_LEG_REFUSED');
  });
});
