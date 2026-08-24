/**
 * Backfill receipts (T028, §13.6) and watermarks (T029, §13.5): no-backdating
 * is enforced at the repository boundary AND structurally by SQL CHECKs; the
 * live-receipt exception requires an explicit reference; coverage claims over
 * a non-contiguous watermark are refused.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { ErrorCode, utcTimestamp, visibleAt, type UtcTimestamp } from '@foresift/domain';
import {
  advanceWatermark,
  appendObservation,
  applyMigrations,
  assertNoBackdating,
  backfillVisibleForReplay,
  canClaimCompleteCoverage,
  createEngine,
  loadWatermark,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  recordBackfillReceipt,
  type DatabaseEngine,
} from '../src/index.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

let db: PGlite;
let engine: DatabaseEngine;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
}, 120_000);

afterAll(async () => {
  await db.close();
}, 30_000);

const T = (s: string): UtcTimestamp => utcTimestamp(s);
const KEY = {
  provider: 'test-provider',
  operation: 'swaps',
  collectorShard: 'shard-0',
  programVersion: '1.0.0',
  chainId: 'eip155:1',
};

describe('no-backdating guard (§13.6 rule 5)', () => {
  it('refuses available_at earlier than retrieval without a live receipt', () => {
    expect(() =>
      assertNoBackdating({
        availableAt: T('2026-02-01T00:00:00Z'),
        retrievedAt: T('2026-03-01T00:00:00Z'),
        proofMethod: 'RECOVERY_FETCH_COMMIT',
      }),
    ).toThrowError(/backdating refused/);

    // Equal instants are fine (availability at commit time).
    expect(() =>
      assertNoBackdating({
        availableAt: T('2026-03-01T00:00:00Z'),
        retrievedAt: T('2026-03-01T00:00:00Z'),
        proofMethod: 'MANUAL_IMPORT_RECEIPT',
      }),
    ).not.toThrow();

    // Later availability than retrieval is trivially honest.
    expect(() =>
      assertNoBackdating({
        availableAt: T('2026-03-02T00:00:00Z'),
        retrievedAt: T('2026-03-01T00:00:00Z'),
        proofMethod: 'RECOVERY_FETCH_COMMIT',
      }),
    ).not.toThrow();
  });

  it('admits earlier availability only with LIVE_RECEIPT_REFERENCE + ref', () => {
    // Live-receipt claim WITHOUT the reference is still refused.
    expect(() =>
      assertNoBackdating({
        availableAt: T('2026-01-01T00:00:00Z'),
        retrievedAt: T('2026-03-01T00:00:00Z'),
        proofMethod: 'LIVE_RECEIPT_REFERENCE',
      }),
    ).toThrowError(/backdating refused/);

    expect(() =>
      assertNoBackdating({
        availableAt: T('2026-01-01T00:00:00Z'),
        retrievedAt: T('2026-03-01T00:00:00Z'),
        proofMethod: 'LIVE_RECEIPT_REFERENCE',
        liveReceiptRef: 'live/obs-123/receipt.json',
      }),
    ).not.toThrow();
  });

  it('the database CHECK independently refuses backdated receipts', async () => {
    await recordBackfillReceipt(engine, {
      backfillReceiptId: 'bf_ok',
      backfillJobId: 'job_ok',
      backfillReason: 'GAP_RECOVERY',
      historicalEventAt: T('2026-02-10T00:00:00Z'),
      retrievedAt: T('2026-03-01T00:00:00Z'),
      availableAt: T('2026-03-01T00:00:00Z'),
      retrospectiveOnly: true,
      wouldHaveBeenObservableLive: false,
      proofMethod: 'RECOVERY_FETCH_COMMIT',
    });
    await expect(
      engine.query(
        `INSERT INTO backfill_receipts (
           backfill_receipt_id, backfill_job_id, backfill_reason,
           historical_event_at, retrieved_at, available_at,
           retrospective_only, availability_proof_method)
         VALUES ('bf_bad','job_bad','GAP_RECOVERY',
                 '2026-02-10T00:00:00Z','2026-03-01T00:00:00Z','2026-02-11T00:00:00Z',
                 true,'RECOVERY_FETCH_COMMIT')`,
      ),
    ).rejects.toThrow();
  });

  it('persists a live-receipt-backed receipt whose event precedes retrieval', async () => {
    // §13.6 requires the reference to point at an INDEPENDENTLY PERSISTED
    // live receipt — so the proof observation is written first and its real
    // receipt hash is what the backfill receipt cites.
    const { receiptHash } = await appendObservation(engine, {
      observationId: 'obs_bf_live_proof',
      eventAt: T('2026-01-15T00:00:00Z'),
      availableAt: T('2026-01-15T00:01:00Z'),
      availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
      qualityCodes: ['MISSING_PROVIDER'],
    });
    await recordBackfillReceipt(engine, {
      backfillReceiptId: 'bf_live',
      backfillJobId: 'job_live',
      backfillReason: 'MISSED_LIVE_WINDOW',
      historicalEventAt: T('2026-01-15T00:00:00Z'),
      retrievedAt: T('2026-03-01T00:00:00Z'),
      availableAt: T('2026-01-15T00:05:00Z'),
      retrospectiveOnly: true,
      wouldHaveBeenObservableLive: true,
      proofMethod: 'LIVE_RECEIPT_REFERENCE',
      liveReceiptRef: receiptHash,
    });
    const stored = await engine.query<{ live_receipt_ref: string | null; available_at: Date }>(
      'SELECT live_receipt_ref, available_at FROM backfill_receipts WHERE backfill_receipt_id = $1',
      ['bf_live'],
    );
    expect(stored.rows[0]?.live_receipt_ref).toBe(receiptHash);
  });

  it('refuses a live-receipt reference that matches no persisted receipt', async () => {
    // A fabricated reference string must not unlock earlier-than-retrieval
    // availability — the exception exists only when the proof really exists.
    await expect(
      recordBackfillReceipt(engine, {
        backfillReceiptId: 'bf_fabricated',
        backfillJobId: 'job_fabricated',
        backfillReason: 'MISSED_LIVE_WINDOW',
        historicalEventAt: T('2026-01-16T00:00:00Z'),
        retrievedAt: T('2026-03-01T00:00:00Z'),
        availableAt: T('2026-01-16T00:05:00Z'),
        retrospectiveOnly: true,
        proofMethod: 'LIVE_RECEIPT_REFERENCE',
        liveReceiptRef: 'sha256:' + 'ef'.repeat(32), // no such receipt anywhere
      }),
    ).rejects.toThrow(ErrorCode.BACKFILL_AVAILABILITY_PROOF_MISSING);
    const leaked = await engine.query<{ n: string }>(
      'SELECT COUNT(*)::text AS n FROM backfill_receipts WHERE backfill_receipt_id = $1',
      ['bf_fabricated'],
    );
    expect(Number(leaked.rows[0]?.n ?? '0')).toBe(0);
  });

  it('replay admission of a backfilled row uses THE shared predicate', () => {
    const input = {
      historicalEventAt: T('2026-02-10T00:00:00Z'),
      availableAt: T('2026-03-01T00:00:00Z'),
    };
    expect(backfillVisibleForReplay(input, T('2026-02-28T23:59:59Z'))).toBe(false);
    expect(backfillVisibleForReplay(input, T('2026-03-01T00:00:00Z'))).toBe(true);
    // Identical to the domain function by construction.
    expect(backfillVisibleForReplay(input, T('2026-02-28T23:59:59Z'))).toBe(
      visibleAt({ availableAt: input.availableAt }, T('2026-02-28T23:59:59Z')),
    );
  });
});

describe('watermarks and complete-coverage honesty (§13.5)', () => {
  it('advances and reloads watermark state', async () => {
    await advanceWatermark(engine, {
      key: KEY,
      highestObservedSlot: 150n,
      highestContiguousSlot: 100n,
      highestFinalizedSlot: 90n,
      oldestOpenGap: { startSlot: 101n, endSlot: 120n },
      maximumLatenessSeenMs: 4_000,
    });
    const w = await loadWatermark(engine, KEY);
    expect(w?.highestObservedSlot).toBe(150n);
    expect(w?.highestContiguousSlot).toBe(100n);
    expect(w?.highestFinalizedSlot).toBe(90n);
    expect(w?.oldestOpenGap).toEqual({ startSlot: 101n, endSlot: 120n });
  });

  it('keeps the worst observed lateness across advances', async () => {
    await advanceWatermark(engine, {
      key: KEY,
      highestObservedSlot: 160n,
      highestContiguousSlot: 155n,
      oldestOpenGap: { startSlot: 156n, endSlot: 159n },
      maximumLatenessSeenMs: 2_500,
    });
    const w = await loadWatermark(engine, KEY);
    expect(w?.highestContiguousSlot).toBe(155n);

    const lateness = await engine.query<{ maximum_lateness_seen_ms: string }>(
      `SELECT maximum_lateness_seen_ms FROM watermarks
       WHERE provider = $1 AND operation = $2 AND collector_shard = $3
         AND program_version = $4 AND chain_id = $5`,
      [KEY.provider, KEY.operation, KEY.collectorShard, KEY.programVersion, KEY.chainId],
    );
    expect(Number(lateness.rows[0]?.maximum_lateness_seen_ms)).toBe(4_000);
  });

  it('refuses coverage claims until contiguity covers the claimed interval', async () => {
    // Arrange a lagging head with an open gap over the claim interval.
    await advanceWatermark(engine, {
      key: KEY,
      highestObservedSlot: 300n,
      highestContiguousSlot: 280n,
      oldestOpenGap: { startSlot: 101n, endSlot: 120n },
    });
    // Open gap [101,120] overlaps the claim → refused even though the
    // contiguous head (280) passes the interval end.
    expect(
      await canClaimCompleteCoverage(engine, KEY, {
        startInclusive: 90n,
        endInclusive: 110n,
      }),
    ).toBe(false);

    // Claims beyond the contiguous head are refused outright.
    expect(
      await canClaimCompleteCoverage(engine, KEY, {
        startInclusive: 90n,
        endInclusive: 281n,
      }),
    ).toBe(false);

    // Once the gap closes and the head catches up, the claim is honored…
    await advanceWatermark(engine, {
      key: KEY,
      highestObservedSlot: 300n,
      highestContiguousSlot: 300n,
    });
    expect(
      await canClaimCompleteCoverage(engine, KEY, {
        startInclusive: 90n,
        endInclusive: 200n,
      }),
    ).toBe(true);

    // …but never past the contiguous head.
    expect(
      await canClaimCompleteCoverage(engine, KEY, {
        startInclusive: 90n,
        endInclusive: 301n,
      }),
    ).toBe(false);
  });

  it('answers false when no watermark exists for the key', async () => {
    expect(
      await canClaimCompleteCoverage(
        engine,
        { ...KEY, chainId: 'eip155:8453' },
        {
          startInclusive: 0n,
          endInclusive: 10n,
        },
      ),
    ).toBe(false);
  });

  it('refuses structural nonsense: gap bounds inverted or beyond the head', async () => {
    await expect(
      engine.query(
        `INSERT INTO watermarks (
           provider, operation, collector_shard, program_version, chain_id,
           highest_observed_slot, highest_contiguous_slot,
           oldest_open_gap_start, oldest_open_gap_end, updated_at)
         VALUES ('p','op','s','v','eip155:1','100','100','120','110', now())`,
      ),
    ).rejects.toThrow();

    await expect(
      engine.query(
        `INSERT INTO watermarks (
           provider, operation, collector_shard, program_version, chain_id,
           highest_observed_slot, highest_contiguous_slot,
           oldest_open_gap_start, oldest_open_gap_end, updated_at)
         VALUES ('p','op','s','v','eip155:1','100','90',NULL,NULL, now())`,
      ),
    ).rejects.toThrow();
  });
});
