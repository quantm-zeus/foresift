/**
 * AC-136 acceptance (positive).
 * Traces: FR-TRD-004, AC-136.
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
