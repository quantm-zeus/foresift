/**
 * AC-249 negative / failure-path.
 * Traces: FR-DATA-003 (INV-006), FR-DATA-004.
 * Actual backdating attempts are refused by the no-backdating guard and the
 * SQL CHECKs; a backfilled row without its honest availability can never
 * enter an earlier replay, so the placebo control cannot be defeated by
 * rewriting history.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { ErrorCode, utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import { assertNoBackdating, recordBackfillReceipt } from '@foresift/persistence';
import { parseDataSchema } from '@foresift/shared-schemas';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from '../acceptance/helpers.ts';

const T = (iso: string): UtcTimestamp => utcTimestamp(iso);

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-249 negative: backdating is refused', () => {
  it('the guard refuses available_at before retrieval commit without a live receipt', () => {
    expect(() =>
      assertNoBackdating({
        availableAt: T('2026-06-01T09:00:00Z'),
        retrievedAt: T('2026-06-05T13:00:00Z'),
        proofMethod: 'RECOVERY_FETCH_COMMIT',
      }),
    ).toThrow(/backdating refused/);
  });

  it('a claimed live-receipt proof without the receipt reference is still backdating', () => {
    // LIVE_RECEIPT_REFERENCE only passes WITH a reference; anything else with
    // an earlier availability falls through to the refusal.
    expect(() =>
      assertNoBackdating({
        availableAt: T('2026-06-01T09:00:00Z'),
        retrievedAt: T('2026-06-05T13:00:00Z'),
        proofMethod: 'LIVE_RECEIPT_REFERENCE',
      }),
    ).toThrow(/backdating refused/);
  });

  it('a genuine live receipt proves earlier availability honestly', () => {
    expect(() =>
      assertNoBackdating({
        availableAt: T('2026-06-01T09:00:00Z'),
        retrievedAt: T('2026-06-05T13:00:00Z'),
        proofMethod: 'LIVE_RECEIPT_REFERENCE',
        liveReceiptRef: 'obs/ac249n/live-proof',
      }),
    ).not.toThrow();
  });

  it('the repository refuses a backdating receipt insert before SQL is reached', async () => {
    // This route goes through recordBackfillReceipt, whose TS guard fires
    // first; the independent SQL CHECK refusal is proven separately in
    // packages/persistence/test/backfill-watermark.spec.ts (raw INSERT).
    await expect(
      recordBackfillReceipt(tdb.engine, {
        backfillReceiptId: 'ac249n-cheat',
        backfillJobId: 'job/cheat',
        backfillReason: 'PROVIDER_GAP_COVERAGE',
        historicalEventAt: T('2026-06-01T09:00:00Z'),
        retrievedAt: T('2026-06-05T13:00:00Z'),
        availableAt: T('2026-06-01T08:30:00Z'), // BEFORE retrieval — backdated
        retrospectiveOnly: false,
        proofMethod: 'RECOVERY_FETCH_COMMIT',
      }),
    ).rejects.toThrow(ErrorCode.BACKFILL_BACKDATING_REJECTED);
  });

  it('no refused row ever landed in the receipts table', async () => {
    const rows = await tdb.engine.query<{ n: string }>(
      'SELECT COUNT(*)::text AS n FROM backfill_receipts WHERE backfill_receipt_id = $1',
      ['ac249n-cheat'],
    );
    expect(Number(rows.rows[0]?.n ?? '0')).toBe(0);
  });
});

describe('AC-249 negative (tool-core substrate): backdating in backfill receipt schema is refused', () => {
  it('BackfillReceipt schema refuses availableAt preceding retrievedAt without live receipt proof', () => {
    expect(() =>
      parseDataSchema('BackfillReceipt', {
        backfillJobId: 'job/cheat',
        backfillReason: 'PROVIDER_GAP_COVERAGE',
        historicalEventAt: T('2026-06-01T09:00:00Z'),
        retrievedAt: T('2026-06-05T13:00:00Z'),
        availableAt: T('2026-06-01T08:30:00Z'),
        retrospectiveOnly: false,
        wouldHaveBeenObservableLive: null,
        availabilityProof: {
          method: 'RECOVERY_FETCH_COMMIT',
        },
      }),
    ).toThrow();
  });
});

