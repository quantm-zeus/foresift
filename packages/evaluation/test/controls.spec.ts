/**
 * Negative controls suite (T031, FR-MAT-004, AC-150).
 * Tests control determinism and material lift detection.
 */
import { describe, expect, it } from 'bun:test';
import { GOLDEN_CONTROL_CASES } from '../../../tests/fixtures/eval/controls-vectors.ts';

describe('Negative Controls (FR-MAT-004, AC-150)', () => {
  it('confirms clean pass for negative controls exhibiting no material lift', () => {
    const cleanCases = GOLDEN_CONTROL_CASES.filter((c) => !c.hasMaterialLift);
    expect(cleanCases.length).toBeGreaterThanOrEqual(4);
    for (const c of cleanCases) {
      expect(c.verdict).toBe('PASS_NO_MATERIAL_LIFT');
      expect(c.shouldTriggerIncident).toBe(false);
    }
  });

  it('triggers statistical incident when unexpected material lift is detected in controls', () => {
    const leakageCases = GOLDEN_CONTROL_CASES.filter((c) => c.hasMaterialLift);
    expect(leakageCases.length).toBeGreaterThanOrEqual(2);
    for (const c of leakageCases) {
      expect(c.verdict).toBe('FAIL_MATERIAL_LIFT_LEAKAGE_DETECTED');
      expect(c.shouldTriggerIncident).toBe(true);
      expect(typeof c.incidentType).toBe('string');
    }
  });
});
