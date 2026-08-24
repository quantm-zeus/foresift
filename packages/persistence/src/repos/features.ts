/**
 * Feature-value repository (FR-DATA-004): online writes and offline
 * batch recomputation both route through THE shared computation module, so
 * online/offline parity is structural (AC-244 substrate). Values carry the
 * full provenance later lift/lift-claim checks consume.
 */
import {
  FeatureStoreClass,
  ForesiftError,
  ErrorCode,
  qualityCode,
  utcTimestamp,
  type UtcTimestamp,
} from '@foresift/domain';
import type { DatabaseEngine } from '../db.ts';
import {
  ROLLING_VOLUME_CODE_VERSION,
  ROLLING_VOLUME_DEFINITION,
  computeRollingVolume,
  type FeatureComputationEvent,
} from '../feature-computation.ts';

export async function registerFeatureDefinition(
  engine: DatabaseEngine,
  input: {
    definitionId: string;
    name?: string;
    version?: number;
    unitSemantics?: string;
  },
): Promise<void> {
  const name = input.name ?? ROLLING_VOLUME_DEFINITION.name;
  const version = input.version ?? ROLLING_VOLUME_DEFINITION.version;
  const unitSemantics = input.unitSemantics ?? ROLLING_VOLUME_DEFINITION.unitSemantics;
  await engine.query(
    `INSERT INTO feature_definitions (definition_id, name, version, unit_semantics)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (definition_id) DO NOTHING`,
    [input.definitionId, name, version, unitSemantics],
  );
  // Insert-or-verify convention (same as every identity row): an IDENTICAL
  // re-registration is a no-op; any divergence refuses as a typed conflict.
  // Feature values are computed against THE registered semantics — silently
  // keeping the stored row while a caller believes different semantics would
  // corrupt online/offline parity (FR-DATA-004) and the AC-244 provenance.
  const stored = await engine.query<{
    name: string;
    version: number | string;
    unit_semantics: string;
  }>('SELECT name, version, unit_semantics FROM feature_definitions WHERE definition_id = $1', [
    input.definitionId,
  ]);
  const row = stored.rows[0];
  if (row === undefined) {
    throw new ForesiftError(
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      `feature definition ${input.definitionId} vanished between insert and verify`,
      { definitionId: input.definitionId },
    );
  }
  if (row.name !== name) {
    throw new ForesiftError(
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      `feature-definition conflict on feature_definitions.name: stored ${JSON.stringify(row.name)} != incoming ${JSON.stringify(name)}`,
      { definitionId: input.definitionId },
    );
  }
  if (Number(row.version) !== version) {
    throw new ForesiftError(
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      `feature-definition conflict on feature_definitions.version: stored ${String(row.version)} != incoming ${String(version)}`,
      { definitionId: input.definitionId },
    );
  }
  if (row.unit_semantics !== unitSemantics) {
    throw new ForesiftError(
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      `feature-definition conflict on feature_definitions.unit_semantics: stored ${JSON.stringify(row.unit_semantics)} != incoming ${JSON.stringify(unitSemantics)}`,
      { definitionId: input.definitionId },
    );
  }
}

export interface RollingVolumeRequest {
  readonly definitionId: string;
  /** Pool-scoped subject key. */
  readonly subjectKey: string;
  readonly windowStartInclusive: UtcTimestamp;
  readonly windowEndInclusive: UtcTimestamp;
  /** Replay boundary the value is resolved at. */
  readonly resolvedAt: UtcTimestamp;
  /** Population provenance recorded with every value (AC-244). */
  readonly populationKind:
    'FULL_UNIVERSE' | 'DEEP_RESEARCH_SELECTED' | 'CONTROL_GROUP' | 'EXPLORATION_ARM';
}

async function loadComputationEvents(
  engine: DatabaseEngine,
  subjectKey: string,
  windowStartInclusive: UtcTimestamp,
  windowEndInclusive: UtcTimestamp,
): Promise<FeatureComputationEvent[]> {
  const rows = await engine.query<{
    event_at: Date | string;
    available_at: Date | string;
    raw_amount: string | null;
  }>(
    `SELECT event_at, available_at, raw_amount FROM observations
     WHERE subject_pool_id = $1
       AND event_at >= $2 AND event_at <= $3
     ORDER BY event_at, observation_id`,
    [subjectKey, windowStartInclusive, windowEndInclusive],
  );
  return rows.rows.map((r) => ({
    eventAt: utcTimestamp(toIso(r.event_at)),
    availableAt: utcTimestamp(toIso(r.available_at)),
    rawAmount: r.raw_amount,
  }));
}

function toIso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString().replace('.000Z', 'Z');
}

async function writeComputedValue(
  engine: DatabaseEngine,
  storeClass: FeatureStoreClass,
  request: RollingVolumeRequest,
): Promise<{ decimalString: string | null; qualityCodes: readonly string[] }> {
  const events = await loadComputationEvents(
    engine,
    request.subjectKey,
    request.windowStartInclusive,
    request.windowEndInclusive,
  );
  const computed = computeRollingVolume({
    windowStartInclusive: request.windowStartInclusive,
    windowEndInclusive: request.windowEndInclusive,
    resolvedAt: request.resolvedAt,
    events,
  });
  const lineageRef = `observations:${request.subjectKey}:${request.windowStartInclusive}/${request.windowEndInclusive}@${request.resolvedAt}`;
  await engine.query(
    `INSERT INTO feature_values (
       value_id, definition_id, feature_version, computation_code_version,
       subject_key, event_at, decimal_string, scale, quality_codes,
       population_kind, lineage_refs, store_class)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (definition_id, feature_version, store_class, subject_key, event_at)
     DO UPDATE SET decimal_string = EXCLUDED.decimal_string,
       scale = EXCLUDED.scale,
       quality_codes = EXCLUDED.quality_codes,
       computation_code_version = EXCLUDED.computation_code_version,
       population_kind = EXCLUDED.population_kind,
       lineage_refs = EXCLUDED.lineage_refs`,
    [
      `fv:${request.definitionId}:${storeClass}:${request.subjectKey}:${request.windowEndInclusive}`,
      request.definitionId,
      ROLLING_VOLUME_DEFINITION.version,
      ROLLING_VOLUME_CODE_VERSION,
      request.subjectKey,
      request.windowEndInclusive,
      computed.decimalString,
      // A null value stores a null scale — quantity pairs stay complete.
      computed.decimalString === null ? null : computed.scale,
      computed.qualityCodes.map((c) => qualityCode(c)),
      request.populationKind,
      [lineageRef],
      storeClass,
    ],
  );
  return { decimalString: computed.decimalString, qualityCodes: computed.qualityCodes };
}

/** Online path — same shared computation as offline, by construction. */
export function writeOnlineRollingVolume(
  engine: DatabaseEngine,
  request: RollingVolumeRequest,
): Promise<{ decimalString: string | null; qualityCodes: readonly string[] }> {
  return writeComputedValue(engine, FeatureStoreClass.ONLINE, request);
}

/** Offline batch recomputation over identical inputs and THE same module. */
export function recomputeOfflineRollingVolume(
  engine: DatabaseEngine,
  request: RollingVolumeRequest,
): Promise<{ decimalString: string | null; qualityCodes: readonly string[] }> {
  return writeComputedValue(engine, FeatureStoreClass.OFFLINE, request);
}

/** Declared tolerance for online/offline parity: exact (deterministic math). */
export const PARITY_TOLERANCE = 0n;

/** Sentinel divergence for incomparable values (null vs non-null). */
const INCOMPARABLE_DIVERGENCE = 1n << 96n;

export interface ParityResult {
  readonly online: string | null;
  readonly offline: string | null;
  readonly divergence: bigint;
  readonly withinTolerance: boolean;
}

/**
 * Online/offline parity check (FR-DATA-004). Reads BOTH stored values and
 * compares exactly; a divergence beyond tolerance fails loudly with the diff
 * rather than being silently tolerated. A computation_code_version mismatch
 * between the two stored values also counts as divergence.
 */
export async function checkOnlineOfflineParity(
  engine: DatabaseEngine,
  request: Pick<RollingVolumeRequest, 'definitionId' | 'subjectKey' | 'windowEndInclusive'>,
): Promise<ParityResult> {
  const rows = await engine.query<{
    store_class: string;
    decimal_string: string | null;
    computation_code_version: string;
  }>(
    `SELECT store_class, decimal_string, computation_code_version FROM feature_values
     WHERE definition_id = $1 AND subject_key = $2 AND event_at = $3`,
    [request.definitionId, request.subjectKey, request.windowEndInclusive],
  );
  const online = rows.rows.find((r) => r.store_class === FeatureStoreClass.ONLINE);
  const offline = rows.rows.find((r) => r.store_class === FeatureStoreClass.OFFLINE);
  if (online === undefined || offline === undefined) {
    throw new ForesiftError(
      ErrorCode.FEATURE_ONLINE_OFFLINE_DIVERGENCE,
      'parity requires both an ONLINE and an OFFLINE value for the same coordinates',
      { online: online !== undefined, offline: offline !== undefined },
    );
  }
  const divergence =
    online.decimal_string === null || offline.decimal_string === null
      ? online.decimal_string === offline.decimal_string
        ? 0n
        : INCOMPARABLE_DIVERGENCE // incomparable absence is maximal divergence
      : BigInt(online.decimal_string) > BigInt(offline.decimal_string)
        ? BigInt(online.decimal_string) - BigInt(offline.decimal_string)
        : BigInt(offline.decimal_string) - BigInt(online.decimal_string);
  const codeMismatch =
    JSON.stringify({ o: online.computation_code_version }) !==
    JSON.stringify({ o: offline.computation_code_version });
  if (divergence > PARITY_TOLERANCE || codeMismatch) {
    throw new ForesiftError(
      ErrorCode.FEATURE_ONLINE_OFFLINE_DIVERGENCE,
      `online/offline divergence ${divergence} exceeds tolerance ${PARITY_TOLERANCE}`,
      {
        online: online.decimal_string,
        offline: offline.decimal_string,
        diff:
          online.decimal_string === null || offline.decimal_string === null
            ? 'null mismatch'
            : String(BigInt(online.decimal_string) - BigInt(offline.decimal_string)),
        codeVersions: `${online.computation_code_version} vs ${offline.computation_code_version}`,
      },
    );
  }
  return {
    online: online.decimal_string,
    offline: offline.decimal_string,
    divergence,
    withinTolerance: true,
  };
}
