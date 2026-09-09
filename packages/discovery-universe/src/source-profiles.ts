import { DiscError, ErrorCode } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import { DiscSourceProfileSchema, UniverseEntryProvenanceSchema } from '@foresift/shared-schemas';

export interface DiscSourceProfile {
  readonly sourceId: string;
  readonly profileVersion: number;
  readonly sourceClass: string;
  readonly coverageScope: Readonly<Record<string, unknown>>;
  readonly rightsBasis: string;
  readonly queryFilterVersion: string;
  readonly upstreamDependence: Readonly<Record<string, unknown>>;
  readonly upstreamLineageKeys: readonly string[];
  readonly manipulationPolicy: string;
  readonly collectorScopeIds: readonly string[];
  readonly effectiveFrom: string;
  readonly supersededAt?: string;
}

export interface UniverseEntryProvenance {
  readonly entryId: string;
  readonly normalizedIdentityId: string;
  readonly entryReason: string;
  readonly coverageScopeRef: string;
  readonly rightsRecord: string;
  readonly queryFilterVersion: string;
  readonly upstreamDependenceDisclosed: Readonly<Record<string, unknown>>;
  readonly firstPartyObserved: boolean;
}

export interface SourceProfileRegistrationResult {
  readonly profile: DiscSourceProfile;
  readonly created: boolean;
}

export interface ProvenancePersistenceResult {
  readonly provenance: UniverseEntryProvenance;
  readonly created: boolean;
}

interface SourceProfileRow {
  source_id: string;
  profile_version: number;
  source_class: string;
  coverage_scope: unknown;
  rights_basis: string;
  query_filter_version: string;
  upstream_dependence: unknown;
  upstream_lineage_keys: string[];
  manipulation_policy: string;
  collector_scope_ids: string[];
  effective_from: string | Date;
  superseded_at: string | Date | null;
}

interface ProvenanceRow {
  entry_id: string;
  normalized_identity_id: string;
  entry_reason: string;
  coverage_scope_ref: string;
  rights_record: string;
  query_filter_version: string;
  upstream_dependence_disclosed: unknown;
  first_party_observed: boolean;
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function jsonObject(value: unknown): Readonly<Record<string, unknown>> {
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new DiscError('persisted discovery provenance contains a non-object JSON value', {
      fieldType: parsed === null ? 'null' : typeof parsed,
    });
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function profileFromRow(row: SourceProfileRow): DiscSourceProfile {
  return DiscSourceProfileSchema.parse({
    sourceId: row.source_id,
    profileVersion: row.profile_version,
    sourceClass: row.source_class,
    coverageScope: jsonObject(row.coverage_scope),
    rightsBasis: row.rights_basis,
    queryFilterVersion: row.query_filter_version,
    upstreamDependence: jsonObject(row.upstream_dependence),
    upstreamLineageKeys: row.upstream_lineage_keys,
    manipulationPolicy: row.manipulation_policy,
    collectorScopeIds: row.collector_scope_ids,
    effectiveFrom: iso(row.effective_from),
    ...(row.superseded_at === null ? {} : { supersededAt: iso(row.superseded_at) }),
  }) as DiscSourceProfile;
}

function provenanceFromRow(row: ProvenanceRow): UniverseEntryProvenance {
  return UniverseEntryProvenanceSchema.parse({
    entryId: row.entry_id,
    normalizedIdentityId: row.normalized_identity_id,
    entryReason: row.entry_reason,
    coverageScopeRef: row.coverage_scope_ref,
    rightsRecord: row.rights_record,
    queryFilterVersion: row.query_filter_version,
    upstreamDependenceDisclosed: jsonObject(row.upstream_dependence_disclosed),
    firstPartyObserved: row.first_party_observed,
  }) as UniverseEntryProvenance;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameProfile(left: DiscSourceProfile, right: DiscSourceProfile): boolean {
  return stable(left) === stable(right);
}

/**
 * Register an immutable profile version. Identical retries are no-ops; a
 * changed payload at an existing key or a non-forward version is refused.
 * A later effective version supersedes an older open-ended row by selection,
 * without rewriting that historical row.
 */
export async function registerSourceProfile(
  engine: DatabaseEngine,
  input: unknown,
): Promise<SourceProfileRegistrationResult> {
  const profile = DiscSourceProfileSchema.parse(input) as DiscSourceProfile;

  return engine.transaction(async (tx) => {
    const sameKey = await tx.query<SourceProfileRow>(
      `SELECT source_id,profile_version,source_class,coverage_scope,rights_basis,
              query_filter_version,upstream_dependence,upstream_lineage_keys,
              manipulation_policy,collector_scope_ids,effective_from,superseded_at
       FROM disc.disc_source_profiles
       WHERE source_id=$1 AND profile_version=$2`,
      [profile.sourceId, profile.profileVersion],
    );
    const existing = sameKey.rows[0];
    if (existing !== undefined) {
      const stored = profileFromRow(existing);
      if (!sameProfile(stored, profile)) {
        throw new DiscError(
          'a source profile key already exists with different content; register a new version',
          { sourceId: profile.sourceId, profileVersion: profile.profileVersion },
          ErrorCode.CONTRACT_INVARIANT_VIOLATED,
        );
      }
      return { profile: stored, created: false };
    }

    const latest = await tx.query<SourceProfileRow>(
      `SELECT source_id,profile_version,source_class,coverage_scope,rights_basis,
              query_filter_version,upstream_dependence,upstream_lineage_keys,
              manipulation_policy,collector_scope_ids,effective_from,superseded_at
       FROM disc.disc_source_profiles
       WHERE source_id=$1
       ORDER BY profile_version DESC LIMIT 1`,
      [profile.sourceId],
    );
    const prior = latest.rows[0];
    if (
      prior !== undefined &&
      (profile.profileVersion <= prior.profile_version ||
        Date.parse(profile.effectiveFrom) <= Date.parse(iso(prior.effective_from)))
    ) {
      throw new DiscError(
        'source profile versions and effective times must advance monotonically',
        {
          sourceId: profile.sourceId,
          profileVersion: profile.profileVersion,
          priorProfileVersion: prior.profile_version,
        },
        ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      );
    }

    const inserted = await tx.query<{ source_id: string }>(
      `INSERT INTO disc.disc_source_profiles (
         source_id,profile_version,source_class,coverage_scope,rights_basis,
         query_filter_version,upstream_dependence,upstream_lineage_keys,
         manipulation_policy,collector_scope_ids,effective_from,superseded_at)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8,$9,$10,$11,$12)
       ON CONFLICT (source_id,profile_version) DO NOTHING
       RETURNING source_id`,
      [
        profile.sourceId,
        profile.profileVersion,
        profile.sourceClass,
        JSON.stringify(profile.coverageScope),
        profile.rightsBasis,
        profile.queryFilterVersion,
        JSON.stringify(profile.upstreamDependence),
        [...profile.upstreamLineageKeys],
        profile.manipulationPolicy,
        [...profile.collectorScopeIds],
        profile.effectiveFrom,
        profile.supersededAt ?? null,
      ],
    );
    if (inserted.rows.length === 1) return { profile, created: true };

    // A concurrent identical registration may have won after our initial
    // read. Re-read and apply the same immutable-key law before reporting it.
    const raced = await tx.query<SourceProfileRow>(
      `SELECT source_id,profile_version,source_class,coverage_scope,rights_basis,
              query_filter_version,upstream_dependence,upstream_lineage_keys,
              manipulation_policy,collector_scope_ids,effective_from,superseded_at
       FROM disc.disc_source_profiles
       WHERE source_id=$1 AND profile_version=$2`,
      [profile.sourceId, profile.profileVersion],
    );
    const storedRow = raced.rows[0];
    if (storedRow === undefined || !sameProfile(profileFromRow(storedRow), profile)) {
      throw new DiscError(
        'concurrent source profile registration produced conflicting content',
        { sourceId: profile.sourceId, profileVersion: profile.profileVersion },
        ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      );
    }
    return { profile: profileFromRow(storedRow), created: false };
  });
}

/** Resolve the newest profile whose declared window contains `asOf`. */
export async function sourceProfileAt(
  engine: DatabaseEngine,
  sourceId: string,
  asOf: string,
): Promise<DiscSourceProfile | undefined> {
  if (sourceId.length === 0 || !Number.isFinite(Date.parse(asOf))) {
    throw new DiscError(
      'source profile lookup requires a source id and valid asOf timestamp',
      { sourceId, asOf },
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
    );
  }
  const result = await engine.query<SourceProfileRow>(
    `SELECT source_id,profile_version,source_class,coverage_scope,rights_basis,
            query_filter_version,upstream_dependence,upstream_lineage_keys,
            manipulation_policy,collector_scope_ids,effective_from,superseded_at
     FROM disc.disc_source_profiles
     WHERE source_id=$1 AND effective_from<=$2
       AND (superseded_at IS NULL OR superseded_at>$2)
     ORDER BY effective_from DESC,profile_version DESC LIMIT 1`,
    [sourceId, asOf],
  );
  const row = result.rows[0];
  return row === undefined ? undefined : profileFromRow(row);
}

/** Persist complete per-entry provenance once; retries never rewrite it. */
export async function persistEntryProvenance(
  engine: DatabaseEngine,
  input: unknown,
): Promise<ProvenancePersistenceResult> {
  const provenance = UniverseEntryProvenanceSchema.parse(input) as UniverseEntryProvenance;
  const inserted = await engine.query<{ entry_id: string }>(
    `INSERT INTO disc.universe_entry_provenance (
       entry_id,normalized_identity_id,entry_reason,coverage_scope_ref,
       rights_record,query_filter_version,upstream_dependence_disclosed,
       first_party_observed)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
     ON CONFLICT (entry_id) DO NOTHING
     RETURNING entry_id`,
    [
      provenance.entryId,
      provenance.normalizedIdentityId,
      provenance.entryReason,
      provenance.coverageScopeRef,
      provenance.rightsRecord,
      provenance.queryFilterVersion,
      JSON.stringify(provenance.upstreamDependenceDisclosed),
      provenance.firstPartyObserved,
    ],
  );
  if (inserted.rows.length === 1) return { provenance, created: true };

  const existing = await engine.query<ProvenanceRow>(
    `SELECT entry_id,normalized_identity_id,entry_reason,coverage_scope_ref,
            rights_record,query_filter_version,upstream_dependence_disclosed,
            first_party_observed
     FROM disc.universe_entry_provenance WHERE entry_id=$1`,
    [provenance.entryId],
  );
  const stored = existing.rows[0];
  if (stored === undefined) {
    throw new DiscError(
      'entry provenance conflict did not resolve to a persisted row',
      { entryId: provenance.entryId },
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
    );
  }
  return { provenance: provenanceFromRow(stored), created: false };
}

/** A coverage/recall claim may use an entry only with complete provenance. */
export function provenanceSupportsClaim(input: unknown): input is UniverseEntryProvenance {
  return UniverseEntryProvenanceSchema.safeParse(input).success;
}

export const entryProvenanceSupportsClaim = provenanceSupportsClaim;
export const findEffectiveSourceProfile = sourceProfileAt;
export const getEffectiveSourceProfile = sourceProfileAt;

/** Resolve persisted provenance and apply the same complete-payload law. */
export async function entrySupportsClaim(
  engine: DatabaseEngine,
  entryId: string,
): Promise<boolean> {
  const result = await engine.query<ProvenanceRow>(
    `SELECT entry_id,normalized_identity_id,entry_reason,coverage_scope_ref,
            rights_record,query_filter_version,upstream_dependence_disclosed,
            first_party_observed
     FROM disc.universe_entry_provenance WHERE entry_id=$1`,
    [entryId],
  );
  const row = result.rows[0];
  if (row === undefined) return false;
  try {
    return provenanceSupportsClaim(provenanceFromRow(row));
  } catch {
    return false;
  }
}

export const canEntrySupportClaim = entrySupportsClaim;

/** Repository facade for callers that prefer an injected engine once. */
export class SourceProfileRegistry {
  constructor(private readonly engine: DatabaseEngine) {}

  register(profile: unknown): Promise<SourceProfileRegistrationResult> {
    return registerSourceProfile(this.engine, profile);
  }

  registerProfile(profile: unknown): Promise<SourceProfileRegistrationResult> {
    return this.register(profile);
  }

  profileAt(sourceId: string, asOf: string): Promise<DiscSourceProfile | undefined> {
    return sourceProfileAt(this.engine, sourceId, asOf);
  }

  effectiveProfile(sourceId: string, asOf: string): Promise<DiscSourceProfile | undefined> {
    return this.profileAt(sourceId, asOf);
  }

  persistEntryProvenance(input: unknown): Promise<ProvenancePersistenceResult> {
    return persistEntryProvenance(this.engine, input);
  }

  recordEntryProvenance(input: unknown): Promise<ProvenancePersistenceResult> {
    return this.persistEntryProvenance(input);
  }

  entrySupportsClaim(entryId: string): Promise<boolean> {
    return entrySupportsClaim(this.engine, entryId);
  }

  canSupportClaim(entryId: string): Promise<boolean> {
    return this.entrySupportsClaim(entryId);
  }
}

export { SourceProfileRegistry as DiscoverySourceProfileRepository };
