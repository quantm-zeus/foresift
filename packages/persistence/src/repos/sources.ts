/**
 * Source identity and independence repository (FR-DATA-006, §11.7, ADR-052,
 * INV-008: provider count is not source independence).
 *
 * Sources sharing an upstream lineage collapse into ONE independence group
 * regardless of distinct brand/provider ids. Pairwise dependence edges store
 * the observed correlation inputs with an explicit availability label:
 * AVAILABLE_AT_THE_TIME inputs may inform replay-era reasoning, while
 * DIAGNOSTIC_RETROSPECTIVE estimates are diagnostic-only forever (AC-247).
 */
import {
  DependenceLabel,
  ForesiftError,
  ErrorCode,
  assertDependenceInputs,
  utcTimestamp,
  visibleAt,
  type DependenceObservationInputs,
  type SourceDependenceEdge,
  type SourceIdentity,
} from '@foresift/domain';
import type { DatabaseEngine } from '../db.ts';

/** Register a source identity; identical tuples verify, differing ones refuse. */
export async function registerSourceIdentity(
  engine: DatabaseEngine,
  identity: SourceIdentity,
): Promise<void> {
  const existing = await engine.query<Record<string, unknown>>(
    `SELECT * FROM source_identities WHERE source_id = $1`,
    [identity.id],
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    if (row === undefined) throw new Error('unreachable');
    const mismatches =
      row.brand_provider !== identity.brandProvider ||
      row.operation !== identity.operation ||
      row.upstream_lineage_key !== identity.upstreamLineageKey ||
      row.endpoint_region !== identity.endpointRegion ||
      row.collection_method !== identity.collectionMethod;
    if (mismatches) {
      throw new ForesiftError(
        ErrorCode.SOURCE_DEPENDENCE_INPUT_INVALID,
        `source identity ${identity.id} already registered with a different tuple`,
        { id: identity.id },
      );
    }
    return;
  }
  await engine.query(
    `INSERT INTO source_identities
       (source_id, brand_provider, operation, upstream_lineage_key, endpoint_region, collection_method)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      identity.id,
      identity.brandProvider,
      identity.operation,
      identity.upstreamLineageKey,
      identity.endpointRegion,
      identity.collectionMethod,
    ],
  );
  // Collapse-by-lineage: membership in the single group for the lineage key.
  const groupId = `indep:${identity.upstreamLineageKey}`;
  await engine.query(
    `INSERT INTO independence_groups (group_id, upstream_lineage_key)
     VALUES ($1,$2) ON CONFLICT (upstream_lineage_key) DO NOTHING`,
    [groupId, identity.upstreamLineageKey],
  );
  await engine.query(
    `INSERT INTO source_group_memberships (group_id, source_identity_id)
     VALUES ($1,$2) ON CONFLICT (group_id, source_identity_id) DO NOTHING`,
    [groupId, identity.id],
  );
}

export interface IndependenceGroupView {
  readonly groupId: string;
  readonly upstreamLineageKey: string;
  readonly memberSourceIds: readonly string[];
}

/** One independence group: every source reselling that lineage. */
export async function independenceGroupOf(
  engine: DatabaseEngine,
  upstreamLineageKey: string,
): Promise<IndependenceGroupView | null> {
  const groups = await engine.query<{ group_id: string; upstream_lineage_key: string }>(
    `SELECT group_id, upstream_lineage_key FROM independence_groups
     WHERE upstream_lineage_key = $1`,
    [upstreamLineageKey],
  );
  const g = groups.rows[0];
  if (g === undefined) return null;
  const members = await engine.query<{ source_identity_id: string }>(
    `SELECT source_identity_id FROM source_group_memberships
     WHERE group_id = $1 ORDER BY source_identity_id`,
    [g.group_id],
  );
  return {
    groupId: g.group_id,
    upstreamLineageKey: g.upstream_lineage_key,
    memberSourceIds: members.rows.map((m) => m.source_identity_id),
  };
}

/**
 * The collapse query: all sources folded into one independence group by their
 * shared upstream lineage — the unit of independence for counting (INV-008).
 */
export async function independenceGroups(
  engine: DatabaseEngine,
): Promise<readonly IndependenceGroupView[]> {
  const groups = await engine.query<{ group_id: string; upstream_lineage_key: string }>(
    `SELECT group_id, upstream_lineage_key FROM independence_groups ORDER BY group_id`,
  );
  const members = await engine.query<{ group_id: string; source_identity_id: string }>(
    `SELECT group_id, source_identity_id FROM source_group_memberships ORDER BY source_identity_id`,
  );
  const byGroup = new Map<string, string[]>();
  for (const m of members.rows) {
    const list = byGroup.get(m.group_id) ?? [];
    list.push(m.source_identity_id);
    byGroup.set(m.group_id, list);
  }
  return groups.rows.map((g) => ({
    groupId: g.group_id,
    upstreamLineageKey: g.upstream_lineage_key,
    memberSourceIds: byGroup.get(g.group_id) ?? [],
  }));
}

// --- Pairwise dependence edges ----------------------------------------------

/** Domain-shaped view of a stored edge. */
export interface StoredDependenceEdge {
  readonly edgeId: string;
  readonly edge: SourceDependenceEdge;
}

/**
 * Label inputs honestly from their own availability: only inputs whose data
 * was itself available at the edge's available_at may carry
 * AVAILABLE_AT_THE_TIME; anything later is diagnostic-only.
 */
export function classifyInputsAvailability(input: {
  /** Availability instant of the underlying correlation data. */
  inputsAvailableAt: string;
  /** The edge estimate's own availability instant. */
  edgeAvailableAt: string;
}): DependenceLabel {
  return visibleAt(
    { availableAt: utcTimestamp(input.inputsAvailableAt) },
    utcTimestamp(input.edgeAvailableAt),
  )
    ? DependenceLabel.AVAILABLE_AT_THE_TIME
    : DependenceLabel.DIAGNOSTIC_RETROSPECTIVE;
}

export async function recordDependenceEdge(
  engine: DatabaseEngine,
  input: { edgeId: string; edge: SourceDependenceEdge },
): Promise<void> {
  assertDependenceInputs(input.edge.inputs);
  // Canonical pair order normalizes orientation regardless of who was listed
  // first; storage does NOT enforce uniqueness per pair (multiple edges over
  // time are allowed and the reader returns them newest-first), and self-edges
  // are refused outright.
  const [a, b] =
    input.edge.sourceA < input.edge.sourceB
      ? [input.edge.sourceA, input.edge.sourceB]
      : [input.edge.sourceB, input.edge.sourceA];
  if (a === b) {
    throw new ForesiftError(
      ErrorCode.SOURCE_DEPENDENCE_INPUT_INVALID,
      'a dependence edge requires two distinct sources',
      { edgeId: input.edgeId },
    );
  }
  await engine.query(
    `INSERT INTO source_dependence_edges (
       edge_id, source_a, source_b, shared_upstream_lineage_keys,
       value_error_timing_correlation, outage_overlap, first_seen_lag_agreement,
       fingerprint_similarity, label, available_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      input.edgeId,
      a,
      b,
      [...input.edge.sharedUpstreamLineageKeys],
      input.edge.inputs.valueErrorTimingCorrelation,
      input.edge.inputs.outageOverlap,
      input.edge.inputs.firstSeenLagAgreement,
      input.edge.inputs.fingerprintSimilarity,
      input.edge.label,
      input.edge.availableAt,
    ],
  );
}

/** Edges touching either side of the pair, newest first. */
export async function dependenceEdgesForPair(
  engine: DatabaseEngine,
  sourceA: string,
  sourceB: string,
): Promise<readonly StoredDependenceEdge[]> {
  const [a, b] = sourceA < sourceB ? [sourceA, sourceB] : [sourceB, sourceA];
  const rows = await engine.query<{
    edge_id: string;
    source_a: string;
    source_b: string;
    shared_upstream_lineage_keys: string[];
    value_error_timing_correlation: number;
    outage_overlap: number;
    first_seen_lag_agreement: number;
    fingerprint_similarity: number;
    label: string;
    available_at: Date | string;
  }>(
    `SELECT * FROM source_dependence_edges
     WHERE (source_a = $1 AND source_b = $2) OR (source_a = $2 AND source_b = $1)
     ORDER BY available_at DESC`,
    [a, b],
  );
  return rows.rows.map((r) => ({
    edgeId: r.edge_id,
    edge: {
      sourceA: r.source_a as SourceIdentity['id'],
      sourceB: r.source_b as SourceIdentity['id'],
      sharedUpstreamLineageKeys: r.shared_upstream_lineage_keys,
      inputs: {
        valueErrorTimingCorrelation: r.value_error_timing_correlation,
        outageOverlap: r.outage_overlap,
        firstSeenLagAgreement: r.first_seen_lag_agreement,
        fingerprintSimilarity: r.fingerprint_similarity,
      } satisfies DependenceObservationInputs,
      label: r.label as DependenceLabel,
      availableAt: utcTimestamp(toIso(r.available_at)),
    },
  }));
}

function toIso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString().replace('.000Z', 'Z');
}
