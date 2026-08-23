/**
 * AC-245 acceptance (positive) — task T056.
 * Traces: FR-DATA-006 (§11.7 empirical dependence, ADR-052).
 * AC text (manifest §39): "Provider pairs with strongly correlated timing,
 * values/errors, outages, and first-seen behavior receive reduced empirical
 * independence credit despite different provider IDs."
 *
 * Observed correlation inputs persisted through the dependence-edge store
 * justify REDUCED independence credit per pair; distinct ids alone never
 * confer independence.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DependenceLabel,
  inputsJustifyReducedIndependence,
  utcTimestamp,
  type DependenceObservationInputs,
} from '@foresift/domain';
import {
  dependenceEdgesForPair,
  recordDependenceEdge,
  registerSourceIdentity,
} from '@foresift/persistence';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/data');

interface ProviderPairFixture {
  name: string;
  expectedReducedIndependence: boolean;
  expectedReason: string;
  sources: { id: string; brandProvider: string; operation: string; upstreamLineageKey: string }[];
}

const correlatedInputs = (
  over: Partial<DependenceObservationInputs> = {},
): DependenceObservationInputs => ({
  valueErrorTimingCorrelation: 0.93,
  outageOverlap: 0.62,
  firstSeenLagAgreement: 0.85,
  fingerprintSimilarity: 0.41,
  ...over,
});

let tdb: TestDatabase;
let pairs: ProviderPairFixture[];

beforeAll(async () => {
  tdb = await makeTestDatabase();
  const fixture = JSON.parse(
    readFileSync(path.join(FIXTURES, 'correlated-providers.json'), 'utf8'),
  ) as { pairs: ProviderPairFixture[] };
  pairs = fixture.pairs;
  for (const p of pairs) {
    for (const s of p.sources) {
      await registerSourceIdentity(tdb.engine, {
        id: s.id as never,
        brandProvider: s.brandProvider,
        operation: s.operation,
        upstreamLineageKey: s.upstreamLineageKey,
        endpointRegion: 'eu-central',
        collectionMethod: 'POLLING_API',
      });
    }
  }
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-245: reduced independence credit despite distinct provider ids', () => {
  it('strongly correlated observed inputs justify reduced independence', () => {
    // Each threshold dimension alone suffices (any-one-of semantics).
    expect(inputsJustifyReducedIndependence(correlatedInputs())).toBe(true);
    expect(inputsJustifyReducedIndependence(correlatedInputs({ outageOverlap: 0.55 }))).toBe(true);
    expect(inputsJustifyReducedIndependence(correlatedInputs({ valueErrorTimingCorrelation: -1 }))).toBe(true);
    expect(
      inputsJustifyReducedIndependence(correlatedInputs({ firstSeenLagAgreement: 0.72 })),
    ).toBe(true);
    expect(inputsJustifyReducedIndependence(correlatedInputs({ fingerprintSimilarity: 0.95 }))).toBe(
      true,
    );
  });

  it('a low-correlation pair across distinct lineages stays independent', () => {
    const independent = pairs.find((p) => !p.expectedReducedIndependence);
    expect(independent?.expectedReason).toBe('INDEPENDENT_EVIDENCE');
    expect(
      inputsJustifyReducedIndependence({
        valueErrorTimingCorrelation: 0.2,
        outageOverlap: 0.1,
        firstSeenLagAgreement: 0.3,
        fingerprintSimilarity: 0.15,
      }),
    ).toBe(false);
  });

  it('persists the correlated-pair edge and reads it back honestly', async () => {
    await recordDependenceEdge(tdb.engine, {
      edgeId: 'ac245-edge-nf-cm',
      edge: {
        sourceA: 'src/nodefront' as never,
        sourceB: 'src/chainmirror' as never,
        sharedUpstreamLineageKeys: ['upstream/nodesense-mainnet'],
        inputs: correlatedInputs(),
        label: DependenceLabel.AVAILABLE_AT_THE_TIME,
        availableAt: utcTimestamp('2026-06-20T12:00:00Z'),
      },
    });
    const stored = await dependenceEdgesForPair(tdb.engine, 'src/chainmirror', 'src/nodefront');
    expect(stored.length).toBe(1);
    expect(stored[0]?.edge.sharedUpstreamLineageKeys).toEqual(['upstream/nodesense-mainnet']);
    expect(stored[0]?.edge.inputs.valueErrorTimingCorrelation).toBeCloseTo(0.93, 6);
    expect(stored[0]?.edge.label).toBe(DependenceLabel.AVAILABLE_AT_THE_TIME);
    // Canonical pair order: querying either way returns the same single edge.
    const reversed = await dependenceEdgesForPair(tdb.engine, 'src/nodefront', 'src/chainmirror');
    expect(reversed.map((e) => e.edgeId)).toEqual(stored.map((e) => e.edgeId));
  });
});
