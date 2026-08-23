/**
 * Immutable matured-count projections over frozen evidence bundles
 * (FR-DATA-006, FR-DATA-004, T037; AC-247).
 *
 * A projection is served only through replay-realizable windows: the claimed
 * maturity window may never extend past the resolved-at replay boundary.
 * Counts derive exclusively from immutable inputs — trigger-protected frozen
 * bundles and one-way acquisition completions — so a projection for a given
 * (candidate, window, boundary) can never be altered afterwards. Promotion
 * eligibility is reported honestly: a below-threshold count is stated as
 * below threshold, never inflated toward the gate.
 */
import {
  ForesiftError,
  ErrorCode,
  utcTimestamp,
  visibleAt,
  type UtcTimestamp,
} from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';

export interface MaturedCountProjection {
  readonly candidateId: string;
  readonly evidenceFamily: string;
  /** Inclusive maturity window in completion time. */
  readonly windowStartInclusive: UtcTimestamp;
  readonly windowEndInclusive: UtcTimestamp;
  /** Replay boundary the projection was resolved at. */
  readonly resolvedAt: UtcTimestamp;
  /** Distinct frozen evidence items matured inside the window. */
  readonly maturedCount: number;
  /** The promotion gate this count is honestly compared against. */
  readonly promotionThreshold: number;
  /** False when below threshold — reported, never rounded up. */
  readonly promotionEligible: boolean;
}

function toIso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString().replace('.000Z', 'Z');
}

/**
 * Project matured evidence counts for a candidate over a completed-retrieval
 * window, counting only items whose bundle was FROZEN at or before the
 * replay boundary. Unfrozen or future-frozen evidence is not matured evidence.
 */
export async function projectMaturedCounts(
  engine: DatabaseEngine,
  input: {
    candidateId: string;
    evidenceFamily: string;
    windowStartInclusive: UtcTimestamp;
    windowEndInclusive: UtcTimestamp;
    resolvedAt: UtcTimestamp;
    promotionThreshold: number;
  },
): Promise<MaturedCountProjection> {
  // Replay-realizability: the window must lie within the replay horizon.
  if (!visibleAt({ availableAt: input.windowEndInclusive }, input.resolvedAt)) {
    throw new ForesiftError(
      ErrorCode.SOURCE_FROZEN_COUNT_IMMUTABLE,
      `maturity window ends ${input.windowEndInclusive}, beyond the replay boundary ${input.resolvedAt}`,
      { candidateId: input.candidateId },
    );
  }
  if (!visibleAt({ availableAt: input.windowStartInclusive }, input.resolvedAt)) {
    throw new ForesiftError(
      ErrorCode.SOURCE_FROZEN_COUNT_IMMUTABLE,
      `maturity window starts ${input.windowStartInclusive}, beyond the replay boundary ${input.resolvedAt}`,
      { candidateId: input.candidateId },
    );
  }

  // Matured = distinct evidence ids of RETURNED decisions completed inside the
  // window AND at/before the boundary, whose bundles are frozen at/before the
  // boundary too.
  const rows = await engine.query<{ n: string }>(
    `SELECT COUNT(DISTINCT e.evidence_id) AS n
     FROM evidence_acquisition_decisions d
     JOIN LATERAL unnest(d.evidence_ids) AS e(evidence_id) ON TRUE
     JOIN evidence_bundles b ON b.bundle_id = e.evidence_id
     WHERE d.candidate_id = $1
       AND d.evidence_family = $2
       AND d.state = 'RETURNED'
       AND d.completed_at IS NOT NULL
       AND d.completed_at >= $3 AND d.completed_at <= $4
       AND d.completed_at <= $5
       AND b.frozen_at <= $5`,
    [
      input.candidateId,
      input.evidenceFamily,
      input.windowStartInclusive,
      input.windowEndInclusive,
      input.resolvedAt,
    ],
  );
  const maturedCount = Number(rows.rows[0]?.n ?? 0);
  return {
    candidateId: input.candidateId,
    evidenceFamily: input.evidenceFamily,
    windowStartInclusive: utcTimestamp(toIso(input.windowStartInclusive)),
    windowEndInclusive: utcTimestamp(toIso(input.windowEndInclusive)),
    resolvedAt: utcTimestamp(toIso(input.resolvedAt)),
    maturedCount,
    promotionThreshold: input.promotionThreshold,
    // Below-threshold honesty: an integer comparison, never inflated.
    promotionEligible: maturedCount >= input.promotionThreshold,
  };
}
