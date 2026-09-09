/**
 * Recall verdict truth table (all 4 verdicts reachable and deterministic;
 * self-recall structurally refused; Horvitz-Thompson recall estimation).
 * Traces: FR-DISC-006, FR-DISC-010.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  estimateRecall,
  calculateRecall,
  resolveLineageIndependence,
  classifyWeightedRetrospectiveMiss,
  RecallEstimator,
  type RecallEstimateInput,
  type RecallObservation,
} from '../src/recall-estimator.ts';
import type { CoveragePopulationManifest } from '@foresift/shared-schemas';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

let db: PGlite;
let engine: DatabaseEngine;
let recallEstimator: RecallEstimator;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  recallEstimator = new RecallEstimator(engine);

  // Seed manifest foreign key
  await engine.query(
    `INSERT INTO disc.coverage_population_manifests (
       manifest_id, population, source_scope, collector_scope,
       window_start, window_end, gaps, rights_exclusions, program_versions,
       selection_probabilities, known_missing_sources, source_dependence_assessment
     ) VALUES (
       'man_recall_001', 'PROSPECTIVELY_OBSERVED_UNIVERSE', '{"sourceIds":["src_independent_archive"]}'::jsonb, '{"scopeIds":["col1"]}'::jsonb,
       '2026-08-20T10:00:00Z', '2026-08-20T12:00:00Z', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
       '{}'::jsonb, '[]'::jsonb, '{}'::jsonb
     ) ON CONFLICT (manifest_id) DO NOTHING`,
  );
});

afterAll(async () => {
  await db.close();
});

describe('Recall Estimator & Verdict Truth Table (FR-DISC-006, FR-DISC-010)', () => {
  const baseManifest: CoveragePopulationManifest = {
    manifestId: 'man_recall_001',
    populationClass: 'PROSPECTIVELY_OBSERVED_UNIVERSE',
    sourceIds: ['src_independent_archive'],
    collectorScopeIds: ['col_solana_live'],
    startTime: '2026-08-20T10:00:00Z',
    endTime: '2026-08-20T12:00:00Z',
    startSlot: '1000',
    endSlot: '2000',
    knownGapsCount: 0,
    rightsExclusions: [],
    sourceDependenceDisclosed: true,
  };

  const observations: RecallObservation[] = [
    { subjectId: 'asset_1', discoveredByEvaluatedSource: true },
    { subjectId: 'asset_2', discoveredByEvaluatedSource: true },
    { subjectId: 'asset_3', discoveredByEvaluatedSource: false },
    { subjectId: 'asset_4', discoveredByEvaluatedSource: false },
  ];

  it('verdict 1: SELF_RECALL_REFUSED when evaluated source generates its own universe', () => {
    const selfRecallManifest: CoveragePopulationManifest = {
      ...baseManifest,
      sourceIds: ['src_evaluated_source'],
    };

    const input: RecallEstimateInput = {
      estimateId: 'est_self_refused',
      manifest: selfRecallManifest,
      evaluatedSourceId: 'src_evaluated_source',
      claimBasis: 'INDEPENDENT_FIRST_PARTY_OBSERVATION',
      asOf: '2026-08-20T12:00:00Z',
      observations,
      independenceEvidence: ['ev_first_party_1'],
      independentFirstPartyObservation: true,
    };

    const result = estimateRecall(input);
    expect(result.verdict).toBe('SELF_RECALL_REFUSED');
    expect(result.recallEstimate).toBeUndefined();
  });

  it('verdict 2: DEPENDENT_DISCLOSED when lineage is dependent', () => {
    const input: RecallEstimateInput = {
      estimateId: 'est_dependent',
      manifest: baseManifest,
      evaluatedSourceId: 'src_evaluated_source',
      claimBasis: 'INDEPENDENT_PROVIDER_LINEAGE',
      asOf: '2026-08-20T12:00:00Z',
      observations,
      independenceEvidence: ['ev_lineage_1'],
      dependenceEdges: [
        {
          edgeId: 'edge_dep_1',
          sourceA: 'src_evaluated_source',
          sourceB: 'src_independent_archive',
          validFrom: '2026-08-01T00:00:00Z',
          validUntil: '2026-08-30T00:00:00Z',
          effectiveIndependenceMultiplier: 0.5, // Discounted -> Dependent!
        },
      ],
    };

    const result = estimateRecall(input);
    expect(result.verdict).toBe('DEPENDENT_DISCLOSED');
    expect(result.recallEstimate).toBeUndefined();
  });

  it('verdict 3: INDEPENDENT_ESTIMATE when evidence and lineage establish independence', () => {
    const input: RecallEstimateInput = {
      estimateId: 'est_independent',
      manifest: baseManifest,
      evaluatedSourceId: 'src_evaluated_source',
      claimBasis: 'INDEPENDENT_FIRST_PARTY_OBSERVATION',
      asOf: '2026-08-20T12:00:00Z',
      observations,
      independenceEvidence: ['ev_first_party_audit'],
      independentFirstPartyObservation: true,
    };

    const result = estimateRecall(input);
    expect(result.verdict).toBe('INDEPENDENT_ESTIMATE');
    // 2 discovered out of 4 total -> recall = 0.5
    expect(result.recallEstimate).toBeCloseTo(0.5, 4);
    expect(result.weightedPopulation).toBe(4);
    expect(result.weightedDiscovered).toBe(2);
  });

  it('verdict 4: NO_ADMISSIBLE_BASIS when declared basis lacks admissible evidence', () => {
    const input: RecallEstimateInput = {
      estimateId: 'est_no_admissible',
      manifest: baseManifest,
      evaluatedSourceId: 'src_evaluated_source',
      claimBasis: 'INDEPENDENT_FIRST_PARTY_OBSERVATION',
      asOf: '2026-08-20T12:00:00Z',
      observations,
      independenceEvidence: [], // Missing evidence
      independentFirstPartyObservation: false, // Inadmissible
    };

    const result = estimateRecall(input);
    expect(result.verdict).toBe('NO_ADMISSIBLE_BASIS');
    expect(result.recallEstimate).toBeUndefined();
  });

  it('persists estimate record to database', async () => {
    const input: RecallEstimateInput = {
      estimateId: 'est_persisted_001',
      manifest: baseManifest,
      evaluatedSourceId: 'src_evaluated_source',
      claimBasis: 'INDEPENDENT_FIRST_PARTY_OBSERVATION',
      asOf: '2026-08-20T12:00:00Z',
      observations,
      independenceEvidence: ['ev_first_party_audit'],
      independentFirstPartyObservation: true,
    };

    const persisted = await recallEstimator.persist(input);
    expect(persisted.estimateId).toBe('est_persisted_001');
    expect(persisted.verdict).toBe('INDEPENDENT_ESTIMATE');

    const rows = await engine.query<{ verdict: string }>(
      'SELECT verdict FROM disc.recall_estimates WHERE estimate_id = $1',
      ['est_persisted_001'],
    );
    expect(rows.rows[0]?.verdict).toBe('INDEPENDENT_ESTIMATE');
  });

  it('calculates Horvitz-Thompson weighted recall on stratified sample', () => {
    const sampledManifest: CoveragePopulationManifest = {
      ...baseManifest,
      populationClass: 'STRATIFIED_SAMPLED_UNIVERSE',
      selectionProbabilities: {
        asset_1: 0.1, // weight 10
        asset_2: 0.2, // weight 5
        asset_3: 0.5, // weight 2
      },
    };

    const sampledObservations: RecallObservation[] = [
      { subjectId: 'asset_1', discoveredByEvaluatedSource: true }, // weight 10
      { subjectId: 'asset_2', discoveredByEvaluatedSource: false }, // weight 5
      { subjectId: 'asset_3', discoveredByEvaluatedSource: true }, // weight 2
    ];

    // Population = 10 + 5 + 2 = 17
    // Discovered = 10 + 2 = 12
    // Recall = 12 / 17 =~ 0.70588
    const result = calculateRecall(sampledManifest, sampledObservations);
    expect(result.weightedPopulation).toBe(17);
    expect(result.weightedDiscovered).toBe(12);
    expect(result.recall).toBeCloseTo(12 / 17, 4);
  });

  it('resolves lineage independence across valid time bounds', () => {
    const edges = [
      {
        edgeId: 'e1',
        sourceA: 'src_eval',
        sourceB: 'src_univ',
        validFrom: '2026-08-01T00:00:00Z',
        validUntil: '2026-08-31T00:00:00Z',
        effectiveIndependenceMultiplier: 1.0,
      },
    ];

    const inside = resolveLineageIndependence('src_eval', ['src_univ'], edges, '2026-08-15T00:00:00Z');
    expect(inside.independent).toBe(true);
    expect(inside.appliedEdgeIds).toEqual(['e1']);

    const outside = resolveLineageIndependence(
      'src_eval',
      ['src_univ'],
      edges,
      '2026-09-15T00:00:00Z',
    );
    expect(outside.independent).toBe(true);
    expect(outside.appliedEdgeIds).toEqual([]);
  });

  it('weights retrospective miss classifications', () => {
    const weighted = classifyWeightedRetrospectiveMiss(
      {
        subjectId: 'asset_1',
        outcomeProfileMatched: true,
        liveSourceIds: [],
        retrospectiveUniversePresent: true,
        lineageIndependenceDisclosed: true,
        evidenceRefs: ['ev_1'],
      },
      0.25,
    );
    expect(weighted.inclusionWeight).toBe(4);
  });
});
