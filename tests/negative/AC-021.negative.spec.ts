/**
 * AC-021 negative / failure-path.
 * Traces: FR-DATA-002, §13.4, INV-004.
 * Direct mutation attempts against the append-only stores must be rejected by
 * the SQL immutability triggers — originals can never be erased or rewritten,
 * not even by raw SQL from the application's own engine seam.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import { appendObservation, loadObservation } from '@foresift/persistence';
import { parseCoreSchema } from '@foresift/shared-schemas';
import { normalizeRawPayload } from '../../packages/tool-core/src/normalize.ts';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from '../acceptance/helpers.ts';

const T = (iso: string): UtcTimestamp => utcTimestamp(iso);

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  const { engine } = tdb;
  await appendObservation(engine, {
    observationId: 'ac21n-orig',
    eventAt: T('2026-06-03T09:00:00Z'),
    availableAt: T('2026-06-03T09:05:00Z'),
    availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
    rawAmount: '500',
    decimals: 2,
  });
  await engine.query(
    `INSERT INTO observation_revisions (
       revision_id, observation_id, revision_no, reason, available_at,
       availability_provenance, superseded_receipt_hash)
     SELECT 'ac21n-rev1', observation_id, 1, 'PROVIDER_CORRECTION',
            $1, 'HISTORICAL_QUERY_FETCHED_LATER', receipt_hash
     FROM observations WHERE observation_id = 'ac21n-orig'`,
    [T('2026-06-03T10:00:00Z')],
  );
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-021 negative: mutation attempts are rejected by triggers', () => {
  it('UPDATE on observations is refused', async () => {
    await expect(tdb.engine.query("UPDATE observations SET raw_amount = '1'")).rejects.toThrow(
      /immutable/,
    );
  });

  it('DELETE on observations is refused', async () => {
    await expect(
      tdb.engine.query("DELETE FROM observations WHERE observation_id = 'ac21n-orig'"),
    ).rejects.toThrow(/immutable/);
  });

  it('the original row survives every refused mutation attempt unchanged', async () => {
    const row = await loadObservation(tdb.engine, 'ac21n-orig');
    expect(row?.rawAmount).toBe('500');
    expect(row?.receiptHash).toMatch(/^sha256:/);
  });

  it('UPDATE on observation_revisions is refused', async () => {
    await expect(
      tdb.engine.query(
        "UPDATE observation_revisions SET reason = 'REWRITTEN' WHERE revision_id = 'ac21n-rev1'",
      ),
    ).rejects.toThrow(/immutable/);
  });

  it('DELETE on observation_revisions is refused', async () => {
    await expect(
      tdb.engine.query("DELETE FROM observation_revisions WHERE revision_id = 'ac21n-rev1'"),
    ).rejects.toThrow(/immutable/);
  });

  it('a compensating event cannot be deleted to hide a reorg', async () => {
    const { appendCompensatingEvent } = await import('@foresift/persistence');
    await appendCompensatingEvent(tdb.engine, {
      compensationId: 'ac21n-comp1',
      targetObservationId: 'ac21n-orig',
      kind: 'FINALITY_CORRECTION',
      availableAt: T('2026-06-03T11:00:00Z'),
    });
    await expect(
      tdb.engine.query("DELETE FROM compensating_events WHERE compensation_id = 'ac21n-comp1'"),
    ).rejects.toThrow(/immutable/);
  });
});

describe('AC-021 negative (tool-core substrate): attempts to erase evidence refs or overwrite observations fail', () => {
  it('envelope validation fails when evidenceIds contains non-string elements or invalid format', () => {
    const invalidEnvelope = {
      data: { poolId: 'ac21-pool' },
      meta: {
        toolName: 'get_pool_observation',
        toolVersion: '1.0.0',
        evidenceIds: [12345 as unknown as string],
        fetchedAt: '2026-06-03T09:00:00Z',
        cache: 'MISS',
        qualityCodes: [],
        conflicts: [],
        quota: {
          quotaModel: 'REQUESTS_PER_PERIOD',
          reservationState: 'COMMITTED',
          estimatedUnits: 1,
          actualUnits: 1,
        },
        partial: false,
      },
    };
    expect(() => parseCoreSchema('ToolResultEnvelope', invalidEnvelope)).toThrow();
  });

  it('normalizer refuses payload when observations is missing or malformed', () => {
    expect(() =>
      normalizeRawPayload(
        { observations: 'not-an-array' },
        { runId: 'run-1', provider: 'test-p', fetchedAt: '2026-06-03T09:00:00Z' },
      ),
    ).toThrow(/raw payload carries no observations array/);

    expect(() =>
      normalizeRawPayload(
        { observations: [null] },
        { runId: 'run-1', provider: 'test-p', fetchedAt: '2026-06-03T09:00:00Z' },
      ),
    ).toThrow(/observation 0 is not an object/);
  });
});
