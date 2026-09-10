/**
 * Missed Opportunity Analyzer suite (T031, FR-EVAL-005, AC-041).
 * Tests error taxonomy completeness and delay decompositions.
 */
import { describe, expect, it } from 'bun:test';
import {
  ERROR_TAXONOMY_MEMBERS,
  GOLDEN_MISSED_OPPORTUNITY_CASES,
} from '../../../tests/fixtures/eval/missed-opportunities.ts';

describe('Missed Opportunity Analyzer (FR-EVAL-005, AC-041)', () => {
  it('covers all 7 reachable error taxonomy members', () => {
    expect(ERROR_TAXONOMY_MEMBERS.length).toBe(7);
    const covered = new Set(GOLDEN_MISSED_OPPORTUNITY_CASES.map((c) => c.taxonomyClassification));
    for (const member of ERROR_TAXONOMY_MEMBERS) {
      expect(covered.has(member)).toBe(true);
    }
  });

  it('verifies delay decomposition integrity (sum of component delays equals total delay)', () => {
    for (const c of GOLDEN_MISSED_OPPORTUNITY_CASES) {
      const sum =
        c.delayDecomposition.ingestionDelayMs +
        c.delayDecomposition.scoringDelayMs +
        c.delayDecomposition.deliveryDelayMs +
        c.delayDecomposition.executionDelayMs;
      expect(sum).toBe(c.delayDecomposition.totalDelayMs);
    }
  });
});
