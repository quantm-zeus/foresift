/**
 * Baseline comparison suite (T031, FR-EVAL-004, AC-042).
 * Tests identical universe and cutoff timestamp invariants for baseline comparisons.
 */
import { describe, expect, it } from 'bun:test';
import { GOLDEN_BASELINE_CASES } from '../../../tests/fixtures/eval/baselines.ts';

describe('Baselines (FR-EVAL-004, AC-042)', () => {
  it('allows baseline comparison when universe and cutoffs are identical', () => {
    const validComp = GOLDEN_BASELINE_CASES.find((c) => c.caseId === 'base_comp_valid_champion_vs_prev');
    expect(validComp?.comparisonValid).toBe(true);
    expect(validComp?.expectedMaterialLift).toBe(850.0);
  });

  it('refuses baseline comparison when universes or cutoff timestamps differ', () => {
    const diffUniverse = GOLDEN_BASELINE_CASES.find((c) => c.caseId === 'base_comp_refused_mismatched_universe');
    expect(diffUniverse?.comparisonValid).toBe(false);
    expect(diffUniverse?.refusalReason).toBe('BASELINE_COMPARISON_REQUIRES_IDENTICAL_FROZEN_UNIVERSE');

    const diffCutoff = GOLDEN_BASELINE_CASES.find((c) => c.caseId === 'base_comp_refused_mismatched_cutoff');
    expect(diffCutoff?.comparisonValid).toBe(false);
    expect(diffCutoff?.refusalReason).toBe('BASELINE_COMPARISON_REQUIRES_IDENTICAL_TIME_CUTOFF');
  });
});
