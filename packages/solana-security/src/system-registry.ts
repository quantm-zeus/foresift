import {
  isExcludableSystemAddress,
  SystemAddressReviewState,
  SystemAddressRole,
} from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import {
  parseSolsecSchema,
  type SystemAddressExclusionApplied,
  type SystemAddressRegistryEntry,
} from '@foresift/shared-schemas';

export async function recordSystemAddressRegistryEntry(
  engine: DatabaseEngine,
  input: SystemAddressRegistryEntry,
): Promise<SystemAddressRegistryEntry> {
  const entry = parseSolsecSchema('SystemAddressRegistryEntry', input);
  await engine.query(
    `INSERT INTO system_address_registry (
       registry_entry_id, chain_id, address, role, valid_from, valid_until,
       source_id, confidence, review_state, registry_version, evidence_ids)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      entry.registryEntryId,
      entry.chainId,
      entry.address,
      entry.role,
      entry.validFrom,
      entry.validUntil,
      entry.sourceId,
      entry.confidence,
      entry.reviewState,
      entry.registryVersion,
      entry.evidenceIds,
    ],
  );
  return entry;
}

export const persistSystemAddressRegistryEntry = recordSystemAddressRegistryEntry;

interface RegistryRow {
  registry_entry_id: string;
  chain_id: string;
  address: string;
  role: SystemAddressRegistryEntry['role'];
  valid_from: string;
  valid_until: string | null;
  source_id: string;
  confidence: number | string;
  review_state: SystemAddressRegistryEntry['reviewState'];
  registry_version: number;
  evidence_ids: string[];
}

function fromRow(row: RegistryRow): SystemAddressRegistryEntry {
  return parseSolsecSchema('SystemAddressRegistryEntry', {
    registryEntryId: row.registry_entry_id,
    chainId: row.chain_id,
    address: row.address,
    role: row.role,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    sourceId: row.source_id,
    confidence: Number(row.confidence),
    reviewState: row.review_state,
    registryVersion: row.registry_version,
    evidenceIds: row.evidence_ids,
  });
}

export interface RegistryPointInTimeQuery {
  readonly chainId: string;
  readonly at: string;
  readonly addresses?: readonly string[];
  /** Frozen decisions pass their recorded version to prevent revision-forward rewrites. */
  readonly maximumRegistryVersion?: number;
}

/** Resolve the newest applicable row per address over a half-open [from, until) interval. */
export async function resolveSystemRegistryAt(
  engine: DatabaseEngine,
  query: RegistryPointInTimeQuery,
): Promise<readonly SystemAddressRegistryEntry[]> {
  if (!Number.isFinite(Date.parse(query.at))) throw new RangeError('at must be a valid timestamp');
  if (
    query.maximumRegistryVersion !== undefined &&
    (!Number.isInteger(query.maximumRegistryVersion) || query.maximumRegistryVersion < 1)
  ) {
    throw new RangeError('maximumRegistryVersion must be a positive integer');
  }
  if (query.addresses?.length === 0) return [];
  const result = await engine.query<RegistryRow>(
    `SELECT registry_entry_id, chain_id, address, role, valid_from, valid_until,
            source_id, confidence, review_state, registry_version, evidence_ids
       FROM system_address_registry
      WHERE chain_id = $1
        AND valid_from <= $2
        AND (valid_until IS NULL OR $2 < valid_until)
        AND ($3::integer IS NULL OR registry_version <= $3)
        AND ($4::text[] IS NULL OR address = ANY($4))
      ORDER BY address ASC, registry_version DESC, valid_from DESC, registry_entry_id ASC`,
    [
      query.chainId,
      query.at,
      query.maximumRegistryVersion ?? null,
      query.addresses === undefined ? null : [...new Set(query.addresses)],
    ],
  );
  const seen = new Set<string>();
  const entries: SystemAddressRegistryEntry[] = [];
  for (const row of result.rows) {
    if (seen.has(row.address)) continue;
    seen.add(row.address);
    entries.push(fromRow(row));
  }
  return entries;
}

export type SystemAddressExclusionDecision =
  | 'EXCLUSION_APPLIED'
  | 'REFUSAL_SUB_FLOOR_CONFIDENCE'
  | 'REFUSAL_PENDING_REVIEW'
  | 'REFUSAL_REJECTED'
  | 'REFUSAL_UNKNOWN_ROLE';

export interface DecideExclusionInput {
  readonly entry: SystemAddressRegistryEntry;
  readonly economicEventId: string;
  readonly rawFlowRef: string;
  readonly appliedAt: string;
  readonly exclusionId?: string;
}

export interface ExclusionDecisionResult {
  readonly decision: SystemAddressExclusionDecision;
  readonly row: SystemAddressExclusionApplied;
}

/** Build an auditable row for both exclusions and refusals; never mutates the raw flow. */
export function decideExclusion(input: DecideExclusionInput): ExclusionDecisionResult {
  const entry = parseSolsecSchema('SystemAddressRegistryEntry', input.entry);
  let decision: SystemAddressExclusionDecision;
  if (entry.role === SystemAddressRole.UNKNOWN_INFRASTRUCTURE) {
    decision = 'REFUSAL_UNKNOWN_ROLE';
  } else if (entry.reviewState === SystemAddressReviewState.PENDING) {
    decision = 'REFUSAL_PENDING_REVIEW';
  } else if (entry.reviewState === SystemAddressReviewState.REJECTED) {
    decision = 'REFUSAL_REJECTED';
  } else if (entry.confidence < 0.8) {
    decision = 'REFUSAL_SUB_FLOOR_CONFIDENCE';
  } else {
    decision = 'EXCLUSION_APPLIED';
  }
  const excluded = isExcludableSystemAddress(entry.role, entry.confidence, entry.reviewState);
  if (excluded !== (decision === 'EXCLUSION_APPLIED')) {
    throw new Error('system-address exclusion policy invariant failed');
  }
  const row = parseSolsecSchema('SystemAddressExclusionApplied', {
    exclusionId:
      input.exclusionId ??
      `system-exclusion:${encodeURIComponent(input.economicEventId)}:${encodeURIComponent(entry.registryEntryId)}:${encodeURIComponent(input.appliedAt)}`,
    registryEntryId: entry.registryEntryId,
    economicEventId: input.economicEventId,
    excluded,
    rawFlowRef: input.rawFlowRef,
    appliedAt: input.appliedAt,
    registryVersion: entry.registryVersion,
    qualityCodes: excluded ? ['VALID'] : ['SYSTEM_ADDRESS_UNCERTAIN'],
  });
  return { decision, row };
}

export async function recordSystemAddressExclusion(
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

export async function decideAndRecordExclusion(
  engine: DatabaseEngine,
  input: DecideExclusionInput,
): Promise<ExclusionDecisionResult> {
  const result = decideExclusion(input);
  await recordSystemAddressExclusion(engine, result.row);
  return result;
}

/** Registry-backed value for EconomicTradeContext.knownRouterAccounts. */
export async function knownRouterAccountsAt(
  engine: DatabaseEngine,
  query: RegistryPointInTimeQuery,
): Promise<readonly string[]> {
  const entries = await resolveSystemRegistryAt(engine, query);
  return entries
    .filter((entry) => isExcludableSystemAddress(entry.role, entry.confidence, entry.reviewState))
    .map((entry) => entry.address);
}

export interface KnownRouterAccountsContext {
  readonly knownRouterAccounts?: readonly string[];
}

/** Return a new context with the registry set; the caller's attribution input is not rewritten. */
export function withKnownRouterAccounts<T extends KnownRouterAccountsContext>(
  context: T,
  registryAccounts: readonly string[],
): T & { readonly knownRouterAccounts: readonly string[] } {
  return {
    ...context,
    knownRouterAccounts: [
      ...new Set([...(context.knownRouterAccounts ?? []), ...registryAccounts]),
    ].sort(),
  };
}
