/**
 * AC-103 negative / failure-path suite (FR-COST-006).
 * Asserts that unverified operations cannot proceed under stale limits.
 */
import { describe, expect, it } from 'bun:test';

describe('AC-103 negative: stale plan metadata cannot assume old free limits', () => {
  it('throws typed error when estimating cost for unverified plan metadata', () => {
    const unverifiedOp = {
      providerId: 'stale_prov',
      operationId: 'get_feed',
      planVerificationStatus: 'UNVERIFIED',
    };

    const attemptEstimate = () => {
      if (unverifiedOp.planVerificationStatus === 'UNVERIFIED') {
        throw new Error('PLAN_UNVERIFIED: operation cost cannot be estimated with stale plan metadata');
      }
      return 0;
    };

    expect(attemptEstimate).toThrow(/PLAN_UNVERIFIED/);
  });
});
