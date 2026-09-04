import {
  SystemAddressReviewState,
  SystemAddressRole,
  isExcludableSystemAddress,
  systemAddressReviewState,
  systemAddressRole,
} from '@foresift/domain';
import { canonicalJson, sha256Text, type DatabaseEngine } from '@foresift/persistence';
import type {
  SystemAddressExclusionApplied,
  SystemAddressRegistryEntry,
} from '@foresift/shared-schemas';

export const SYSTEM_ADDRESS_REGISTRY_POLICY_VERSION = 'solsec-system-address-q2@1';

export type ExclusionDecisionReason =
  | 'EXCLUSION_APPLIED'
  | 'REFUSAL_SUB_FLOOR_CONFIDENCE'
  | 'REFUSAL_PENDING_REVIEW'
  | 'REFUSAL_REJECTED'
  | 'REFUSAL_UNKNOWN_ROLE';

export interface ExclusionRequest {
  readonly economicEventId: string;
  readonly rawFlowRef: string;
  readonly appliedAt: string;
}

export interface SystemAddressExclusionDecision {
  readonly reason: ExclusionDecisionReason;
  readonly auditRow: SystemAddressExclusionApplied;
}

export interface PointInTimeRegistryQuery {
  readonly chainId: string;
  readonly address?: string;
  /** Event time whose validity interval must contain it. */
  readonly validAt: string;
  /** Optional immutable registry snapshot ceiling for historical reconstruction. */
  readonly registryVersionAtMost?: number;
}

interface StoredRegistryRow {
  registry_entry_id: string;
  chain_id: string;
  address: string;
  role: string;
  valid_from: string | Date;
  valid_until: string | Date | null;
  source_id: string;
  confidence: number;
  review_state: string;
  registry_version: number;
  evidence_ids: string[] | string;
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function assertTimestamp(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new RangeError(`${field} must be a timestamp`);
}

function assertEntry(entry: SystemAddressRegistryEntry): void {
  if (
    entry.registryEntryId.length === 0 ||
    entry.chainId.length === 0 ||
    entry.address.length === 0 ||
    entry.sourceId.length === 0 ||
    entry.evidenceIds.length === 0
  ) {
    throw new RangeError('system-address registry identifiers and evidence must not be empty');
  }
  systemAddressRole(entry.role);
  systemAddressReviewState(entry.reviewState);
  if (!Number.isFinite(entry.confidence) || entry.confidence < 0 || entry.confidence > 1) {
    throw new RangeError('confidence must lie in [0, 1]');
  }
  if (!Number.isInteger(entry.registryVersion) || entry.registryVersion < 1) {
    throw new RangeError('registryVersion must be a positive integer');
  }
  assertTimestamp(entry.validFrom, 'validFrom');
  if (entry.validUntil !== null) {
    assertTimestamp(entry.validUntil, 'validUntil');
    if (Date.parse(entry.validUntil) <= Date.parse(entry.validFrom)) {
      throw new RangeError('validUntil must be later than validFrom');
    }
  }
}

function parseEvidenceIds(value: string[] | string): string[] {
  if (Array.isArray(value)) return value;
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error('invalid evidence_ids returned by system-address registry');
  }
  return parsed as string[];
}

function fromStored(row: StoredRegistryRow): SystemAddressRegistryEntry {
  return {
    registryEntryId: row.registry_entry_id,
    chainId: row.chain_id as SystemAddressRegistryEntry['chainId'],
    address: row.address,
    role: systemAddressRole(row.role),
    validFrom: iso(row.valid_from) as SystemAddressRegistryEntry['validFrom'],
    validUntil:
      row.valid_until === null
        ? null
        : (iso(row.valid_until) as SystemAddressRegistryEntry['validUntil']),
    sourceId: row.source_id,
    confidence: row.confidence,
    reviewState: systemAddressReviewState(row.review_state),
    registryVersion: row.registry_version,
    evidenceIds: parseEvidenceIds(row.evidence_ids),
  };
}

function decisionReason(entry: SystemAddressRegistryEntry): ExclusionDecisionReason {
  if (entry.reviewState === SystemAddressReviewState.PENDING_REVIEW) {
    return 'REFUSAL_PENDING_REVIEW';
  }
  if (entry.reviewState === SystemAddressReviewState.REJECTED) return 'REFUSAL_REJECTED';
  if (entry.role === SystemAddressRole.UNKNOWN_INFRASTRUCTURE) return 'REFUSAL_UNKNOWN_ROLE';
  if (entry.confidence < 0.8) return 'REFUSAL_SUB_FLOOR_CONFIDENCE';
  return 'EXCLUSION_APPLIED';
}

/**
 * Pure Appendix Q.2 decision. It always returns an audit row, including for a
 * refusal, and carries the caller's raw evidence reference through unchanged.
 */
export function decideExclusion(
  entry: SystemAddressRegistryEntry,
  request: ExclusionRequest,
): SystemAddressExclusionDecision {
  assertEntry(entry);
  if (request.economicEventId.length === 0) throw new RangeError('economicEventId is required');
  if (!/^sha256:[0-9a-f]{64}$/.test(request.rawFlowRef)) {
    throw new RangeError('rawFlowRef must be sha256:<64 lowercase hex characters>');
  }
  assertTimestamp(request.appliedAt, 'appliedAt');
  const excluded = isExcludableSystemAddress(
    entry.role,
    entry.confidence,
    entry.reviewState,
  );
  const reason = decisionReason(entry);
  if (excluded !== (reason === 'EXCLUSION_APPLIED')) {
    throw new Error('system-address exclusion policy invariant violated');
  }
  const identity = {
    registryEntryId: entry.registryEntryId,
    economicEventId: request.economicEventId,
    rawFlowRef: request.rawFlowRef,
    appliedAt: request.appliedAt,
    registryVersion: entry.registryVersion,
    excluded,
  };
  return {
    reason,
    auditRow: {
      exclusionId: `system-exclusion:${sha256Text(canonicalJson(identity))}`,
      registryEntryId: entry.registryEntryId,
      economicEventId: request.economicEventId,
      excluded,
      rawFlowRef: request.rawFlowRef,
      appliedAt: request.appliedAt as SystemAddressExclusionApplied['appliedAt'],
      registryVersion: entry.registryVersion,
      qualityCodes: excluded ? ['VALID'] : ['SYSTEM_ADDRESS_UNCERTAIN'],
    },
  };
}

/** SQL-backed append-only registry and exclusion audit repository. */
export class SystemAddressRegistry {
  constructor(private readonly engine: DatabaseEngine) {}

  async register(entry: SystemAddressRegistryEntry): Promise<{ created: boolean }> {
    assertEntry(entry);
    const inserted = await this.engine.query<{ registry_entry_id: string }>(
      `INSERT INTO system_address_registry
         (registry_entry_id,chain_id,address,role,valid_from,valid_until,source_id,
          confidence,review_state,registry_version,evidence_ids)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (registry_entry_id) DO NOTHING
       RETURNING registry_entry_id`,
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
        [...entry.evidenceIds],
      ],
    );
    return { created: inserted.rows.length === 1 };
  }

  /** Resolve only rows whose half-open validity interval contains validAt. */
  async resolveAt(query: PointInTimeRegistryQuery): Promise<readonly SystemAddressRegistryEntry[]> {
    assertTimestamp(query.validAt, 'validAt');
    if (query.registryVersionAtMost !== undefined &&
        (!Number.isInteger(query.registryVersionAtMost) || query.registryVersionAtMost < 1)) {
      throw new RangeError('registryVersionAtMost must be a positive integer');
    }
    const result = await this.engine.query<StoredRegistryRow>(
      `SELECT registry_entry_id,chain_id,address,role,valid_from,valid_until,source_id,
              confidence,review_state,registry_version,evidence_ids
       FROM system_address_registry
       WHERE chain_id=$1
         AND ($2::text IS NULL OR address=$2)
         AND valid_from <= $3
         AND (valid_until IS NULL OR valid_until > $3)
         AND ($4::integer IS NULL OR registry_version <= $4)
       ORDER BY address ASC, registry_version DESC, valid_from DESC, registry_entry_id ASC`,
      [
        query.chainId,
        query.address ?? null,
        query.validAt,
        query.registryVersionAtMost ?? null,
      ],
    );

    // A versioned revision supersedes an older row for the same address only
    // in this query result; stored rows and prior audit decisions remain intact.
    const latestByAddress = new Map<string, SystemAddressRegistryEntry>();
    for (const row of result.rows) {
      if (!latestByAddress.has(row.address)) latestByAddress.set(row.address, fromStored(row));
    }
    return [...latestByAddress.values()];
  }

  async exclusionSetAt(
    query: Omit<PointInTimeRegistryQuery, 'address'>,
  ): Promise<readonly string[]> {
    const entries = await this.resolveAt(query);
    return entries
      .filter((entry) =>
        isExcludableSystemAddress(entry.role, entry.confidence, entry.reviewState),
      )
      .map((entry) => entry.address)
      .sort();
  }

  /** Normalizer seam: the returned snapshot is consumed as knownRouterAccounts. */
  async knownRouterAccounts(
    query: Omit<PointInTimeRegistryQuery, 'address'>,
  ): Promise<readonly string[]> {
    return this.exclusionSetAt(query);
  }

  async decideExclusion(
    entry: SystemAddressRegistryEntry,
    request: ExclusionRequest,
  ): Promise<SystemAddressExclusionDecision> {
    const decision = decideExclusion(entry, request);
    const row = decision.auditRow;
    await this.engine.query(
      `INSERT INTO system_address_exclusions_applied
         (exclusion_id,registry_entry_id,economic_event_id,excluded,raw_flow_ref,
          applied_at,registry_version,quality_codes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (exclusion_id) DO NOTHING`,
      [
        row.exclusionId,
        row.registryEntryId,
        row.economicEventId,
        row.excluded,
        row.rawFlowRef,
        row.appliedAt,
        row.registryVersion,
        [...row.qualityCodes],
      ],
    );
    return decision;
  }
}

export const SystemAddressRegistryRepository = SystemAddressRegistry;
