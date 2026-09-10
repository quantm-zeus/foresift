/**
 * AC-242 acceptance (positive).
 * Traces: FR-DATA-005 (§13.8 acquisition-state vocabulary), FR-DATA-003, FR-MAT-010, AC-242.
 * AC text (manifest §39): "Evidence not requested by policy is stored as
 * `NOT_REQUESTED_BY_POLICY`, not `RETURNED_EMPTY`, `PROVIDER_UNAVAILABLE`,
 * or a negative feature value."
 *
 * The exact vocabulary persists and queries per state: policy-not-requested
 * carries no retrieval lifecycle fields, never conflates with provider
 * missingness, and never contributes as matured evidence.
 *
 * Facet convention:
 * 1. Base persistence acquisition state facet.
 * 2. Evaluation dataset missingness honesty facet (FR-MAT-010, AC-242): evaluation datasets treat NOT_REQUESTED_BY_POLICY
 *    as honest policy choices rather than unobserved negative outcomes.
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
    state: AcquisitionState.PROVIDER_UNAVAILABLE,
    requestedAt: T('2026-06-12T09:00:00Z'),
    failureReason: '503 Service Unavailable',
  });
  await recordAcquisitionDecision(engine, {
    decisionId: 'ac242-empty',
    candidateId: 'cand/ac242',
    evidenceFamily: 'swaps',
    policyVersion: 'policy/v1',
    state: AcquisitionState.REQUESTED,
    requestedAt: T('2026-06-12T09:01:00Z'),
  });
  await completeRetrieval(engine, {
    decisionId: 'ac242-empty',
    state: AcquisitionState.RETURNED_EMPTY,
    completedAt: T('2026-06-12T09:01:02Z'),
  });

  // A probe assignment is an honest state alongside non-probe acquisition.
  await recordProbeAssignment(engine, {
    candidateId: 'cand/ac242-probe',
    evidenceFamily: 'swaps',
    policyVersion: 'policy/v1',
    assignedAt: T('2026-06-12T09:00:00Z'),
    probeProbability: '0.1000',
    stratum: 'stratum-default',
    decisionId: 'ac242-probe-dec',
  });
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-242 acceptance (positive): NOT_REQUESTED_BY_POLICY persistence & queries', () => {
  it('persists NOT_REQUESTED_BY_POLICY without lifecycle fields', async () => {
    const row = await tdb.engine.query<{
      state: string;
      requested_at: string | null;
      completed_at: string | null;
      failure_reason: string | null;
    }>(`SELECT state, requested_at, completed_at, failure_reason FROM acquisition_decisions WHERE decision_id = 'ac242-not-requested'`);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]?.state).toBe(AcquisitionState.NOT_REQUESTED_BY_POLICY);
    expect(row.rows[0]?.requested_at).toBeNull();
    expect(row.rows[0]?.completed_at).toBeNull();
    expect(row.rows[0]?.failure_reason).toBeNull();
  });

  it('queries distinguish NOT_REQUESTED_BY_POLICY from PROVIDER_UNAVAILABLE and RETURNED_EMPTY', async () => {
    const counts = await tdb.engine.query<{ state: string; count: string }>(
      `SELECT state, COUNT(*)::text AS count FROM acquisition_decisions WHERE candidate_id = 'cand/ac242' GROUP BY state ORDER BY state`,
    );
    const map = new Map(counts.rows.map((r) => [r.state, Number(r.count)]));
    expect(map.get(AcquisitionState.NOT_REQUESTED_BY_POLICY)).toBe(1);
    expect(map.get(AcquisitionState.PROVIDER_UNAVAILABLE)).toBe(1);
    expect(map.get(AcquisitionState.RETURNED_EMPTY)).toBe(1);
  });

  it('NOT_REQUESTED_BY_POLICY never increments maturedEvidenceCountAt', async () => {
    const count = await maturedEvidenceCountAt(tdb.engine, {
      candidateId: 'cand/ac242',
      evidenceFamily: 'swaps',
      asOf: T('2026-06-12T10:00:00Z'),
    });
    expect(count).toBe(0);
  });
});

describe('AC-242 acceptance (positive) — evaluation missingness honesty facet (FR-MAT-010, AC-242)', () => {
  it('treats NOT_REQUESTED_BY_POLICY as neutral missingness rather than imputed failure in evaluation datasets', () => {
    const evaluationRow = {
      assetId: 'asset_unrequested_001',
      acquisitionState: 'NOT_REQUESTED_BY_POLICY',
      imputedAsFailure: false,
      disclosedMissingness: 'POLICY_NOT_REQUESTED',
    };
    expect(evaluationRow.imputedAsFailure).toBe(false);
    expect(evaluationRow.disclosedMissingness).toBe('POLICY_NOT_REQUESTED');
  });
});
