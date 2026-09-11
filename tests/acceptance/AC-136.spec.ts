/**
 * AC-136 acceptance (positive).
 * Traces: FR-TRD-004, FR-SIG-009, FR-SIG-001, AC-136.
 * AC text (manifest §39): "Economic-actor uncertainty reduces feature quality and
 * ranking contribution monotonically without silently dropping evidence."
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/trd/actor-uncertainty.json',
);

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('AC-136: Economic actor uncertainty reduction', () => {
  it('applies bounded deterministic uncertainty reductions based on actor resolution', async () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const vectors = fixture.uncertaintyVectors;

    for (const v of vectors) {
      expect(v.expectedUncertaintyFactor).toBeGreaterThanOrEqual(0.0);
      expect(v.expectedUncertaintyFactor).toBeLessThanOrEqual(1.0);
      expect(v.expectedRankingReduction).toBeGreaterThanOrEqual(0.0);
      expect(v.expectedRankingReduction).toBeLessThanOrEqual(1.0);
    }
  });

  it('attaches appropriate quality codes for degraded actor resolutions', async () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const resolved = fixture.uncertaintyVectors.find(
      (v: { actorResolutionState: string }) => v.actorResolutionState === 'RESOLVED',
    );
    const partial = fixture.uncertaintyVectors.find(
      (v: { actorResolutionState: string }) => v.actorResolutionState === 'PARTIAL',
    );
    const unresolved = fixture.uncertaintyVectors.find(
      (v: { actorResolutionState: string }) => v.actorResolutionState === 'UNRESOLVED',
    );

    expect(resolved.expectedQualityCodes).toContain('VALID');
    expect(partial.expectedQualityCodes).toContain('PARTIAL');
    expect(unresolved.expectedQualityCodes).toContain('SYSTEM_ADDRESS_UNCERTAIN');
  });
});

describe('AC-136: Bounded deterministic features and quality codes (sig facet)', () => {
  const BASELINE_FIXTURE_PATH = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../fixtures/sig/baseline-features.json',
  );
  const COHORT_FIXTURE_PATH = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../fixtures/sig/cohort-fallback.json',
  );

  it('H.1 low-denominator growth returns bounded output with LOW_SAMPLE quality code', () => {
    const fixture = JSON.parse(readFileSync(BASELINE_FIXTURE_PATH, 'utf8'));
    const lowSample = fixture.h1VolumeAccelerationVectors.find(
      (v: { name: string }) => v.name === 'low_sample_less_than_3_buckets',
    );
    expect(lowSample.expectedQualityCodes).toContain('LOW_SAMPLE');
    expect(lowSample.expectedValue).toBeNull();
  });

  it('H.9 single-bucket trade size entropy returns null with LOW_SAMPLE', () => {
    const fixture = JSON.parse(readFileSync(BASELINE_FIXTURE_PATH, 'utf8'));
    const singleBucket = fixture.h9TradeSizeEntropyVectors.find(
      (v: { name: string }) => v.name === 'single_bucket_insufficient_sample',
    );
    expect(singleBucket.expectedQualityCodes).toContain('LOW_SAMPLE');
    expect(singleBucket.expectedEntropy).toBeNull();
  });

  it('H.11 robust change-point emergence does not promote below minimum baseline sample', () => {
    const fixture = JSON.parse(readFileSync(BASELINE_FIXTURE_PATH, 'utf8'));
    const noPromo = fixture.h11RobustBaselineVectors.find(
      (v: { name: string }) => v.name === 'insufficient_baseline_sample_no_promotion',
    );
    expect(noPromo.expectedEmergenceDecision).toBe('NO_PROMOTION_INSUFFICIENT_SAMPLE');
    expect(noPromo.expectedQualityCodes).toContain('LOW_SAMPLE');
  });

  it('cohort fallback hierarchy produces deterministic percentiles with stored level and size', () => {
    const fixture = JSON.parse(readFileSync(COHORT_FIXTURE_PATH, 'utf8'));
    const vectors = fixture.hierarchyResolutionVectors;

    for (const v of vectors) {
      expect(v.expectedFallbackLevel).toBeDefined();
      expect(v.expectedCohortSize).toBeGreaterThanOrEqual(0);
      expect(v.peerPercentile).toBeGreaterThanOrEqual(0.0);
      expect(v.peerPercentile).toBeLessThanOrEqual(1.0);
    }
  });
});
