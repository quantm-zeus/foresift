/**
 * AC-249 acceptance (positive) — task T057.
 * Traces: FR-DATA-003 (no-backdating rule, §13.6), FR-DATA-004.
 * AC text (manifest §39, abridged): "…availability-backdating placebo …
 * controls show no unexplained material lift; any failure blocks promotion."
 *
 * The placebo control at fixture level: a backfilled historical row carrying
 * its TRUE late availability enters no earlier replay — replay output is
 * bit-for-bit unchanged before and after the backfill. Any apparent "lift"
 * from the backfill would be an explained artifact of a later boundary only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import {
  appendObservation,
  recordBackfillReceipt,
  replayObservations,
} from '@foresift/persistence';
import { resolveEvidenceAt } from '@foresift/evidence';
import { closeTestDatabase, makeTestDatabase, seedPool, type TestDatabase } from './helpers.ts';

const T = (iso: string): UtcTimestamp => utcTimestamp(iso);

let tdb: TestDatabase;
let poolId: string;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  const { engine } = tdb;
  poolId = await seedPool(engine, {
    chainId: 'eip155:1',
    dexId: 'uniswap-v2',
    poolAddress: '0x00000000000000000000000000000000000ac249',
  });
  // Live data available well before every boundary used below.
  await appendObservation(engine, {
    observationId: 'ac249-live',
    subjectPoolId: poolId,
    eventAt: T('2026-06-01T08:00:00Z'),
    availableAt: T('2026-06-01T08:30:00Z'),
    availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
    rawAmount: '100',
    decimals: 2,
  });
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-249: availability-backdating placebo leaves replay unchanged', () => {
  it('backfilling with TRUE late availability does not alter earlier replays', async () => {
    const boundary = T('2026-06-01T12:00:00Z');
    const replayBefore = await replayObservations(tdb.engine, boundary);
    const evidenceBefore = await resolveEvidenceAt(tdb.engine, { resolvedAt: boundary });

    // A historical-query row about June 1st events, fetched June 5th: its
    // honest available_at is June 5th — NOT the event time.
    await appendObservation(tdb.engine, {
      observationId: 'ac249-backfilled',
      subjectPoolId: poolId,
      eventAt: T('2026-06-01T09:00:00Z'),
      availableAt: T('2026-06-05T14:00:00Z'), // true availability
      availabilityProvenance: 'HISTORICAL_QUERY_FETCHED_LATER',
      rawAmount: '9000', // would be a huge phantom lift if backdated
      decimals: 2,
    });
    await recordBackfillReceipt(tdb.engine, {
      backfillReceiptId: 'ac249-receipt',
      backfillJobId: 'job/ac249',
      backfillReason: 'PROVIDER_GAP_COVERAGE',
      historicalEventAt: T('2026-06-01T09:00:00Z'),
      retrievedAt: T('2026-06-05T13:00:00Z'),
      availableAt: T('2026-06-05T14:00:00Z'),
      retrospectiveOnly: false,
      proofMethod: 'RECOVERY_FETCH_COMMIT',
    });

    // The pre-boundary replay is UNCHANGED by the backfill's existence.
    expect(await replayObservations(tdb.engine, boundary)).toEqual(replayBefore);
    expect(await resolveEvidenceAt(tdb.engine, { resolvedAt: boundary })).toEqual(evidenceBefore);
    expect(replayBefore.map((r) => r.observationId)).toEqual(['ac249-live']);
  });

  it('the backfilled row becomes visible exactly at its own availability', async () => {
    const justBefore = await replayObservations(tdb.engine, T('2026-06-05T13:59:59Z'));
    expect(justBefore.map((r) => r.observationId)).not.toContain('ac249-backfilled');

    const at = await replayObservations(tdb.engine, T('2026-06-05T14:00:00Z'));
    expect(at.map((r) => r.observationId)).toContain('ac249-backfilled');
    // Any decision-time delta is fully attributable to the registered
    // boundary crossing the honest availability instant.
  });

  it('the receipt proves provenance for audit without changing visibility', async () => {
    const receipts = await tdb.engine.query<Record<string, unknown>>(
      'SELECT * FROM backfill_receipts WHERE backfill_receipt_id = $1',
      ['ac249-receipt'],
    );
    const receipt = receipts.rows[0];
    expect(receipt).toBeDefined();
    // Event time and availability stay distinct — never collapsed.
    expect(new Date(receipt?.historical_event_at as string).toISOString()).toBe(
      '2026-06-01T09:00:00.000Z',
    );
    expect(new Date(receipt?.available_at as string).toISOString()).toBe(
      '2026-06-05T14:00:00.000Z',
    );
  });
});
