/**
 * AC-243 negative / failure-path — task T054.
 * Traces: FR-DATA-005, §13.8, INV-004.
 * Retrieval cannot outrun randomization: completing without a prior probe
 * assignment fails, degenerate probabilities are refused, late assignments
 * are refused, and an assignment without a recorded decision impact cannot
 * mature — every ordering violation is a typed refusal.
 */
import { afterAll, beforeAll, describe, it } from 'vitest';
import { AcquisitionState, ErrorCode, utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import {
  completeRetrieval,
  recordAcquisitionDecision,
  recordProbeAssignment,
} from '@foresift/persistence';
import {
  closeTestDatabase,
  expectForesiftError,
  makeTestDatabase,
  type TestDatabase,
} from '../acceptance/helpers.ts';

const T = (iso: string): UtcTimestamp => utcTimestamp(iso);

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  const { engine } = tdb;
  await recordAcquisitionDecision(engine, {
    decisionId: 'ac243n-no-assignment',
    candidateId: 'cand/ac243n-a',
    evidenceFamily: 'swaps',
    policyVersion: 'policy/v1',
    state: AcquisitionState.REQUESTED,
    requestedAt: T('2026-06-14T09:00:00Z'),
  });
  await recordAcquisitionDecision(engine, {
    decisionId: 'ac243n-no-impact',
    candidateId: 'cand/ac243n-b',
    evidenceFamily: 'swaps',
    policyVersion: 'policy/v1',
    state: AcquisitionState.REQUESTED,
    requestedAt: T('2026-06-14T09:00:00Z'),
  });
  await recordAcquisitionDecision(engine, {
    decisionId: 'ac243n-late-assignment',
    candidateId: 'cand/ac243n-c',
    evidenceFamily: 'swaps',
    policyVersion: 'policy/v1',
    state: AcquisitionState.REQUESTED,
    requestedAt: T('2026-06-14T09:00:00Z'),
  });
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-243 negative: write-before-retrieval violations fail closed', () => {
  it('retrieval without any prior probe assignment is refused', async () => {
    await expectForesiftError(
      completeRetrieval(tdb.engine, {
        decisionId: 'ac243n-no-assignment',
        completedAt: T('2026-06-14T10:00:00Z'),
        state: AcquisitionState.RETURNED,
        evidenceIds: ['ev/x'],
      }),
      ErrorCode.ACQUISITION_PROBE_ASSIGNMENT_MISSING,
    );
  });

  it('an assignment without a recorded decision impact cannot mature', async () => {
    // Simulate a partially-written assignment (probe row only, no decision-row
    // impact bookkeeping) via raw SQL through the engine seam.
    await tdb.engine.query(
      `INSERT INTO probe_assignments (
         decision_id, eligibility_stratum, assignment_probability,
         seed_provenance, selection_at, requested_fields)
       VALUES ('ac243n-no-impact', 'stratum-a', 0.5, 'seed/x', $1, ARRAY['volume']::text[])`,
      [T('2026-06-14T09:00:01Z')],
    );
    await expectForesiftError(
      completeRetrieval(tdb.engine, {
        decisionId: 'ac243n-no-impact',
        completedAt: T('2026-06-14T10:00:00Z'),
        state: AcquisitionState.RETURNED,
        evidenceIds: ['ev/y'],
      }),
      ErrorCode.ACQUISITION_WRITE_BEFORE_RETRIEVAL_VIOLATED,
    );
  });

  it('zero assignment probability is refused (not masquerading as randomization)', async () => {
    await expectForesiftError(
      recordProbeAssignment(tdb.engine, {
        decisionId: 'ac243n-late-assignment',
        assignment: {
          eligibilityStratum: 'stratum-a',
          assignmentProbability: 0,
          seedProvenance: 'seed/x',
          selectionAt: T('2026-06-14T09:00:01Z'),
          requestedFields: ['volume'],
        },
      }),
      ErrorCode.ACQUISITION_WRITE_BEFORE_RETRIEVAL_VIOLATED,
    );
  });

  it('probability at or above 1 is refused', async () => {
    await expectForesiftError(
      recordProbeAssignment(tdb.engine, {
        decisionId: 'ac243n-late-assignment',
        assignment: {
          eligibilityStratum: 'stratum-a',
          assignmentProbability: 1,
          seedProvenance: 'seed/x',
          selectionAt: T('2026-06-14T09:00:01Z'),
          requestedFields: ['volume'],
        },
      }),
      ErrorCode.ACQUISITION_WRITE_BEFORE_RETRIEVAL_VIOLATED,
    );
  });

  it('an assignment recorded after retrieval completion is refused', async () => {
    // Complete ac243n-late-assignment legitimately first.
    await recordProbeAssignment(tdb.engine, {
      decisionId: 'ac243n-late-assignment',
      assignment: {
        eligibilityStratum: 'stratum-a',
        assignmentProbability: 0.5,
        seedProvenance: 'seed/x',
        selectionAt: T('2026-06-14T09:00:01Z'),
        requestedFields: ['volume'],
      },
      estimatedDecisionImpact: 0.4,
    });
    await completeRetrieval(tdb.engine, {
      decisionId: 'ac243n-late-assignment',
      completedAt: T('2026-06-14T10:00:00Z'),
      state: AcquisitionState.RETURNED,
      evidenceIds: ['ev/z'],
    });
    await expectForesiftError(
      recordProbeAssignment(tdb.engine, {
        decisionId: 'ac243n-late-assignment',
        assignment: {
          eligibilityStratum: 'stratum-b',
          assignmentProbability: 0.9,
          seedProvenance: 'seed/late',
          selectionAt: T('2026-06-14T11:00:00Z'),
          requestedFields: ['holders'],
        },
      }),
      ErrorCode.ACQUISITION_WRITE_BEFORE_RETRIEVAL_VIOLATED,
    );
  });

  it('retrieval completion preceding its own request time is refused', async () => {
    const { engine } = tdb;
    await recordAcquisitionDecision(engine, {
      decisionId: 'ac243n-time-travel',
      candidateId: 'cand/ac243n-d',
      evidenceFamily: 'swaps',
      policyVersion: 'policy/v1',
      state: AcquisitionState.REQUESTED,
      requestedAt: T('2026-06-14T12:00:00Z'),
    });
    await recordProbeAssignment(engine, {
      decisionId: 'ac243n-time-travel',
      assignment: {
        eligibilityStratum: 'stratum-a',
        assignmentProbability: 0.5,
        seedProvenance: 'seed/x',
        selectionAt: T('2026-06-14T12:00:01Z'),
        requestedFields: ['volume'],
      },
      estimatedDecisionImpact: 0.2,
    });
    await expectForesiftError(
      completeRetrieval(engine, {
        decisionId: 'ac243n-time-travel',
        completedAt: T('2026-06-14T11:59:59Z'), // precedes requestedAt
        state: AcquisitionState.RETURNED,
        evidenceIds: ['ev/w'],
      }),
      ErrorCode.ACQUISITION_WRITE_BEFORE_RETRIEVAL_VIOLATED,
    );
  });
});
