/**
 * AC-243 acceptance (positive).
 * Traces: FR-DATA-005, FR-DATA-003 (§13.8 randomized probes), FR-MAT-007, AC-243.
 * AC text (manifest §39): "Every randomized evidence probe stores eligibility
 * stratum, nonzero assignment probability, seed provenance, selection
 * timestamp, requested fields, and final decision impact before outcome
 * maturity."
 *
 * The storage contract persists every probe field BEFORE retrieval completes;
 * after completion the decision row still exposes assignment probability and
 * the impact recorded at selection time.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { AcquisitionState, utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import {
  completeRetrieval,
  recordAcquisitionDecision,
  recordProbeAssignment,
} from '@foresift/persistence';
import { DATA_SCHEMAS, parseDataSchema } from '@foresift/shared-schemas';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';

const T = (iso: string): UtcTimestamp => utcTimestamp(iso);

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  const { engine } = tdb;

  await recordAcquisitionDecision(engine, {
    decisionId: 'ac243-probe',
    candidateId: 'cand/ac243',
    evidenceFamily: 'swaps',
    policyVersion: 'policy/v1',
    state: AcquisitionState.REQUESTED,
    requestedAt: T('2026-06-13T09:00:00Z'),
    estimatedInformationValue: 0.6,
  });
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-243: probe metadata completeness with write-before-retrieval ordering', () => {
  it('persists every required probe field before retrieval', async () => {
    await recordProbeAssignment(tdb.engine, {
      decisionId: 'ac243-probe',
      assignment: {
        eligibilityStratum: 'stratum-high-value',
        assignmentProbability: 0.25,
        seedProvenance: 'seed/hashing-v1:candidate=cand/ac243',
        selectionAt: T('2026-06-13T09:00:01Z'),
        requestedFields: ['volume', 'liquidity', 'holders'],
      },
      estimatedDecisionImpact: 0.35,
    });

    // Read the stored rows BEFORE any retrieval happened.
    const probes = await tdb.engine.query<{
      eligibility_stratum: string;
      assignment_probability: string;
      seed_provenance: string;
      selection_at: Date | string;
      requested_fields: string[];
    }>('SELECT * FROM probe_assignments WHERE decision_id = $1', ['ac243-probe']);
    const p = probes.rows[0];
    expect(p).toBeDefined();
    expect(p?.eligibility_stratum).toBe('stratum-high-value');
    expect(Number(p?.assignment_probability)).toBe(0.25); // strictly nonzero
    expect(p?.seed_provenance).toBe('seed/hashing-v1:candidate=cand/ac243');
    expect(new Date(p?.selection_at ?? '').toISOString()).toBe('2026-06-13T09:00:01.000Z');
    expect(p?.requested_fields).toEqual(['volume', 'liquidity', 'holders']);

    // The decision already carries the selection-time impact pre-completion.
    const decisions = await tdb.engine.query<{
      assignment_probability: string | null;
      estimated_decision_impact: string | null;
      impact_recorded_at: Date | string | null;
      completed_at: Date | string | null;
    }>(
      'SELECT assignment_probability, estimated_decision_impact, impact_recorded_at, completed_at FROM evidence_acquisition_decisions WHERE decision_id = $1',
      ['ac243-probe'],
    );
    const d = decisions.rows[0];
    expect(Number(d?.assignment_probability)).toBe(0.25);
    expect(Number(d?.estimated_decision_impact)).toBe(0.35);
    expect(d?.impact_recorded_at).not.toBeNull(); // recorded BEFORE maturity
    expect(d?.completed_at).toBeNull(); // not yet matured
  });

  it('outcome maturity preserves the earlier-recorded probe metadata', async () => {
    await completeRetrieval(tdb.engine, {
      decisionId: 'ac243-probe',
      completedAt: T('2026-06-13T10:00:00Z'),
      state: AcquisitionState.RETURNED,
      evidenceIds: ['ev/ac243/1'],
      actualDecisionChanged: true,
    });
    const decisions = await tdb.engine.query<{
      state: string;
      assignment_probability: string | null;
      estimated_decision_impact: string | null;
      impact_recorded_at: Date | string | null;
      actual_decision_changed: boolean | null;
    }>(
      'SELECT state, assignment_probability, estimated_decision_impact, impact_recorded_at, actual_decision_changed FROM evidence_acquisition_decisions WHERE decision_id = $1',
      ['ac243-probe'],
    );
    const d = decisions.rows[0];
    expect(d?.state).toBe('RETURNED');
    expect(Number(d?.assignment_probability)).toBe(0.25);
    expect(Number(d?.estimated_decision_impact)).toBe(0.35);
    expect(d?.impact_recorded_at).not.toBeNull();
    expect(d?.actual_decision_changed).toBe(true);
  });

  it('the persisted decision validates against the shared schema mirror', async () => {
    const rows = await tdb.engine.query<{
      decision_id: string;
      candidate_id: string;
      evidence_family: string;
      policy_version: string;
      state: string;
      requested_at: string | null;
      completed_at: string | null;
      assignment_probability: string | null;
      estimated_decision_impact: string | null;
      estimated_information_value: string | null;
      actual_decision_changed: boolean | null;
      evidence_ids: string[];
    }>('SELECT * FROM evidence_acquisition_decisions WHERE decision_id = $1', ['ac243-probe']);
    const r = rows.rows[0];
    expect(r).toBeDefined();
    // Row → schema projection: numerics arrive as decimal text; absent as NULL.
    const num = (v: string | null | undefined): number | undefined =>
      v === null || v === undefined ? undefined : Number(v);
    const parsed = DATA_SCHEMAS.EvidenceAcquisitionDecision.parse({
      id: r?.decision_id,
      candidateId: r?.candidate_id,
      evidenceFamily: r?.evidence_family,
      policyVersion: r?.policy_version,
      state: r?.state,
      requestedAt: r?.requested_at ?? undefined,
      completedAt: r?.completed_at ?? undefined,
      assignmentProbability: num(r?.assignment_probability),
      estimatedDecisionImpact: num(r?.estimated_decision_impact),
      estimatedInformationValue: num(r?.estimated_information_value),
      actualDecisionChanged: r?.actual_decision_changed ?? undefined,
      evidenceIds: r?.evidence_ids ?? [],
    });
    expect(parsed.assignmentProbability).toBe(0.25);
    expect(parsed.completedAt).toBeDefined();
    expect(parsed.evidenceIds).toEqual(['ev/ac243/1']);
  });
});

describe('AC-243 acceptance (tool-core substrate): probe assignment schema and persistence validity', () => {
  it('EvidenceAcquisitionDecision schema validates complete probe assignment', () => {
    const parsed = parseDataSchema('EvidenceAcquisitionDecision', {
      id: 'ac243-probe',
      candidateId: 'cand/ac243',
      evidenceFamily: 'swaps',
      policyVersion: 'policy/v1',
      state: 'RETURNED',
      requestedAt: T('2026-06-13T09:00:00Z'),
      completedAt: T('2026-06-13T10:00:00Z'),
      assignmentProbability: 0.25,
      estimatedDecisionImpact: 0.35,
      actualDecisionChanged: true,
      evidenceIds: ['ev/ac243/1'],
    });
    expect(parsed.assignmentProbability).toBe(0.25);
    expect(parsed.estimatedDecisionImpact).toBe(0.35);
  });
});

describe('AC-243 G1 extension: probe-probability-before-maturity ordering facet (FR-MAT-007, AC-243)', () => {
  it('freezes probe assignment probability and strata before maturity progression for Horvitz-Thompson estimation', async () => {
    // Horvitz-Thompson weighted estimation requires strictly positive inclusion probability
    // recorded prior to outcome maturity.
    const probeDecisionId = 'ac243-ht-probe';
    await recordAcquisitionDecision(tdb.engine, {
      decisionId: probeDecisionId,
      candidateId: 'cand/ac243-ht',
      evidenceFamily: 'swaps',
      policyVersion: 'policy/v1',
      state: AcquisitionState.REQUESTED,
      requestedAt: T('2026-06-13T11:00:00Z'),
      estimatedInformationValue: 0.5,
    });

    await recordProbeAssignment(tdb.engine, {
      decisionId: probeDecisionId,
      assignment: {
        eligibilityStratum: 'stratum-liquidity-high',
        assignmentProbability: 0.2,
        seedProvenance: 'seed/ht-stratum-v1',
        selectionAt: T('2026-06-13T11:00:01Z'),
        requestedFields: ['volume', 'liquidity'],
      },
      estimatedDecisionImpact: 0.4,
    });

    // Verify assignment probability is strictly positive and recorded prior to completion
    const beforeMaturity = await tdb.engine.query<{
      assignment_probability: string | null;
      impact_recorded_at: Date | string | null;
      completed_at: Date | string | null;
    }>(
      'SELECT assignment_probability, impact_recorded_at, completed_at FROM evidence_acquisition_decisions WHERE decision_id = $1',
      [probeDecisionId],
    );
    expect(Number(beforeMaturity.rows[0]?.assignment_probability)).toBe(0.2);
    expect(beforeMaturity.rows[0]?.impact_recorded_at).not.toBeNull();
    expect(beforeMaturity.rows[0]?.completed_at).toBeNull();

    // Now complete retrieval to mature the outcome
    await completeRetrieval(tdb.engine, {
      decisionId: probeDecisionId,
      completedAt: T('2026-06-13T12:00:00Z'),
      state: AcquisitionState.RETURNED,
      evidenceIds: ['ev/ac243/ht/1'],
      actualDecisionChanged: false,
    });

    const afterMaturity = await tdb.engine.query<{
      assignment_probability: string | null;
      completed_at: Date | string | null;
    }>(
      'SELECT assignment_probability, completed_at FROM evidence_acquisition_decisions WHERE decision_id = $1',
      [probeDecisionId],
    );
    expect(Number(afterMaturity.rows[0]?.assignment_probability)).toBe(0.2);
    expect(afterMaturity.rows[0]?.completed_at).not.toBeNull();
    // Horvitz-Thompson weight = 1 / p_i = 1 / 0.2 = 5.0
    const htWeight = 1 / Number(afterMaturity.rows[0]?.assignment_probability);
    expect(htWeight).toBe(5.0);
  });
});
