/**
 * Bounded live-path precomputed alpha matching (T024, FR-PROD-006; PRD §33.7;
 * plan D6).
 *
 * A production live path may serve ONLY a versioned precomputed lookup whose
 * candidate/row/edge/latency/cost ceilings are ALL declared and whose freshness
 * window is open. `servePrecomputedAlpha` records every read as served or
 * refused in `prod.live_path_alpha_reads` with a typed reason — an unbounded,
 * expired, or unknown-artifact request is REFUSED, never truncated into a
 * different (over-claiming) result. The ceiling/freshness law itself is the
 * domain `precomputedAlphaBoundRespected`.
 *
 * Strictly read-only: the lookup serves already-computed read-only intelligence
 * evidence; it never trades, custodies, signs, or submits.
 */
import {
  ErrorCode,
  ForesiftError,
  compareTimestamps,
  precomputedAlphaBoundRespected,
  utcTimestamp,
  type PrecomputedAlphaBound,
  type PrecomputedAlphaRequest,
} from '@foresift/domain';
import { canonicalJson, sha256Text, type DatabaseEngine } from '@foresift/persistence';

/** Closed refusal reasons for a live-path precomputed read (§33.7). */
export const PrecomputedAlphaRefusalReason = {
  /** No artifact reference was supplied at all. */
  NO_BOUND: 'NO_BOUND',
  /** The live path has bounds but none for the requested artifact. */
  UNKNOWN_ARTIFACT: 'UNKNOWN_ARTIFACT',
  /** The declared ceiling set is missing/invalid (never treated as unbounded-allow). */
  UNBOUNDED: 'UNBOUNDED',
  /** The envelope's freshness window has closed. */
  EXPIRED: 'EXPIRED',
  /** The request exceeds a declared candidate/row/edge/latency/cost ceiling. */
  BOUND_EXCEEDED: 'BOUND_EXCEEDED',
} as const;
export type PrecomputedAlphaRefusalReason =
  (typeof PrecomputedAlphaRefusalReason)[keyof typeof PrecomputedAlphaRefusalReason];
export const ALL_PRECOMPUTED_ALPHA_REFUSAL_REASONS: readonly PrecomputedAlphaRefusalReason[] =
  Object.values(PrecomputedAlphaRefusalReason);

/** One persisted `prod.precomputed_alpha_bounds` row. */
export interface PrecomputedAlphaBoundRow {
  readonly boundId: string;
  readonly livePath: string;
  readonly artifactRef: string;
  readonly artifactSetHash: string;
  readonly maxCandidates: number;
  readonly maxRows: number;
  readonly maxEdges: number;
  readonly maxLatencyMs: number;
  readonly maxCostUsd: number;
  readonly datasetCutoff: string;
  readonly verifiedAt: string;
  readonly expiresAt: string;
}

/** One persisted `prod.live_path_alpha_reads` row. */
export interface LivePathAlphaReadRow {
  readonly readId: string;
  readonly livePath: string;
  readonly boundId: string;
  readonly requestHash: string;
  readonly served: boolean;
  readonly refusalReason: string | null;
  readonly latencyMs: number | null;
  readonly readAt: string;
}

interface RawBoundRow {
  bound_id: string;
  live_path: string;
  artifact_ref: string;
  artifact_set_hash: string;
  max_candidates: number | string;
  max_rows: number | string;
  max_edges: number | string;
  max_latency_ms: number | string;
  max_cost_usd: number | string;
  dataset_cutoff: unknown;
  verified_at: unknown;
  expires_at: unknown;
}

interface RawReadRow {
  read_id: string;
  live_path: string;
  bound_id: string;
  request_hash: string;
  served: boolean;
  refusal_reason: string | null;
  latency_ms: number | null;
  read_at: unknown;
}

const toIso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value);

function decodeBound(row: RawBoundRow): PrecomputedAlphaBoundRow {
  return {
    boundId: row.bound_id,
    livePath: row.live_path,
    artifactRef: row.artifact_ref,
    artifactSetHash: row.artifact_set_hash,
    maxCandidates: Number(row.max_candidates),
    maxRows: Number(row.max_rows),
    maxEdges: Number(row.max_edges),
    maxLatencyMs: Number(row.max_latency_ms),
    maxCostUsd: Number(row.max_cost_usd),
    datasetCutoff: toIso(row.dataset_cutoff),
    verifiedAt: toIso(row.verified_at),
    expiresAt: toIso(row.expires_at),
  };
}

function decodeRead(row: RawReadRow): LivePathAlphaReadRow {
  return {
    readId: row.read_id,
    livePath: row.live_path,
    boundId: row.bound_id,
    requestHash: row.request_hash,
    served: row.served,
    refusalReason: row.refusal_reason,
    latencyMs: row.latency_ms === null ? null : Number(row.latency_ms),
    readAt: toIso(row.read_at),
  };
}

function toDomainBound(bound: PrecomputedAlphaBoundRow): PrecomputedAlphaBound {
  return {
    artifactSetHash: bound.artifactSetHash,
    maxCandidates: bound.maxCandidates,
    maxRows: bound.maxRows,
    maxEdges: bound.maxEdges,
    maxLatencyMs: bound.maxLatencyMs,
    maxCostUsd: bound.maxCostUsd,
    expiresAt: bound.expiresAt,
  };
}

/** Register a bounded precomputed-alpha envelope (every ceiling required). */
export async function registerPrecomputedAlphaBound(
  engine: DatabaseEngine,
  input: {
    readonly boundId: string;
    readonly livePath: string;
    readonly artifactRef: string;
    readonly artifactSetHash: string;
    readonly maxCandidates: number;
    readonly maxRows: number;
    readonly maxEdges: number;
    readonly maxLatencyMs: number;
    readonly maxCostUsd: number;
    readonly datasetCutoff: string;
    readonly verifiedAt: string;
    readonly expiresAt: string;
  },
): Promise<PrecomputedAlphaBoundRow> {
  await engine.query(
    `INSERT INTO prod.precomputed_alpha_bounds
       (bound_id, live_path, artifact_ref, artifact_set_hash, max_candidates, max_rows,
        max_edges, max_latency_ms, max_cost_usd, dataset_cutoff, verified_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz, $12::timestamptz)`,
    [
      input.boundId,
      input.livePath,
      input.artifactRef,
      input.artifactSetHash,
      input.maxCandidates,
      input.maxRows,
      input.maxEdges,
      input.maxLatencyMs,
      input.maxCostUsd,
      input.datasetCutoff,
      input.verifiedAt,
      input.expiresAt,
    ],
  );
  return {
    boundId: input.boundId,
    livePath: input.livePath,
    artifactRef: input.artifactRef,
    artifactSetHash: input.artifactSetHash,
    maxCandidates: input.maxCandidates,
    maxRows: input.maxRows,
    maxEdges: input.maxEdges,
    maxLatencyMs: input.maxLatencyMs,
    maxCostUsd: input.maxCostUsd,
    datasetCutoff: input.datasetCutoff,
    verifiedAt: input.verifiedAt,
    expiresAt: input.expiresAt,
  };
}

/** The newest bound for a live path, optionally constrained to one artifact. */
export async function findPrecomputedAlphaBound(
  engine: DatabaseEngine,
  input: { readonly livePath: string; readonly artifactRef?: string; readonly boundId?: string },
): Promise<PrecomputedAlphaBoundRow | undefined> {
  const params: unknown[] = [input.livePath];
  let where = `live_path = $1`;
  if (input.boundId !== undefined) {
    params.push(input.boundId);
    where += ` AND bound_id = $${params.length}`;
  }
  if (input.artifactRef !== undefined) {
    params.push(input.artifactRef);
    where += ` AND artifact_ref = $${params.length}`;
  }
  const result = await engine.query<RawBoundRow>(
    `SELECT bound_id, live_path, artifact_ref, artifact_set_hash, max_candidates, max_rows,
            max_edges, max_latency_ms, max_cost_usd, dataset_cutoff, verified_at, expires_at
       FROM prod.precomputed_alpha_bounds
      WHERE ${where}
      ORDER BY verified_at DESC, bound_id DESC
      LIMIT 1`,
    params,
  );
  const row = result.rows[0];
  return row === undefined ? undefined : decodeBound(row);
}

/** A served or refused live-path read outcome. */
export type PrecomputedAlphaResult =
  | {
      readonly served: true;
      readonly read: LivePathAlphaReadRow;
      readonly bound: PrecomputedAlphaBoundRow;
    }
  | {
      readonly served: false;
      readonly refusalReason: PrecomputedAlphaRefusalReason;
      readonly read: LivePathAlphaReadRow | null;
      readonly boundId: string | null;
      readonly detail: string;
    };

async function recordRead(
  engine: DatabaseEngine,
  input: {
    readonly readId: string;
    readonly livePath: string;
    readonly boundId: string;
    readonly request: PrecomputedAlphaRequest;
    readonly served: boolean;
    readonly refusalReason: PrecomputedAlphaRefusalReason | null;
    readonly latencyMs: number | null;
    readonly at: string;
  },
): Promise<LivePathAlphaReadRow> {
  await engine.query(
    `INSERT INTO prod.live_path_alpha_reads
       (read_id, live_path, bound_id, request_hash, served, refusal_reason, latency_ms, read_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)`,
    [
      input.readId,
      input.livePath,
      input.boundId,
      sha256Text(canonicalJson(input.request)),
      input.served,
      input.refusalReason,
      input.latencyMs,
      input.at,
    ],
  );
  const result = await engine.query<RawReadRow>(
    `SELECT read_id, live_path, bound_id, request_hash, served, refusal_reason, latency_ms, read_at
       FROM prod.live_path_alpha_reads WHERE read_id = $1`,
    [input.readId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new ForesiftError(
      ErrorCode.PROD_PRECOMPUTED_BOUND_INVALID,
      'live-path precomputed read was not recorded',
      { readId: input.readId },
    );
  }
  return decodeRead(row);
}

/**
 * Serve a live-path precomputed lookup, or refuse it with a typed reason. The
 * request is NEVER truncated: exceeding any ceiling refuses the whole lookup.
 * Every refusal that can reference a real envelope is recorded; a live path
 * with no envelope at all cannot be logged against the (foreign-key) bound
 * table and refuses without a persisted read row.
 */
export async function servePrecomputedAlpha(
  engine: DatabaseEngine,
  input: {
    readonly livePath: string;
    readonly request: PrecomputedAlphaRequest;
    readonly now: string;
    readonly artifactRef?: string;
    readonly boundId?: string;
    readonly readId?: string;
    readonly servedAt?: string;
  },
): Promise<PrecomputedAlphaResult> {
  const now = utcTimestamp(input.now);
  const at = input.servedAt ?? input.now;
  const readId =
    input.readId ??
    `read-${sha256Text(
      canonicalJson({
        livePath: input.livePath,
        artifactRef: input.artifactRef ?? null,
        request: input.request,
        at,
      }),
    ).slice(7, 23)}`;

  const bound = await findPrecomputedAlphaBound(engine, {
    livePath: input.livePath,
    ...(input.artifactRef === undefined ? {} : { artifactRef: input.artifactRef }),
    ...(input.boundId === undefined ? {} : { boundId: input.boundId }),
  });
  if (bound === undefined) {
    // Try the live path's newest envelope to attribute an unknown-artifact read.
    const anyBound = await findPrecomputedAlphaBound(engine, { livePath: input.livePath });
    if (anyBound === undefined) {
      return {
        served: false,
        refusalReason: PrecomputedAlphaRefusalReason.NO_BOUND,
        read: null,
        boundId: null,
        detail: 'the live path has no bounded precomputed-alpha envelope at all',
      };
    }
    const reason =
      input.artifactRef === undefined
        ? PrecomputedAlphaRefusalReason.NO_BOUND
        : PrecomputedAlphaRefusalReason.UNKNOWN_ARTIFACT;
    const read = await recordRead(engine, {
      readId,
      livePath: input.livePath,
      boundId: anyBound.boundId,
      request: input.request,
      served: false,
      refusalReason: reason,
      latencyMs: null,
      at,
    });
    return {
      served: false,
      refusalReason: reason,
      read,
      boundId: anyBound.boundId,
      detail:
        reason === PrecomputedAlphaRefusalReason.UNKNOWN_ARTIFACT
          ? `no bound for artifact ${String(input.artifactRef)} on ${input.livePath}`
          : 'no artifact reference supplied for the live path bound',
    };
  }

  let within: boolean;
  try {
    within = precomputedAlphaBoundRespected(toDomainBound(bound), input.request, now);
  } catch {
    const read = await recordRead(engine, {
      readId,
      livePath: input.livePath,
      boundId: bound.boundId,
      request: input.request,
      served: false,
      refusalReason: PrecomputedAlphaRefusalReason.UNBOUNDED,
      latencyMs: null,
      at,
    });
    return {
      served: false,
      refusalReason: PrecomputedAlphaRefusalReason.UNBOUNDED,
      read,
      boundId: bound.boundId,
      detail: 'the envelope does not declare a valid, complete ceiling set',
    };
  }
  if (!within) {
    const reason =
      compareTimestamps(now, utcTimestamp(bound.expiresAt)) >= 0
        ? PrecomputedAlphaRefusalReason.EXPIRED
        : PrecomputedAlphaRefusalReason.BOUND_EXCEEDED;
    const read = await recordRead(engine, {
      readId,
      livePath: input.livePath,
      boundId: bound.boundId,
      request: input.request,
      served: false,
      refusalReason: reason,
      latencyMs: null,
      at,
    });
    return {
      served: false,
      refusalReason: reason,
      read,
      boundId: bound.boundId,
      detail:
        reason === PrecomputedAlphaRefusalReason.EXPIRED
          ? `the envelope expired at ${bound.expiresAt}`
          : 'the request exceeds a declared candidate/row/edge/latency/cost ceiling',
    };
  }
  const read = await recordRead(engine, {
    readId,
    livePath: input.livePath,
    boundId: bound.boundId,
    request: input.request,
    served: true,
    refusalReason: null,
    latencyMs: input.request.latencyMs,
    at,
  });
  return { served: true, read, bound };
}

/** The served/refused read history for a live path (append-only read). */
export async function livePathReadHistory(
  engine: DatabaseEngine,
  livePath: string,
): Promise<readonly LivePathAlphaReadRow[]> {
  const result = await engine.query<RawReadRow>(
    `SELECT read_id, live_path, bound_id, request_hash, served, refusal_reason, latency_ms, read_at
       FROM prod.live_path_alpha_reads
      WHERE live_path = $1
      ORDER BY read_at ASC, read_id ASC`,
    [livePath],
  );
  return result.rows.map(decodeRead);
}
