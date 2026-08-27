/**
 * AC-061 negative / failure-path.
 * Traces: FR-DATA-005, FR-DR-001.
 * Fabricating a success-shaped output over an outage is impossible at every
 * layer: silent absences are refused (repository AND SQL), the success
 * vocabulary cannot explain a null, and an outage decision can never be
 * patched into a completed retrieval after the fact.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { AcquisitionState, ErrorCode, utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import {
  appendObservation,
  completeRetrieval,
  recordAcquisitionDecision,
  recordFieldQuality,
} from '@foresift/persistence';
import {
  closeTestDatabase,
  expectForesiftError,
  makeTestDatabase,
  seedPool,
  type TestDatabase,
} from '../acceptance/helpers.ts';

const T = (iso: string): UtcTimestamp => utcTimestamp(iso);

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  const { engine } = tdb;
  const poolId = await seedPool(engine, {
    chainId: 'eip155:1',
    dexId: 'uniswap-v2',
    poolAddress: '0x00000000000000000000000000000000000ac161',
  });
  await appendObservation(engine, {
    observationId: 'ac061n-obs',
    subjectPoolId: poolId,
    eventAt: T('2026-06-01T08:00:00Z'),
    availableAt: T('2026-06-01T08:30:00Z'),
    availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
    rawAmount: '7',
    decimals: 2,
  });
  // An outage decision opened mid-window, requested but never completed.
  await recordAcquisitionDecision(engine, {
    decisionId: 'ac061n-outage',
    candidateId: 'cand/ac061n',
    evidenceFamily: 'swaps',
    policyVersion: 'policy/v1',
    state: AcquisitionState.PROVIDER_UNAVAILABLE,
    requestedAt: T('2026-06-01T08:05:00Z'),
  });
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-061 negative: fabricated success over an outage is refused', () => {
  it('a silent null (no quality code) is refused at the repository boundary', async () => {
    await expectForesiftError(
      recordFieldQuality(tdb.engine, {
        fieldQualityId: 'ac061n-fq-silent-null',
        observationId: 'ac061n-obs',
        fieldPath: 'metrics.volumeUsd24h',
        valueRaw: null,
        qualityCodes: [],
      }),
      ErrorCode.QUALITY_NULL_WITHOUT_CODE,
    );
  });

  it('the success vocabulary (VALID alone) cannot explain an absence', async () => {
    await expectForesiftError(
      recordFieldQuality(tdb.engine, {
        fieldQualityId: 'ac061n-fq-valid-null',
        observationId: 'ac061n-obs',
        fieldPath: 'metrics.tvlUsd',
        valueRaw: null,
        qualityCodes: ['VALID'],
      }),
      ErrorCode.QUALITY_NULL_WITHOUT_CODE,
    );
  });

  it('the SQL layer independently refuses a null without codes', async () => {
    await tdb.engine
      .query(
        `INSERT INTO observation_field_quality
           (field_quality_id, observation_id, field_path, value_raw, quality_codes)
         VALUES ('ac061n-fq-sql-null','ac061n-obs','metrics.x',NULL,ARRAY[]::text[])`,
      )
      .then(
        () => {
          throw new Error('expected check-constraint refusal for codeless null');
        },
        (err: unknown) => {
          expect(String((err as Error).message)).toContain('observation_field_quality');
        },
      );
  });

  it('an outage decision cannot be patched into a completed retrieval', async () => {
    // No probe assignment was ever persisted for the outage attempt, so a
    // post-hoc "it actually returned" completion is a typed refusal — the
    // PROVIDER_UNAVAILABLE state stands.
    await expectForesiftError(
      completeRetrieval(tdb.engine, {
        decisionId: 'ac061n-outage',
        completedAt: T('2026-06-01T09:00:00Z'),
        state: AcquisitionState.RETURNED,
        evidenceIds: ['ev/fabricated'],
      }),
      ErrorCode.ACQUISITION_PROBE_ASSIGNMENT_MISSING,
    );
    const rows = await tdb.engine.query<{ state: string; completed_at: string | null }>(
      'SELECT state, completed_at FROM evidence_acquisition_decisions WHERE decision_id = $1',
      ['ac061n-outage'],
    );
    expect(rows.rows[0]?.state).toBe(AcquisitionState.PROVIDER_UNAVAILABLE);
    expect(rows.rows[0]?.completed_at).toBeNull();
  });
});
