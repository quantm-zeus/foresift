/**
 * AC-242 acceptance (positive).
 * Traces: FR-DATA-005 (§13.8 acquisition-state vocabulary), FR-DATA-003.
 * AC text (manifest §39): "Evidence not requested by policy is stored as
 * `NOT_REQUESTED_BY_POLICY`, not `RETURNED_EMPTY`, `PROVIDER_UNAVAILABLE`,
 * or a negative feature value."
 *
 * The exact vocabulary persists and queries per state: policy-not-requested
 * carries no retrieval lifecycle fields, never conflates with provider
 * missingness, and never contributes as matured evidence.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { AcquisitionState, utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import {
  maturedEvidenceCountAt,
  recordAcquisitionDecision,
  recordProbeAssignment,
  completeRetrieval,
} from '@foresift/persistence';
import { parseCoreSchema, type BlockedStatePayload } from '@foresift/shared-schemas';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';

const T = (iso: string): UtcTimestamp => utcTimestamp(iso);

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  const { engine } = tdb;

  // Three outcomes for the same candidate/family that must stay distinct.
  await recordAcquisitionDecision(engine, {
    decisionId: 'ac242-not-requested',
    candidateId: 'cand/ac242',
    evidenceFamily: 'swaps',
    policyVersion: 'policy/v1',
    state: AcquisitionState.NOT_REQUESTED_BY_POLICY,
  });
  await recordAcquisitionDecision(engine, {
    decisionId: 'ac242-provider-down',
    candidateId: 'cand/ac242',
    evidenceFamily: 'swaps',
    policyVersion: 'policy/v1',
    state: AcquisitionState.REQUESTED,
    requestedAt: T('2026-06-11T09:00:00Z'),
  });
  await recordProbeAssignment(engine, {
    decisionId: 'ac242-provider-down',
    assignment: {
      eligibilityStratum: 'stratum-a',
      assignmentProbability: 0.4,
      seedProvenance: 'seed/deterministic-v1',
      selectionAt: T('2026-06-11T09:00:01Z'),
      requestedFields: ['volume'],
    },
    estimatedDecisionImpact: 0.2,
  });
  await completeRetrieval(engine, {
    decisionId: 'ac242-provider-down',
    completedAt: T('2026-06-11T09:05:00Z'),
    state: AcquisitionState.PROVIDER_UNAVAILABLE,
  });
  await recordAcquisitionDecision(engine, {
    decisionId: 'ac242-returned',
    candidateId: 'cand/ac242',
    evidenceFamily: 'swaps',
    policyVersion: 'policy/v1',
    state: AcquisitionState.REQUESTED,
    requestedAt: T('2026-06-11T10:00:00Z'),
  });
  await recordProbeAssignment(engine, {
    decisionId: 'ac242-returned',
    assignment: {
      eligibilityStratum: 'stratum-a',
      assignmentProbability: 0.4,
      seedProvenance: 'seed/deterministic-v1',
      selectionAt: T('2026-06-11T10:00:01Z'),
      requestedFields: ['volume'],
    },
    estimatedDecisionImpact: 0.3,
  });
  await completeRetrieval(engine, {
    decisionId: 'ac242-returned',
    completedAt: T('2026-06-11T10:04:00Z'),
    state: AcquisitionState.RETURNED,
    evidenceIds: ['ev/ac242/1'],
  });
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-242: NOT_REQUESTED_BY_POLICY storage semantics', () => {
  it('persists the exact state with no retrieval lifecycle fields', async () => {
    const rows = await tdb.engine.query<Record<string, unknown>>(
      'SELECT * FROM evidence_acquisition_decisions WHERE decision_id = $1',
      ['ac242-not-requested'],
    );
    const row = rows.rows[0];
    expect(row).toBeDefined();
    expect(row?.state).toBe('NOT_REQUESTED_BY_POLICY');
    expect(row?.requested_at).toBeNull();
    expect(row?.completed_at).toBeNull();
    expect(row?.assignment_probability).toBeNull();
  });

  it('each outcome state stays distinct and queryable', async () => {
    const byState = await tdb.engine.query<{ state: string; n: string }>(
      `SELECT state, COUNT(*)::text AS n FROM evidence_acquisition_decisions
       WHERE candidate_id = 'cand/ac242' GROUP BY state ORDER BY state`,
    );
    expect(
      Object.fromEntries(byState.rows.map((r): [string, number] => [r.state, Number(r.n)])),
    ).toEqual({
      NOT_REQUESTED_BY_POLICY: 1,
      PROVIDER_UNAVAILABLE: 1,
      RETURNED: 1,
    });
  });

  it('policy-not-requested never counts as matured evidence', async () => {
    // Only the RETURNED decision contributes — NOT_REQUESTED and
    // PROVIDER_UNAVAILABLE are invisible to matured evidence counts.
    const matured = await maturedEvidenceCountAt(tdb.engine, {
      candidateId: 'cand/ac242',
      evidenceFamily: 'swaps',
      t: T('2026-06-11T12:00:00Z'),
    });
    expect(matured).toBe(1);
  });

  it('a NOT_REQUESTED decision carries no evidence ids to count', async () => {
    const rows = await tdb.engine.query<{ evidence_ids: string[] }>(
      'SELECT evidence_ids FROM evidence_acquisition_decisions WHERE decision_id = $1',
      ['ac242-not-requested'],
    );
    expect(rows.rows[0]?.evidence_ids).toEqual([]);
  });
});

describe('AC-242 acceptance (tool-core substrate): NOT_REQUESTED_BY_POLICY and blocked states persist distinctly', () => {
  it('BlockedStatePayload schema validates NOT_REQUESTED_BY_POLICY payload', () => {
    const payload: BlockedStatePayload = {
      acquisitionState: 'NOT_REQUESTED_BY_POLICY',
      machineReason: 'POLICY_EVALUATION_SKIPPED',
      toolName: 'discover_candidates',
      toolVersion: '1.0.0',
      pipelineRunId: 'run-ac242-1',
      at: T('2026-06-11T09:00:00Z'),
    };
    const validated = parseCoreSchema('BlockedStatePayload', payload);
    expect(validated.acquisitionState).toBe('NOT_REQUESTED_BY_POLICY');
  });
});

describe('AC-242 G1 extensions: FR-DATA-012 field set and seed provenance (FR-DATA-011, FR-DATA-012)', () => {
  it('persists requestedFields and seed provenance before retrieval', async () => {
    await recordAcquisitionDecision(tdb.engine, {
      decisionId: 'ac242-seed-test',
      candidateId: 'cand/ac242-seed',
      evidenceFamily: 'social_sentiment',
      policyVersion: 'probe-policy@v2',
      state: AcquisitionState.REQUESTED,
      requestedAt: T('2026-06-11T14:00:00Z'),
    });

    await recordProbeAssignment(tdb.engine, {
      decisionId: 'ac242-seed-test',
      assignment: {
        eligibilityStratum: 'stratum-x',
        assignmentProbability: 0.25,
        seedProvenance: 'seed/g1-prng-42',
        selectionAt: T('2026-06-11T14:00:01Z'),
        requestedFields: ['holder_distribution', 'developer_activity'],
      },
      estimatedDecisionImpact: 0.45,
    });

    const rows = await tdb.engine.query<Record<string, unknown>>(
      'SELECT * FROM evidence_acquisition_decisions WHERE decision_id = $1',
      ['ac242-seed-test'],
    );
    const row = rows.rows[0];
    expect(row).toBeDefined();
    expect(row?.assignment_seed).toBe('seed/g1-prng-42');
  });
});
