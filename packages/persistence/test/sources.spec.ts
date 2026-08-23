/**
 * Source identity and independence (T031/T032, FR-DATA-006, §11.7, ADR-052,
 * INV-008): distinct brand/provider ids do not imply independence — sources
 * sharing an upstream lineage collapse into ONE group; strongly correlated
 * pairs earn REDUCED independence credit despite distinct ids. Dependence
 * edges are labeled by input availability: AVAILABLE_AT_THE_TIME inputs may
 * inform replay reasoning; DIAGNOSTIC_RETROSPECTIVE estimates never can
 * (AC-247 substrate).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  DependenceLabel,
  ForesiftError,
  inputsJustifyReducedIndependence,
  utcTimestamp,
  type SourceDependenceEdge,
  type SourceIdentity,
  type SourceIdentityId,
} from '@foresift/domain';
import {
  applyMigrations,
  classifyInputsAvailability,
  createEngine,
  dependenceEdgesForPair,
  independenceGroupOf,
  independenceGroups,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  recordDependenceEdge,
  registerSourceIdentity,
  type DatabaseEngine,
} from '../src/index.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);
const FIXTURE = JSON.parse(
  readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../tests/fixtures/data/correlated-providers.json',
    ),
    'utf8',
  ),
) as {
  pairs: Array<{
    name: string;
    expectedReducedIndependence: boolean;
    expectedReason: string;
    sources: Array<SourceIdentity>;
    edge: Pick<SourceDependenceEdge, 'sharedUpstreamLineageKeys' | 'inputs' | 'availableAt'>;
    expectedEdgeJustifiesReducedIndependenceOnInputsAlone: boolean;
  }>;
};

let db: PGlite;
let engine: DatabaseEngine;

const [correlatedPair, independentPair] = FIXTURE.pairs;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  if (correlatedPair === undefined || independentPair === undefined) {
    throw new Error('fixture must define both pairs');
  }
  for (const pair of FIXTURE.pairs) {
    for (const s of pair.sources) {
      await registerSourceIdentity(engine, { ...s, id: s.id as SourceIdentityId });
    }
  }
}, 120_000);

afterAll(async () => {
  await db.close();
}, 30_000);

function edgeFor(
  pair: NonNullable<typeof correlatedPair>,
  sourceA: string,
  sourceB: string,
): SourceDependenceEdge {
  return {
    sourceA: sourceA as SourceIdentityId,
    sourceB: sourceB as SourceIdentityId,
    sharedUpstreamLineageKeys: pair.edge.sharedUpstreamLineageKeys,
    inputs: pair.edge.inputs,
    label: classifyInputsAvailability({
      inputsAvailableAt: '2026-01-20T00:00:00Z',
      edgeAvailableAt: pair.edge.availableAt,
    }),
    availableAt: pair.edge.availableAt,
  };
}

describe('lineage collapse — provider count is not independence (INV-008)', () => {
  it('collapses the correlated fixture pair into one independence group', async () => {
    const group = await independenceGroupOf(engine, 'upstream/nodesense-mainnet');
    expect(group).not.toBeNull();
    if (group === null) throw new Error('unreachable');
    expect(group.memberSourceIds).toEqual(['src/chainmirror', 'src/nodefront']);
  });

  it('keeps genuinely independent lineages in separate groups', async () => {
    const groups = await independenceGroups(engine);
    const keys = groups.map((g) => g.upstreamLineageKey).sort();
    expect(keys).toEqual([
      'upstream/explorer-b-indexer',
      'upstream/nodesense-mainnet',
      'upstream/rpc-a-own-infra',
    ]);
    for (const g of groups) {
      if (g.upstreamLineageKey !== 'upstream/nodesense-mainnet') {
        expect(g.memberSourceIds).toHaveLength(1);
      } else {
        expect(g.memberSourceIds).toHaveLength(2);
      }
    }
  });

  it('verifies an identical re-registration and refuses a conflicting tuple', async () => {
    const first = correlatedPair!.sources[0]!;
    await expect(
      registerSourceIdentity(engine, { ...first, id: first.id as SourceIdentityId }),
    ).resolves.toBeUndefined();
    await expect(
      registerSourceIdentity(engine, {
        ...first,
        id: first.id as SourceIdentityId,
        upstreamLineageKey: 'upstream/something-else',
      }),
    ).rejects.toThrowError(ForesiftError);
  });
});

describe('pairwise dependence edges (T032, AC-245)', () => {
  it('records reduced-independence evidence for the correlated pair despite distinct ids', async () => {
    expect(correlatedPair).toBeDefined();
    expect(inputsJustifyReducedIndependence(correlatedPair!.edge.inputs)).toBe(
      correlatedPair!.expectedEdgeJustifiesReducedIndependenceOnInputsAlone,
    );
    // Every threshold is crossed individually for this fixture pair.
    expect(correlatedPair!.edge.inputs.valueErrorTimingCorrelation).toBeGreaterThanOrEqual(0.8);
    expect(correlatedPair!.edge.inputs.fingerprintSimilarity).toBeGreaterThanOrEqual(0.9);

    await recordDependenceEdge(engine, {
      edgeId: 'edge-correlated-1',
      edge: edgeFor(correlatedPair!, 'src/nodefront', 'src/chainmirror'),
    });
    const edges = await dependenceEdgesForPair(engine, 'src/nodefront', 'src/chainmirror');
    expect(edges).toHaveLength(1);
    // Canonical order regardless of who was listed first.
    expect(edges[0]!.edge.sourceA).toBe('src/chainmirror');
    expect(edges[0]!.edge.sourceB).toBe('src/nodefront');
    expect(edges[0]!.edge.label).toBe(DependenceLabel.AVAILABLE_AT_THE_TIME);
  });

  it('keeps the independent pair below every reduction threshold', async () => {
    expect(independentPair).toBeDefined();
    expect(inputsJustifyReducedIndependence(independentPair!.edge.inputs)).toBe(false);
  });

  it('labels post-hoc estimates DIAGNOSTIC_RETROSPECTIVE and stores them anyway', async () => {
    // The estimate was published 2026-05-01 but its inputs only became
    // available 2026-06-01 — stored for diagnostics, never usable to rewrite
    // replay history.
    const label = classifyInputsAvailability({
      inputsAvailableAt: '2026-06-01T00:00:00Z',
      edgeAvailableAt: '2026-05-01T00:00:00Z',
    });
    expect(label).toBe(DependenceLabel.DIAGNOSTIC_RETROSPECTIVE);
    await recordDependenceEdge(engine, {
      edgeId: 'edge-independent-retro',
      edge: {
        ...edgeFor(independentPair!, 'src/rpc-a', 'src/explorer-b'),
        label,
        availableAt: '2026-05-01T00:00:00Z',
      },
    });
    const edges = await dependenceEdgesForPair(engine, 'src/rpc-a', 'src/explorer-b');
    expect(edges[0]!.edge.label).toBe(DependenceLabel.DIAGNOSTIC_RETROSPECTIVE);
  });

  it('refuses self-edges and out-of-range inputs', async () => {
    await expect(
      recordDependenceEdge(engine, {
        edgeId: 'edge-self',
        edge: edgeFor(correlatedPair!, 'src/nodefront', 'src/nodefront'),
      }),
    ).rejects.toThrowError(/two distinct sources/);

    await expect(
      recordDependenceEdge(engine, {
        edgeId: 'edge-nan',
        edge: {
          ...edgeFor(correlatedPair!, 'src/nodefront', 'src/chainmirror'),
          inputs: { ...correlatedPair!.edge.inputs, outageOverlap: 1.5 },
        },
      }),
    ).rejects.toThrowError(ForesiftError);
  });

  it('returns newest-first edges per pair with canonical ordering', async () => {
    await recordDependenceEdge(engine, {
      edgeId: 'edge-correlated-0',
      edge: {
        ...edgeFor(correlatedPair!, 'src/chainmirror', 'src/nodefront'),
        availableAt: utcTimestamp('2026-01-15T00:00:00Z'),
      },
    });
    const edges = await dependenceEdgesForPair(engine, 'src/chainmirror', 'src/nodefront');
    expect(edges.map((e) => e.edgeId)).toEqual(['edge-correlated-1', 'edge-correlated-0']);
  });
});
