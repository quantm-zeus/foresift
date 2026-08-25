/**
 * Rights matrix (FR-PROV-009; §15.6, AC-273). Versioned sixteen-field rights
 * declarations per operation; every version change computes the set of use
 * paths that became PROHIBITED (the tightening delta), records a durable
 * change row, and attests it through the audit bridge. Loosening a right —
 * re-permitting a previously prohibited path — requires a CURRENTLY VALID
 * verification window on the new declaration, else refusal. Use-time
 * decisions evaluate against the rights version CAPTURED AT INGESTION and
 * fail closed when that version is unknown or its verification lapsed.
 */
import type { ClockPort } from '@foresift/domain';
import { fixedClock, utcTimestamp } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import {
  ProvErrorCode,
  RightsChangeError,
} from './errors.ts';
import {
  RightsChangeRecordSchema,
  RightsDeclarationRecordSchema,
  type RightsChangeRecord,
  type RightsMatrix,
  type RightsDeclarationRecord,
  type RightsUsePath,
} from './schemas.ts';
import type { ProviderAuditBridge } from './audit-bridges.ts';

/** Each gated use path is governed by exactly one matrix boolean. */
export const USE_PATH_FIELD: Record<RightsUsePath, keyof RightsMatrix> = {
  COMMERCIAL_USE: 'commercialUseAllowed',
  PERSONAL_RESEARCH: 'personalResearchAllowed',
  CACHE: 'cacheAllowed',
  RAW_RETENTION_STORAGE: 'rawRetentionAllowed',
  DERIVED_FEATURES: 'derivedFeaturesAllowed',
  MODEL_TRAINING_USE: 'modelTrainingAllowed',
  REDISTRIBUTION: 'redistributionAllowed',
  PUBLIC_ALERT_DERIVATIVE: 'publicAlertDerivativeAllowed',
  RAW_EXPORT: 'rawExportAllowed',
};

export const USE_PATHS: readonly RightsUsePath[] = Object.keys(USE_PATH_FIELD) as RightsUsePath[];

interface DeclarationRow {
  provider_id: string;
  operation_id: string;
  rights_version: number;
  commercial_use_allowed: boolean;
  personal_research_allowed: boolean;
  cache_allowed: boolean;
  maximum_cache_duration_seconds: string | number | null;
  raw_retention_allowed: boolean;
  derived_features_allowed: boolean;
  model_training_allowed: boolean;
  redistribution_allowed: boolean;
  public_alert_derivative_allowed: boolean;
  attribution_required: boolean;
  user_byok_required: boolean;
  raw_export_allowed: boolean;
  jurisdiction_restrictions: unknown;
  terms_version: string;
  verified_at: Date | string;
  verification_expires_at: Date | string;
  declared_at: Date | string;
}

function iso(value: Date | string): string {
  return typeof value === 'string'
    ? value.replace(' ', 'T')
    : value.toISOString().replace('.000Z', 'Z');
}

function num(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

function rowToDeclaration(row: DeclarationRow): RightsDeclarationRecord {
  return RightsDeclarationRecordSchema.parse({
    providerId: row.provider_id,
    operationId: row.operation_id,
    rightsVersion: Number(row.rights_version),
    matrix: {
      commercialUseAllowed: row.commercial_use_allowed,
      personalResearchAllowed: row.personal_research_allowed,
      cacheAllowed: row.cache_allowed,
      maximumCacheDurationSeconds: num(row.maximum_cache_duration_seconds),
      rawRetentionAllowed: row.raw_retention_allowed,
      derivedFeaturesAllowed: row.derived_features_allowed,
      modelTrainingAllowed: row.model_training_allowed,
      redistributionAllowed: row.redistribution_allowed,
      publicAlertDerivativeAllowed: row.public_alert_derivative_allowed,
      attributionRequired: row.attribution_required,
      userByokRequired: row.user_byok_required,
      rawExportAllowed: row.raw_export_allowed,
      jurisdictionRestrictions: row.jurisdiction_restrictions,
      termsVersion: row.terms_version,
      verifiedAt: iso(row.verified_at),
      verificationExpiresAt: iso(row.verification_expires_at),
    },
    declaredAt: iso(row.declared_at),
  });
}

interface ChangeRow {
  change_id: string;
  provider_id: string;
  operation_id: string;
  from_rights_version: number;
  to_rights_version: number;
  newly_prohibited_uses: unknown;
  changed_at: Date | string;
  changed_by: string;
}

function rowToChange(row: ChangeRow): RightsChangeRecord {
  return RightsChangeRecordSchema.parse({
    changeId: row.change_id,
    providerId: row.provider_id,
    operationId: row.operation_id,
    fromRightsVersion: Number(row.from_rights_version),
    toRightsVersion: Number(row.to_rights_version),
    newlyProhibitedUses: row.newly_prohibited_uses,
    changedAt: iso(row.changed_at),
    changedBy: row.changed_by,
  });
}

export interface RightsDeclareInput {
  readonly providerId: string;
  readonly operationId: string;
  readonly matrix: RightsMatrix;
  readonly actor: string;
}

export class RightsMatrixService {
  private readonly engine: DatabaseEngine;
  private readonly clock: ClockPort;
  private readonly audit: ProviderAuditBridge | undefined;

  constructor(options: {
    readonly engine: DatabaseEngine;
    /** Injected clock (Constitution XI). */
    readonly clock?: ClockPort;
    /** Chain bridge for RIGHTS_CHANGE attestations (AC-259/AC-273). */
    readonly audit?: ProviderAuditBridge;
  }) {
    this.engine = options.engine;
    this.clock = options.clock ?? fixedClock(utcTimestamp('1970-01-01T00:00:00Z'));
    this.audit = options.audit;
  }

  /** Latest declared version, or undefined when none exists. */
  async latest(providerId: string, operationId: string): Promise<RightsDeclarationRecord | undefined> {
    const rows = await this.engine.query<DeclarationRow>(
      `SELECT * FROM prov.prov_rights_declarations
       WHERE provider_id = $1 AND operation_id = $2
       ORDER BY rights_version DESC LIMIT 1`,
      [providerId, operationId],
    );
    const row = rows.rows[0];
    return row === undefined ? undefined : rowToDeclaration(row);
  }

  async getVersion(
    providerId: string,
    operationId: string,
    rightsVersion: number,
  ): Promise<RightsDeclarationRecord | undefined> {
    const rows = await this.engine.query<DeclarationRow>(
      `SELECT * FROM prov.prov_rights_declarations
       WHERE provider_id = $1 AND operation_id = $2 AND rights_version = $3`,
      [providerId, operationId, rightsVersion],
    );
    const row = rows.rows[0];
    return row === undefined ? undefined : rowToDeclaration(row);
  }

  async listChanges(providerId: string, operationId: string): Promise<RightsChangeRecord[]> {
    const rows = await this.engine.query<ChangeRow>(
      `SELECT * FROM prov.prov_rights_changes
       WHERE provider_id = $1 AND operation_id = $2 ORDER BY to_rights_version ASC`,
      [providerId, operationId],
    );
    return rows.rows.map(rowToChange);
  }

  /**
   * Declare a NEW version (monotonic). The tightening delta
   * (newlyProhibitedUses) is computed against the immediately previous
   * version; any LOOSENING (a previously false boolean becoming true)
   * demands the new declaration carry a verification window still open at
   * the current instant. First versions loosen nothing by construction.
   */
  async declareVersion(input: RightsDeclareInput): Promise<{
    declaration: RightsDeclarationRecord;
    change?: RightsChangeRecord;
  }> {
    const now = this.clock.now();
    const previous = await this.latest(input.providerId, input.operationId);
    const nextVersion = (previous?.rightsVersion ?? 0) + 1;

    if (
      Date.parse(input.matrix.verificationExpiresAt) <=
      Date.parse(input.matrix.verifiedAt)
    ) {
      throw new RightsChangeError(
        'rights declaration verification window is empty or inverted',
        {},
        ProvErrorCode.PROV_RIGHTS_DECLARATION_INVALID,
      );
    }

    // The tightening/loosening delta — computed BEFORE anything persists.
    let newlyProhibitedUses: RightsUsePath[] = [];
    let loosenedUses: RightsUsePath[] = [];
    if (previous !== undefined) {
      newlyProhibitedUses = USE_PATHS.filter(
        (path) =>
          previous.matrix[USE_PATH_FIELD[path]] === true &&
          input.matrix[USE_PATH_FIELD[path]] === false,
      );
      loosenedUses = USE_PATHS.filter(
        (path) =>
          previous.matrix[USE_PATH_FIELD[path]] === false &&
          input.matrix[USE_PATH_FIELD[path]] === true,
      );
      if (loosenedUses.length > 0 && Date.parse(input.matrix.verificationExpiresAt) <= this.clock.nowEpochMs()) {
        throw new RightsChangeError(
          'loosening rights re-permits prohibited uses — a currently valid verification window is required',
          { loosenedUses: loosenedUses.join(',') },
          ProvErrorCode.PROV_RIGHTS_REACTIVATION_REQUIRES_REVERIFICATION,
        );
      }
    }

    const inserted = await this.engine.query<DeclarationRow>(
      `INSERT INTO prov.prov_rights_declarations (
         provider_id, operation_id, rights_version,
         commercial_use_allowed, personal_research_allowed, cache_allowed,
         maximum_cache_duration_seconds, raw_retention_allowed,
         derived_features_allowed, model_training_allowed,
         redistribution_allowed, public_alert_derivative_allowed,
         attribution_required, user_byok_required, raw_export_allowed,
         jurisdiction_restrictions, terms_version, verified_at,
         verification_expires_at, declared_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19,$20)
       RETURNING *`,
      [
        input.providerId,
        input.operationId,
        nextVersion,
        input.matrix.commercialUseAllowed,
        input.matrix.personalResearchAllowed,
        input.matrix.cacheAllowed,
        input.matrix.maximumCacheDurationSeconds,
        input.matrix.rawRetentionAllowed,
        input.matrix.derivedFeaturesAllowed,
        input.matrix.modelTrainingAllowed,
        input.matrix.redistributionAllowed,
        input.matrix.publicAlertDerivativeAllowed,
        input.matrix.attributionRequired,
        input.matrix.userByokRequired,
        input.matrix.rawExportAllowed,
        JSON.stringify(input.matrix.jurisdictionRestrictions),
        input.matrix.termsVersion,
        input.matrix.verifiedAt,
        input.matrix.verificationExpiresAt,
        now,
      ],
    );
    const declaration = rowToDeclaration(inserted.rows[0]!);

    if (previous === undefined) {
      return { declaration };
    }

    const change: RightsChangeRecord = {
      changeId: `prov-rights-change:${input.providerId}:${input.operationId}:${nextVersion}`,
      providerId: input.providerId,
      operationId: input.operationId,
      fromRightsVersion: previous.rightsVersion,
      toRightsVersion: nextVersion,
      newlyProhibitedUses,
      changedAt: now,
      changedBy: input.actor,
    };
    await this.engine.query(
      `INSERT INTO prov.prov_rights_changes (
         change_id, provider_id, operation_id, from_rights_version,
         to_rights_version, newly_prohibited_uses, changed_at, changed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        change.changeId,
        change.providerId,
        change.operationId,
        change.fromRightsVersion,
        change.toRightsVersion,
        newlyProhibitedUses,
        change.changedAt,
        change.changedBy,
      ],
    );
    if (this.audit !== undefined) {
      await this.audit.rightsChange({
        occurredAt: utcTimestamp(change.changedAt),
        actor: change.changedBy,
        providerId: change.providerId,
        operationId: change.operationId,
        fromRightsVersion: change.fromRightsVersion,
        toRightsVersion: change.toRightsVersion,
        newlyProhibitedUses: change.newlyProhibitedUses,
        changeId: change.changeId,
      });
    }
    return { declaration, change };
  }

  /**
   * Use-time decision evaluated against the rights version CAPTURED AT
   * INGESTION (fail-closed): unknown captured version refuses; an expired
   * verification window refuses even when the governing boolean is true.
   */
  async decideUsePath(input: {
    readonly providerId: string;
    readonly operationId: string;
    readonly capturedRightsVersion: number;
    readonly usePath: RightsUsePath;
  }): Promise<{ allowed: boolean; reason: string }> {
    const declaration = await this.getVersion(
      input.providerId,
      input.operationId,
      input.capturedRightsVersion,
    );
    if (declaration === undefined) {
      throw new RightsChangeError(
        `captured rights version ${input.capturedRightsVersion} does not exist — refusing fail-closed`,
        { capturedRightsVersion: input.capturedRightsVersion },
        ProvErrorCode.PROV_RIGHTS_VERSION_UNKNOWN,
      );
    }
    if (Date.parse(declaration.matrix.verificationExpiresAt) <= this.clock.nowEpochMs()) {
      return { allowed: false, reason: 'VERIFICATION_EXPIRED' };
    }
    const allowed = declaration.matrix[USE_PATH_FIELD[input.usePath]] === true;
    return { allowed, reason: allowed ? 'RIGHT_GRANTED' : 'RIGHT_PROHIBITED' };
  }
}
