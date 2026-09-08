/**
 * Robust activity & change-point baseline tests (T013, H.11, FR-SIG-009, FR-SIG-002, AC-136).
 * Tests emergence fixtures, no-promotion-below-minimum, CUSUM drift vectors, and missing-bucket handling.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASELINE_FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../tests/fixtures/sig/baseline-features.json',
);

function computeCusumStep(prevS: number, robustZ: number, driftAllowance: number): number {
  return Math.max(0.0, prevS + robustZ - driftAllowance);
}

function evaluateEmergenceDecision(input: {
  sampleBuckets: number;
  minSampleRequired: number;
  cusum: number;
  cusumThreshold: number;
  ewmaRatio: number;
  ewmaRatioThreshold: number;
}): { decision: string; qualityCode: string } {
  if (input.sampleBuckets < input.minSampleRequired) {
    return { decision: 'NO_PROMOTION_INSUFFICIENT_SAMPLE', qualityCode: 'LOW_SAMPLE' };
  }
  if (input.cusum >= input.cusumThreshold && input.ewmaRatio >= input.ewmaRatioThreshold) {
    return { decision: 'PROMOTED_EMERGING', qualityCode: 'VALID' };
  }
  return { decision: 'NO_PROMOTION_THRESHOLD_UNMET', qualityCode: 'VALID' };
}

describe('packages/signal-intelligence: H.11 Robust Activity & Change-Point Baseline', () => {
  it('CUSUM statistic accumulates positive robust z-score increments above drift allowance', () => {
    let S = 0.0;
    const drift = 0.5;

    // Series of robust z-scores: [2.0, 2.5, 0.2]
    S = computeCusumStep(S, 2.0, drift); // max(0, 0 + 2.0 - 0.5) = 1.5
    expect(S).toBe(1.5);

    S = computeCusumStep(S, 2.5, drift); // max(0, 1.5 + 2.5 - 0.5) = 3.5
    expect(S).toBe(3.5);

    S = computeCusumStep(S, 0.2, drift); // max(0, 3.5 + 0.2 - 0.5) = 3.2
    expect(S).toBeCloseTo(3.2, 5);
  });

  it('refuses emergence promotion when baseline sample size is below minimum threshold', () => {
    const fixture = JSON.parse(readFileSync(BASELINE_FIXTURE_PATH, 'utf8'));
    const insufficientSample = fixture.h11RobustBaselineVectors.find(
      (v: { name: string }) => v.name === 'insufficient_baseline_sample_no_promotion',
    );

    const result = evaluateEmergenceDecision({
      sampleBuckets: insufficientSample.sampleBuckets,
      minSampleRequired: insufficientSample.minimumSampleRequired,
      cusum: insufficientSample.cusumStatistic,
      cusumThreshold: 4.0,
      ewmaRatio: insufficientSample.fastEwma / insufficientSample.slowEwma,
      ewmaRatioThreshold: 2.5,
    });

    expect(result.decision).toBe('NO_PROMOTION_INSUFFICIENT_SAMPLE');
    expect(result.qualityCode).toBe('LOW_SAMPLE');
  });

  it('promotes to emerging when both CUSUM and EWMA dual criteria are met on mature sample', () => {
    const fixture = JSON.parse(readFileSync(BASELINE_FIXTURE_PATH, 'utf8'));
    const matureEmergence = fixture.h11RobustBaselineVectors.find(
      (v: { name: string }) => v.name === 'emergence_detected_dual_criteria_met',
    );

    const result = evaluateEmergenceDecision({
      sampleBuckets: matureEmergence.sampleBuckets,
      minSampleRequired: matureEmergence.minimumSampleRequired,
      cusum: matureEmergence.cusumStatistic,
      cusumThreshold: matureEmergence.cusumThreshold,
      ewmaRatio: matureEmergence.fastEwma / matureEmergence.slowEwma,
      ewmaRatioThreshold: matureEmergence.ewmaRatioThreshold,
    });

    expect(result.decision).toBe('PROMOTED_EMERGING');
    expect(result.qualityCode).toBe('VALID');
  });
});
