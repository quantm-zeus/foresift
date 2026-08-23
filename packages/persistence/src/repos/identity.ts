/**
 * Identity repository (FR-DATA-001): insert-only writes for chains, dexes,
 * asset representations, verified-equivalence memberships, pools, pairs,
 * launches, and migration edges — plus the decimals resolution state machine
 * (sourced → cross-checked → conflicting, versioned by observations).
 *
 * Identity rows are never updated or deleted; the only mutable columns in
 * this repository are the decimals resolution fields on representations,
 * which advance strictly through observation-derived states.
 */
import {
  DecimalsResolutionState,
  ErrorCode,
  ForesiftError,
  LineageStatus,
  assertVerifiedEquivalence,
  chainIdentity,
  composePoolId,
  detectLineageCycles,
  utcTimestamp,
  type ChainIdentity,
  type ChainMappingQuality,
  type DecimalsResolutionState as DecimalsState,
  type MigrationLineageEdge,
  type PoolId,
  type PoolKey,
  type UtcTimestamp,
  type VerifiedEquivalence,
} from '@foresift/domain';
import type { DatabaseEngine } from '../db.ts';

export interface IdentityWriteResult {
  readonly inserted: boolean;
}

async function insertOrVerify(
  engine: DatabaseEngine,
  table: string,
  conflictTarget: string,
  columns: readonly string[],
  values: readonly unknown[],
  conflictColumns: readonly string[],
): Promise<IdentityWriteResult> {
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const conflictValues = conflictColumns.map((col) => {
    const valueIndex = columns.indexOf(col);
    const raw = valueIndex === -1 ? undefined : values[valueIndex];
    return raw === undefined ? null : raw;
  });
  const existing = await engine.query<Record<string, unknown>>(
    `SELECT * FROM ${table} WHERE (${conflictTarget}) = (${conflictColumns
      .map((_, i) => `$${i + 1}`)
      .join(', ')})`,
    conflictValues,
  );
  if (existing.rows.length > 0) {
    // Insert-only semantics: an identical row is a no-op, any difference refuses.
    const row = existing.rows[0];
    if (row === undefined) throw new Error('unreachable');
    for (let i = 0; i < columns.length; i += 1) {
      const col = columns[i];
      if (col === undefined) continue;
      // Compare on comparable ground: instants by epoch ms (either side may
      // arrive as ISO string or a driver Date), undefined collapsed onto NULL,
      // everything else by its own value.
      const comparable = (value: unknown): unknown => {
        if (value === null || value === undefined) return null;
        if (value instanceof Date) return value.getTime();
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
          return Date.parse(value);
        }
        return value;
      };
      const normalized = comparable(values[i]);
      const storedNormalized = comparable(row[col]);
      if (normalized !== storedNormalized) {
        throw new ForesiftError(
          ErrorCode.CONTRACT_INVARIANT_VIOLATED,
          `identity conflict on ${table}.${String(col)}: stored ${JSON.stringify(storedNormalized)} != incoming ${JSON.stringify(normalized)}`,
          { table, column: String(col) },
        );
      }
    }
    return { inserted: false };
  }
  await engine.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
    values.map((v) => (v === undefined ? null : v)),
  );
  return { inserted: true };
}

export async function insertChain(
  engine: DatabaseEngine,
  identity: ChainIdentity,
): Promise<IdentityWriteResult> {
  return insertOrVerify(
    engine,
    'chains',
    'chain_id',
    ['chain_id', 'namespace', 'reference', 'mapping_quality', 'internal_id_version'],
    [
      identity.chainId,
      identity.namespace,
      identity.reference,
      identity.mappingQuality,
      identity.internalIdVersion,
    ],
    ['chain_id'],
  );
}

/** Resolve-or-create chain identity from a raw id (deriving mapping quality). */
export async function ensureChain(
  engine: DatabaseEngine,
  chainId: string,
  internalIdVersion?: number,
): Promise<ChainIdentity> {
  const identity = chainIdentity(
    internalIdVersion === undefined ? { chainId } : { chainId, internalIdVersion },
  );
  await insertChain(engine, identity);
  return identity;
}

export async function insertDex(
  engine: DatabaseEngine,
  chainId: string,
  dexId: string,
): Promise<IdentityWriteResult> {
  return insertOrVerify(
    engine,
    'dexes',
    '(chain_id, dex_id)',
    ['chain_id', 'dex_id'],
    [chainId, dexId],
    ['chain_id', 'dex_id'],
  );
}

export interface RepresentationInput {
  readonly chainId: string;
  readonly canonicalAddress: string;
  readonly decimalsState?: DecimalsState;
}

export async function insertRepresentation(
  engine: DatabaseEngine,
  input: RepresentationInput,
): Promise<IdentityWriteResult> {
  return insertOrVerify(
    engine,
    'asset_representations',
    '(chain_id, canonical_address)',
    ['chain_id', 'canonical_address', 'decimals_state'],
    [input.chainId, input.canonicalAddress, input.decimalsState ?? DecimalsResolutionState.SOURCED],
    ['chain_id', 'canonical_address'],
  );
}

export async function createAsset(
  engine: DatabaseEngine,
  assetId: string,
): Promise<IdentityWriteResult> {
  return insertOrVerify(engine, 'assets', 'asset_id', ['asset_id'], [assetId], ['asset_id']);
}

export interface MembershipInput {
  readonly assetId: string;
  readonly chainId: string;
  readonly canonicalAddress: string;
  readonly verification: VerifiedEquivalence;
}

/**
 * Attach a representation to an asset grouping. Equivalence MUST be verified
 * — heuristic merges are refused at this boundary before the CHECK even runs.
 */
export async function attachMembership(
  engine: DatabaseEngine,
  input: MembershipInput,
): Promise<IdentityWriteResult> {
  assertVerifiedEquivalence(input.verification);
  await engine.query(
    `INSERT INTO asset_memberships (asset_id, chain_id, canonical_address, verification)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (chain_id, canonical_address) DO NOTHING`,
    [input.assetId, input.chainId, input.canonicalAddress, input.verification],
  );
  return { inserted: true };
}

export async function insertPool(engine: DatabaseEngine, key: PoolKey): Promise<PoolId> {
  const poolId = composePoolId(key);
  await insertOrVerify(
    engine,
    'pools',
    'pool_id',
    ['pool_id', 'chain_id', 'dex_id', 'pool_address'],
    [poolId, key.chainId, key.dexId, key.poolAddress],
    ['pool_id'],
  );
  return poolId;
}

export interface PairInput {
  readonly pairId: string;
  readonly poolId: string;
  readonly baseAssetId: string;
  readonly quoteAssetId: string;
  readonly orientationUnverified?: boolean;
}

export async function recordPair(
  engine: DatabaseEngine,
  input: PairInput,
): Promise<IdentityWriteResult> {
  return insertOrVerify(
    engine,
    'pairs',
    'pair_id',
    ['pair_id', 'pool_id', 'base_asset_id', 'quote_asset_id', 'orientation_unverified'],
    [
      input.pairId,
      input.poolId,
      input.baseAssetId,
      input.quoteAssetId,
      input.orientationUnverified ?? false,
    ],
    ['pair_id'],
  );
}

export async function registerLaunch(
  engine: DatabaseEngine,
  input: { launchId: string; poolId: string; launchedAt?: UtcTimestamp; sourceRef: string },
): Promise<IdentityWriteResult> {
  return insertOrVerify(
    engine,
    'launches',
    'launch_id',
    ['launch_id', 'pool_id', 'launched_at', 'source_ref'],
    [input.launchId, input.poolId, input.launchedAt, input.sourceRef],
    ['launch_id'],
  );
}

// --- Migration lineage -------------------------------------------------------

export async function registerMigrationEdge(
  engine: DatabaseEngine,
  edge: MigrationLineageEdge,
): Promise<IdentityWriteResult> {
  if (edge.status === LineageStatus.AMBIGUOUS && edge.migratedAt !== undefined) {
    throw new ForesiftError(
      ErrorCode.IDENTITY_MIGRATION_EDGE_AMBIGUOUS,
      'ambiguous migration edges must not assert a boundary time',
      { migrationId: edge.migrationId },
    );
  }
  // Cycle refusal covers existing confirmed edges plus the candidate.
  const existing = await engine.query<{ launch_pool_id: string; migrated_pool_id: string }>(
    `SELECT launch_pool_id, migrated_pool_id FROM migration_edges WHERE status = 'CONFIRMED'`,
  );
  const graph: MigrationLineageEdge[] = existing.rows.map((r) => ({
    migrationId:
      `existing:${r.launch_pool_id}->${r.migrated_pool_id}` as MigrationLineageEdge['migrationId'],
    launchPoolId: r.launch_pool_id as PoolId,
    migratedPoolId: r.migrated_pool_id as PoolId,
    status: LineageStatus.CONFIRMED,
  }));
  detectLineageCycles([...graph, edge]);

  return insertOrVerify(
    engine,
    'migration_edges',
    'migration_id',
    ['migration_id', 'launch_pool_id', 'migrated_pool_id', 'status', 'migrated_at'],
    [edge.migrationId, edge.launchPoolId, edge.migratedPoolId, edge.status, edge.migratedAt],
    ['migration_id'],
  );
}

// --- Decimals resolution state machine --------------------------------------

export interface DecimalsObservationInput {
  readonly observationId: string;
  readonly chainId: string;
  readonly canonicalAddress: string;
  readonly decimals: number;
  readonly observedAt: UtcTimestamp;
  readonly sourceRef: string;
}

/**
 * Record one decimals observation and re-derive the representation's state:
 * - disagreement among distinct values at the newest instant → CONFLICTING;
 * - the latest value endorsed by ≥2 distinct sources (over all time) →
 *   CROSS_CHECKED;
 * - a lone latest value contradicted by an independent source that never
 *   endorsed it → CONFLICTING (explicitly unusable, never guessed);
 * - otherwise SOURCED (single source, possibly self-correcting).
 */
export async function recordDecimalsObservation(
  engine: DatabaseEngine,
  input: DecimalsObservationInput,
): Promise<{ state: DecimalsState; decimals: number | null }> {
  await engine.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO token_decimal_observations
         (observation_id, chain_id, canonical_address, decimals, state, observed_at, source_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.observationId,
        input.chainId,
        input.canonicalAddress,
        input.decimals,
        DecimalsResolutionState.SOURCED,
        input.observedAt,
        input.sourceRef,
      ],
    );

    const rows = await tx.query<{
      decimals: number;
      source_ref: string;
      observed_at: Date | string;
    }>(
      `SELECT decimals, source_ref, observed_at
       FROM token_decimal_observations
       WHERE chain_id = $1 AND canonical_address = $2`,
      [input.chainId, input.canonicalAddress],
    );
    const history = rows.rows.map((r) => ({
      decimals: Number(r.decimals),
      sourceRef: r.source_ref,
      at: typeof r.observed_at === 'string' ? Date.parse(r.observed_at) : r.observed_at.getTime(),
    }));
    if (history.length === 0) throw new Error('unreachable: observation just inserted');
    const newestAt = Math.max(...history.map((h) => h.at));
    const newestValues = new Set(history.filter((h) => h.at === newestAt).map((h) => h.decimals));

    let state: DecimalsState;
    let resolvedDecimals: number | null;
    if (newestValues.size > 1) {
      state = DecimalsResolutionState.CONFLICTING;
      resolvedDecimals = null; // conflicting ⇒ explicitly unusable, never guessed
    } else {
      const latest = [...newestValues][0];
      if (latest === undefined) throw new Error('unreachable: newest-value set empty');
      // Support counts across the full history: two independent sources that
      // ever reported the current value make it cross-checked.
      const supporters = new Set(
        history.filter((h) => h.decimals === latest).map((h) => h.sourceRef),
      );
      const unendorsedDissent = history.some(
        (h) => h.decimals !== latest && !supporters.has(h.sourceRef),
      );
      if (supporters.size >= 2) {
        state = DecimalsResolutionState.CROSS_CHECKED;
        resolvedDecimals = latest;
      } else if (unendorsedDissent) {
        // A dissenting independent source stands until independently answered.
        state = DecimalsResolutionState.CONFLICTING;
        resolvedDecimals = null;
      } else {
        state = DecimalsResolutionState.SOURCED;
        resolvedDecimals = latest;
      }
    }

    await tx.query(
      `UPDATE asset_representations SET decimals_state = $1, decimals = $2
       WHERE chain_id = $3 AND canonical_address = $4`,
      [state, resolvedDecimals, input.chainId, input.canonicalAddress],
    );
  });

  const row = await engine.query<{ decimals_state: string; decimals: number | null }>(
    `SELECT decimals_state, decimals FROM asset_representations
     WHERE chain_id = $1 AND canonical_address = $2`,
    [input.chainId, input.canonicalAddress],
  );
  const state = row.rows[0]?.decimals_state;
  if (state === undefined) throw new Error('representation missing after decimals observation');
  return { state: state as DecimalsState, decimals: row.rows[0]?.decimals ?? null };
}

export interface IdentitySnapshot {
  readonly chainId: string;
  readonly mappingQuality: ChainMappingQuality;
  readonly decimalsState: string | null;
  readonly decimals: number | null;
}

export async function loadRepresentation(
  engine: DatabaseEngine,
  chainId: string,
  canonicalAddress: string,
): Promise<IdentitySnapshot | null> {
  const row = await engine.query<{
    chain_id: string;
    mapping_quality: ChainMappingQuality;
    decimals_state: string | null;
    decimals: number | null;
  }>(
    `SELECT r.chain_id, c.mapping_quality, r.decimals_state, r.decimals
     FROM asset_representations r JOIN chains c ON c.chain_id = r.chain_id
     WHERE r.chain_id = $1 AND r.canonical_address = $2`,
    [chainId, canonicalAddress],
  );
  const r = row.rows[0];
  if (r === undefined) return null;
  return {
    chainId: r.chain_id,
    mappingQuality: r.mapping_quality,
    decimalsState: r.decimals_state,
    decimals: r.decimals,
  };
}

/** Confirmed boundary times out of a pool, for lineage-aware aggregation. */
export async function confirmedMigrationBoundaries(
  engine: DatabaseEngine,
  poolId: string,
): Promise<readonly UtcTimestamp[]> {
  const rows = await engine.query<{ migrated_at: string }>(
    `SELECT migrated_at FROM migration_edges
     WHERE launch_pool_id = $1 AND status = 'CONFIRMED' AND migrated_at IS NOT NULL`,
    [poolId],
  );
  return rows.rows.map((r) =>
    utcTimestamp(new Date(r.migrated_at).toISOString().replace('.000Z', 'Z')),
  );
}
