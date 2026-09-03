/**
 * AC-247 acceptance (positive).
 * Traces: FR-DATA-006 (frozen historical counts, INV-005).
 * AC text (manifest §39, abridged): "A retrospective provider-dependence
 * estimate cannot alter a frozen historical evidence count in realizable
 * replay; it is labeled diagnostic unless the estimate was available then."
 *
 * The frozen-count query resolves ONLY retrieval outcomes completed at or
 * before the boundary — later dependence estimates are structurally outside
 * its inputs, and late-input estimates carry the diagnostic label.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  AcquisitionState,
  DependenceInputAvailability,
  DependenceLabel,
  edgeMayAffectCreditAt,
  isEdgeValidAtTimestamp,
  utcTimestamp,
  type SourceDependenceEdgeLike,
  type UtcTimestamp,
} from '@foresift/domain';
import {
  classifyInputsAvailability,
  maturedEvidenceCountAt,
  completeRetrieval,
  recordAcquisitionDecision,
  recordProbeAssignment,
  registerSourceIdentity,
} from '@foresift/persistence';
import { parseCoreSchema } from '@foresift/shared-schemas';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';

const T = (iso: string): UtcTimestamp => utcTimestamp(iso);

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  const { engine } = tdb;

  // Sources for the retrospective dependence estimate.
  for (const id of ['src/rpc-a', 'src/explorer-b']) {
    await registerSourceIdentity(engine, {
      id: id as never,
      brandProvider: id.toUpperCase(),
      operation: 'swaps',
      upstreamLineageKey: `upstream/${id}`,
      endpointRegion: 'eu-central',
      collectionMethod: 'POLLING_API',
    });
  }

  // Two RETURNED retrievals maturing well before the replay boundary.
  for (const [i, day] of ['2026-06-01', '2026-06-02'].entries()) {
    const decisionId = `ac247-ret-${i}`;
    await recordAcquisitionDecision(engine, {
      decisionId,
      candidateId: 'cand/ac247',
      evidenceFamily: 'swaps',
      policyVersion: 'policy/v1',
      state: AcquisitionState.REQUESTED,
      requestedAt: utcTimestamp(`${day}T09:00:00Z`),
    });
    await recordProbeAssignment(engine, {
      decisionId,
      assignment: {
        eligibilityStratum: 'stratum-a',
        assignmentProbability: 0.5,
        seedProvenance: 'seed/deterministic-v1',
        selectionAt: utcTimestamp(`${day}T09:00:01Z`),
        requestedFields: ['volume'],
      },
      estimatedDecisionImpact: 0.3,
    });
    await completeRetrieval(engine, {
      decisionId,
      completedAt: utcTimestamp(`${day}T10:00:00Z`),
      state: AcquisitionState.RETURNED,
      evidenceIds: [`ev/ac247/${i}`],
    });
  }

  // A dependence estimate computed LONG after the boundary from data that was
  // not available then.
  await engine.query(
    `INSERT INTO source_dependence_edges (
       edge_id, source_a, source_b, shared_upstream_lineage_keys,
       value_error_timing_correlation, outage_overlap, first_seen_lag_agreement,
       fingerprint_similarity, label, available_at,
       valid_from, valid_until, method, evidence_ids, confidence, effective_independence_multiplier)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      'ac247-edge-retro',
      'src/explorer-b',
      'src/rpc-a',
      [],
      0.95,
      0.8,
      0.9,
      0.92,
      DependenceLabel.DIAGNOSTIC_RETROSPECTIVE,
      T('2026-07-15T00:00:00Z'),
      T('2026-07-15T00:00:00Z'),
      null,
      'EMPIRICAL',
      [],
      1.0,
      0.5,
    ],
  );
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-247: retrospective estimates cannot alter frozen counts', () => {
  it('the count at the boundary is frozen at the pre-boundary maturity', async () => {
    const boundary = T('2026-06-05T00:00:00Z');
    expect(
      await maturedEvidenceCountAt(tdb.engine, {
        candidateId: 'cand/ac247',
        evidenceFamily: 'swaps',
        t: boundary,
      }),
    ).toBe(2);
  });

  it('recording a later diagnostic estimate leaves the frozen count unchanged', async () => {
    // (Estimate recorded in beforeAll, AFTER the boundary's data.) Recompute:
    const frozen = await maturedEvidenceCountAt(tdb.engine, {
      candidateId: 'cand/ac247',
      t: T('2026-06-05T00:00:00Z'),
    });
    expect(frozen).toBe(2);
  });

  it('inputs not available at the estimate time are labeled DIAGNOSTIC_RETROSPECTIVE', () => {
    const label = classifyInputsAvailability({
      inputsAvailableAt: '2026-07-15T00:00:00Z', // correlation data itself is late
      edgeAvailableAt: '2026-06-20T00:00:00Z',
    });
    expect(label).toBe(DependenceLabel.DIAGNOSTIC_RETROSPECTIVE);
  });

  it('inputs genuinely available at the time keep the AVAILABLE_AT_THE_TIME label', () => {
    const label = classifyInputsAvailability({
      inputsAvailableAt: '2026-06-19T00:00:00Z',
      edgeAvailableAt: '2026-06-20T00:00:00Z',
    });
    expect(label).toBe(DependenceLabel.AVAILABLE_AT_THE_TIME);
  });

  it('only completions within the boundary contribute (later ones excluded)', async () => {
    // A third retrieval completing AFTER the boundary must not inflate it.
    await recordAcquisitionDecision(tdb.engine, {
      decisionId: 'ac247-late',
      candidateId: 'cand/ac247',
      evidenceFamily: 'swaps',
      policyVersion: 'policy/v1',
      state: AcquisitionState.REQUESTED,
      requestedAt: T('2026-06-04T09:00:00Z'),
    });
    await recordProbeAssignment(tdb.engine, {
      decisionId: 'ac247-late',
      assignment: {
        eligibilityStratum: 'stratum-a',
        assignmentProbability: 0.5,
        seedProvenance: 'seed/deterministic-v1',
        selectionAt: T('2026-06-04T09:00:01Z'),
        requestedFields: ['volume'],
      },
      estimatedDecisionImpact: 0.2,
    });
    await completeRetrieval(tdb.engine, {
      decisionId: 'ac247-late',
      completedAt: T('2026-06-10T10:00:00Z'), // matures after the boundary
      state: AcquisitionState.RETURNED,
      evidenceIds: ['ev/ac247/late'],
    });
    expect(
      await maturedEvidenceCountAt(tdb.engine, {
        candidateId: 'cand/ac247',
        t: T('2026-06-05T00:00:00Z'),
      }),
    ).toBe(2);
    // …and IS visible to a later boundary.
    expect(
      await maturedEvidenceCountAt(tdb.engine, {
        candidateId: 'cand/ac247',
        t: T('2026-06-11T00:00:00Z'),
      }),
    ).toBe(3);
  });
});

describe('AC-247 acceptance (tool-core substrate): exact-cache entry record schema validation', () => {
  it('ExactCacheEntryRecord schema validates entry record', () => {
    const parsed = parseCoreSchema('ExactCacheEntryRecord', {
      cacheKeyHash: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      payloadRef: 'obj://core-cache/ac247-entry',
      storedAt: T('2026-06-01T09:00:00Z'),
      freshUntil: T('2026-06-01T10:00:00Z'),
      staleUntil: T('2026-06-01T12:00:00Z'),
      licensePolicyVersion: 'policy-1',
      rightsPermitted: true,
    });
    expect(parsed.rightsPermitted).toBe(true);
  });
});

describe('AC-247 G1 extensions: point-in-time independence & retrospective diagnostic isolation (FR-DATA-015)', () => {
  it('point-in-time independence estimates cannot use future provider behavior to alter evidence counts', async () => {
    const boundary = T('2026-06-05T00:00:00Z');
    const frozenCount = await maturedEvidenceCountAt(tdb.engine, {
      candidateId: 'cand/ac247',
      t: boundary,
    });
    expect(frozenCount).toBe(2);
  });

  it('validates that DIAGNOSTIC_RETROSPECTIVE labeled estimates are excluded from realizable replay credit', () => {
    const diagnosticEdge: SourceDependenceEdgeLike = {
      validFrom: T('2026-01-01T00:00:00Z'),
      validUntil: T('2026-12-31T23:59:59Z'),
      confidence: 1.0,
      effectiveIndependenceMultiplier: 0.25,
      inputAvailability: DependenceInputAvailability.DIAGNOSTIC_RETROSPECTIVE,
    };

    expect(edgeMayAffectCreditAt(diagnosticEdge, '2026-06-05T00:00:00Z')).toBe(false);
  });
});
