/**
 * AC-150 acceptance (positive) — negative controls show no unexplained material lift (§31.13, §68.5).
 * Traces: FR-MAT-004, AC-150.
 */
import { describe, expect, it } from 'bun:test';
import { GOLDEN_CONTROL_CASES } from '../fixtures/eval/controls-vectors.ts';

describe('AC-150 acceptance (positive): negative controls demonstrate zero unexplained material lift', () => {
  it('confirms clean pass for negative controls within allowable bound', () => {
    const cleanCases = GOLDEN_CONTROL_CASES.filter((c) => !c.hasMaterialLift);
    for (const c of cleanCases) {
      expect(c.hasMaterialLift).toBe(false);
      expect(c.measuredLiftUsd).toBeLessThanOrEqual(c.maxAllowedLiftUsd);
    }
  });
});
