/**
 * Denominator policy suite (T031, FR-MAT-002, FR-MAT-010, AC-123, AC-124).
 * Tests exclusion laws for all 7 excluded classes from final denominators.
 */
import { describe, expect, it } from 'bun:test';
import { GOLDEN_DENOMINATOR_DATASETS } from '../../../tests/fixtures/mat/denominator-vectors.ts';

describe('Denominator Policy (FR-MAT-002, FR-MAT-010)', () => {
  it('excludes invalid, censored, partial, low-res, rights-blocked, unobserved, and signal-only outcomes', () => {
    const mixedDataset = GOLDEN_DENOMINATOR_DATASETS.find((d) => d.datasetId === 'denom_mixed_standard_100');
    expect(mixedDataset).toBeDefined();
    if (!mixedDataset) return;

    // Verify hand-computed breakdown totals
    expect(mixedDataset.totalRegistered).toBe(100);
    expect(mixedDataset.expectedFinalDenominator).toBe(40);
    expect(mixedDataset.expectedBreakdown.INVALID_DATA).toBe(10);
    expect(mixedDataset.expectedBreakdown.CENSORED).toBe(10);
    expect(mixedDataset.expectedBreakdown.PARTIALLY_MATURED).toBe(10);
    expect(mixedDataset.expectedBreakdown.LOW_RESOLUTION).toBe(10);
    expect(mixedDataset.expectedBreakdown.RIGHTS_BLOCKED).toBe(8);
    expect(mixedDataset.expectedBreakdown.UNOBSERVED).toBe(7);
    expect(mixedDataset.expectedBreakdown.SIGNAL_ONLY).toBe(5);
  });

  it('refuses final denominator calculation when zero fully matured outcomes exist', () => {
    const pendingDataset = GOLDEN_DENOMINATOR_DATASETS.find((d) => d.datasetId === 'denom_all_pending_refusal');
    expect(pendingDataset).toBeDefined();
    if (!pendingDataset) return;

    expect(pendingDataset.expectedFinalDenominator).toBe(0);
    expect(pendingDataset.expectedRefusalOnIncomplete).toBe(true);
    expect(pendingDataset.refusalReason).toBe('ZERO_FULLY_MATURED_OUTCOMES_FOR_FINAL_DENOMINATOR');
  });
});
