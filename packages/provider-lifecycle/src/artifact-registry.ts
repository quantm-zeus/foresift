/**
 * Provider-artifact registry (FR-PROV-009; AC-273; plan material decision 7).
 *
 * Every ingested provider artifact registers AT CAPTURE TIME with the rights
 * version that governed it. When a rights tightening lands, affected
 * artifacts (captured under the superseded version) are durably enumerated
 * into QUARANTINE-or-RETIRE actions — RETIRE when raw retention or export is
 * newly prohibited, QUARANTINE otherwise. Loosening NEVER silently reactivates
 * anything: an artifact returns to ACTIVE only through an explicit
 * reactivation that proves current RIGHTS reverification.
 */
import type { DatabaseEngine } from '@foresift/persistence';
import type { UtcTimestamp } from '@foresift/domain';
import type { OperationRef } from './operation-registry.ts';
import { RightsChangeError, RegistryError, ProvErrorCode } from './errors.ts';

export type ArtifactState = 'ACTIVE' | 'QUARANTINED' | 'RETIRED';

export interface ProviderArtifact {
  readonly artifactId: string;
  readonly objectRef: string;
  readonly ref: OperationRef;
  readonly rightsVersionAtCapture: string;
  readonly state: ArtifactState;
  readonly capturedAt: UtcTimestamp;
}

interface ArtifactRow {
  artifact_id: string;
  object_ref: string;
  provider_id: string;
  operation_id: string;
  operation_version: string;
  rights_version_at_capture: string;
  state: string;
  captured_at: Date | string;
}

function normalize(value: Date | string): UtcTimestamp {
  if (typeof value === 'string') return value as UtcTimestamp;
  return value.toISOString().replace('.000Z', 'Z') as UtcTimestamp;
}

function rowToArtifact(row: ArtifactRow): ProviderArtifact {
  return {
    artifactId: row.artifact_id,
    objectRef: row.object_ref,
    ref: {
      providerId: row.provider_id,
      operationId: row.operation_id,
      version: row.operation_version,
    },
    rightsVersionAtCapture: row.rights_version_at_capture,
    state: row.state as ArtifactState,
    capturedAt: normalize(row.captured_at),
  };
}

export class ArtifactRegistry {
  private readonly engine: DatabaseEngine;

  constructor(engine: DatabaseEngine) {
    this.engine = engine;
  }

  /** Capture-time registration: every artifact enters as ACTIVE. */
  async registerArtifact(input: {
    readonly artifactId: string;
    readonly objectRef: string;
    readonly ref: OperationRef;
    readonly rightsVersionAtCapture: string;
    readonly capturedAt: UtcTimestamp;
  }): Promise<ProviderArtifact> {
    try {
      await this.engine.query(
        `INSERT INTO prov.prov_provider_artifacts (
           artifact_id, object_ref, provider_id, operation_id,
           operation_version, rights_version_at_capture, state, captured_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', $7)`,
        [
          input.artifactId,
          input.objectRef,
          input.ref.providerId,
          input.ref.operationId,
          input.ref.version,
          input.rightsVersionAtCapture,
          input.capturedAt,
        ],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new RegistryError(
          `artifact '${input.artifactId}' or object ref '${input.objectRef}' is already registered`,
          { artifactId: input.artifactId, objectRef: input.objectRef },
          ProvErrorCode.PROV_OPERATION_ALREADY_REGISTERED,
        );
      }
      throw error;
    }
    return {
      artifactId: input.artifactId,
      objectRef: input.objectRef,
      ref: input.ref,
      rightsVersionAtCapture: input.rightsVersionAtCapture,
      state: 'ACTIVE',
      capturedAt: input.capturedAt,
    };
  }

  async getArtifact(artifactId: string): Promise<ProviderArtifact> {
    const rows = await this.engine.query<ArtifactRow>(
      'SELECT * FROM prov.prov_provider_artifacts WHERE artifact_id = $1',
      [artifactId],
    );
    const row = rows.rows[0];
    if (row === undefined) {
      throw new RegistryError(
        `artifact ${artifactId} is not registered`,
        { artifactId },
        ProvErrorCode.PROV_OPERATION_UNKNOWN,
      );
    }
    return rowToArtifact(row);
  }

  async findByObjectRef(objectRef: string): Promise<ProviderArtifact | undefined> {
    const rows = await this.engine.query<ArtifactRow>(
      'SELECT * FROM prov.prov_provider_artifacts WHERE object_ref = $1',
      [objectRef],
    );
    const row = rows.rows[0];
    return row === undefined ? undefined : rowToArtifact(row);
  }

  /**
   * Active artifacts of these operations whose governing rights version is
   * exactly the superseded one — the tightening's blast radius.
   */
  async enumerateAffected(
    refs: ReadonlyArray<Pick<OperationRef, 'providerId' | 'operationId'>>,
    rightsVersionAtCapture: string,
  ): Promise<ProviderArtifact[]> {
    const affected: ProviderArtifact[] = [];
    for (const { providerId, operationId } of refs) {
      const rows = await this.engine.query<ArtifactRow>(
        `SELECT * FROM prov.prov_provider_artifacts
         WHERE provider_id = $1 AND operation_id = $2
           AND rights_version_at_capture = $3 AND state = 'ACTIVE'
         ORDER BY artifact_id`,
        [providerId, operationId, rightsVersionAtCapture],
      );
      affected.push(...rows.rows.map(rowToArtifact));
    }
    return affected;
  }

  /**
   * Durably record each (change, artifact → action) pair exactly once and
   * move the artifact out of ACTIVE. Idempotent on the UNIQUE
   * (change_id, artifact_id) constraint.
   */
  async executeActions(input: {
    readonly changeId: string;
    readonly entries: ReadonlyArray<{ readonly artifactId: string; readonly action: 'QUARANTINE' | 'RETIRE' }>;
    readonly executedBy: string;
    readonly executedAt: UtcTimestamp;
  }): Promise<void> {
    for (const entry of input.entries) {
      await this.engine.transaction(async (tx) => {
        const inserted = await tx.query<{ action_id: string }>(
          `INSERT INTO prov.prov_rights_change_actions (
             action_id, change_id, artifact_id, action, executed_at, executed_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (change_id, artifact_id) DO NOTHING
           RETURNING action_id`,
          [
            `${input.changeId}:${entry.artifactId}`,
            input.changeId,
            entry.artifactId,
            entry.action,
            input.executedAt,
            input.executedBy,
          ],
        );
        if (inserted.rows.length > 0) {
          await tx.query('UPDATE prov.prov_provider_artifacts SET state = $2 WHERE artifact_id = $1', [
            entry.artifactId,
            entry.action === 'RETIRE' ? 'RETIRED' : 'QUARANTINED',
          ]);
        }
      });
    }
  }

  /**
   * Explicit reactivation. Requires BOTH non-empty reverification evidence
   * AND a currently-fresh RIGHTS PASS verification for the operation —
   * otherwise refuses with PROV_RIGHTS_REACTIVATION_REVERIFICATION_REQUIRED.
   * A loosened declaration alone reactivates nothing.
   */
  async reactivate(input: {
    readonly artifactId: string;
    readonly actor: string;
    readonly at: UtcTimestamp;
    readonly reverificationEvidenceRefs: readonly string[];
  }): Promise<ProviderArtifact> {
    const artifact = await this.getArtifact(input.artifactId);
    if (input.reverificationEvidenceRefs.length === 0) {
      throw new RightsChangeError(
        `reactivation of ${input.artifactId} requires reverification evidence; a loosened declaration alone reactivates nothing`,
        { artifactId: input.artifactId },
        ProvErrorCode.PROV_RIGHTS_REACTIVATION_REVERIFICATION_REQUIRED,
      );
    }
    const fresh = await this.engine.query<{ expires_at: Date | string }>(
      `SELECT expires_at FROM prov.prov_verification_records
       WHERE provider_id = $1 AND operation_id = $2 AND operation_version = $3
         AND kind = 'RIGHTS' AND outcome = 'PASS' AND expires_at > $4
       ORDER BY expires_at DESC LIMIT 1`,
      [artifact.ref.providerId, artifact.ref.operationId, artifact.ref.version, input.at],
    );
    if (fresh.rows.length === 0) {
      throw new RightsChangeError(
        `reactivation of ${input.artifactId} refused: no fresh RIGHTS verification covers the operation at ${input.at}`,
        { artifactId: input.artifactId },
        ProvErrorCode.PROV_RIGHTS_REACTIVATION_REVERIFICATION_REQUIRED,
      );
    }
    await this.engine.query(
      "UPDATE prov.prov_provider_artifacts SET state = 'ACTIVE' WHERE artifact_id = $1",
      [input.artifactId],
    );
    return { ...artifact, state: 'ACTIVE' };
  }
}
