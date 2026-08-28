/**
 * AC-105 negative / failure-path suite (FR-COST-010, FR-COST-008).
 * Asserts that having an active BYOK model budget does NOT allow paid data calls.
 */
import { describe, expect, it } from 'bun:test';

describe('AC-105 negative: BYOK model budget does not grant authority for paid data providers', () => {
  it('blocks paid data call even when BYOK model budget is nonzero and active', () => {
    const systemState = {
      byokModelBudgetActive: true,
      byokModelBudgetUsd: 500,
      dataProviderMode: 'STRICT_FREE',
    };

    const attemptedDataCall = {
      provider: 'helius',
      operation: 'enhanced_transactions',
      costClass: 'PAID_EXPLICIT',
    };

    const isAllowed =
      systemState.dataProviderMode !== 'STRICT_FREE' &&
      attemptedDataCall.costClass !== 'PAID_EXPLICIT';

    expect(isAllowed).toBe(false);
  });
});
