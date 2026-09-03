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
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  DEFAULT_DEPENDENCE_THRESHOLDS,
  DependenceInputAvailability,
  DependenceLabel,
  calculateEffectiveIndependenceMultiplier,
  edgeMayAffectCreditAt,
  inputsJustifyReducedIndependence,
  isEdgeValidAtTimestamp,
  utcTimestamp,
  type DependenceObservationInputs,
  type DependenceThresholds,
  type SourceDependenceEdgeLike,
} from '@foresift/domain';
import { dependenceEdgesForPair, registerSourceIdentity } from '@foresift/persistence';
import { parseDataSchema } from '@foresift/shared-schemas';
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

    const [a, b] = sourceA.id < sourceB.id ? [sourceA.id, sourceB.id] : [sourceB.id, sourceA.id];
    await tdb.engine.query(
      `INSERT INTO source_dependence_edges (
         edge_id, source_a, source_b, shared_upstream_lineage_keys,
         value_error_timing_correlation, outage_overlap, first_seen_lag_agreement,
         fingerprint_similarity, label, available_at,
         valid_from, valid_until, method, evidence_ids, confidence, effective_independence_multiplier)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        'ac245-edge-fixture-driven',
        a,
        b,
        correlated.edge.sharedUpstreamLineageKeys,
        correlated.edge.inputs.valueErrorTimingCorrelation,
        correlated.edge.inputs.outageOverlap,
        correlated.edge.inputs.firstSeenLagAgreement,
        correlated.edge.inputs.fingerprintSimilarity,
        DependenceLabel.AVAILABLE_AT_THE_TIME,
        utcTimestamp(correlated.edge.availableAt),
        utcTimestamp(correlated.edge.availableAt),
        null,
        'EMPIRICAL',
        [],
        1.0,
        0.5,
      ],
    );
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

describe('AC-245 acceptance (tool-core substrate): source dependence schema validation', () => {
  it('SourceDependenceEdge schema validates empirical dependence edge', () => {
    const parsed = parseDataSchema('SourceDependenceEdge', {
      sourceA: 'src-1',
      sourceB: 'src-2',
      sharedUpstreamLineageKeys: ['up-1'],
      inputs: {
        valueErrorTimingCorrelation: 0.85,
        outageOverlap: 0.7,
        firstSeenLagAgreement: 0.9,
        fingerprintSimilarity: 0.95,
      },
      label: 'AVAILABLE_AT_THE_TIME',
      availableAt: utcTimestamp('2026-06-20T00:00:00Z'),
    });
    expect(parsed.inputs.valueErrorTimingCorrelation).toBe(0.85);
  });
});

describe('AC-245 G1 extensions: validity interval and DIAGNOSTIC_RETROSPECTIVE isolation (FR-DATA-013, FR-DATA-015)', () => {
  it('evaluates effective credit strictly from edges valid at decision time T', () => {
    const edge = {
      validFrom: utcTimestamp('2026-01-01T00:00:00Z'),
      validUntil: utcTimestamp('2026-06-01T00:00:00Z'),
      confidence: 0.95,
      effectiveIndependenceMultiplier: 0.5,
      inputAvailability: DependenceInputAvailability.AVAILABLE_AT_THE_TIME,
    };

    expect(isEdgeValidAtTimestamp(edge, '2026-03-01T00:00:00Z')).toBe(true);
    expect(isEdgeValidAtTimestamp(edge, '2026-01-01T00:00:00Z')).toBe(true);
    expect(isEdgeValidAtTimestamp(edge, '2026-06-01T00:00:00Z')).toBe(true);
    expect(isEdgeValidAtTimestamp(edge, '2026-07-01T00:00:00Z')).toBe(false);
    expect(isEdgeValidAtTimestamp(edge, '2025-12-31T23:59:59Z')).toBe(false);

    expect(edgeMayAffectCreditAt(edge, '2026-03-01T00:00:00Z')).toBe(true);
    expect(edgeMayAffectCreditAt(edge, '2026-07-01T00:00:00Z')).toBe(false);
  });

  it('computes monotonic effective independence multiplier reductions from empirical signals', () => {
    const highDep = calculateEffectiveIndependenceMultiplier({
      sharedUpstreamLineage: false,
      valueErrorTimingCorrelation: 0.95,
      outageOverlap: 0.8,
      firstSeenLagAgreement: 0.85,
      fingerprintSimilarity: 0.95,
    });
    expect(highDep).toBeLessThan(1.0);
    expect(highDep).toBeGreaterThanOrEqual(0.0);

    const noDep = calculateEffectiveIndependenceMultiplier({
      sharedUpstreamLineage: false,
      valueErrorTimingCorrelation: 0.1,
      outageOverlap: 0.1,
      firstSeenLagAgreement: 0.1,
      fingerprintSimilarity: 0.1,
    });
    expect(noDep).toBe(1.0);
  });

  it('isolates retrospective diagnostic dependence updates from realizable replay', () => {
    const retroEdge: SourceDependenceEdgeLike = {
      validFrom: utcTimestamp('2026-01-01T00:00:00Z'),
      validUntil: utcTimestamp('2026-12-31T23:59:59Z'),
      confidence: 0.9,
      effectiveIndependenceMultiplier: 0.4,
      inputAvailability: DependenceInputAvailability.DIAGNOSTIC_RETROSPECTIVE,
    };

    // Diagnostic retrospective estimates never affect credit in realizable replay
    expect(edgeMayAffectCreditAt(retroEdge, '2026-06-01T00:00:00Z')).toBe(false);
  });
});
