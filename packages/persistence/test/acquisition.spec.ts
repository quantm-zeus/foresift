/**
 * Evidence acquisition lifecycle (T035/T036, §13.8, AC-243, AC-247): probe
 * assignment and decision impact are persisted BEFORE retrieval; retrieval
 * without a prior assignment is rejected; completion is one-way; historical
 * counts resolved at a replay boundary are frozen against later post-hoc
 * (DIAGNOSTIC_RETROSPECTIVE) estimates.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  AcquisitionState,
  DependenceLabel,
  ErrorCode,
  ForesiftError,
  utcTimestamp,
  type ProbeAssignment,
  type SourceIdentityId,
} from '@foresift/domain';
import {
  applyMigrations,
  completeRetrieval,
  createEngine,
  maturedEvidenceCountAt,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  recordAcquisitionDecision,
  recordDependenceEdge,
  recordProbeAssignment,
  registerSourceIdentity,
  toDomainDecision,
  type DatabaseEngine,
} from '../src/index.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

let db: PGlite;
let engine: DatabaseEngine;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
}, 120_000);

afterAll(async () => {
  await db.close();
}, 30_000);

function probe(overrides: Partial<ProbeAssignment> = {}): ProbeAssignment {
  return {
    eligibilityStratum: 'stratum:low-volume-pools',
    assignmentProbability: 0.25,
    seedProvenance: 'prf:sha256:probe-seed-v1#counter-42',
    selectionAt: utcTimestamp('2026-03-01T00:00:00Z'),
    requestedFields: ['volume_raw', 'price_usd'],
    ...overrides,
  };
}

describe('probe-assignment write-before-retrieval (T035, AC-243)', () => {
  it('refuses degenerate assignment probabilities at the boundary', async () => {
    await recordAcquisitionDecision(engine, {
      decisionId: 'd_zero',
      candidateId: 'cand-1',
      evidenceFamily: 'DEX_TRADES',
      policyVersion: 'acq-policy/v1',
      state: AcquisitionState.REQUESTED,
      requestedAt: utcTimestamp('2026-03-01T00:00:00Z'),
    });
    await expect(
      recordProbeAssignment(engine, {
        decisionId: 'd_zero',
        assignment: probe({ assignmentProbability: 0 }),
      }),
    ).rejects.toThrowError(/strictly positive/);
    await expect(
      recordProbeAssignment(engine, {
        decisionId: 'd_zero',
        assignment: probe({ assignmentProbability: 1 }),
      }),
    ).rejects.toThrowError(/below 1/);
  });

  it('refuses retrieval completed without any prior probe assignment', async () => {
    await recordAcquisitionDecision(engine, {
      decisionId: 'd_noassign',
      candidateId: 'cand-1',
      evidenceFamily: 'DEX_TRADES',
      policyVersion: 'acq-policy/v1',
      state: AcquisitionState.REQUESTED,
      requestedAt: utcTimestamp('2026-03-01T00:00:00Z'),
    });
    const err = await completeRetrieval(engine, {
      decisionId: 'd_noassign',
      completedAt: utcTimestamp('2026-03-02T00:00:00Z'),
      state: AcquisitionState.RETURNED,
      evidenceIds: ['ev-1'],
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForesiftError);
    expect((err as ForesiftError).code).toBe(ErrorCode.ACQUISITION_PROBE_ASSIGNMENT_MISSING);
  });

  it('refuses completion of a NOT_REQUESTED_BY_POLICY outcome and a mis-scoped record', async () => {
    await recordAcquisitionDecision(engine, {
      decisionId: 'd_notreq',
      candidateId: 'cand-1',
      evidenceFamily: 'DEX_TRADES',
      policyVersion: 'acq-policy/v1',
      state: AcquisitionState.NOT_REQUESTED_BY_POLICY,
    });
    await expect(
      completeRetrieval(engine, {
        decisionId: 'd_notreq',
        completedAt: utcTimestamp('2026-03-02T00:00:00Z'),
        state: AcquisitionState.NOT_REQUESTED_BY_POLICY,
      }),
    ).rejects.toThrowError(/no retrieval completion/);
    await expect(
      completeRetrieval(engine, {
        decisionId: 'd_missing',
        completedAt: utcTimestamp('2026-03-02T00:00:00Z'),
        state: AcquisitionState.RETURNED,
      }),
    ).rejects.toThrowError(/unknown decision/);
  });

  it('completes only after assignment + impact, and completion is one-way', async () => {
    await recordAcquisitionDecision(engine, {
      decisionId: 'd_happy',
      candidateId: 'cand-1',
      evidenceFamily: 'DEX_TRADES',
      policyVersion: 'acq-policy/v1',
      state: AcquisitionState.REQUESTED,
      requestedAt: utcTimestamp('2026-03-01T00:00:00Z'),
    });
    await expect(
      completeRetrieval(engine, {
        decisionId: 'd_happy',
        completedAt: utcTimestamp('2026-03-02T00:00:00Z'),
        state: AcquisitionState.RETURNED,
      }),
    ).rejects.toThrowError(ErrorCode.ACQUISITION_PROBE_ASSIGNMENT_MISSING);

    await recordProbeAssignment(engine, {
      decisionId: 'd_happy',
      assignment: probe(),
      estimatedDecisionImpact: 0.4,
    });
    await completeRetrieval(engine, {
      decisionId: 'd_happy',
      completedAt: utcTimestamp('2026-03-02T00:00:00Z'),
      state: AcquisitionState.RETURNED,
      evidenceIds: ['ev-a', 'ev-b'],
      actualDecisionChanged: true,
    });

    // One-way: no reopening, no re-completion, no post-hoc assignment.
    await expect(
      completeRetrieval(engine, {
        decisionId: 'd_happy',
        completedAt: utcTimestamp('2026-03-03T00:00:00Z'),
        state: AcquisitionState.INVALID_RESPONSE,
      }),
    ).rejects.toThrowError(/already completed and is immutable/);
    await expect(
      recordProbeAssignment(engine, { decisionId: 'd_happy', assignment: probe() }),
    ).rejects.toThrowError(/after retrieval completion/);

    // The stored row round-trips through the §13.8 domain shape.
    const rows = await engine.query<Parameters<typeof toDomainDecision>[0]>(
      'SELECT * FROM evidence_acquisition_decisions WHERE decision_id = $1',
      ['d_happy'],
    );
    const decision = toDomainDecision(rows.rows[0]!);
    expect(decision.state).toBe(AcquisitionState.RETURNED);
    expect(decision.completedAt).toBe('2026-03-02T00:00:00Z');
    expect(decision.assignmentProbability).toBe(0.25);
    expect(decision.estimatedDecisionImpact).toBe(0.4);
    expect(decision.actualDecisionChanged).toBe(true);
    expect([...decision.evidenceIds]).toEqual(['ev-a', 'ev-b']);
    // Impact was recorded strictly BEFORE retrieval completion (AC-243).
    expect(decision.requestedAt).toBe('2026-03-01T00:00:00Z');
  });

  it('refuses completion before request at the boundary AND in SQL', async () => {
    await recordAcquisitionDecision(engine, {
      decisionId: 'd_order',
      candidateId: 'cand-1',
      evidenceFamily: 'DEX_TRADES',
      policyVersion: 'acq-policy/v1',
      state: AcquisitionState.REQUESTED,
      requestedAt: utcTimestamp('2026-03-05T00:00:00Z'),
    });
    await recordProbeAssignment(engine, {
      decisionId: 'd_order',
      assignment: probe({ selectionAt: utcTimestamp('2026-03-04T00:00:00Z') }),
    });
    await expect(
      completeRetrieval(engine, {
        decisionId: 'd_order',
        completedAt: utcTimestamp('2026-03-04T12:00:00Z'),
        state: AcquisitionState.RETURNED,
      }),
    ).rejects.toThrowError(/completion precedes request/);

    // The structural mirror: a raw row that completes before its own request
    // violates the SQL CHECK regardless of which process writes it.
    await expect(
      engine.query(
        `INSERT INTO evidence_acquisition_decisions
           (decision_id, candidate_id, evidence_family, policy_version, state,
            requested_at, completed_at, assignment_probability, impact_recorded_at)
         VALUES ('d_sqlbad','cand-1','DEX_TRADES','acq-policy/v1','REQUESTED',
                 '2026-03-06T00:00:00Z','2026-03-05T00:00:00Z',0.5,'2026-03-05T00:00:00Z')`,
      ),
    ).rejects.toThrowError(/acquisition_completion_not_before_request/);
  });

  it('refuses out-of-range impacts and NOT_REQUESTED records carrying lifecycle', async () => {
    await expect(
      recordAcquisitionDecision(engine, {
        decisionId: 'd_impact_bad',
        candidateId: 'cand-1',
        evidenceFamily: 'DEX_TRADES',
        policyVersion: 'acq-policy/v1',
        state: AcquisitionState.REQUESTED,
        requestedAt: utcTimestamp('2026-03-01T00:00:00Z'),
        estimatedDecisionImpact: 1.5,
      }),
    ).rejects.toThrowError(/decision impact must lie in/);
    await expect(
      recordAcquisitionDecision(engine, {
        decisionId: 'd_notreq_bad',
        candidateId: 'cand-1',
        evidenceFamily: 'DEX_TRADES',
        policyVersion: 'acq-policy/v1',
        state: AcquisitionState.NOT_REQUESTED_BY_POLICY,
        requestedAt: utcTimestamp('2026-03-01T00:00:00Z'),
      }),
    ).rejects.toThrowError(/no lifecycle timestamps/);
    // The SQL mirror: assignment_probability > 0 is required for any stored
    // probe; zero slips past nothing.
    await expect(
      engine.query(
        `INSERT INTO probe_assignments
           (decision_id, eligibility_stratum, assignment_probability, seed_provenance,
            selection_at, requested_fields)
         VALUES ('d_zero','s',0,'prf:x','2026-03-01T00:00:00Z',ARRAY['f'])`,
      ),
    ).rejects.toThrowError();
  });
});

describe('frozen matured counts (T036, AC-247)', () => {
  it('resolves counts only from decisions completed at or before t', async () => {
    // Two RETURNED decisions completed before the boundary…
    await recordAcquisitionDecision(engine, {
      decisionId: 'd_frozen_1',
      candidateId: 'cand-frozen',
      evidenceFamily: 'DEX_TRADES',
      policyVersion: 'acq-policy/v1',
      state: AcquisitionState.REQUESTED,
      requestedAt: utcTimestamp('2026-03-01T00:00:00Z'),
    });
    await recordProbeAssignment(engine, {
      decisionId: 'd_frozen_1',
      assignment: probe({ selectionAt: utcTimestamp('2026-03-01T00:00:30Z') }),
    });
    await completeRetrieval(engine, {
      decisionId: 'd_frozen_1',
      completedAt: utcTimestamp('2026-03-10T00:00:00Z'),
      state: AcquisitionState.RETURNED,
      evidenceIds: ['fe-1', 'fe-2'],
    });

    await recordAcquisitionDecision(engine, {
      decisionId: 'd_frozen_2',
      candidateId: 'cand-frozen',
      evidenceFamily: 'DEX_TRADES',
      policyVersion: 'acq-policy/v1',
      state: AcquisitionState.REQUESTED,
      requestedAt: utcTimestamp('2026-03-01T00:00:00Z'),
    });
    await recordProbeAssignment(engine, {
      decisionId: 'd_frozen_2',
      assignment: probe({ selectionAt: utcTimestamp('2026-03-01T00:00:30Z') }),
    });
    await completeRetrieval(engine, {
      decisionId: 'd_frozen_2',
      completedAt: utcTimestamp('2026-03-20T00:00:00Z'),
      state: AcquisitionState.RETURNED,
      evidenceIds: ['fe-2', 'fe-3'], // fe-2 duplicates across decisions → distinct count
    });

    // …one RETURNED decision completed AFTER the boundary…
    await recordAcquisitionDecision(engine, {
      decisionId: 'd_late',
      candidateId: 'cand-frozen',
      evidenceFamily: 'DEX_TRADES',
      policyVersion: 'acq-policy/v1',
      state: AcquisitionState.REQUESTED,
      requestedAt: utcTimestamp('2026-03-01T00:00:00Z'),
    });
    await recordProbeAssignment(engine, {
      decisionId: 'd_late',
      assignment: probe({ selectionAt: utcTimestamp('2026-03-01T00:00:30Z') }),
    });
    await completeRetrieval(engine, {
      decisionId: 'd_late',
      completedAt: utcTimestamp('2026-04-05T00:00:00Z'),
      state: AcquisitionState.RETURNED,
      evidenceIds: ['fe-4'],
    });

    const before = await maturedEvidenceCountAt(engine, {
      candidateId: 'cand-frozen',
      t: utcTimestamp('2026-04-01T00:00:00Z'),
    });
    expect(before).toBe(3); // distinct {fe-1, fe-2, fe-3}; d_late excluded

    // AC-247: a later post-hoc dependence estimate is stored (diagnostic-only)
    // but CANNOT alter the already-resolved historical count.
    await registerSourceIdentity(engine, {
      id: 'src/frozen-a' as SourceIdentityId,
      brandProvider: 'FrozenA',
      operation: 'swaps',
      upstreamLineageKey: 'upstream/frozen-a',
      endpointRegion: 'eu-west',
      collectionMethod: 'POLLING_API',
    });
    await registerSourceIdentity(engine, {
      id: 'src/frozen-b' as SourceIdentityId,
      brandProvider: 'FrozenB',
      operation: 'swaps',
      upstreamLineageKey: 'upstream/frozen-b',
      endpointRegion: 'us-east',
      collectionMethod: 'POLLING_API',
    });
    await recordDependenceEdge(engine, {
      edgeId: 'edge-frozen-retro',
      edge: {
        sourceA: 'src/frozen-a' as SourceIdentityId,
        sourceB: 'src/frozen-b' as SourceIdentityId,
        sharedUpstreamLineageKeys: [],
        inputs: {
          valueErrorTimingCorrelation: 0.9,
          outageOverlap: 0.6,
          firstSeenLagAgreement: 0.8,
          fingerprintSimilarity: 0.95,
        },
        label: DependenceLabel.DIAGNOSTIC_RETROSPECTIVE,
        availableAt: utcTimestamp('2026-05-01T00:00:00Z'),
      },
    });
    const after = await maturedEvidenceCountAt(engine, {
      candidateId: 'cand-frozen',
      t: utcTimestamp('2026-04-01T00:00:00Z'),
    });
    expect(after).toBe(before);
    // Family scoping works, and the later decision is visible at a later t.
    const familyOnly = await maturedEvidenceCountAt(engine, {
      candidateId: 'cand-frozen',
      evidenceFamily: 'SOCIAL',
      t: utcTimestamp('2026-04-01T00:00:00Z'),
    });
    expect(familyOnly).toBe(0);
    const later = await maturedEvidenceCountAt(engine, {
      candidateId: 'cand-frozen',
      t: utcTimestamp('2026-05-01T00:00:00Z'),
    });
    expect(later).toBe(4); // d_late's fe-4 now matured
  });
});
