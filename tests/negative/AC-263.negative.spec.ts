/**
 * AC-263 negative / failure-path.
 * Traces: FR-DATA-004, FR-DR-001, FR-DR-002.
 * The two ways recovery could corrupt collector truth are both refused:
 * advancing a cursor across slots that were never marked as a gap (silent
 * history loss) and re-recording a first-seen canonical event (duplicate
 * application). Gap lifecycle transitions are one-way.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorCode, utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import {
  commitCheckpoint,
  recordCanonicalEvent,
  registerGap,
  resolveGapStatus,
} from '@foresift/persistence';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from '../acceptance/helpers.ts';

const T = (iso: string): UtcTimestamp => utcTimestamp(iso);

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-263 negative: unmarked skips and duplicates are refused', () => {
  it('advancing a cursor across unmarked slots is refused and the cursor holds', async () => {
    const engine = tdb.engine;
    await commitCheckpoint(engine, {
      shardId: 'shard-ac263n-unmarked',
      fencingToken: 1,
      cursorPosition: 5,
      at: T('2026-06-01T08:00:00Z'),
    });
    // Slots 6–9 were missed but nobody registered a gap: the advance would
    // silently skip history, so it is refused.
    await expect(
      commitCheckpoint(engine, {
        shardId: 'shard-ac263n-unmarked',
        fencingToken: 1,
        cursorPosition: 10,
        at: T('2026-06-01T08:05:00Z'),
      }),
    ).rejects.toMatchObject({ code: ErrorCode.COLLECTOR_GAP_UNMARKED });

    const cp = await engine.query<{ cursor_position: string }>(
      "SELECT cursor_position FROM collector_checkpoints WHERE shard_id = 'shard-ac263n-unmarked'",
    );
    expect(Number(cp.rows[0]?.cursor_position)).toBe(5);
  });

  it('a gap still RECOVERING does not unblock the advance', async () => {
    const engine = tdb.engine;
    await commitCheckpoint(engine, {
      shardId: 'shard-ac263n-recovering',
      fencingToken: 1,
      cursorPosition: 3,
      at: T('2026-06-01T08:00:00Z'),
    });
    await registerGap(engine, {
      gapId: 'gap-ac263n-recovering',
      shardId: 'shard-ac263n-recovering',
      gapStartSlot: 4,
      gapEndSlot: 6,
      reason: 'provider outage window',
      registeredAt: T('2026-06-01T08:01:00Z'),
    });
    // Backfill started but is not verified complete: still blocking.
    await resolveGapStatus(engine, {
      gapId: 'gap-ac263n-recovering',
      status: 'RECOVERING',
      at: T('2026-06-01T08:10:00Z'),
    });
    await expect(
      commitCheckpoint(engine, {
        shardId: 'shard-ac263n-recovering',
        fencingToken: 1,
        cursorPosition: 7,
        at: T('2026-06-01T08:15:00Z'),
      }),
    ).rejects.toMatchObject({ code: ErrorCode.COLLECTOR_GAP_UNMARKED });
  });

  it('a duplicate first-seen canonical event is refused and not re-counted', async () => {
    const engine = tdb.engine;
    const key = 'eip155:1:swaps:0xdef:200';
    await recordCanonicalEvent(engine, {
      canonicalKey: key,
      eventFamily: 'swaps',
      firstSeenAt: T('2026-06-01T08:00:00Z'),
    });
    await expect(
      recordCanonicalEvent(engine, {
        canonicalKey: key,
        eventFamily: 'swaps',
        firstSeenAt: T('2026-06-01T09:00:00Z'),
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CANONICAL_EVENT_DUPLICATE });

    const rows = await engine.query<{ n: string }>(
      'SELECT count(*) AS n FROM canonical_event_keys WHERE canonical_key = $1',
      [key],
    );
    expect(Number(rows.rows[0]?.n)).toBe(1);
  });

  it('an already-resolved gap cannot be resolved again', async () => {
    const engine = tdb.engine;
    await registerGap(engine, {
      gapId: 'gap-ac263n-oneway',
      shardId: 'shard-ac263n-oneway',
      gapStartSlot: 1,
      gapEndSlot: 2,
      reason: 'provider outage window',
      registeredAt: T('2026-06-01T08:00:00Z'),
    });
    await resolveGapStatus(engine, {
      gapId: 'gap-ac263n-oneway',
      status: 'RECOVERED',
      at: T('2026-06-01T08:20:00Z'),
    });
    await expect(
      resolveGapStatus(engine, {
        gapId: 'gap-ac263n-oneway',
        status: 'DECLARED_UNRECOVERABLE',
        at: T('2026-06-01T08:30:00Z'),
      }),
    ).rejects.toMatchObject({ code: ErrorCode.COLLECTOR_GAP_UNMARKED });
  });
});
