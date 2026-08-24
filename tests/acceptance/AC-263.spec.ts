/**
 * AC-263 acceptance (positive) — task T061.
 * Traces: FR-DR-001, FR-DR-002, FR-DR-003 (restore + replay recovery).
 * Gap/idempotence semantics are governed by invariant INV-009 ("every state
 * transition and external side effect remains idempotent and fenced"), the
 * on-point authority for no-skip/no-duplicate replay.
 * AC text (manifest §39.25): "Collector recovery from backup plus live
 * replay neither skips an unmarked gap nor duplicates a canonical event/
 * first-seen record."
 *
 * A full destructive restore replays into a clean environment: already-
 * applied canonical events are refused by storage (exactly once survives
 * the restore), new events apply normally, and checkpoint advance across a
 * discontinuity works ONLY because the gap was explicitly recovered.
 */
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorCode, utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import {
  applyMigrations,
  blockingGapsForShard,
  captureDeterministicSnapshot,
  commitCheckpoint,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  recordCanonicalEvent,
  registerGap,
  resolveGapStatus,
  type DatabaseEngine,
} from '@foresift/persistence';
import {
  closeTestDatabase,
  makeTestDatabase,
  MIGRATIONS_DIR,
  restoreSnapshotInto,
  type TestDatabase,
} from './helpers.ts';

const T = (iso: string): UtcTimestamp => utcTimestamp(iso);

const EVENTS = [
  { canonicalKey: 'eip155:1:swaps:0xabc:100', eventFamily: 'swaps' },
  { canonicalKey: 'eip155:1:swaps:0xabc:101', eventFamily: 'swaps' },
  { canonicalKey: 'eip155:1:swaps:0xabc:102', eventFamily: 'swaps' },
] as const;

let source: TestDatabase;
let restoredDb: PGlite | undefined;
let restored: DatabaseEngine;

beforeAll(async () => {
  source = await makeTestDatabase();
  const { engine } = source;
  // Live collector world before the backup: three first-seen events…
  for (const e of EVENTS) {
    await recordCanonicalEvent(engine, { ...e, firstSeenAt: T('2026-06-01T08:00:00Z') });
  }
  // …a checkpoint at slot 5…
  await commitCheckpoint(engine, {
    shardId: 'shard-ac263',
    fencingToken: 1,
    cursorPosition: 5,
    at: T('2026-06-01T08:05:00Z'),
  });
  // …and an explicit, still-unrecovered discontinuity over slots 6–8
  // (detected pre-backup; recovery completes in the restored environment).
  await registerGap(engine, {
    gapId: 'gap-ac263',
    shardId: 'shard-ac263',
    gapStartSlot: 6,
    gapEndSlot: 8,
    reason: 'provider outage window',
    registeredAt: T('2026-06-01T08:06:00Z'),
  });
});

afterAll(async () => {
  await closeTestDatabase(source);
  if (restoredDb) await restoredDb.close();
});

describe('AC-263: restore + replay neither duplicates nor skips unmarked history', () => {
  it('replaying applied events after a destructive restore is refused by storage', async () => {
    // Backup → destroy → clean-environment restore.
    const snapshot = await captureDeterministicSnapshot(source.engine, T('2026-06-01T09:00:00Z'));
    restoredDb = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
    restored = createEngine(restoredDb, 'pglite');
    await applyMigrations({ engine: restored, migrationsDir: MIGRATIONS_DIR });
    const restoredRows = await restoreSnapshotInto(restored, snapshot);
    expect(restoredRows).toBeGreaterThanOrEqual(EVENTS.length);

    // The restored world holds exactly the pre-backup truth…
    const keys = await restored.query<{ n: string }>(
      'SELECT count(*) AS n FROM canonical_event_keys',
    );
    expect(Number(keys.rows[0]?.n)).toBe(EVENTS.length);

    // …and live replay re-delivers the same events: storage refuses each
    // re-application — exactly-once is enforced by the primary key, not by
    // replay discipline.
    let refusals = 0;
    for (const e of EVENTS) {
      await expect(
        recordCanonicalEvent(restored, { ...e, firstSeenAt: T('2026-06-01T10:00:00Z') }),
      ).rejects.toMatchObject({ code: ErrorCode.CANONICAL_EVENT_DUPLICATE });
      refusals += 1;
    }
    expect(refusals).toBe(EVENTS.length);

    const afterReplay = await restored.query<{ n: string }>(
      'SELECT count(*) AS n FROM canonical_event_keys',
    );
    expect(Number(afterReplay.rows[0]?.n)).toBe(EVENTS.length);

    // Replay proceeds past the applied prefix: genuinely new events record.
    await recordCanonicalEvent(restored, {
      canonicalKey: 'eip155:1:swaps:0xabc:103',
      eventFamily: 'swaps',
      firstSeenAt: T('2026-06-01T10:01:00Z'),
    });
    const final = await restored.query<{ n: string }>(
      'SELECT count(*) AS n FROM canonical_event_keys',
    );
    expect(Number(final.rows[0]?.n)).toBe(EVENTS.length + 1);
  });

  it('checkpoint recovery advances across the gap only because it was explicitly recovered', async () => {
    // The restored registry carries the gap explicitly…
    const blocking = await blockingGapsForShard(restored!, 'shard-ac263');
    expect(blocking).toHaveLength(1); // still UNRECOVERED in the restored copy

    // Recovery marks it RECOVERED in the restored environment…
    await resolveGapStatus(restored!, {
      gapId: 'gap-ac263',
      status: 'RECOVERED',
      at: T('2026-06-01T10:05:00Z'),
    });
    expect(await blockingGapsForShard(restored!, 'shard-ac263')).toHaveLength(0);

    // …and only then may the same-epoch cursor jump across slots 6–8.
    await commitCheckpoint(restored!, {
      shardId: 'shard-ac263',
      fencingToken: 1,
      cursorPosition: 9,
      at: T('2026-06-01T10:06:00Z'),
    });
    const cp = await restored!.query<{ cursor_position: string }>(
      "SELECT cursor_position FROM collector_checkpoints WHERE shard_id = 'shard-ac263'",
    );
    expect(Number(cp.rows[0]?.cursor_position)).toBe(9);
  });
});
