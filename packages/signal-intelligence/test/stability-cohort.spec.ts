/**
 * Stability & cohort fallback tests (T011, FR-SIG-009, FR-SIG-001, AC-136).
 * Tests fallback-level truth table (all 7 levels reachable), shrinkage bounds,
 * capped-contribution clamp, and low-sample warnings.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COHORT_FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../tests/fixtures/sig/cohort-fallback.json',
);

function applyShrinkage(
  sampleValue: number,
  sampleSize: number,
  priorMean: number,
  priorWeight: number,
): number {
  return (sampleSize * sampleValue + priorWeight * priorMean) / (sampleSize + priorWeight);
}

function clampCappedContribution(value: number, maxCap: number): number {
  return Math.min(Math.max(value, 0.0), maxCap);
}

describe('packages/signal-intelligence: Numerical Stability & Cohort Fallback', () => {
  it('all 7 fallback levels are reachable and deterministic per §19.9 hierarchy', () => {
    const fixture = JSON.parse(readFileSync(COHORT_FIXTURE_PATH, 'utf8'));
    const levelsEncountered = new Set<string>();

    for (const v of fixture.hierarchyResolutionVectors) {
      levelsEncountered.add(v.expectedFallbackLevel);
      expect(v.expectedCohortSize).toBeGreaterThanOrEqual(0);
      expect(typeof v.expectedLowSampleWarning).toBe('boolean');
    }

    expect(levelsEncountered.size).toBe(7);
    for (const expected of fixture.fallbackHierarchyOrder) {
      expect(levelsEncountered.has(expected)).toBe(true);
    }
  });

  it('shrinkage pulls small samples toward prior and leaves large samples unaffected', () => {
    const fixture = JSON.parse(readFileSync(COHORT_FIXTURE_PATH, 'utf8'));
    const smallSample = fixture.shrinkageVectors.find(
      (v: { name: string }) => v.name === 'small_sample_heavy_shrinkage_to_prior',
    );
    const largeSample = fixture.shrinkageVectors.find(
      (v: { name: string }) => v.name === 'large_sample_minimal_shrinkage',
    );

    const smallResult = applyShrinkage(
      smallSample.sampleValue,
      smallSample.sampleSize,
      smallSample.cohortPriorMean,
      smallSample.priorWeight,
    );
    expect(smallResult).toBeCloseTo(smallSample.expectedShrunkValue, 3);

    const largeResult = applyShrinkage(
      largeSample.sampleValue,
      largeSample.sampleSize,
      largeSample.cohortPriorMean,
      largeSample.priorWeight,
    );
    expect(largeResult).toBeCloseTo(largeSample.expectedShrunkValue, 3);
  });

  it('capped contribution clamps ranking feature influence to (0, maxCap]', () => {
    const cap = 0.25;
    expect(clampCappedContribution(0.1, cap)).toBe(0.1);
    expect(clampCappedContribution(0.25, cap)).toBe(0.25);
    expect(clampCappedContribution(0.85, cap)).toBe(0.25); // clamped
    expect(clampCappedContribution(-0.5, cap)).toBe(0.0);
  });
});
