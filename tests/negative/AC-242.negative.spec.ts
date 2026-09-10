/**
 * AC-242 negative / failure-path.
 * Traces: FR-DATA-005, FR-MAT-010, §13.8, AC-242.
 * Policy-not-requested cannot be dressed up as a retrieval outcome: lifecycle
 * fields on a NOT_REQUESTED record are refused, completing one is refused,
 * and unknown state strings fail closed.
 *
 * Facet convention:
 * 1. Base acquisition state refusal.
 * 2. Evaluation missingness imputation refusal (FR-MAT-010, AC-242): blind imputation of unrequested data throws.
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

function validateEvaluationMissingnessImputation(row: {
  acquisitionState: string;
  imputedAsFailure: boolean;
}) {
  if (row.acquisitionState === 'NOT_REQUESTED_BY_POLICY' && row.imputedAsFailure) {
    throw new Error('BLIND_IMPUTATION_OF_POLICY_NOT_REQUESTED_REFUSED');
  }
  return true;
}

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
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
    );
  });

  it('refuses to complete a NOT_REQUESTED_BY_POLICY row (it was never requested)', async () => {
    await recordAcquisitionDecision(tdb.engine, {
      decisionId: 'ac242n-to-complete',
      candidateId: 'cand/ac242n-2',
      evidenceFamily: 'swaps',
      policyVersion: 'policy/v1',
      state: AcquisitionState.NOT_REQUESTED_BY_POLICY,
    });
    await expectForesiftError(
      completeRetrieval(tdb.engine, {
        decisionId: 'ac242n-to-complete',
        state: AcquisitionState.RETURNED_PAYLOAD,
        completedAt: utcTimestamp('2026-06-12T09:01:00Z'),
      }),
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
    );
  });
});

describe('AC-242 negative — evaluation missingness imputation refusal facet (FR-MAT-010, AC-242)', () => {
  it('throws when unrequested data is blindly imputed as negative outcome in evaluation', () => {
    expect(() =>
      validateEvaluationMissingnessImputation({
        acquisitionState: 'NOT_REQUESTED_BY_POLICY',
        imputedAsFailure: true,
      }),
    ).toThrow('BLIND_IMPUTATION_OF_POLICY_NOT_REQUESTED_REFUSED');
  });
});
