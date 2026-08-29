import type { DatabaseEngine } from '@foresift/persistence';
import {
  CollectorScopeDeclarationSchema,
  type CollectorScopeDeclaration,
} from '@foresift/shared-schemas';
export type ScopeRefusalCode =
  'OUT_OF_SCOPE' | 'SCOPE_VERSION_CHANGED' | 'SUPPORT_MANIFEST_UNVERIFIED';
export class CollectorScopeError extends Error {
  constructor(
    readonly code: ScopeRefusalCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'CollectorScopeError';
  }
}
export interface SupportManifestVerifier {
  isVerified(contentHash: string, at: Date): boolean | Promise<boolean>;
}
export interface LoadedCollectorScope extends CollectorScopeDeclaration {
  readonly scopeVersion: number;
  readonly accountFilters: readonly string[];
  readonly supportManifestRef: string;
  readonly active: boolean;
}
export interface SubscriptionRequest {
  readonly chainId: string;
  readonly programId: string;
  readonly programVersion: string;
  readonly account: string;
  readonly eventFamily: string;
  readonly finality: 'confirmed' | 'finalized';
}
export interface ScopedSubscription extends SubscriptionRequest {
  readonly scopeId: string;
  readonly scopeVersion: number;
  readonly decoderVersion: string;
}
function fromRow(row: Record<string, unknown>): LoadedCollectorScope {
  const declaration = CollectorScopeDeclarationSchema.parse({
    scopeId: row.scope_id,
    chainId: row.chain_id,
    programId: row.program_id,
    programVersion: row.program_version,
    accountLayoutVersion: row.account_layout_version ?? row.program_version,
    supportedEventFamilies: row.event_families,
    coverageStartSlot: String(row.coverage_start_slot ?? 0),
    coverageStartTime:
      row.coverage_start instanceof Date ? row.coverage_start.toISOString() : row.coverage_start,
    finalityPolicy: String(row.finality_policy).toLowerCase(),
    decoderVersion: row.decoder_version,
    quotaStreamedByteEnvelope: {
      maxBytesPerSec: Number(row.byte_envelope),
      maxEventsPerSec: Number(row.quota_envelope),
    },
    maximumLagSlots: Number(row.max_lag_slots),
    maximumGapAgeSeconds: Number(row.max_gap_age_ms) / 1000,
    rightsPolicy: row.rights_policy_ref,
  });
  return {
    ...declaration,
    scopeVersion: Number(row.scope_version),
    accountFilters: (row.account_filters as string[]) ?? [],
    supportManifestRef: String(row.support_manifest_ref),
    active: Boolean(row.active),
  };
}
export class CollectorScopeLoader {
  constructor(
    private readonly engine: DatabaseEngine,
    private readonly manifests: SupportManifestVerifier,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async loadActive(): Promise<readonly LoadedCollectorScope[]> {
    const rows = await this.engine.query<Record<string, unknown>>(
      'SELECT * FROM col.collector_scopes WHERE active = true ORDER BY scope_id, scope_version',
    );
    const scopes = rows.rows.map(fromRow);
    for (const scope of scopes)
      if (!(await this.manifests.isVerified(scope.supportManifestRef, this.now())))
        throw new CollectorScopeError(
          'SUPPORT_MANIFEST_UNVERIFIED',
          `scope ${scope.scopeId}@${scope.scopeVersion}`,
        );
    return scopes;
  }
}
export class ScopeSubscriptionBuilder {
  private readonly byId = new Map<string, LoadedCollectorScope>();
  constructor(
    scopes: readonly LoadedCollectorScope[],
    pinnedVersions: ReadonlyMap<string, number> = new Map(),
  ) {
    for (const scope of scopes) {
      const pinned = pinnedVersions.get(scope.scopeId);
      if (pinned !== undefined && pinned !== scope.scopeVersion)
        throw new CollectorScopeError(
          'SCOPE_VERSION_CHANGED',
          `${scope.scopeId} changed from ${pinned} to ${scope.scopeVersion}`,
        );
      this.byId.set(scope.scopeId, scope);
    }
  }
  build(scopeId: string, request: SubscriptionRequest): ScopedSubscription {
    const scope = this.byId.get(scopeId);
    const allowed =
      scope !== undefined &&
      scope.active &&
      request.chainId === scope.chainId &&
      request.programId === scope.programId &&
      request.programVersion === scope.programVersion &&
      scope.accountFilters.includes(request.account) &&
      scope.supportedEventFamilies.includes(request.eventFamily) &&
      request.finality === scope.finalityPolicy;
    if (!allowed || scope === undefined)
      throw new CollectorScopeError('OUT_OF_SCOPE', `subscription refused for ${scopeId}`);
    return {
      ...request,
      scopeId: scope.scopeId,
      scopeVersion: scope.scopeVersion,
      decoderVersion: scope.decoderVersion,
    };
  }
}
export function validateCollectorScope(value: unknown): { allowed: boolean; reason?: string } {
  const parsed = CollectorScopeDeclarationSchema.safeParse(value);
  return parsed.success
    ? { allowed: false, reason: 'SUPPORT_MANIFEST_VERIFIER_REQUIRED' }
    : { allowed: false, reason: 'SCOPE_SCHEMA_INVALID' };
}
