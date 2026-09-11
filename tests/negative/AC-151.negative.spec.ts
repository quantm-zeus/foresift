/**
 * AC-151 negative (failure) — relying on naive i.i.d. confidence intervals without cluster diagnostics is refused.
 * Traces: FR-MAT-005, AC-151.
 */
import { describe, expect, it } from 'bun:test';

function validateIntervalReport(report: {
  naiveOnly: boolean;
  effectiveSampleSize?: number;
  clusterCount?: number;
}) {
  if (report.naiveOnly || !report.effectiveSampleSize || !report.clusterCount) {
    throw new Error('CLUSTERED_UNCERTAINTY_AND_ESS_REQUIRED');
  }
  return true;
}

describe('AC-151 negative: naive confidence intervals without clustered ESS diagnostics are refused', () => {
  it('throws when interval report omits cluster count and ESS', () => {
    expect(() =>
      validateIntervalReport({
        naiveOnly: true,
      }),
    ).toThrow('CLUSTERED_UNCERTAINTY_AND_ESS_REQUIRED');
  });
});
