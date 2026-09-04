import {
  SystemAddressReviewState,
  isExcludableSystemAddress,
  SYSTEM_ADDRESS_EXCLUSION_MIN_CONFIDENCE,
} from '@foresift/domain';
import { canonicalJson, sha256Text, type DatabaseEngine } from '@foresift/persistence';
import {
  parseSolsecSchema,
  type SystemAddressExclusionApplied,
  type SystemAddressRegistryEntry,
} from '@foresift/shared-schemas';

/**
 * Versioned system-address registry (Appendix Q.2, FR-SOLSEC-006, AC-132).
 *
 * Registry persistence plus point-in-time exclusion queries. `decideExclusion`
 * produces `system_address_exclusions_applied` audit rows for BOTH applied
 * exclusions and refusals — raw flow references are always preserved. A
 * refusal (low confidence / pending review / rejected / unknown role) degrades
 * quality codes to `SYSTEM_ADDRESS_UNCERTAIN` instead of silently removing
 * evidence. Registry revisions never rewrite historical attribution inputs
 * (§37.3): rows are insert-only, keyed by version, and point-in-time queries
 * resolve against the validity interval containing T.
 */
export const SYSTEM_REGISTRY_POLICY_VERSION = 'solsec-system-registry@1';

/** Quality code attached when a registry candidate cannot justify exclusion. */
export const SYSTEM_ADDRESS_UNCERTAIN = 'SYSTEM_ADDRESS_UNCERTAIN' as const;

function requireTimestamp(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new RangeError(`${field} must be a parseable timestamp`);
  return parsed;
}

function requireRawFlowRef(rawFlowRef: string): string {
  if (!/^sha256:[0-9a-f]{64}$/.test(rawFlowRef))
    throw new RangeError('rawFlowRef must be a sha256:<64 hex> reference');
  return rawFlowRef;
}

/**
 * Point-in-time validity: the registry entry's interval must contain T
 * (inclusive on both bounds, matching the point-in-time index).
 */
export function isValidAt(entry: SystemAddressRegistryEntry, queryAt: string): boolean {
  const t = requireTimestamp(queryAt, 'queryAt');
  const from = requireTimestamp(entry.validFrom, 'validFrom');
  if (entry.validUntil === null) return t >= from;
  const until = requireTimestamp(entry.validUntil, 'validUntil');
  return t >= from && t <= until;
}

export type ExclusionDecisionClass =
  | 'EXCLUSION_APPLIED'
  | 'REFUSAL_SUB_FLOOR_CONFIDENCE'
  | 'REFUSAL_PENDING_REVIEW'
  | 'REFUSAL_REJECTED'
  | 'REFUSAL_UNKNOWN_ROLE'
  | 'REFUSAL_OUTSIDE_VALIDITY';

export interface ExclusionDecision {
  readonly decision: ExclusionDecisionClass;
  /** True only when the account may leave actor-attribution features. */
  readonly excluded: boolean;
  /** Degraded quality codes carried by the audit row (refusals degrade). */
  readonly qualityCodes: readonly ('VALID' | typeof SYSTEM_ADDRESS_UNCERTAIN)[];
}

/**
 * Pure exclusion decision for one registry candidate at time T. Fail-closed:
 * only reviewed, floor-confidence (>= 0.8), known infrastructure roles whose
 * validity interval contains T are excludable; every other case is a refusal
 * that keeps the evidence and degrades quality to SYSTEM_ADDRESS_UNCERTAIN.
 */
export function classifyExclusion(
  entry: SystemAddressRegistryEntry,
  queryAt: string,
): ExclusionDecision {
  if (!isValidAt(entry, queryAt))
    return {
      decision: 'REFUSAL_OUTSIDE_VALIDITY',
      excluded: false,
      qualityCodes: [SYSTEM_ADDRESS_UNCERTAIN],
    };
  if (isExcludableSystemAddress(entry.role, entry.confidence, entry.reviewState))
    return { decision: 'EXCLUSION_APPLIED', excluded: true, qualityCodes: ['VALID'] };
  let reason: ExclusionDecisionClass;
  if (entry.reviewState === SystemAddressReviewState.PENDING_REVIEW)
    reason = 'REFUSAL_PENDING_REVIEW';
  else if (entry.reviewState === SystemAddressReviewState.REJECTED) reason = 'REFUSAL_REJECTED';
  else if (entry.confidence < SYSTEM_ADDRESS_EXCLUSION_MIN_CONFIDENCE)
    reason = 'REFUSAL_SUB_FLOOR_CONFIDENCE';
  else reason = 'REFUSAL_UNKNOWN_ROLE';
  return { decision: reason, excluded: false, qualityCodes: [SYSTEM_ADDRESS_UNCERTAIN] };
}

export interface ExclusionDecisionInput {
  readonly entry: SystemAddressRegistryEntry;
  readonly economicEventId: string;
  readonly rawFlowRef: string;
  readonly queryAt: string;
  /** Audit-row timestamp; defaults to queryAt. */
  readonly appliedAt?: string;
}

/**
 * Builds the audit row for one decision. Both exclusions and refusals are
 * recorded; the raw flow reference is preserved verbatim either way.
 */
export function decideExclusion(input: ExclusionDecisionInput): SystemAddressExclusionApplied {
  requireTimestamp(input.queryAt, 'queryAt');
  const appliedAt = input.appliedAt ?? input.queryAt;
  requireTimestamp(appliedAt, 'appliedAt');
  requireRawFlowRef(input.rawFlowRef);
  if (input.economicEventId.trim().length === 0)
    throw new RangeError('economicEventId must be non-empty');
  const classified = classifyExclusion(input.entry, input.queryAt);
  return parseSolsecSchema('SystemAddressExclusionApplied', {
    exclusionId: `excl:${sha256Text(
      canonicalJson({
        registryEntryId: input.entry.registryEntryId,
        economicEventId: input.economicEventId,
        registryVersion: input.entry.registryVersion,
        queryAt: input.queryAt,
        rawFlowRef: input.rawFlowRef,
      }),
    )}`,
    registryEntryId: input.entry.registryEntryId,
    economicEventId: input.economicEventId,
    excluded: classified.excluded,
    rawFlowRef: input.rawFlowRef,
    appliedAt,
    registryVersion: input.entry.registryVersion,
    qualityCodes: classified.qualityCodes,
  });
}

/** Creates the registry tables if a migration has not already done so. */
export async function ensureSystemRegistryTables(engine: DatabaseEngine): Promise<void> {
  await engine.exec(`
    CREATE TABLE IF NOT EXISTS system_address_registry (
      registry_entry_id text PRIMARY KEY,
      chain_id text NOT NULL,
      address text NOT NULL,
      role text NOT NULL,
      valid_from timestamptz NOT NULL,
      valid_until timestamptz,
      source_id text NOT NULL,
      confidence double precision NOT NULL,
      review_state text NOT NULL,
      registry_version integer NOT NULL,
      evidence_ids text[] NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS system_address_registry_point_in_time_idx
      ON system_address_registry (chain_id, address, valid_from, valid_until);
    CREATE TABLE IF NOT EXISTS system_address_exclusions_applied (
      exclusion_id text PRIMARY KEY,
      registry_entry_id text NOT NULL,
      economic_event_id text NOT NULL,
      excluded boolean NOT NULL,
      raw_flow_ref text NOT NULL,
      applied_at timestamptz NOT NULL,
      registry_version integer NOT NULL,
      quality_codes text[] NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS system_address_exclusions_event_idx
      ON system_address_exclusions_applied (economic_event_id, applied_at);
  `);
}

/** Persists one registry entry; insert-only, never rewrites prior revisions. */
export async function recordRegistryEntry(
  engine: DatabaseEngine,
  entry: SystemAddressRegistryEntry,
): Promise<SystemAddressRegistryEntry> {
  const parsed = parseSolsecSchema('SystemAddressRegistryEntry', entry);
  await engine.query(
    `INSERT INTO system_address_registry (
       registry_entry_id, chain_id, address, role, valid_from, valid_until,
       source_id, confidence, review_state, registry_version, evidence_ids)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      parsed.registryEntryId,
      parsed.chainId,
      parsed.address,
      parsed.role,
      parsed.validFrom,
      parsed.validUntil,
      parsed.sourceId,
      parsed.confidence,
      parsed.reviewState,
      parsed.registryVersion,
      parsed.evidenceIds,
    ],
  );
  return parsed;
}

export interface RegistryPointInTimeQuery {
  readonly chainId: string;
  readonly address: string;
  /** Query timestamp T; the validity interval of the resolved row contains T. */
  readonly queryAt: string;
}

/**
 * Resolves the registry row whose validity interval contains T (latest
 * valid_from first). Returns null when no row covers T — absence is
 * preserved, never silently treated as exclusion or as negative evidence.
 */
export async function resolveRegistryEntryAt(
  engine: DatabaseEngine,
  query: RegistryPointInTimeQuery,
): Promise<SystemAddressRegistryEntry | null> {
  requireTimestamp(query.queryAt, 'queryAt');
  const rows = await engine.query<Record<string, unknown>>(
    `SELECT registry_entry_id, chain_id, address, role, valid_from, valid_until,
            source_id, confidence, review_state, registry_version, evidence_ids
       FROM system_address_registry
      WHERE chain_id = $1 AND address = $2
        AND valid_from <= $3 AND (valid_until IS NULL OR valid_until >= $3)
      ORDER BY valid_from DESC, registry_version DESC
      LIMIT 1`,
    [
      query.chainId,
      query.address,
      new Date(requireTimestamp(query.queryAt, 'queryAt')).toISOString(),
    ],
  );
  const row = rows.rows[0];
  if (row === undefined) return null;
  return parseSolsecSchema('SystemAddressRegistryEntry', {
    registryEntryId: row.registry_entry_id,
    chainId: row.chain_id,
    address: row.address,
    role: row.role,
    validFrom: new Date(row.valid_from as string).toISOString(),
    validUntil: row.valid_until === null ? null : new Date(row.valid_until as string).toISOString(),
    sourceId: row.source_id,
    confidence: row.confidence,
    reviewState: row.review_state,
    registryVersion: row.registry_version,
    evidenceIds: row.evidence_ids,
  });
}

/** Persists one exclusion/refusal audit row (see decideExclusion). */
export async function recordExclusionApplied(
  engine: DatabaseEngine,
  row: SystemAddressExclusionApplied,
): Promise<SystemAddressExclusionApplied> {
  const parsed = parseSolsecSchema('SystemAddressExclusionApplied', row);
  await engine.query(
    `INSERT INTO system_address_exclusions_applied (
       exclusion_id, registry_entry_id, economic_event_id, excluded,
       raw_flow_ref, applied_at, registry_version, quality_codes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      parsed.exclusionId,
      parsed.registryEntryId,
      parsed.economicEventId,
      parsed.excluded,
      parsed.rawFlowRef,
      parsed.appliedAt,
      parsed.registryVersion,
      parsed.qualityCodes,
    ],
  );
  return parsed;
}

export interface ExclusionResolution {
  /** Audit row for the decision (exclusion or refusal) that was persisted. */
  readonly applied: SystemAddressExclusionApplied;
  /** True when the account is excluded from actor-attribution features. */
  readonly excluded: boolean;
  /** The registry entry version the decision was made against. */
  readonly registryVersion: number;
}

/**
 * Point-in-time decide-and-record: resolves the entry covering T, decides,
 * and persists the audit row. When no registry row covers T the account is
 * NOT excluded; the caller receives no row (no entry exists to reference)
 * and must treat the account as uncertified infrastructure evidence.
 */
export async function resolveAndRecordExclusion(
  engine: DatabaseEngine,
  input: Omit<ExclusionDecisionInput, 'entry'> & {
    readonly entry?: SystemAddressRegistryEntry;
  },
): Promise<ExclusionResolution | null> {
  const entry =
    input.entry ??
    (await resolveRegistryEntryAt(engine, {
      chainId: (input as { chainId?: string }).chainId ?? '',
      address: (input as { address?: string }).address ?? '',
      queryAt: input.queryAt,
    }));
  if (entry === null) return null;
  const applied = decideExclusion({ ...input, entry });
  await recordExclusionApplied(engine, applied);
  return {
    applied,
    excluded: applied.excluded,
    registryVersion: entry.registryVersion,
  };
}

/**
 * Registry-backed exclusion set for the normalizer context seam:
 * `EconomicTradeContext.knownRouterAccounts` (consumed, not rewritten). The
 * returned accounts have PASSED the exclusion floor at queryAt; feeding them
 * as router context lets the normalizer attribute flows through them without
 * degrading actor quality. Refused candidates are never returned — they keep
 * their evidence and degrade quality codes at the consumer.
 */
export async function registryExclusionSet(
  engine: DatabaseEngine,
  chainId: string,
  queryAt: string,
): Promise<readonly string[]> {
  requireTimestamp(queryAt, 'queryAt');
  const rows = await engine.query<{ address: string }>(
    `SELECT address
       FROM system_address_registry
      WHERE chain_id = $1
        AND valid_from <= $2 AND (valid_until IS NULL OR valid_until >= $2)
        AND role <> 'UNKNOWN_INFRASTRUCTURE'
        AND review_state = 'REVIEWED'
        AND confidence >= $3`,
    [
      chainId,
      new Date(requireTimestamp(queryAt, 'queryAt')).toISOString(),
      SYSTEM_ADDRESS_EXCLUSION_MIN_CONFIDENCE,
    ],
  );
  return [...new Set(rows.rows.map((row) => row.address))].sort();
}
