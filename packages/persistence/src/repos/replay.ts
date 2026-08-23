/**
 * Point-in-time replay repository (FR-DATA-003, AC-020/021).
 *
 * The boundary rule is THE shared domain predicate (`visibleAt`:
 * available_at <= T) — the SQL prefilter mirrors it, and every candidate row
 * is re-verified through the domain function before being resolved, so there
 * is exactly one definition of visibility across persistence and evidence.
 *
 * Current views resolve the latest valid revision; replay views resolve the
 * latest revision whose available_at is within the boundary. Every replay
 * entrypoint REQUIRES an explicit T — no optional-T overload defaults to
 * "now". The one T-free view is the separately named `currentObservations`
 * below, which reads global head state by design and is never a replay
 * default.
 */
import {
  compareForReplayResolution,
  utcTimestamp,
  visibleAt,
  type UtcTimestamp,
} from '@foresift/domain';
import type { DatabaseEngine } from '../db.ts';

interface CandidateRow {
  observation_id: string;
  revision_no: number | null;
  revision_id: string | null;
  available_at: Date | string;
  event_at: Date | string;
  availability_provenance: string;
  raw_amount: string | null;
  decimals: number | null;
  quality_codes: string[];
  receipt_hash: string;
}

export interface ResolvedObservation {
  readonly observationId: string;
  /** Which row won: base receipt or a specific revision. */
  readonly revisionNo: number;
  readonly revisionId: string | null;
  readonly availableAt: UtcTimestamp;
  readonly eventAt: UtcTimestamp;
  readonly availabilityProvenance: string;
  readonly rawAmount: string | null;
  readonly decimals: number | null;
  readonly qualityCodes: readonly string[];
  readonly receiptHash: string;
  /** True when the winning row is a revision rather than the original. */
  readonly isRevision: boolean;
}

function toIso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString().replace('.000Z', 'Z');
}

function toResolved(row: CandidateRow): ResolvedObservation {
  const iso = toIso(row.available_at);
  return {
    observationId: row.observation_id,
    revisionNo: row.revision_no ?? 0,
    revisionId: row.revision_id,
    availableAt: utcTimestamp(iso),
    eventAt: utcTimestamp(toIso(row.event_at)),
    availabilityProvenance: row.availability_provenance,
    rawAmount: row.raw_amount,
    decimals: row.decimals,
    qualityCodes: row.quality_codes,
    receiptHash: row.receipt_hash,
    isRevision: row.revision_no !== null,
  };
}

/**
 * Replay observations at decision time T. For each observation whose base
 * receipt (or any of its revisions) was available at or before T, resolves
 * the latest such version deterministically.
 */
export async function replayObservations(
  engine: DatabaseEngine,
  t: UtcTimestamp,
  filter?: { subjectPoolId?: string; subjectAssetId?: string },
): Promise<readonly ResolvedObservation[]> {
  // Fail closed on a hidden/invalid boundary BEFORE it reaches SQL — an
  // undefined t would silently become `<= NULL` (an empty-looking success).
  const boundary = utcTimestamp(String(t));
  // Candidates: original receipts plus every revision, prefetched with the
  // SQL mirror of the boundary predicate.
  const params: unknown[] = [boundary];
  let poolClause = '';
  if (filter?.subjectPoolId !== undefined) {
    params.push(filter.subjectPoolId);
    poolClause = `AND o.subject_pool_id = $${params.length}`;
  }
  let assetClause = '';
  if (filter?.subjectAssetId !== undefined) {
    params.push(filter.subjectAssetId);
    assetClause = `AND o.subject_asset_id = $${params.length}`;
  }

  const bases = await engine.query<CandidateRow>(
    `SELECT o.observation_id, NULL::int AS revision_no, NULL::text AS revision_id,
            o.available_at, o.event_at, o.availability_provenance,
            o.raw_amount, o.decimals, o.quality_codes, o.receipt_hash
     FROM observations o
     WHERE o.available_at <= $1 ${poolClause} ${assetClause}`,
    params,
  );
  const revisions = await engine.query<CandidateRow>(
    `SELECT r.observation_id, r.revision_no, r.revision_id,
            r.available_at, o.event_at, r.availability_provenance,
            r.raw_amount, r.decimals, r.quality_codes, o.receipt_hash
     FROM observation_revisions r JOIN observations o ON o.observation_id = r.observation_id
     WHERE r.available_at <= $1 ${poolClause} ${assetClause}`,
    params,
  );

  // Group candidates per observation; re-verify each through the shared
  // domain predicate; resolve with the shared deterministic ordering.
  const byObservation = new Map<string, { rows: ResolvedObservation[]; eventAt: UtcTimestamp }>();
  for (const row of [...bases.rows, ...revisions.rows]) {
    if (!visibleAt({ availableAt: utcTimestamp(toIso(row.available_at)) }, t)) continue;
    const bucket = byObservation.get(row.observation_id) ?? {
      rows: [],
      eventAt: utcTimestamp(toIso(row.event_at)),
    };
    bucket.rows.push(toResolved(row));
    byObservation.set(row.observation_id, bucket);
  }

  const resolved: ResolvedObservation[] = [];
  for (const [, bucket] of byObservation) {
    // Latest availability first, then highest revision, then stable key —
    // expressed via the shared comparator on replay-orderable shapes.
    const winner = bucket.rows
      .map((r) => ({
        r,
        orderable: {
          availableAt: r.availableAt,
          ...(r.revisionNo > 0 ? { revisionNo: r.revisionNo } : {}),
          stableKey: `${r.revisionNo === 0 ? 'base' : r.revisionId}@${r.observationId}`,
        },
      }))
      .sort((a, b) => compareForReplayResolution(a.orderable, b.orderable))
      .at(0)?.r;
    if (winner !== undefined) resolved.push(winner);
  }
  return resolved.sort((a, b) =>
    a.observationId < b.observationId ? -1 : a.observationId > b.observationId ? 1 : 0,
  );
}

/** Current view (no T): latest revision overall. Distinct from any replay path. */
export async function currentObservations(
  engine: DatabaseEngine,
  filter?: { subjectPoolId?: string; subjectAssetId?: string },
): Promise<readonly ResolvedObservation[]> {
  const params: unknown[] = [];
  let where = '';
  if (filter?.subjectPoolId !== undefined) {
    params.push(filter.subjectPoolId);
    where += ` AND o.subject_pool_id = $${params.length}`;
  }
  if (filter?.subjectAssetId !== undefined) {
    params.push(filter.subjectAssetId);
    where += ` AND o.subject_asset_id = $${params.length}`;
  }
  const rows = await engine.query<CandidateRow>(
    `WITH head AS (
       SELECT r.observation_id, MAX(r.revision_no) AS max_no
       FROM observation_revisions r
       JOIN observations o ON o.observation_id = r.observation_id
       WHERE TRUE ${where}
       GROUP BY r.observation_id
     )
     SELECT r.observation_id, r.revision_no, r.revision_id,
            r.available_at, o.event_at, r.availability_provenance,
            r.raw_amount, r.decimals, r.quality_codes, o.receipt_hash
     FROM observation_revisions r
     JOIN head ON head.observation_id = r.observation_id AND head.max_no = r.revision_no
     JOIN observations o ON o.observation_id = r.observation_id
     UNION ALL
     SELECT o.observation_id, NULL::int, NULL::text,
            o.available_at, o.event_at, o.availability_provenance,
            o.raw_amount, o.decimals, o.quality_codes, o.receipt_hash
     FROM observations o
     WHERE NOT EXISTS (
       SELECT 1 FROM observation_revisions r WHERE r.observation_id = o.observation_id
     ) ${where}`,
    params,
  );
  return rows.rows
    .map(toResolved)
    .sort((a, b) =>
      a.observationId < b.observationId ? -1 : a.observationId > b.observationId ? 1 : 0,
    );
}
