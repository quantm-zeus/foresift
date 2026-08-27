/**
 * Collector continuity storage contract (§34.7, INV-009, AC-263):
 * fenced checkpoints reject stale-token commits; restore+replay inserts each
 * canonical event exactly once; replay across an unmarked gap is refused
 * until the gap is registered AND resolved.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ErrorCode, ForesiftError, utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import {
  applyMigrations,
  blockingGapsForShard,
  commitCheckpoint,
  createEngine,
  FENCED_CHECKPOINT_UPSERT_SQL,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  recordCanonicalEvent,
  registerGap,
  resolveGapStatus,
  type DatabaseEngine,
} from '../src/index.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

const AT = utcTimestamp('2026-08-20T12:00:00.000Z');
const later = (minutes: number): UtcTimestamp =>
  utcTimestamp(new Date(Date.parse(AT) + minutes * 60_000).toISOString());

let db: PGlite;
let engine: DatabaseEngine;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe('fenced checkpoints (INV-009)', () => {
  it('accepts a fresh commit and a higher fencing token at any cursor', async () => {
    await commitCheckpoint(engine, { shardId: 'shard-a', fencingToken: 1, cursorPosition: 10 });
    // New epoch (lease re-acquired) may set any cursor.
    await commitCheckpoint(engine, { shardId: 'shard-a', fencingToken: 2, cursorPosition: 0 });
    const rows = await engine.query<{ fencing_token: string; cursor_position: string }>(
      'SELECT fencing_token, cursor_position FROM collector_checkpoints WHERE shard_id = $1',
      ['shard-a'],
    );
    expect(Number(rows.rows[0]?.cursor_position)).toBe(0);
  });

  it('rejects a STALE fencing token commit', async () => {
    await commitCheckpoint(engine, { shardId: 'shard-b', fencingToken: 5, cursorPosition: 42 });
    await expect(
      commitCheckpoint(engine, { shardId: 'shard-b', fencingToken: 4, cursorPosition: 50 }),
    ).rejects.toMatchObject({ code: ErrorCode.CHECKPOINT_STALE_FENCING_TOKEN });
  });

  it('rejects cursor regression within one fencing epoch', async () => {
    await commitCheckpoint(engine, { shardId: 'shard-c', fencingToken: 3, cursorPosition: 100 });
    await expect(
      commitCheckpoint(engine, { shardId: 'shard-c', fencingToken: 3, cursorPosition: 99 }),
    ).rejects.toMatchObject({ code: ErrorCode.CHECKPOINT_CURSOR_REGRESSION });
  });

  it('refuses same-epoch advance across skipped slots until gaps are recovered', async () => {
    await commitCheckpoint(engine, { shardId: 'shard-d', fencingToken: 1, cursorPosition: 10 });
    // Advance 10 → 20 skips slots 11..19 with NO gap registered.
    await expect(
      commitCheckpoint(engine, { shardId: 'shard-d', fencingToken: 1, cursorPosition: 20 }),
    ).rejects.toMatchObject({ code: ErrorCode.COLLECTOR_GAP_UNMARKED });

    // Registering alone is not enough — UNRECOVERED gaps still block.
    await registerGap(engine, {
      gapId: 'gap-d1',
      shardId: 'shard-d',
      gapStartSlot: 11,
      gapEndSlot: 19,
      reason: 'collector restart window',
      registeredAt: later(1),
    });
    await expect(
      commitCheckpoint(engine, { shardId: 'shard-d', fencingToken: 1, cursorPosition: 20 }),
    ).rejects.toMatchObject({ code: ErrorCode.COLLECTOR_GAP_UNMARKED });

    // Resolved gaps unblock the advance.
    await resolveGapStatus(engine, { gapId: 'gap-d1', status: 'RECOVERING', at: later(2) });
    await expect(
      commitCheckpoint(engine, { shardId: 'shard-d', fencingToken: 1, cursorPosition: 20 }),
    ).rejects.toMatchObject({ code: ErrorCode.COLLECTOR_GAP_UNMARKED });
    await resolveGapStatus(engine, {
      gapId: 'gap-d1',
      status: 'RECOVERED',
      at: later(3),
    });
    await commitCheckpoint(engine, { shardId: 'shard-d', fencingToken: 1, cursorPosition: 20 });
  });

  it('lets DECLARED_UNRECOVERABLE gaps cover skipped slots too', async () => {
    await commitCheckpoint(engine, { shardId: 'shard-e', fencingToken: 1, cursorPosition: 5 });
    await registerGap(engine, {
      gapId: 'gap-e1',
      shardId: 'shard-e',
      gapStartSlot: 6,
      gapEndSlot: 8,
      reason: 'source permanently unavailable; declared by policy',
      registeredAt: later(1),
    });
    await resolveGapStatus(engine, {
      gapId: 'gap-e1',
      status: 'DECLARED_UNRECOVERABLE',
      at: later(2),
    });
    await commitCheckpoint(engine, { shardId: 'shard-e', fencingToken: 1, cursorPosition: 9 });
  });

  it('lists only unresolved gaps as blocking for a shard', async () => {
    const blocking = await blockingGapsForShard(engine, 'shard-d');
    expect(blocking).toEqual([]);
    const unresolvedShardE = await blockingGapsForShard(engine, 'shard-e');
    expect(unresolvedShardE).toEqual([]);
    await registerGap(engine, {
      gapId: 'gap-d2',
      shardId: 'shard-d',
      gapStartSlot: 30,
      gapEndSlot: 31,
      reason: 'new discontinuity',
      registeredAt: later(4),
    });
    expect((await blockingGapsForShard(engine, 'shard-d')).map((g) => g.gapId)).toEqual(['gap-d2']);
  });

  it('refuses inverted gap bounds and resolution of unknown/resolved gaps', async () => {
    await expect(
      registerGap(engine, {
        gapId: 'gap-bad',
        shardId: 'shard-f',
        gapStartSlot: 9,
        gapEndSlot: 3,
        reason: 'inverted',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.COLLECTOR_GAP_UNMARKED });

    await expect(
      resolveGapStatus(engine, { gapId: 'no-such-gap', status: 'RECOVERING', at: later(1) }),
    ).rejects.toBeInstanceOf(ForesiftError);

    await expect(
      resolveGapStatus(engine, { gapId: 'gap-e1', status: 'RECOVERED', at: later(5) }),
    ).rejects.toMatchObject({ code: ErrorCode.COLLECTOR_GAP_UNMARKED });
  });
});

describe('fenced-upsert storage backstop (INV-009 race window)', () => {
  // The in-transaction guard in commitCheckpoint cannot be raced from a
  // single connection — these tests pin the storage-level rule that closes
  // the READ COMMITTED lost-update window instead: a write whose guard read
  // was superseded by a concurrent committer loses AT THE UPSERT (zero
  // RETURNING rows) and leaves the stored checkpoint untouched.
  const raceUpsert = (shardId: string, fencingToken: number, cursorPosition: number) =>
    engine.query<{ fencing_token: string | number }>(FENCED_CHECKPOINT_UPSERT_SQL, [
      shardId,
      fencingToken,
      cursorPosition,
      AT,
    ]);

  const storedState = async (shardId: string) => {
    const rows = await engine.query<{ fencing_token: string; cursor_position: string }>(
      'SELECT fencing_token, cursor_position FROM collector_checkpoints WHERE shard_id = $1',
      [shardId],
    );
    return {
      token: Number(rows.rows[0]?.fencing_token),
      cursor: Number(rows.rows[0]?.cursor_position),
    };
  };

  it('a stale-token write landing after a concurrent commit is refused and changes nothing', async () => {
    // The concurrent winner commits token 6 AFTER the loser's guard read…
    await commitCheckpoint(engine, {
      shardId: 'shard-race-t',
      fencingToken: 6,
      cursorPosition: 60,
    });
    // …the loser's write lands last with its stale token 5 — refused.
    const lost = await raceUpsert('shard-race-t', 5, 99);
    expect(lost.rows).toEqual([]);
    expect(await storedState('shard-race-t')).toEqual({ token: 6, cursor: 60 });
  });

  it('a same-token cursor-regression write landing after a concurrent commit is refused too', async () => {
    await commitCheckpoint(engine, {
      shardId: 'shard-race-c',
      fencingToken: 4,
      cursorPosition: 40,
    });
    const lost = await raceUpsert('shard-race-c', 4, 39);
    expect(lost.rows).toEqual([]);
    expect(await storedState('shard-race-c')).toEqual({ token: 4, cursor: 40 });
  });

  it('the same conditional path admits non-regressing writes (equal or advancing pairs)', async () => {
    await commitCheckpoint(engine, {
      shardId: 'shard-race-w',
      fencingToken: 2,
      cursorPosition: 20,
    });
    // Same epoch, cursor advanced by the normal contiguous step.
    const stepped = await raceUpsert('shard-race-w', 2, 21);
    expect(stepped.rows.length).toBe(1);
    // Idempotent re-commit of the identical pair is not a regression.
    const idempotent = await raceUpsert('shard-race-w', 2, 21);
    expect(idempotent.rows.length).toBe(1);
    expect(await storedState('shard-race-w')).toEqual({ token: 2, cursor: 21 });
  });
});

describe('exactly-once canonical events across restore+replay (AC-263)', () => {
  it('records each canonical key once; re-application after restore is refused', async () => {
    await recordCanonicalEvent(engine, {
      canonicalKey: 'evm:1:tx:0xabc:log:7',
      eventFamily: 'pool_swap',
      firstSeenAt: AT,
    });
    // Simulated post-restore replay re-applies the SAME canonical event…
    await expect(
      recordCanonicalEvent(engine, {
        canonicalKey: 'evm:1:tx:0xabc:log:7',
        eventFamily: 'pool_swap',
        firstSeenAt: AT,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CANONICAL_EVENT_DUPLICATE });

    // …while distinct events still insert.
    await recordCanonicalEvent(engine, {
      canonicalKey: 'evm:1:tx:0xabc:log:8',
      eventFamily: 'pool_swap',
      firstSeenAt: later(1),
    });
    const count = await engine.query<{ n: string }>(
      'SELECT count(*) AS n FROM canonical_event_keys WHERE event_family = $1',
      ['pool_swap'],
    );
    expect(Number(count.rows[0]?.n)).toBe(2);
  });

  // Duplicate classification must be structural (SQLSTATE 23505), not a bet
  // on driver message wording — a driver that rewords its text must not turn
  // an exactly-once refusal into some unrelated failure class.
  describe('duplicate classification is structural (SQLSTATE-first)', () => {
    const KEY_INPUT = {
      canonicalKey: 'evm:137:tx:0xdef:log:1',
      eventFamily: 'pool_swap',
      firstSeenAt: AT,
    };
    function engineFailingWith(err: unknown): DatabaseEngine {
      return createEngine(
        {
          exec: async () => undefined,
          query: async () => {
            throw err;
          },
        },
        'pg',
      );
    }
    it('classifies SQLSTATE 23505 as duplicate regardless of message wording', async () => {
      const sqlstateError = Object.assign(new Error('driver-specific wording'), { code: '23505' });
      await expect(
        recordCanonicalEvent(engineFailingWith(sqlstateError), KEY_INPUT),
      ).rejects.toMatchObject({ code: ErrorCode.CANONICAL_EVENT_DUPLICATE });
    });
    it('message fallback still catches drivers that wrap without SQLSTATE', async () => {
      const wrapped = new Error('duplicate key value violates unique constraint "x_pkey"');
      await expect(
        recordCanonicalEvent(engineFailingWith(wrapped), KEY_INPUT),
      ).rejects.toMatchObject({ code: ErrorCode.CANONICAL_EVENT_DUPLICATE });
    });
    it('unrelated failures pass through untouched', async () => {
      const boom = Object.assign(new Error('storage unavailable'), { code: '58030' });
      await expect(recordCanonicalEvent(engineFailingWith(boom), KEY_INPUT)).rejects.toBe(boom);
    });
  });
});
