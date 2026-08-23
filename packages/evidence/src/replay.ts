/**
 * Replay-boundary resolution over evidence bundles AND observations
 * (T040, FR-DATA-003, FR-DATA-002). Shares THE domain predicate —
 * visibleAt({availableAt}, T) = available_at <= T — with the persistence
 * replay repos, so a boundary resolves identically no matter which module
 * answers. Frozen evidence contributes only when frozen at or before the
 * boundary; observations contribute only the revision visible at T.
 */
import { utcTimestamp, visibleAt, type UtcTimestamp } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';

export interface ResolvedBundle {
  readonly bundleId: string;
  readonly contentHash: string;
  readonly manifest: unknown;
  readonly frozenAt: UtcTimestamp;
}

export interface ResolvedObservationRef {
  readonly observationId: string;
  readonly subjectPoolId: string;
  /** Availability instant that made this entry visible at the boundary. */
  readonly availableAt: UtcTimestamp;
}

export interface ReplayResolution {
  readonly resolvedAt: UtcTimestamp;
  readonly bundles: readonly ResolvedBundle[];
  readonly observations: readonly ResolvedObservationRef[];
}

function toIso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString().replace('.000Z', 'Z');
}

/**
 * Resolve everything a deep-research decision could have relied on at time T:
 * evidence bundles frozen at/before T and pool observations whose availability
 * (base or superseding revision) is at/before T.
 */
export async function resolveEvidenceAt(
  engine: DatabaseEngine,
  input: { resolvedAt: UtcTimestamp },
): Promise<ReplayResolution> {
  // Fail closed on a hidden/invalid boundary before any query runs — an
  // absent resolvedAt must refuse, never fall back to "now" or empty.
  const t = utcTimestamp(String(input.resolvedAt));

  const bundleRows = await engine.query<{
    bundle_id: string;
    content_hash: string;
    manifest: unknown;
    frozen_at: Date | string;
  }>(
    'SELECT bundle_id, content_hash, manifest, frozen_at FROM evidence_bundles ORDER BY frozen_at, bundle_id',
  );
  const bundles = bundleRows.rows
    .map((r) => ({
      bundleId: r.bundle_id,
      contentHash: r.content_hash,
      manifest: r.manifest,
      frozenAt: utcTimestamp(toIso(r.frozen_at)),
    }))
    // THE shared domain predicate, applied exactly as in repos/replay.
    .filter((b) => visibleAt({ availableAt: b.frozenAt }, t));

  // Among versions VISIBLE at T, newest availability wins — the same
  // resolution rule as repos/replay (visibility first, then max availability).
  const candidateRows = await engine.query<{
    observation_id: string;
    subject_pool_id: string;
    available_at: Date | string;
  }>(`
    SELECT observation_id, subject_pool_id, available_at FROM observations
    UNION ALL
    SELECT r.observation_id, o.subject_pool_id, r.available_at
      FROM observation_revisions r JOIN observations o ON o.observation_id = r.observation_id
    ORDER BY observation_id, available_at
  `);
  const latestByObservation = new Map<string, ResolvedObservationRef>();
  for (const row of candidateRows.rows) {
    const availableAt = utcTimestamp(toIso(row.available_at));
    if (!visibleAt({ availableAt }, t)) continue;
    const ref: ResolvedObservationRef = {
      observationId: row.observation_id,
      subjectPoolId: row.subject_pool_id,
      availableAt,
    };
    const current = latestByObservation.get(ref.observationId);
    if (current === undefined || ref.availableAt > current.availableAt) {
      latestByObservation.set(ref.observationId, ref);
    }
  }
  const observations = [...latestByObservation.values()].sort(
    (a, b) =>
      a.observationId.localeCompare(b.observationId) || a.availableAt.localeCompare(b.availableAt),
  );

  return { resolvedAt: t, bundles, observations };
}
