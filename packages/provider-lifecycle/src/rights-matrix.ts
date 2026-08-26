/**
 * Rights matrices — sixteen-field versioned declarations, the change-diff
 * engine, and the fail-closed decision API (FR-PROV-009, AC-273; T120).
 *
 *   * every declaration carries ALL SIXTEEN §15.6 fields with a terms
 *     version and a verification window tied to the FR-PROV-002 TTL engine;
 *   * changes diff consecutive versions into the newly-prohibited use set
 *     across the storage / derived-use / redistribution / caching / export /
 *     model-training / public-alert paths;
 *   * the decision API evaluates THE RIGHTS VERSION CAPTURED AT INGESTION —
 *     a tightening applies immediately to already-stored artifacts because
 *     their captured version's row is superseded by the change ledger; any
 *     path without a current declaration refuses (fail-closed).
 */
import type { DatabaseEngine } from '@foresift/persistence';
import { sha256Text } from '@foresift/persistence';
import type { ClockPort, UtcTimestamp } from '@foresift/domain';
import { z } from 'zod';
import { RIGHTS_USE_PATHS, type RightsUsePath } from './vocabulary.ts';
import { ProvErrorCode, RightsChangeError } from './errors.ts';
import { RightsChangeAuditBridge } from './audit-bridges.ts';
import type { AuditChain } from '@foresift/security';

/** The sixteen §15.6 fields (booleans + jurisdiction + terms + window). */
export const RightsDeclarationSchema = z
  .object({
    commercialUseAllowed: z.boolean(),
    personalResearchAllowed: z.boolean(),
    cacheAllowed: z.boolean(),
    maximumCacheDurationSeconds: z.number().int().min(0),
    rawRetentionAllowed: z.boolean(),
    derivedFeaturesAllowed: z.boolean(),
    modelTrainingAllowed: z.boolean(),
    redistributionAllowed: z.boolean(),
    publicAlertDerivativeAllowed: z.boolean(),
    attributionRequired: z.boolean(),
    userByokRequired: z.boolean(),
    rawExportAllowed: z.boolean(),
    jurisdictionRestrictions: z.array(z.string().min(1)),
    termsVersion: z.string().min(1),
    verifiedAt: z.custom<UtcTimestamp>((v) => typeof v === 'string'),
    verificationExpiresAt: z.custom<UtcTimestamp>((v) => typeof v === 'string'),
  })
  .strict();
export type RightsDeclaration = z.infer<typeof RightsDeclarationSchema>;

export interface DeclareRightsInput {
  readonly providerId: string;
  readonly operationId: string;
  /** Monotone version; must be exactly current+1 for a CHANGE, or 1 first. */
  readonly rightsVersion: number;
  readonly declaration: RightsDeclaration;
}

/** Which §15.6 boolean gates which use path. */
const PATH_GATES: Readonly<Record<RightsUsePath, keyof RightsDeclaration | null>> = {
  STORAGE: 'rawRetentionAllowed',
  DERIVED_USE: 'derivedFeaturesAllowed',
  REDISTRIBUTION: 'redistributionAllowed',
  CACHING: 'cacheAllowed',
  EXPORT: 'rawExportAllowed',
  MODEL_TRAINING: 'modelTrainingAllowed',
  PUBLIC_ALERT: 'publicAlertDerivativeAllowed',
};

/** Newly-prohibited paths for two consecutive declarations. */
export function diffRights(
  from: RightsDeclaration,
  to: RightsDeclaration,
): { newlyProhibitedUses: RightsUsePath[]; tightened: boolean } {
  const newlyProhibitedUses: RightsUsePath[] = [];
  for (const path of RIGHTS_USE_PATHS) {
    const gate = PATH_GATES[path];
    if (gate !== null && from[gate] === true && to[gate] === false) {
      newlyProhibitedUses.push(path);
    }
  }
  // A shorter cache window is also a tightening even if caching stays allowed.
  const cacheWindowShortened =
    to.cacheAllowed &&
    from.cacheAllowed &&
    to.maximumCacheDurationSeconds < from.maximumCacheDurationSeconds;
  // Jurisdiction expansion restricts too.
  const jurisdictionsExpanded = to.jurisdictionRestrictions.some(
    (j) => !from.jurisdictionRestrictions.includes(j),
  );
  const tightened =
    newlyProhibitedUses.length > 0 ||
    (!to.commercialUseAllowed && from.commercialUseAllowed) ||
    (!to.personalResearchAllowed && from.personalResearchAllowed) ||
    cacheWindowShortened ||
    jurisdictionsExpanded;
  return { newlyProhibitedUses, tightened };
}

interface DeclarationRow {
  declaration_id: string;
  rights_version: number;
  commercial_use_allowed: boolean;
  personal_research_allowed: boolean;
  cache_allowed: boolean;
  maximum_cache_duration_seconds: number;
  raw_retention_allowed: boolean;
  derived_features_allowed: boolean;
  model_training_allowed: boolean;
  redistribution_allowed: boolean;
  public_alert_derivative_allowed: boolean;
  attribution_required: boolean;
  user_byok_required: boolean;
  raw_export_allowed: boolean;
  jurisdiction_restrictions: string[];
  terms_version: string;
  verified_at: Date | string;
  verification_expires_at: Date | string;
  declared_at: Date | string;
}

function iso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString();
}

function rowToDeclaration(row: DeclarationRow): RightsDeclaration & { rightsVersion: number } {
  return {
    rightsVersion: Number(row.rights_version),
    commercialUseAllowed: row.commercial_use_allowed,
    personalResearchAllowed: row.personal_research_allowed,
    cacheAllowed: row.cache_allowed,
    maximumCacheDurationSeconds: Number(row.maximum_cache_duration_seconds),
    rawRetentionAllowed: row.raw_retention_allowed,
    derivedFeaturesAllowed: row.derived_features_allowed,
    modelTrainingAllowed: row.model_training_allowed,
    redistributionAllowed: row.redistribution_allowed,
    publicAlertDerivativeAllowed: row.public_alert_derivative_allowed,
    attributionRequired: row.attribution_required,
    userByokRequired: row.user_byok_required,
    rawExportAllowed: row.raw_export_allowed,
    jurisdictionRestrictions: [...row.jurisdiction_restrictions],
    termsVersion: row.terms_version,
    verifiedAt: iso(row.verified_at) as UtcTimestamp,
    verificationExpiresAt: iso(row.verification_expires_at) as UtcTimestamp,
  };
}

export interface ChangeRightsInput {
  readonly providerId: string;
  readonly operationId: string;
  readonly nextVersion: number;
  readonly declaration: RightsDeclaration;
  readonly actor: string;
  /**
   * Explicit change instant — deterministic ids make retries of the SAME
   * declared change resolve to one row; omit for clock.now().
   */
  readonly changedAt?: UtcTimestamp | undefined;
}

export interface RightsChangeRecord {
  readonly changeId: string;
  readonly fromRightsVersion: number;
  readonly toRightsVersion: number;
  readonly newlyProhibitedUses: readonly RightsUsePath[];
  readonly tightened: boolean;
}

export class RightsMatrixEngine {
  private readonly engine: DatabaseEngine;
  private readonly clock: ClockPort;
  private readonly audit: RightsChangeAuditBridge | undefined;

  constructor(options: { engine: DatabaseEngine; clock: ClockPort; auditChain?: AuditChain }) {
    this.engine = options.engine;
    this.clock = options.clock;
    this.audit =
      options.auditChain !== undefined ? new RightsChangeAuditBridge(options.auditChain) : undefined;
  }

  private declarationId(providerId: string, operationId: string, version: number): string {
    return `prt:${providerId}:${operationId}:v${String(version)}`;
  }

  /** Records one versioned declaration (idempotent per version). */
  async declareRights(input: DeclareRightsInput): Promise<{ declarationId: string }> {
    const declaration = RightsDeclarationSchema.parse(input.declaration);
    if (
      new Date(declaration.verificationExpiresAt).getTime() <=
      new Date(declaration.verifiedAt).getTime()
    ) {
      throw new RightsChangeError(
        'rights verification window invalid: expiry must lie strictly after verification',
        {},
        ProvErrorCode.PROV_RIGHTS_MATRIX_INVALID,
      );
    }
    const declarationId = this.declarationId(
      input.providerId,
      input.operationId,
      input.rightsVersion,
    );
    await this.engine.query(
      `INSERT INTO prov.prov_rights_declarations (
         declaration_id, provider_id, operation_id, rights_version,
         commercial_use_allowed, personal_research_allowed, cache_allowed,
         maximum_cache_duration_seconds, raw_retention_allowed,
         derived_features_allowed, model_training_allowed, redistribution_allowed,
         public_alert_derivative_allowed, attribution_required, user_byok_required,
         raw_export_allowed, jurisdiction_restrictions, terms_version,
         verified_at, verification_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       ON CONFLICT (declaration_id) DO NOTHING`,
      [
        declarationId,
        input.providerId,
        input.operationId,
        input.rightsVersion,
        declaration.commercialUseAllowed,
        declaration.personalResearchAllowed,
        declaration.cacheAllowed,
        declaration.maximumCacheDurationSeconds,
        declaration.rawRetentionAllowed,
        declaration.derivedFeaturesAllowed,
        declaration.modelTrainingAllowed,
        declaration.redistributionAllowed,
        declaration.publicAlertDerivativeAllowed,
        declaration.attributionRequired,
        declaration.userByokRequired,
        declaration.rawExportAllowed,
        declaration.jurisdictionRestrictions,
        declaration.termsVersion,
        declaration.verifiedAt,
        declaration.verificationExpiresAt,
      ],
    );
    return { declarationId };
  }

  /** The CURRENT (highest-version) declaration, or null when none exists. */
  async currentRights(
    providerId: string,
    operationId: string,
  ): Promise<(RightsDeclaration & { rightsVersion: number }) | null> {
    const rows = await this.engine.query<DeclarationRow>(
      `SELECT * FROM prov.prov_rights_declarations
       WHERE provider_id = $1 AND operation_id = $2
       ORDER BY rights_version DESC LIMIT 1`,
      [providerId, operationId],
    );
    const row = rows.rows[0];
    return row === undefined ? null : rowToDeclaration(row);
  }

  /** A SPECIFIC captured version (the artifact-ingestion lookup). */
  async rightsAtVersion(
    providerId: string,
    operationId: string,
    rightsVersion: number,
  ): Promise<(RightsDeclaration & { rightsVersion: number }) | null> {
    const rows = await this.engine.query<DeclarationRow>(
      `SELECT * FROM prov.prov_rights_declarations
       WHERE provider_id = $1 AND operation_id = $2 AND rights_version = $3`,
      [providerId, operationId, rightsVersion],
    );
    const row = rows.rows[0];
    return row === undefined ? null : rowToDeclaration(row);
  }

  /**
   * Records a change between consecutive versions with its computed diff.
   *
   * INV-009: a replay of the SAME transition (from→to) resolves to the SAME
   * change row — detected via the recorded change LEDGER, not the current
   * pointer, because this call itself advances the pointer. A replay carrying
   * DIFFERENT content than the recorded transition is refused outright: the
   * first-recorded outcome of a transition is immutable.
   */
  async changeRights(input: ChangeRightsInput): Promise<RightsChangeRecord> {
    const to = RightsDeclarationSchema.parse(input.declaration);
    const prior = await this.findChange(
      input.providerId,
      input.operationId,
      input.nextVersion - 1,
      input.nextVersion,
    );
    if (prior !== null) {
      const fromDecl = await this.rightsAtVersion(
        input.providerId,
        input.operationId,
        prior.from_rights_version,
      );
      if (fromDecl === null) {
        throw new RightsChangeError(
          'recorded change references a missing from-version declaration',
          { changeId: prior.change_id },
          ProvErrorCode.PROV_RIGHTS_VERSION_UNKNOWN,
        );
      }
      const { newlyProhibitedUses, tightened } = diffRights(fromDecl, to);
      const storedUses = [...prior.newly_prohibited_uses].sort().join(',');
      const freshUses = [...newlyProhibitedUses].sort().join(',');
      if (storedUses !== freshUses || prior.tightened !== tightened) {
        throw new RightsChangeError(
          `rights transition v${String(prior.from_rights_version)}→v${String(prior.to_rights_version)} was already recorded with DIFFERENT content; first outcome is immutable`,
          { changeId: prior.change_id },
          ProvErrorCode.PROV_RIGHTS_REACTIVATION_REQUIRES_REVERIFICATION,
        );
      }
      return {
        changeId: prior.change_id,
        fromRightsVersion: Number(prior.from_rights_version),
        toRightsVersion: Number(prior.to_rights_version),
        newlyProhibitedUses,
        tightened,
      };
    }

    const from = await this.currentRights(input.providerId, input.operationId);
    if (from === null) {
      throw new RightsChangeError(
        `no existing rights declaration for ${input.providerId}/${input.operationId}; declare v1 before changing`,
        {},
        ProvErrorCode.PROV_RIGHTS_VERSION_UNKNOWN,
      );
    }
    if (input.nextVersion !== from.rightsVersion + 1) {
      throw new RightsChangeError(
        `next rights version must be ${String(from.rightsVersion + 1)}; got ${String(input.nextVersion)}`,
        {},
        ProvErrorCode.PROV_RIGHTS_MATRIX_INVALID,
      );
    }
    const { newlyProhibitedUses, tightened } = diffRights(from, to);

    const changedAt = input.changedAt ?? this.clock.now();
    const changeId = `prc:${sha256Text(
      [
        input.providerId,
        input.operationId,
        String(from.rightsVersion),
        String(input.nextVersion),
      ].join('|'),
    )}`;

    const inserted = await this.engine.query<{ seq: number }>(
      `INSERT INTO prov.prov_rights_changes (
         change_id, provider_id, operation_id, from_rights_version,
         to_rights_version, newly_prohibited_uses, tightened, changed_at,
         actor, audit_chain_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (change_id) DO NOTHING
       RETURNING seq`,
      [
        changeId,
        input.providerId,
        input.operationId,
        from.rightsVersion,
        input.nextVersion,
        newlyProhibitedUses,
        tightened,
        changedAt,
        input.actor,
        `audit:${changeId}`,
      ],
    );
    const created = inserted.rows.length === 1;

    // The next version MUST be declarable after its change is recorded.
    await this.declareRights({
      providerId: input.providerId,
      operationId: input.operationId,
      rightsVersion: input.nextVersion,
      declaration: to,
    });

    if (created && this.audit !== undefined) {
      await this.audit.rightsChanged({
        providerId: input.providerId,
        operationId: input.operationId,
        changeId,
        fromRightsVersion: from.rightsVersion,
        toRightsVersion: input.nextVersion,
        newlyProhibitedUses,
        tightened,
        actor: input.actor,
        changedAt,
      });
    }

    return {
      changeId,
      fromRightsVersion: from.rightsVersion,
      toRightsVersion: input.nextVersion,
      newlyProhibitedUses,
      tightened,
    };
  }

  private async findChange(
    providerId: string,
    operationId: string,
    fromVersion: number,
    toVersion: number,
  ): Promise<{
    change_id: string;
    from_rights_version: number;
    to_rights_version: number;
    newly_prohibited_uses: string[];
    tightened: boolean;
  } | null> {
    const rows = await this.engine.query<{
      change_id: string;
      from_rights_version: number;
      to_rights_version: number;
      newly_prohibited_uses: string[];
      tightened: boolean;
    }>(
      `SELECT change_id, from_rights_version, to_rights_version,
              newly_prohibited_uses, tightened
       FROM prov.prov_rights_changes
       WHERE provider_id = $1 AND operation_id = $2
         AND from_rights_version = $3 AND to_rights_version = $4`,
      [providerId, operationId, fromVersion, toVersion],
    );
    const row = rows.rows[0];
    if (row === undefined) return null;
    return {
      change_id: row.change_id,
      from_rights_version: Number(row.from_rights_version),
      to_rights_version: Number(row.to_rights_version),
      newly_prohibited_uses: [...row.newly_prohibited_uses],
      tightened: row.tightened,
    };
  }

  /**
   * The immediate fail-closed decision API: evaluates use of ONE path under
   * the rights version CAPTURED AT ARTIFACT INGESTION. A missing declaration
   * refuses; an expired verification window refuses; a false gate refuses.
   */
  async decideForArtifact(input: {
    readonly providerId: string;
    readonly operationId: string;
    readonly capturedRightsVersion: number;
    readonly path: RightsUsePath;
  }): Promise<{ allowed: boolean }> {
    const declaration = await this.rightsAtVersion(
      input.providerId,
      input.operationId,
      input.capturedRightsVersion,
    );
    if (declaration === null) {
      throw new RightsChangeError(
        `rights version ${String(input.capturedRightsVersion)} unknown for ${input.providerId}/${input.operationId}; failing closed`,
        {},
        ProvErrorCode.PROV_RIGHTS_VERSION_UNKNOWN,
      );
    }
    if (
      new Date(iso(declaration.verificationExpiresAt)).getTime() <= this.clock.nowEpochMs()
    ) {
      throw new RightsChangeError(
        `rights verification expired at ${iso(declaration.verificationExpiresAt)}; ${input.path} fails closed`,
        {},
        ProvErrorCode.PROV_RIGHTS_VERIFICATION_EXPIRED,
      );
    }
    const gate = PATH_GATES[input.path];
    if (gate !== null && declaration[gate] !== true) {
      return { allowed: false };
    }
    return { allowed: true };
  }

  /** Decision for NEW captures against the CURRENT declaration. */
  async decideForNewCapture(input: {
    readonly providerId: string;
    readonly operationId: string;
    readonly path: RightsUsePath;
  }): Promise<{ allowed: boolean }> {
    const current = await this.currentRights(input.providerId, input.operationId);
    if (current === null) {
      throw new RightsChangeError(
        `no rights declaration for ${input.providerId}/${input.operationId}; capture fails closed`,
        {},
        ProvErrorCode.PROV_RIGHTS_VERSION_UNKNOWN,
      );
    }
    return this.decideForArtifact({
      ...input,
      capturedRightsVersion: current.rightsVersion,
    });
  }
}
