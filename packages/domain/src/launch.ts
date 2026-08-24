/**
 * Launch/migration lineage (FR-DATA-001, §11.6): launch_pool → migration_event
 * → migrated_pool edges; features must avoid double counting liquidity,
 * volume, and holders across migration boundaries (AC-022).
 */
import { ErrorCode, ForesiftError } from './errors.ts';
import type { PoolId } from './asset.ts';
import type { UtcTimestamp } from './timestamps.ts';

declare const brand: unique symbol;
export type MigrationId = string & { readonly [brand]: 'MigrationId' };

/** Lifecycle status of a migration edge. */
export const LineageStatus = {
  /** Edge observed directly from protocol migration events. */
  CONFIRMED: 'CONFIRMED',
  /** Multiple candidate migrated pools; ambiguous until disambiguated. */
  AMBIGUOUS: 'AMBIGUOUS',
} as const;

export type LineageStatus = (typeof LineageStatus)[keyof typeof LineageStatus];

/** One directed lineage edge. */
export interface MigrationLineageEdge {
  readonly migrationId: MigrationId;
  readonly launchPoolId: PoolId;
  readonly migratedPoolId: PoolId;
  readonly status: LineageStatus;
  /** When the migration completed; absent while unconfirmed/ambiguous. */
  readonly migratedAt?: UtcTimestamp;
}

/**
 * Aggregate per-pool metric samples across lineage boundaries without double
 * counting (AC-022). A sample contributed by pool `P` counts once:
 * - samples dated at/after a confirmed migration out of `P` are superseded —
 *   the metric now lives in the successor pool's own sample;
 * - undated samples on a pool with outgoing migrations are refused as
 *   ambiguous rather than guessed (§11.8 abstain rule).
 *
 * Every supplied edge must already be CONFIRMED with a `migratedAt` boundary;
 * any AMBIGUOUS or unbounded edge is refused up front, even when its pools
 * appear nowhere in `contributions`.
 *
 * Naive summation over the same inputs double counts across every boundary,
 * which is exactly what the AC-022 regression fixture demonstrates.
 */
export interface LineageMetricSample {
  /** Sample position on the lineage timeline; `null` when undated. */
  readonly effectiveAt: UtcTimestamp | null;
  /** Raw integer amount in metric-native units (never a JS number). */
  readonly value: bigint;
}

export function aggregateWithoutDoubleCounting(
  contributions: ReadonlyMap<PoolId, readonly LineageMetricSample[]>,
  edges: readonly MigrationLineageEdge[],
): bigint {
  detectLineageCycles(edges);
  const confirmedBoundaries = new Map<PoolId, UtcTimestamp[]>();
  for (const e of edges) {
    if (e.status !== LineageStatus.CONFIRMED || e.migratedAt === undefined) {
      throw new ForesiftError(
        ErrorCode.IDENTITY_MIGRATION_EDGE_AMBIGUOUS,
        'aggregation requires confirmed migrations with boundary times',
        { migrationId: e.migrationId },
      );
    }
    const list = confirmedBoundaries.get(e.launchPoolId) ?? [];
    list.push(e.migratedAt);
    confirmedBoundaries.set(e.launchPoolId, list);
  }

  let total = 0n;
  for (const [poolId, samples] of contributions) {
    const boundaries = confirmedBoundaries.get(poolId) ?? [];
    for (const sample of samples) {
      const effectiveAt: UtcTimestamp | null = sample.effectiveAt;
      if (effectiveAt === null) {
        if (boundaries.length > 0) {
          throw new ForesiftError(
            ErrorCode.IDENTITY_MIGRATION_EDGE_AMBIGUOUS,
            'undated sample on a migrated pool cannot be attributed',
            { poolId },
          );
        }
        total += sample.value;
        continue;
      }
      const effAt: UtcTimestamp = effectiveAt;
      const superseded = boundaries.some((b) => b <= effAt);
      if (!superseded) total += sample.value;
    }
  }
  return total;
}

/** Refuse cyclic lineage graphs before any registration or aggregation use. */
export function detectLineageCycles(edges: readonly MigrationLineageEdge[]): void {
  const adj = new Map<PoolId, PoolId[]>();
  for (const e of edges) {
    if (e.status !== LineageStatus.CONFIRMED) continue;
    const list = adj.get(e.launchPoolId) ?? [];
    list.push(e.migratedPoolId);
    adj.set(e.launchPoolId, list);
  }
  const visiting = new Set<PoolId>();
  const done = new Set<PoolId>();
  const visit = (node: PoolId): void => {
    if (visiting.has(node)) {
      throw new ForesiftError(
        ErrorCode.IDENTITY_MIGRATION_EDGE_CYCLES,
        'migration lineage contains a cycle',
        { poolId: node },
      );
    }
    if (done.has(node)) return;
    visiting.add(node);
    for (const next of adj.get(node) ?? []) visit(next);
    visiting.delete(node);
    done.add(node);
  };
  for (const node of adj.keys()) visit(node);
}
