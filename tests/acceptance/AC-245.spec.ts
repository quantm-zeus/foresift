/**
 * AC-245 acceptance (positive).
 * Traces: FR-DATA-006 (§11.7 empirical dependence, ADR-052).
 * AC text (manifest §39): "Provider pairs with strongly correlated timing,
 * values/errors, outages, and first-seen behavior receive reduced empirical
 * independence credit despite different provider IDs."
 *
 * Every assertion is driven by tests/fixtures/data/correlated-providers.json:
 * the declared thresholds, both per-pair input vectors, and the
 * expected-outcome flags are all consumed here, so editing the fixture
 * without matching behavior fails this suite (and vice versa).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_DEPENDENCE_THRESHOLDS,
  DependenceLabel,
  inputsJustifyReducedIndependence,
  utcTimestamp,
  type DependenceObservationInputs,
  type DependenceThresholds,
} from '@foresift/domain';
import {
  dependenceEdgesForPair,
  recordDependenceEdge,
  registerSourceIdentity,
} from '@foresift/persistence';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/data');

interface ProviderPairFixture {
  name: string;
  expectedReducedIndependence: boolean;
  expectedReason: string;
  sources: {
    id: string;
    brandProvider: string;
    operation: string;
    upstreamLineageKey: string;
    endpointRegion: string;
    collectionMethod: string;
  }[];
  edge: {
    sharedUpstreamLineageKeys: string[];
    inputs: DependenceObservationInputs;
    availableAt: string;
  };
  expectedEdgeJustifiesReducedIndependenceOnInputsAlone: boolean;
}

interface CorrelatedProvidersFixture {
  thresholds: DependenceThresholds;
  pairs: ProviderPairFixture[];
}

let tdb: TestDatabase;
let fixture: CorrelatedProvidersFixture;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  fixture = JSON.parse(
    readFileSync(path.join(FIXTURES, 'correlated-providers.json'), 'utf8'),
  ) as CorrelatedProvidersFixture;
  for (const p of fixture.pairs) {
    for (const s of p.sources) {
      await registerSourceIdentity(tdb.engine, {
        id: s.id as never,
        brandProvider: s.brandProvider,
        operation: s.operation,
        upstreamLineageKey: s.upstreamLineageKey,
        endpointRegion: s.endpointRegion,
        collectionMethod: s.collectionMethod as never,
      });
    }
  }
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-245: reduced independence credit despite distinct provider ids', () => {
  it('classifies each fixture pair exactly as its declared vector requires', () => {
    expect(fixture.pairs.length).toBeGreaterThanOrEqual(2);
    for (const pair of fixture.pairs) {
      expect(inputsJustifyReducedIndependence(pair.edge.inputs), pair.name).toBe(
        pair.expectedEdgeJustifiesReducedIndependenceOnInputsAlone,
      );
      expect(pair.expectedEdgeJustifiesReducedIndependenceOnInputsAlone).toBe(
        pair.expectedReducedIndependence,
      );
    }
  });

  it('uses the fixture thresholds as the domain defaults, each dimension alone sufficient', () => {
    const thresholds = fixture.thresholds;
    // The fixture declares the same gate the domain enforces by default;
    // divergence between the two documents must fail here, not silently.
    expect(thresholds).toEqual({
      correlation: DEFAULT_DEPENDENCE_THRESHOLDS.correlation,
      outageOverlap: DEFAULT_DEPENDENCE_THRESHOLDS.outageOverlap,
      firstSeenLagAgreement: DEFAULT_DEPENDENCE_THRESHOLDS.firstSeenLagAgreement,
      fingerprintSimilarity: DEFAULT_DEPENDENCE_THRESHOLDS.fingerprintSimilarity,
    });

    // Any-one-of semantics pinned AT each fixture threshold and just below it.
    const base = {
      valueErrorTimingCorrelation: 0,
      outageOverlap: 0,
      firstSeenLagAgreement: 0,
      fingerprintSimilarity: 0,
    };
    const dimensions = [
      ['valueErrorTimingCorrelation', thresholds.correlation],
      ['outageOverlap', thresholds.outageOverlap],
      ['firstSeenLagAgreement', thresholds.firstSeenLagAgreement],
      ['fingerprintSimilarity', thresholds.fingerprintSimilarity],
    ] as const;
    for (const [dimension, threshold] of dimensions) {
      const atThreshold = { ...base, [dimension]: threshold };
      expect(inputsJustifyReducedIndependence(atThreshold), `${dimension} at threshold`).toBe(true);
      const belowThreshold = { ...base, [dimension]: threshold - 0.000001 };
      expect(
        inputsJustifyReducedIndependence(belowThreshold),
        `${dimension} just below threshold`,
      ).toBe(false);
    }
  });

  it('persists the correlated-pair edge from the fixture and reads it back honestly', async () => {
    const correlated = fixture.pairs.find((p) => p.expectedReason === 'SHARED_UPSTREAM_LINEAGE');
    if (!correlated) throw new Error('fixture lost its correlated pair');
    const [sourceA, sourceB] = correlated.sources;
    if (!sourceA || !sourceB) throw new Error('fixture pair lost a source');

    await recordDependenceEdge(tdb.engine, {
      edgeId: 'ac245-edge-fixture-driven',
      edge: {
        sourceA: sourceA.id as never,
        sourceB: sourceB.id as never,
        sharedUpstreamLineageKeys: correlated.edge.sharedUpstreamLineageKeys,
        inputs: correlated.edge.inputs,
        label: DependenceLabel.AVAILABLE_AT_THE_TIME,
        availableAt: utcTimestamp(correlated.edge.availableAt),
      },
    });
    const stored = await dependenceEdgesForPair(
      tdb.engine,
      sourceB.id as never,
      sourceA.id as never,
    );
    expect(stored.length).toBe(1);
    expect(stored[0]?.edge.sharedUpstreamLineageKeys).toEqual(
      correlated.edge.sharedUpstreamLineageKeys,
    );
    // Round-trip honesty: the exact fixture vector comes back unchanged.
    expect(stored[0]?.edge.inputs).toEqual(correlated.edge.inputs);
    expect(stored[0]?.edge.label).toBe(DependenceLabel.AVAILABLE_AT_THE_TIME);
    // Canonical pair order: querying either way returns the same single edge.
    const reversed = await dependenceEdgesForPair(
      tdb.engine,
      sourceA.id as never,
      sourceB.id as never,
    );
    expect(reversed.map((e) => e.edgeId)).toEqual(stored.map((e) => e.edgeId));
  });
});
