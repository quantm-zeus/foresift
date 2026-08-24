/**
 * Backfill receipts (§13.6, FR-DATA-003) and watermark state (§13.5).
 *
 * No-backdating is enforced three ways: structurally by the SQL CHECKs (a
 * receipt whose available_at precedes retrieval commit is refused unless it
 * carries a live-receipt reference), explicitly at this boundary via
 * `assertNoBackdating`, and by verifying that a claimed live-receipt
 * reference actually matches a persisted observation receipt — refusals are
 * typed (`BACKFILL_BACKDATING_REJECTED`,
 * `BACKFILL_AVAILABILITY_PROOF_MISSING`), never prose-only.
 */
import {
  availabilityProvenanceClass,
  compareTimestamps,
  ErrorCode,
  ForesiftError,
  isHistoricalFetch,
  utcTimestamp,
  visibleAt,
  type UtcTimestamp,
} from '@foresift/domain';
import type { DatabaseEngine } from '../db.ts';

export interface BackfillReceiptInput {
  readonly backfillReceiptId: string;
  readonly backfillJobId: string;
  readonly backfillReason: string;
  readonly historicalEventAt: UtcTimestamp;
  readonly retrievedAt: UtcTimestamp;
  readonly availableAt: UtcTimestamp;
  readonly retrospectiveOnly: boolean;
  readonly wouldHaveBeenObservableLive?: boolean | null;
  readonly proofMethod:
    'LIVE_RECEIPT_REFERENCE' | 'RECOVERY_FETCH_COMMIT' | 'MANUAL_IMPORT_RECEIPT';
  readonly liveReceiptRef?: string;
}

/**
 * The §13.6 no-backdating guard: historical-query rows may not claim an
 * available_at earlier than their retrieval commit unless an independently
 * persisted live receipt proves earlier availability.
 */
export function assertNoBackdating(input: {
  availableAt: UtcTimestamp;
  retrievedAt: UtcTimestamp;
  proofMethod: string;
  liveReceiptRef?: string;
}): void {
  const cls = availabilityProvenanceClass(
    input.proofMethod === 'MANUAL_IMPORT_RECEIPT'
      ? 'MANUAL_IMPORT_AVAILABLE'
      : 'HISTORICAL_QUERY_FETCHED_LATER',
  );
  if (!isHistoricalFetch(cls)) {
    throw new ForesiftError(
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      'backfill provenance must be a historical-fetch class',
      { proofMethod: input.proofMethod },
    );
  }
  if (input.proofMethod === 'LIVE_RECEIPT_REFERENCE' && input.liveReceiptRef !== undefined) {
    return; // independently persisted live receipt proves earlier availability
  }
  // Instant comparison, not lexical: mixed sub-ms precision would otherwise
  // shift the backdating boundary (review L-2).
  if (compareTimestamps(input.availableAt, input.retrievedAt) < 0) {
    throw new ForesiftError(
      ErrorCode.BACKFILL_BACKDATING_REJECTED,
      `backdating refused: available_at ${input.availableAt} precedes retrieval commit ${input.retrievedAt} without a live receipt`,
      { availableAt: input.availableAt, retrievedAt: input.retrievedAt },
    );
  }
}

export async function recordBackfillReceipt(
  engine: DatabaseEngine,
  input: BackfillReceiptInput,
): Promise<void> {
  assertNoBackdating({
    availableAt: input.availableAt,
    retrievedAt: input.retrievedAt,
    proofMethod: input.proofMethod,
    ...(input.liveReceiptRef === undefined ? {} : { liveReceiptRef: input.liveReceiptRef }),
  });
  await engine.transaction(async (tx) => {
    if (input.proofMethod === 'LIVE_RECEIPT_REFERENCE') {
      // §13.6: the no-backdating exception unlocks only on an INDEPENDENTLY
      // PERSISTED live receipt — a reference string that matches no stored
      // observation receipt proves nothing and is refused here, in the same
      // transaction as the insert.
      const proof = await tx.query<{ receipt_hash: string }>(
        'SELECT receipt_hash FROM observations WHERE receipt_hash = $1',
        [input.liveReceiptRef],
      );
      if (proof.rows.length === 0) {
        throw new ForesiftError(
          ErrorCode.BACKFILL_AVAILABILITY_PROOF_MISSING,
          `live-receipt reference does not match any persisted observation receipt`,
          { backfillReceiptId: input.backfillReceiptId },
        );
      }
    }
    await tx.query(
      `INSERT INTO backfill_receipts (
         backfill_receipt_id, backfill_job_id, backfill_reason,
         historical_event_at, retrieved_at, available_at,
         retrospective_only, would_have_been_observable_live,
         availability_proof_method, live_receipt_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        input.backfillReceiptId,
        input.backfillJobId,
        input.backfillReason,
        input.historicalEventAt,
        input.retrievedAt,
        input.availableAt,
        input.retrospectiveOnly,
        input.wouldHaveBeenObservableLive ?? null,
        input.proofMethod,
        input.liveReceiptRef ?? null,
      ],
    );
  });
}

/**
 * Whether the backfilled row may enter a simulated historical decision at T:
 * only when its own available_at is within the boundary (rule 1 of §13.6 —
 * HISTORICAL_QUERY_FETCHED_LATER data cannot enter earlier than its actual
 * available_at). The check reuses THE shared replay predicate.
 */
export function backfillVisibleForReplay(
  input: {
    historicalEventAt: UtcTimestamp;
    availableAt: UtcTimestamp;
  },
  t: UtcTimestamp,
): boolean {
  return visibleAt({ availableAt: input.availableAt }, t);
}

// --- Watermarks (§13.5) ------------------------------------------------------

export interface WatermarkKey {
  readonly provider: string;
  readonly operation: string;
  readonly collectorShard: string;
  readonly programVersion: string;
  readonly chainId: string;
}

export interface WatermarkAdvance {
  readonly key: WatermarkKey;
  readonly highestObservedSlot: bigint;
  readonly highestContiguousSlot: bigint;
  readonly highestFinalizedSlot?: bigint | undefined;
  /** Explicit open gap when the contiguous head lags the observed head. */
  readonly oldestOpenGap?: { startSlot: bigint; endSlot: bigint } | undefined;
  readonly maximumLatenessSeenMs?: number | undefined;
  readonly gapRecoveryStatus?: 'NONE' | 'IN_PROGRESS' | 'RECOVERED' | 'ACCEPTED_LOSS';
}

function slot(value: bigint): string {
  return value.toString();
}

export async function advanceWatermark(
  engine: DatabaseEngine,
  advance: WatermarkAdvance,
): Promise<void> {
  const k = advance.key;
  await engine.transaction(async (tx) => {
    // Monotonicity guard (§13.5): the slot high-water marks are the only
    // mutable state machine in the data-truth layer with no structural
    // floor, so regression is refused at this boundary — a lower incoming
    // value means a stale or rewound writer, and silently rewinding would
    // corrupt gap/coverage honesty downstream. Gap windows are excluded:
    // they legitimately open and close as discovery progresses.
    const stored = await tx.query<{
      highest_observed_slot: string;
      highest_contiguous_slot: string;
      highest_finalized_slot: string | null;
    }>(
      `SELECT highest_observed_slot, highest_contiguous_slot, highest_finalized_slot
       FROM watermarks
       WHERE provider = $1 AND operation = $2 AND collector_shard = $3
         AND program_version = $4 AND chain_id = $5
       FOR UPDATE`,
      [k.provider, k.operation, k.collectorShard, k.programVersion, k.chainId],
    );
    const currentRow = stored.rows[0];
    if (currentRow !== undefined) {
      const regressed: string[] = [];
      if (advance.highestObservedSlot < BigInt(currentRow.highest_observed_slot)) {
        regressed.push('highest_observed_slot');
      }
      if (advance.highestContiguousSlot < BigInt(currentRow.highest_contiguous_slot)) {
        regressed.push('highest_contiguous_slot');
      }
      if (
        advance.highestFinalizedSlot !== undefined &&
        currentRow.highest_finalized_slot !== null &&
        advance.highestFinalizedSlot < BigInt(currentRow.highest_finalized_slot)
      ) {
        regressed.push('highest_finalized_slot');
      }
      if (regressed.length > 0) {
        throw new ForesiftError(
          ErrorCode.WATERMARK_REGRESSION_REJECTED,
          `watermark advance would regress ${regressed.join(', ')}`,
          {
            provider: k.provider,
            operation: k.operation,
            collectorShard: k.collectorShard,
            programVersion: k.programVersion,
            chainId: k.chainId,
          },
        );
      }
    }
    await tx.query(
      `INSERT INTO watermarks (
         provider, operation, collector_shard, program_version, chain_id,
         highest_observed_slot, highest_contiguous_slot, highest_finalized_slot,
         oldest_open_gap_start, oldest_open_gap_end,
         maximum_lateness_seen_ms, gap_recovery_status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
       ON CONFLICT (provider, operation, collector_shard, program_version, chain_id)
       DO UPDATE SET
         highest_observed_slot = EXCLUDED.highest_observed_slot,
         highest_contiguous_slot = EXCLUDED.highest_contiguous_slot,
         highest_finalized_slot = EXCLUDED.highest_finalized_slot,
         oldest_open_gap_start = EXCLUDED.oldest_open_gap_start,
         oldest_open_gap_end = EXCLUDED.oldest_open_gap_end,
         maximum_lateness_seen_ms = GREATEST(watermarks.maximum_lateness_seen_ms, EXCLUDED.maximum_lateness_seen_ms),
         gap_recovery_status = EXCLUDED.gap_recovery_status,
         updated_at = now()`,
      [
        k.provider,
        k.operation,
        k.collectorShard,
        k.programVersion,
        k.chainId,
        slot(advance.highestObservedSlot),
        slot(advance.highestContiguousSlot),
        advance.highestFinalizedSlot === undefined ? null : slot(advance.highestFinalizedSlot),
        advance.oldestOpenGap === undefined ? null : slot(advance.oldestOpenGap.startSlot),
        advance.oldestOpenGap === undefined ? null : slot(advance.oldestOpenGap.endSlot),
        advance.maximumLatenessSeenMs ?? 0,
        advance.gapRecoveryStatus ?? (advance.oldestOpenGap !== undefined ? 'IN_PROGRESS' : 'NONE'),
      ],
    );
  });
}

export interface CoverageClaim {
  /** Claimed fully-covered interval [startInclusive, endInclusive]. */
  readonly startInclusive: bigint;
  readonly endInclusive: bigint;
}

/**
 * §13.5 coverage gate: a non-contiguous watermark cannot support complete-
 * coverage claims for the gap interval. Contiguity over the claimed interval
 * requires highest_contiguous_slot >= end AND no open gap overlapping it.
 */
export async function canClaimCompleteCoverage(
  engine: DatabaseEngine,
  key: WatermarkKey,
  claim: CoverageClaim,
): Promise<boolean> {
  const rows = await engine.query<{
    highest_contiguous_slot: string;
    oldest_open_gap_start: string | null;
    oldest_open_gap_end: string | null;
  }>(
    `SELECT highest_contiguous_slot, oldest_open_gap_start, oldest_open_gap_end
     FROM watermarks
     WHERE provider = $1 AND operation = $2 AND collector_shard = $3
       AND program_version = $4 AND chain_id = $5`,
    [key.provider, key.operation, key.collectorShard, key.programVersion, key.chainId],
  );
  const w = rows.rows[0];
  if (w === undefined) return false; // no watermark ⇒ no coverage to claim
  if (BigInt(w.highest_contiguous_slot) < claim.endInclusive) return false;
  if (w.oldest_open_gap_start !== null && w.oldest_open_gap_end !== null) {
    const gapStart = BigInt(w.oldest_open_gap_start);
    const gapEnd = BigInt(w.oldest_open_gap_end);
    const overlaps = gapStart <= claim.endInclusive && gapEnd >= claim.startInclusive;
    if (overlaps) return false;
  }
  return true;
}

export async function loadWatermark(
  engine: DatabaseEngine,
  key: WatermarkKey,
): Promise<{
  highestObservedSlot: bigint;
  highestContiguousSlot: bigint;
  highestFinalizedSlot: bigint | null;
  oldestOpenGap: { startSlot: bigint; endSlot: bigint } | null;
} | null> {
  const rows = await engine.query<{
    highest_observed_slot: string;
    highest_contiguous_slot: string;
    highest_finalized_slot: string | null;
    oldest_open_gap_start: string | null;
    oldest_open_gap_end: string | null;
  }>(
    `SELECT highest_observed_slot, highest_contiguous_slot, highest_finalized_slot,
            oldest_open_gap_start, oldest_open_gap_end
     FROM watermarks
     WHERE provider = $1 AND operation = $2 AND collector_shard = $3
       AND program_version = $4 AND chain_id = $5`,
    [key.provider, key.operation, key.collectorShard, key.programVersion, key.chainId],
  );
  const w = rows.rows[0];
  if (w === undefined) return null;
  return {
    highestObservedSlot: BigInt(w.highest_observed_slot),
    highestContiguousSlot: BigInt(w.highest_contiguous_slot),
    highestFinalizedSlot:
      w.highest_finalized_slot === null ? null : BigInt(w.highest_finalized_slot),
    oldestOpenGap:
      w.oldest_open_gap_start === null || w.oldest_open_gap_end === null
        ? null
        : { startSlot: BigInt(w.oldest_open_gap_start), endSlot: BigInt(w.oldest_open_gap_end) },
  };
}

/** Convenience for tests/fixtures: parse a UTC string. */
export const at = utcTimestamp;
