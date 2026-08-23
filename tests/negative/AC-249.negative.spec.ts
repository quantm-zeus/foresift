/**
 * AC-249 negative / failure-path — task T057.
 * Traces: FR-DATA-003 (INV-006), FR-DATA-004.
 * Actual backdating attempts are refused by the no-backdating guard and the
 * SQL CHECKs; a backfilled row without its honest availability can never
 * enter an earlier replay, so the placebo control cannot be defeated by
 * rewriting history.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import {
  assertNoBackdating,
  recordBackfillReceipt,
} from '@foresift/persistence';
import {
  closeTestDatabase,
  makeTestDatabase,
  type TestDatabase,
} from '../acceptance/helpers';

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

  it('the database refuses a backdating receipt insert', async () => {
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
    ).rejects.toThrow();
  });

  it('no refused row ever landed in the receipts table', async () => {
    const rows = await tdb.engine.query<{ n: string }>(
      'SELECT COUNT(*)::text AS n FROM backfill_receipts WHERE backfill_receipt_id = $1',
      ['ac249n-cheat'],
    );
    expect(Number(rows.rows[0]?.n ?? '0')).toBe(0);
  });
});
