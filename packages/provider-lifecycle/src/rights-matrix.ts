/**
 * Rights matrix (FR-PROV-009, §15.6 sixteen fields; AC-273).
 *
 * Declarations are immutable history keyed by rights version. A recorded
 * change is always a TIGHTENING: the diff between the two declarations'
 * use-path fields is computed here and must be non-empty. Tightening
 * decisions are IMMEDIATE and fail-closed:
 *
 *   - live use decisions read the CURRENT declaration (absence refuses);
 *   - stored-material decisions additionally honour the rights version
 *     CAPTURED at ingestion — a use path prohibited by any tightening after
 *     capture stays refused even if a later declaration loosens it, unless
 *     the bound artifact was explicitly reactivated with reverification
 *     through the artifact registry.
 */
import type { DatabaseEngine } from '@foresift/persistence';
import type { UtcTimestamp } from '@foresift/domain';
import type { OperationRef } from './operation-registry.ts';
import { RIGHTS_USE_PATHS, type RightsUsePath } from './vocabularies.ts';
import { RightsChangeError, ProvErrorCode } from './errors.ts';
import type { ArtifactRegistry } from './artifact-registry.ts';
import type { LifecycleAuditBridge } from './audit-bridges.ts';

/** The sixteen §15.6 declaration fields (identity + provenance included). */
export interface RightsDeclarationInput {
  readonly ref: OperationRef;
  readonly rightsVersion: string;
  readonly commercialUseAllowed: boolean;
  readonly personalResearchAllowed: boolean;
  readonly cacheAllowed: boolean;
  readonly maximumCacheDuration: string | null;
  readonly rawRetentionAllowed: boolean;
  readonly derivedFeaturesAllowed: boolean;
  readonly modelTrainingAllowed: boolean;
  readonly redistributionAllowed: boolean;
  readonly publicAlertDerivativeAllowed: boolean;
  readonly attributionRequired: boolean;
  readonly userByokRequired: boolean;
  readonly rawExportAllowed: boolean;
  readonly jurisdictionRestrictions: readonly string[];
  readonly termsVersion: string;
  readonly verifiedAt: UtcTimestamp;
  readonly verificationExpiresAt: UtcTimestamp;
}

export type RightsDeclaration = RightsDeclarationInput & {
  readonly providerId: string;
  readonly operationId: string;
  readonly operationVersion: string;
};

/**
 * Use path → the declaration field(s) that govern it. STORAGE shares the raw
 * retention flag; CACHE additionally honours the maximum duration.
 */
export const USE_PATH_FIELD_MAP: Readonly<Record<RightsUsePath, 'cacheAllowed' | 'rawRetentionAllowed' | 'rawExportAllowed' | 'redistributionAllowed' | 'modelTrainingAllowed' | 'derivedFeaturesAllowed'>> = {
  CACHE: 'cacheAllowed',
  RAW_RETENTION: 'rawRetentionAllowed',
  EXPORT: 'rawExportAllowed',
  REDISTRIBUTION: 'redistributionAllowed',
  MODEL_USE: 'modelTrainingAllowed',
  STORAGE: 'rawRetentionAllowed',
  DERIVED_FEATURES: 'derivedFeaturesAllowed',
};

export interface UseDecision {
  readonly allowed: boolean;
  readonly usePath: RightsUsePath;
  /** Rights version the decision was evaluated against. */
  readonly evaluatedAgainstRightsVersion: string;
  /** Present when allowed under CACHE: the declared maximum duration. */
  readonly maximumCacheDuration?: string;
}

interface DeclarationRow {
  declaration_id: string;
  provider_id: string;
  operation_id: string;
  operation_version: string;
  rights_version: string;
  commercial_use_allowed: boolean;
  personal_research_allowed: boolean;
  cache_allowed: boolean;
  maximum_cache_duration: string | null;
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
}

function normalize(value: Date | string): UtcTimestamp {
  if (typeof value === 'string') return value as UtcTimestamp;
  return value.toISOString().replace('.000Z', 'Z') as UtcTimestamp;
}

function rowToDeclaration(row: DeclarationRow): RightsDeclaration {
  return {
    providerId: row.provider_id,
    operationId: row.operation_id,
    operationVersion: row.operation_version,
    ref: {
      providerId: row.provider_id,
      operationId: row.operation_id,
      version: row.operation_version,
    },
    rightsVersion: row.rights_version,
    commercialUseAllowed: row.commercial_use_allowed,
    personalResearchAllowed: row.personal_research_allowed,
    cacheAllowed: row.cache_allowed,
    maximumCacheDuration: row.maximum_cache_duration,
    rawRetentionAllowed: row.raw_retention_allowed,
    derivedFeaturesAllowed: row.derived_features_allowed,
    modelTrainingAllowed: row.model_training_allowed,
    redistributionAllowed: row.redistribution_allowed,
    publicAlertDerivativeAllowed: row.public_alert_derivative_allowed,
    attributionRequired: row.attribution_required,
    userByokRequired: row.user_byok_required,
    rawExportAllowed: row.raw_export_allowed,
    jurisdictionRestrictions: Array.isArray(row.jurisdiction_restrictions)
      ? (row.jurisdiction_restrictions as string[])
      : [],
    termsVersion: row.terms_version,
    verifiedAt: normalize(row.verified_at),
    verificationExpiresAt: normalize(row.verification_expires_at),
  };
}

export interface RecordedRightsChange {
  readonly changeId: string;
  readonly fromRightsVersion: string;
  readonly toRightsVersion: string;
  readonly newlyProhibitedUses: readonly RightsUsePath[];
}

export class RightsMatrix {
  private readonly engine: DatabaseEngine;
  private readonly artifacts: ArtifactRegistry | undefined;
  private readonly bridge: LifecycleAuditBridge | undefined;

  constructor(
    engine: DatabaseEngine,
    artifacts?: ArtifactRegistry,
    bridge?: LifecycleAuditBridge,
  ) {
    this.engine = engine;
    this.artifacts = artifacts;
    this.bridge = bridge;
  }

  /**
   * Record one immutable declaration version. Newer versions never rewrite
   * older ones; tightening flows through {@link recordChange}.
   */
  async declare(input: RightsDeclarationInput): Promise<RightsDeclaration> {
    if (!(input.verificationExpiresAt > input.verifiedAt)) {
      throw new RightsChangeError(
        'rights verification window invalid: expiry must be strictly after verification instant',
        { rightsVersion: input.rightsVersion },
        ProvErrorCode.PROV_RIGHTS_VERIFICATION_EXPIRED,
      );
    }
    if (input.cacheAllowed && (input.maximumCacheDuration === null || input.maximumCacheDuration === '')) {
      throw new RightsChangeError(
        'a declaration allowing caching must carry its maximum cache duration',
        { rightsVersion: input.rightsVersion },
        ProvErrorCode.PROV_DEFINITION_INVALID,
      );
    }
    const declarationId = `${input.ref.providerId}:${input.ref.operationId}:${input.ref.version}:${input.rightsVersion}`;
    await this.engine.query(
      `INSERT INTO prov.prov_rights_declarations (
         declaration_id, provider_id, operation_id, operation_version,
         rights_version, commercial_use_allowed, personal_research_allowed,
         cache_allowed, maximum_cache_duration, raw_retention_allowed,
         derived_features_allowed, model_training_allowed, redistribution_allowed,
         public_alert_derivative_allowed, attribution_required, user_byok_required,
         raw_export_allowed, jurisdiction_restrictions, terms_version,
         verified_at, verification_expires_at)
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
         $17, $18::jsonb, $19, $20, $21)`,
      [
        declarationId,
        input.ref.providerId,
        input.ref.operationId,
        input.ref.version,
        input.rightsVersion,
        input.commercialUseAllowed,
        input.personalResearchAllowed,
        input.cacheAllowed,
        input.maximumCacheDuration,
        input.rawRetentionAllowed,
        input.derivedFeaturesAllowed,
        input.modelTrainingAllowed,
        input.redistributionAllowed,
        input.publicAlertDerivativeAllowed,
        input.attributionRequired,
        input.userByokRequired,
        input.rawExportAllowed,
        JSON.stringify([...input.jurisdictionRestrictions]),
        input.termsVersion,
        input.verifiedAt,
        input.verificationExpiresAt,
      ],
    );
    return { ...input, providerId: input.ref.providerId, operationId: input.ref.operationId, operationVersion: input.ref.version };
  }

  /** Latest-declared version for an operation (highest verified_at). */
  async currentDeclaration(ref: OperationRef): Promise<RightsDeclaration | undefined> {
    const rows = await this.engine.query<DeclarationRow>(
      `SELECT * FROM prov.prov_rights_declarations
       WHERE provider_id = $1 AND operation_id = $2 AND operation_version = $3
       ORDER BY verified_at DESC, rights_version DESC LIMIT 1`,
      [ref.providerId, ref.operationId, ref.version],
    );
    const row = rows.rows[0];
    return row === undefined ? undefined : rowToDeclaration(row);
  }

  async declarationAt(ref: OperationRef, rightsVersion: string): Promise<RightsDeclaration> {
    const rows = await this.engine.query<DeclarationRow>(
      `SELECT * FROM prov.prov_rights_declarations
       WHERE provider_id = $1 AND operation_id = $2 AND operation_version = $3 AND rights_version = $4`,
      [ref.providerId, ref.operationId, ref.version, rightsVersion],
    );
    const row = rows.rows[0];
    if (row === undefined) {
      throw new RightsChangeError(
        `rights version ${rightsVersion} was never declared for ${ref.providerId}/${ref.operationId}@${ref.version}`,
        { rightsVersion, ref: JSON.stringify(ref) },
        ProvErrorCode.PROV_RIGHTS_VERSION_UNKNOWN,
      );
    }
    return rowToDeclaration(row);
  }

  /**
   * Record a tightening from→to. Computes newly-prohibited use paths from
   * the two declarations' fields; an empty diff is refused (that is not a
   * rights change). With an ArtifactRegistry wired, affected ACTIVE
   * artifacts captured under the FROM version are enumerated into durable
   * QUARANTINE/RETIRE actions (RETIRE when raw retention or export is among
   * the new prohibitions), and the whole event is audited.
   */
  async recordChange(input: {
    readonly changeId: string;
    readonly ref: OperationRef;
    readonly fromRightsVersion: string;
    readonly toRightsVersion: string;
    readonly changedAt: UtcTimestamp;
    readonly declaredBy: string;
    readonly evidenceRefs: readonly string[];
  }): Promise<RecordedRightsChange> {
    const from = await this.declarationAt(input.ref, input.fromRightsVersion);
    const to = await this.declarationAt(input.ref, input.toRightsVersion);

    const newlyProhibited = RIGHTS_USE_PATHS.filter((path) => {
      const field = USE_PATH_FIELD_MAP[path];
      return from[field] === true && to[field] === false;
    });
    if (newlyProhibited.length === 0) {
      throw new RightsChangeError(
        `declaration diff ${input.fromRightsVersion}→${input.toRightsVersion} prohibits no new use path; recording it would dilute the tightening history`,
        {
          fromRightsVersion: input.fromRightsVersion,
          toRightsVersion: input.toRightsVersion,
        },
        ProvErrorCode.PROV_DEFINITION_INVALID,
      );
    }

    // Durable action enumeration BEFORE the audit entry so the entry can name it.
    const affected =
      this.artifacts !== undefined
        ? await this.artifacts.enumerateAffected(
            [{ providerId: input.ref.providerId, operationId: input.ref.operationId }],
            input.fromRightsVersion,
          )
        : [];
    const entries = affected.map((artifact) => ({
      artifactId: artifact.artifactId,
      action: (newlyProhibited.includes('RAW_RETENTION') || newlyProhibited.includes('EXPORT')
        ? 'RETIRE'
        : 'QUARANTINE') as 'RETIRE' | 'QUARANTINE',
    }));

    await this.engine.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO prov.prov_rights_changes (
           change_id, provider_id, operation_id, from_rights_version,
           to_rights_version, newly_prohibited_uses, changed_at, declared_by, evidence_refs)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [
          input.changeId,
          input.ref.providerId,
          input.ref.operationId,
          input.fromRightsVersion,
          input.toRightsVersion,
          newlyProhibited,
          input.changedAt,
          input.declaredBy,
          JSON.stringify([...input.evidenceRefs]),
        ],
      );
      if (this.artifacts !== undefined && entries.length > 0) {
        for (const entry of entries) {
          await tx.query(
            `INSERT INTO prov.prov_rights_change_actions (
               action_id, change_id, artifact_id, action, executed_at, executed_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (change_id, artifact_id) DO NOTHING`,
            [
              `${input.changeId}:${entry.artifactId}`,
              input.changeId,
              entry.artifactId,
              entry.action,
              input.changedAt,
              input.declaredBy,
            ],
          );
          await tx.query(
            'UPDATE prov.prov_provider_artifacts SET state = $2 WHERE artifact_id = $1',
            [entry.artifactId, entry.action === 'RETIRE' ? 'RETIRED' : 'QUARANTINED'],
          );
        }
      }
    });

    if (this.bridge !== undefined) {
      await this.bridge.recordRightsChange({
        changedAt: input.changedAt,
        actor: input.declaredBy,
        changeId: input.changeId,
        ref: { providerId: input.ref.providerId, operationId: input.ref.operationId },
        newlyProhibitedUses: newlyProhibited,
        affectedArtifactActions: entries,
      });
    }
    return {
      changeId: input.changeId,
      fromRightsVersion: input.fromRightsVersion,
      toRightsVersion: input.toRightsVersion,
      newlyProhibitedUses: newlyProhibited,
    };
  }

  /**
   * Fail-closed use-path decision at injected instant `at`.
   *
   * Without capture context this evaluates the CURRENT declaration only.
   * With capture context (`capturedRightsVersion` + `capturedAt`), material
   * ingested before a tightening that prohibited this path stays REFUSED —
   * the loosening never silently reactivates it. Only an explicit artifact
   * reactivation (with reverification, via the registry) restores the path
   * for that specific artifact.
   */
  async decideUse(input: {
    readonly ref: OperationRef;
    readonly usePath: RightsUsePath;
    readonly at: UtcTimestamp;
    readonly capturedRightsVersion?: string;
    readonly capturedAt?: UtcTimestamp;
    readonly artifactId?: string;
  }): Promise<UseDecision> {
    const current = await this.currentDeclaration(input.ref);
    if (current === undefined) {
      throw new RightsChangeError(
        `no rights declaration exists for ${input.ref.providerId}/${input.ref.operationId}@${input.ref.version}; absence refuses every use path`,
        { usePath: input.usePath, ref: JSON.stringify(input.ref) },
        ProvErrorCode.PROV_RIGHTS_VERSION_UNKNOWN,
      );
    }
    if (!(current.verificationExpiresAt > input.at)) {
      throw new RightsChangeError(
        `rights verification expired at ${current.verificationExpiresAt} (now ${input.at}); use paths refuse fail-closed until re-verified`,
        { usePath: input.usePath, expiredAt: current.verificationExpiresAt },
        ProvErrorCode.PROV_RIGHTS_VERIFICATION_EXPIRED,
      );
    }

    const evaluateAgainst = input.capturedRightsVersion ?? current.rightsVersion;
    const declaration =
      evaluateAgainst === current.rightsVersion
        ? current
        : await this.declarationAt(input.ref, evaluateAgainst);

    const field = USE_PATH_FIELD_MAP[input.usePath];
    if (declaration[field] !== true) {
      throw new RightsChangeError(
        `use path ${input.usePath} is prohibited by rights version ${declaration.rightsVersion}`,
        {
          usePath: input.usePath,
          rightsVersion: declaration.rightsVersion,
          captured: input.capturedRightsVersion !== undefined,
        },
        ProvErrorCode.PROV_RIGHTS_USE_PATH_PROHIBITED,
      );
    }

    // Captured material: any tightening of THIS path recorded after capture
    // keeps it refused, regardless of later loosened declarations — except
    // when the bound artifact has been explicitly re-verified back to ACTIVE.
    if (input.capturedRightsVersion !== undefined && input.capturedAt !== undefined) {
      const tightenedAfterCapture = await this.engine.query<{ change_id: string; changed_at: Date | string }>(
        `SELECT change_id, changed_at FROM prov.prov_rights_changes
         WHERE provider_id = $1 AND operation_id = $2
           AND changed_at >= $3 AND $4 = ANY(newly_prohibited_uses)
         ORDER BY changed_at DESC LIMIT 1`,
        [
          input.ref.providerId,
          input.ref.operationId,
          input.capturedAt,
          input.usePath,
        ],
      );
      const tightening = tightenedAfterCapture.rows[0];
      if (tightening !== undefined) {
        let reactivated = false;
        if (input.artifactId !== undefined && this.artifacts !== undefined) {
          const artifact = await this.artifacts.getArtifact(input.artifactId);
          reactivated = artifact.state === 'ACTIVE';
        }
        if (!reactivated) {
          throw new RightsChangeError(
            `use path ${input.usePath} was tightened after capture (${tightening.change_id}) and the material was not explicitly re-verified; loosening never silently reactivates it`,
            {
              usePath: input.usePath,
              changeId: tightening.change_id,
              artifactId: input.artifactId ?? null,
            },
            ProvErrorCode.PROV_RIGHTS_USE_PATH_PROHIBITED,
          );
        }
      }
    }

    return {
      allowed: true,
      usePath: input.usePath,
      evaluatedAgainstRightsVersion: declaration.rightsVersion,
      ...(field === 'cacheAllowed' && declaration.maximumCacheDuration !== null
        ? { maximumCacheDuration: declaration.maximumCacheDuration }
        : {}),
    };
  }
}
