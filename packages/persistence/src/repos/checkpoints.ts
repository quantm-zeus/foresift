/**
 * Collector continuity repository (§34.7, INV-009, AC-263).
 *
 * Storage contract:
 * - checkpoints are fenced: a commit carrying a STALE fencing token is
 *   refused — by the in-transaction guard AND structurally by the conditional
 *   upsert, so even a commit that races a concurrent committer between its
 *   read and its write cannot move the stored checkpoint backwards; cursor
 *   regression within one fencing epoch is refused the same way;
 * - advancing a checkpoint across skipped slots is refused until the
 *   discontinuity is REGISTERED as a gap and RESOLVED (`RECOVERED` or
 *   `DECLARED_UNRECOVERABLE`; unmarked-gap replay is never legitimate);
 * - canonical event keys make duplicate first-seen/event inserts impossible
 *   at the storage layer — restore+replay re-applies each event exactly once.
 *
 * The structural guarantee is "stored state only moves forward" (token, then
 * cursor, lexicographically). Serializing whole epochs — e.g. ensuring a new
 * lease holder finishes its first commit before an old holder retries —
 * remains a caller obligation.
 */
import { ErrorCode, ForesiftError, utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import type { DatabaseEngine } from '../db.ts';

export interface CheckpointCommit {
  readonly shardId: string;
  /** Fencing epoch; a token lower than the stored one is stale. */
  readonly fencingToken: number;
  readonly cursorPosition: number;
  readonly at?: UtcTimestamp | undefined;
}

/**
 * The fenced checkpoint upsert. Conditional at the storage layer: the update
 * applies only when the incoming (fencing token, cursor) pair is
 * lexicographically not behind the stored row AS IT EXISTS AT WRITE TIME, so
 * a commit that races a concurrent committer between its guard read and its
 * write still loses cleanly (zero RETURNING rows, stored row untouched).
 * Exported so specs can pin this storage-level guarantee directly — the
 * in-transaction guard cannot be raced from a single-connection test.
 */
export const FENCED_CHECKPOINT_UPSERT_SQL = `INSERT INTO collector_checkpoints (shard_id, fencing_token, cursor_position, updated_at)
VALUES ($1,$2,$3,$4)
ON CONFLICT (shard_id) DO UPDATE SET
  fencing_token = EXCLUDED.fencing_token,
  cursor_position = EXCLUDED.cursor_position,
  updated_at = EXCLUDED.updated_at
WHERE EXCLUDED.fencing_token > collector_checkpoints.fencing_token
   OR (EXCLUDED.fencing_token = collector_checkpoints.fencing_token
       AND EXCLUDED.cursor_position >= collector_checkpoints.cursor_position)
RETURNING fencing_token`;

/**
 * Commit a checkpoint. Same-token commits must be contiguous or covered by
 * resolved gaps (RECOVERED or DECLARED_UNRECOVERABLE); higher tokens acquire
 * the shard (new epoch) and may set any cursor; lower tokens are refused
 * inside this transaction. The final upsert (see
 * `FENCED_CHECKPOINT_UPSERT_SQL`) is conditional — it overwrites only when
 * the incoming pair is not behind the stored row — so a commit that loses a
 * race against a concurrent committer between the guard read and the write
 * is still refused with the same typed errors: the stored checkpoint can
 * never regress.
 */
export async function commitCheckpoint(
  engine: DatabaseEngine,
  input: CheckpointCommit,
): Promise<void> {
  if (!Number.isInteger(input.fencingToken) || input.fencingToken < 1) {
    throw new ForesiftError(
      ErrorCode.CHECKPOINT_STALE_FENCING_TOKEN,
      'fencing token must be a positive integer',
      { shardId: input.shardId },
    );
  }
  await engine.transaction(async (tx) => {
    const rows = await tx.query<{
      fencing_token: string | number;
      cursor_position: string | number;
    }>('SELECT fencing_token, cursor_position FROM collector_checkpoints WHERE shard_id = $1', [
      input.shardId,
    ]);
    const existing = rows.rows[0];
    const storedToken = existing === undefined ? null : Number(existing.fencing_token);
    const storedCursor = existing === undefined ? null : Number(existing.cursor_position);

    if (storedToken !== null && input.fencingToken < storedToken) {
      throw new ForesiftError(
        ErrorCode.CHECKPOINT_STALE_FENCING_TOKEN,
        `stale fencing token ${input.fencingToken} for ${input.shardId} (current ${storedToken})`,
        { shardId: input.shardId },
      );
    }
    if (
      storedCursor !== null &&
      input.fencingToken === storedToken &&
      input.cursorPosition < storedCursor
    ) {
      throw new ForesiftError(
        ErrorCode.CHECKPOINT_CURSOR_REGRESSION,
        `cursor regression for ${input.shardId}: ${input.cursorPosition} < ${storedCursor}`,
        { shardId: input.shardId },
      );
    }
    // Unmarked-gap rule: same-epoch advance across skipped slots requires the
    // whole skipped interval to be covered by resolved gaps (RECOVERED or
    // DECLARED_UNRECOVERABLE — the statuses the SQL query below accepts).
    if (
      storedCursor !== null &&
      input.fencingToken === storedToken &&
      input.cursorPosition > storedCursor + 1
    ) {
      // The registered gaps must jointly cover every skipped slot.
      const skipped: number[] = [];
      for (let slot = storedCursor + 1; slot < input.cursorPosition; slot += 1) {
        skipped.push(slot);
      }
      const gapRows = await tx.query<{
        gap_start_slot: string | number;
        gap_end_slot: string | number;
      }>(
        `SELECT gap_start_slot, gap_end_slot FROM collector_gaps
         WHERE shard_id = $1 AND recovery_status IN ('RECOVERED','DECLARED_UNRECOVERABLE')`,
        [input.shardId],
      );
      const coveredSlots = new Set<number>();
      for (const g of gapRows.rows) {
        const start = Number(g.gap_start_slot);
        const end = Number(g.gap_end_slot);
        for (
          let slot = Math.max(start, storedCursor + 1);
          slot <= Math.min(end, input.cursorPosition - 1);
          slot += 1
        ) {
          coveredSlots.add(slot);
        }
      }
      if (!skipped.every((slot) => coveredSlots.has(slot))) {
        throw new ForesiftError(
          ErrorCode.COLLECTOR_GAP_UNMARKED,
          `checkpoint advance skips unmarked slots (${storedCursor + 1}..${input.cursorPosition - 1}); register and recover the gap first`,
          { shardId: input.shardId },
        );
      }
    }

    // Fencing backstop: the guard checks above ran against a snapshot that a
    // concurrent committer may already have superseded (READ COMMITTED lost-
    // update window). The conditional upsert carries the same monotonicity
    // rule structurally — see FENCED_CHECKPOINT_UPSERT_SQL; RETURNING
    // detects the refused case so it surfaces as the same typed errors,
    // never silence.
    const fenced = await tx.query<{ fencing_token: string | number }>(
      FENCED_CHECKPOINT_UPSERT_SQL,
      [
        input.shardId,
        input.fencingToken,
        input.cursorPosition,
        input.at ?? utcTimestamp(new Date().toISOString()),
      ],
    );
    if (fenced.rows.length === 0) {
      // Zero rows can only mean the WHERE clause refused the overwrite: a
      // concurrent committer advanced (token, cursor) after this
      // transaction's read. Re-classify against the now-stored row for the
      // precise typed refusal.
      const winner = await tx.query<{
        fencing_token: string | number;
        cursor_position: string | number;
      }>('SELECT fencing_token, cursor_position FROM collector_checkpoints WHERE shard_id = $1', [
        input.shardId,
      ]);
      const stored = winner.rows[0];
      if (
        stored !== undefined &&
        Number(stored.fencing_token) === input.fencingToken &&
        Number(stored.cursor_position) > input.cursorPosition
      ) {
        throw new ForesiftError(
          ErrorCode.CHECKPOINT_CURSOR_REGRESSION,
          `cursor regression for ${input.shardId}: ${input.cursorPosition} < ${Number(stored.cursor_position)} (concurrent commit won)`,
          { shardId: input.shardId },
        );
      }
      throw new ForesiftError(
        ErrorCode.CHECKPOINT_STALE_FENCING_TOKEN,
        `stale fencing token ${input.fencingToken} for ${input.shardId}${stored === undefined ? '' : ` (current ${Number(stored.fencing_token)})`} — a concurrent commit advanced the checkpoint`,
        { shardId: input.shardId },
      );
    }
  });
}

export interface RegisteredGap {
  readonly gapId: string;
  readonly shardId: string;
  readonly gapStartSlot: number;
  readonly gapEndSlot: number;
  readonly reason: string;
  readonly recoveryStatus: 'UNRECOVERED' | 'RECOVERING' | 'RECOVERED' | 'DECLARED_UNRECOVERABLE';
}

/** Register a detected discontinuity — gaps are explicit, never silent. */
export async function registerGap(
  engine: DatabaseEngine,
  input: {
    gapId: string;
    shardId: string;
    gapStartSlot: number;
    gapEndSlot: number;
    reason: string;
    registeredAt?: UtcTimestamp | undefined;
  },
): Promise<RegisteredGap> {
  if (input.gapStartSlot > input.gapEndSlot) {
    throw new ForesiftError(ErrorCode.COLLECTOR_GAP_UNMARKED, 'gap bounds inverted', {
      gapId: input.gapId,
    });
  }
  await engine.query(
    `INSERT INTO collector_gaps
       (gap_id, shard_id, gap_start_slot, gap_end_slot, reason, recovery_status, registered_at)
     VALUES ($1,$2,$3,$4,$5,'UNRECOVERED',$6)`,
    [
      input.gapId,
      input.shardId,
      input.gapStartSlot,
      input.gapEndSlot,
      input.reason,
      input.registeredAt ?? utcTimestamp(new Date().toISOString()),
    ],
  );
  return {
    gapId: input.gapId,
    shardId: input.shardId,
    gapStartSlot: input.gapStartSlot,
    gapEndSlot: input.gapEndSlot,
    reason: input.reason,
    recoveryStatus: 'UNRECOVERED',
  };
}

/** Move a gap to a resolved status with its resolution instant. */
export async function resolveGapStatus(
  engine: DatabaseEngine,
  input: {
    gapId: string;
    status: 'RECOVERING' | 'RECOVERED' | 'DECLARED_UNRECOVERABLE';
    at: UtcTimestamp;
  },
): Promise<void> {
  const rows = await engine.query<{ recovery_status: string }>(
    'SELECT recovery_status FROM collector_gaps WHERE gap_id = $1',
    [input.gapId],
  );
  const current = rows.rows[0]?.recovery_status;
  if (current === undefined) {
    throw new ForesiftError(ErrorCode.COLLECTOR_GAP_UNMARKED, `unknown gap ${input.gapId}`, {});
  }
  if (current === 'RECOVERED' || current === 'DECLARED_UNRECOVERABLE') {
    throw new ForesiftError(
      ErrorCode.COLLECTOR_GAP_UNMARKED,
      `gap ${input.gapId} already resolved as ${current}`,
      { gapId: input.gapId },
    );
  }
  await engine.query(
    'UPDATE collector_gaps SET recovery_status = $2, resolved_at = $3 WHERE gap_id = $1',
    [input.gapId, input.status, input.at],
  );
}

/** Gaps of a shard that still block replay across them. */
export async function blockingGapsForShard(
  engine: DatabaseEngine,
  shardId: string,
): Promise<readonly RegisteredGap[]> {
  const rows = await engine.query<{
    gap_id: string;
    shard_id: string;
    gap_start_slot: string | number;
    gap_end_slot: string | number;
    reason: string;
    recovery_status: string;
  }>(
    `SELECT gap_id, shard_id, gap_start_slot, gap_end_slot, reason, recovery_status
     FROM collector_gaps WHERE shard_id = $1 AND recovery_status IN ('UNRECOVERED','RECOVERING')
     ORDER BY gap_start_slot`,
    [shardId],
  );
  return rows.rows.map((r) => ({
    gapId: r.gap_id,
    shardId: r.shard_id,
    gapStartSlot: Number(r.gap_start_slot),
    gapEndSlot: Number(r.gap_end_slot),
    reason: r.reason,
    recoveryStatus: r.recovery_status as RegisteredGap['recoveryStatus'],
  }));
}

// --- Exactly-once canonical events -------------------------------------------

/**
 * Record a first-seen canonical event key. Re-application after restore hits
 * the primary key and is refused — exactly once, by storage, not discipline.
 */
export async function recordCanonicalEvent(
  engine: DatabaseEngine,
  input: { canonicalKey: string; eventFamily: string; firstSeenAt: UtcTimestamp },
): Promise<void> {
  try {
    await engine.query(
      'INSERT INTO canonical_event_keys (canonical_key, event_family, first_seen_at) VALUES ($1,$2,$3)',
      [input.canonicalKey, input.eventFamily, input.firstSeenAt],
    );
  } catch (err) {
    if ((err as Error).message.includes('duplicate key')) {
      throw new ForesiftError(
        ErrorCode.CANONICAL_EVENT_DUPLICATE,
        `canonical event ${input.canonicalKey} was already recorded`,
        { canonicalKey: input.canonicalKey },
      );
    }
    throw err;
  }
}
