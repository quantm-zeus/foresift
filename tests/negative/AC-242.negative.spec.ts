/**
 * AC-242 negative / failure-path.
 * Traces: FR-DATA-005, §13.8.
 * Policy-not-requested cannot be dressed up as a retrieval outcome: lifecycle
 * fields on a NOT_REQUESTED record are refused, completing one is refused,
 * and unknown state strings fail closed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { AcquisitionState, ErrorCode, utcTimestamp } from '@foresift/domain';
import {
  completeRetrieval,
  maturedEvidenceCountAt,
  recordAcquisitionDecision,
} from '@foresift/persistence';
import { parseCoreSchema } from '@foresift/shared-schemas';
import {
  closeTestDatabase,
  expectForesiftError,
  makeTestDatabase,
  type TestDatabase,
} from '../acceptance/helpers.ts';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-242 negative: policy-not-requested is never a retrieval outcome', () => {
  it('refuses NOT_REQUESTED_BY_POLICY carrying a request timestamp', async () => {
    await expectForesiftError(
      recordAcquisitionDecision(tdb.engine, {
        decisionId: 'ac242n-tainted',
        candidateId: 'cand/ac242n',
        evidenceFamily: 'swaps',
        policyVersion: 'policy/v1',
        state: AcquisitionState.NOT_REQUESTED_BY_POLICY,
        requestedAt: utcTimestamp('2026-06-12T09:00:00Z'),
      }),
      ErrorCode.ACQUISITION_WRITE_BEFORE_RETRIEVAL_VIOLATED,
    );
  });

  it('refuses recording a NOT_REQUESTED_BY_POLICY retrieval completion', async () => {
    await recordAcquisitionDecision(tdb.engine, {
      decisionId: 'ac242n-clean',
      candidateId: 'cand/ac242n',
      evidenceFamily: 'swaps',
      policyVersion: 'policy/v1',
      state: AcquisitionState.REQUESTED,
      requestedAt: utcTimestamp('2026-06-12T09:00:00Z'),
    });
    await expectForesiftError(
      completeRetrieval(tdb.engine, {
        decisionId: 'ac242n-clean',
        completedAt: utcTimestamp('2026-06-12T09:05:00Z'),
        state: AcquisitionState.NOT_REQUESTED_BY_POLICY,
      }),
      ErrorCode.ACQUISITION_WRITE_BEFORE_RETRIEVAL_VIOLATED,
    );
  });

  it('refuses unknown acquisition states (no silent default)', async () => {
    await expectForesiftError(
      recordAcquisitionDecision(tdb.engine, {
        decisionId: 'ac242n-unknown-state',
        candidateId: 'cand/ac242n',
        evidenceFamily: 'swaps',
        policyVersion: 'policy/v1',
        state: 'RETURNED_EMPTY' as AcquisitionState, // not in the §13.8 vocabulary
      }),
      ErrorCode.ACQUISITION_STATE_UNKNOWN,
    );
  });

  it('a NOT_REQUESTED record never enters matured evidence counts', async () => {
    await recordAcquisitionDecision(tdb.engine, {
      decisionId: 'ac242n-only-not-requested',
      candidateId: 'cand/ac242n-counts',
      evidenceFamily: 'swaps',
      policyVersion: 'policy/v1',
      state: AcquisitionState.NOT_REQUESTED_BY_POLICY,
    });
    const matured = await maturedEvidenceCountAt(tdb.engine, {
      candidateId: 'cand/ac242n-counts',
      t: utcTimestamp('2026-06-12T23:00:00Z'),
    });
    expect(matured).toBe(0);
  });
});

describe('AC-242 negative (tool-core substrate): invalid blocked states and empty conflations fail closed', () => {
  it('BlockedStatePayload schema refuses unrecognized blocked state strings', () => {
    expect(() =>
      parseCoreSchema('BlockedStatePayload', {
        acquisitionState: 'RETURNED_EMPTY',
        machineReason: 'EMPTY_RESULT',
        toolName: 'discover_candidates',
        toolVersion: '1.0.0',
        pipelineRunId: 'run-1',
        at: '2026-06-12T09:00:00Z',
      }),
    ).toThrow();
  });
});

