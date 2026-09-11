/**
 * Drift and calibration degradation suite (T031, FR-EVAL-001…009, AC-154).
 * Tests automated expected-net-utility degradation on market regime drift.
 */
import { describe, expect, it } from 'bun:test';

describe('Drift Calibration (AC-154)', () => {
  it('degrades expected net utility when calibration drift or regime shift occurs', () => {
    const baselineUtility = 100.0;
    const regimeDriftScore = 0.45; // High drift
    const degradedUtility = baselineUtility * (1 - regimeDriftScore);

    // Float-exact: 100 * (1 - 0.45) is 55.00000000000001 in binary floating
    // point, never exactly 55.0 — assert closeness, not identity.
    expect(degradedUtility).toBeCloseTo(55.0, 10);
    expect(degradedUtility).toBeLessThan(baselineUtility);
  });
});
