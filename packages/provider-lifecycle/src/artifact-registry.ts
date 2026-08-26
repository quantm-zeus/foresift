/**
 * Provider artifact registry — capture-time registration and rights-change
 * enforcement over stored artifacts (FR-PROV-009, AC-273; T121).
 *
 *   * every persisted provider artifact is registered with the rights
 *     version CAPTURED AT INGESTION — that binding is what makes a later
 *     tightening retroactively enforceable;
 *   * applying a rights change enumerates every still-ACTIVE artifact whose
 *     captured version predates the change's target version and executes a
 *     QUARANTINE (use paths closed) or RETIRE (STORAGE itself revoked)
 *     action per artifact;
 *   * action rows are INV-009-fenced on (change_id, artifact_id) so replayed
 *     change executions resolve to the SAME ledger; state updates guard on
 *     `state = 'ACTIVE'` so an enforcement pass can never loosen a row;
 *   * there is NO reactivation path: loosening a right never silently
 *     revives quarantined or retired artifacts — re-capture under the new
 *     rights version is the only road back.
 */
import type { DatabaseEngine } from '@foresift/persistence';
import { sha256Text } from '@foresift/persistence';
import type { ClockPort, UtcTimestamp } from '@foresift/domain';
import { ProvErrorCode, RegistryError } from './errors.ts';
import type { OperationTarget } from './operation-registry.ts';
import type { RightsChangeRecord } from './rights-matrix.ts';
import type { RightsUsePath } from './vocabulary.ts';

export interface RegisterArtifactInput {
  readonly target: OperationTarget;
  /** Storage-layer reference of the captured object (never the payload). */
  readonly objectRef: string;
  /** The rights declaration version in force at capture time. */
  readonly rightsVersion: number;
  /** Explicit capture instant for deterministic retries; default clock.now(). */
  readonly capturedAt?: UtcTimestamp | undefined;
}

export interface RegisteredArtifact {
  readonly artifactId: string;
  readonly state: 'ACTIVE' | 'QUARANTINED' | 'RETIRED';
  readonly created: boolean;
}

export interface AppliedAction {
  readonly artifactId: string;
  readonly action: 'QUARANTINE' | 'RETIRE';
}

interface ArtifactRow {
  artifact_id: string;
  object_ref: string;
  rights_version: number;
  state: string;
  captured_at: Date | string;
  updated_at: Date | string;
}

function iso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString();
}

export class ArtifactRegistry {
  private readonly engine: DatabaseEngine;
  private readonly clock: ClockPort;

  constructor(options: { engine: DatabaseEngine; clock: ClockPort }) {
    this.engine = options.engine;
    this.clock = options.clock;
  }

  /**
   * Registers one captured artifact. Deterministic ids make retries of the
   * same capture resolve to the SAME row without mutating its state (an
   * idempotent retry must not resurrect an enforced row).
   */
  async registerArtifact(input: RegisterArtifactInput): Promise<RegisteredArtifact> {
    if (input.objectRef.length === 0) {
      throw new RegistryError(
        'artifact registration requires a non-empty object reference',
        { ...input.target },
        ProvErrorCode.PROV_DEFINITION_SCHEMA_INVALID,
      );
    }
    const capturedAt = input.capturedAt ?? this.clock.now();
    const artifactId = `par:${sha256Text(
      [
        input.target.providerId,
        input.target.operationId,
        input.target.version,
        input.objectRef,
        String(input.rightsVersion),
      ].join('|'),
    )}`;
    await this.engine.query(
      `INSERT INTO prov.prov_provider_artifacts (
         artifact_id, object_ref, provider_id, operation_id,
         operation_version, rights_version, state, captured_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7,$8)
       ON CONFLICT (artifact_id) DO NOTHING`,
      [
        artifactId,
        input.objectRef,
        input.target.providerId,
        input.target.operationId,
        input.target.version,
        input.rightsVersion,
        capturedAt,
        capturedAt,
      ],
    );
    const rows = await this.engine.query<{ state: string }>(
      `SELECT state FROM prov.prov_provider_artifacts WHERE artifact_id = $1`,
      [artifactId],
    );
    const state = rows.rows[0]?.state;
    return {
      artifactId,
      state:
        state === 'QUARANTINED' || state === 'RETIRED' || state === 'ACTIVE' ? state : 'ACTIVE',
      // A pre-existing row keeps its CURRENT state; only fresh inserts are ACTIVE creations.
      created: state === 'ACTIVE',
    };
  }

  async get(artifactId: string): Promise<{
    artifactId: string;
    objectRef: string;
    providerId: string;
    operationId: string;
    operationVersion: string;
    rightsVersion: number;
    state: string;
    capturedAt: string;
    updatedAt: string;
  } | null> {
    const rows = await this.engine.query<
      ArtifactRow & { provider_id: string; operation_id: string; operation_version: string }
    >(`SELECT * FROM prov.prov_provider_artifacts WHERE artifact_id = $1`, [artifactId]);
    const row = rows.rows[0];
    if (row === undefined) return null;
    return {
      artifactId: row.artifact_id,
      objectRef: row.object_ref,
      providerId: row.provider_id,
      operationId: row.operation_id,
      operationVersion: row.operation_version,
      rightsVersion: Number(row.rights_version),
      state: row.state,
      capturedAt: iso(row.captured_at),
      updatedAt: iso(row.updated_at),
    };
  }

  /**
   * Executes one recorded rights change against the artifact store
   * (AC-273). Affected = still-ACTIVE artifacts of this provider/operation
   * whose captured rights version predates the change's target version.
   *
   * Policy: STORAGE newly prohibited ⇒ RETIRE (the raw copy cannot even be
   * held); any OTHER newly prohibited path ⇒ QUARANTINE. A tightened change
   * with NO newly prohibited path takes no storage actions — the shorter
   * window / expanded jurisdictions are enforced dynamically by the
   * rights-matrix decision API at use time.
   */
  async applyRightsChange(input: {
    readonly change: RightsChangeRecord;
    readonly providerId: string;
    readonly operationId: string;
    /** Explicit execution instant for deterministic retries; default clock.now(). */
    readonly executedAt?: UtcTimestamp | undefined;
    readonly details?: string | undefined;
  }): Promise<AppliedAction[]> {
    const newlyProhibited = [...input.change.newlyProhibitedUses];
    if (newlyProhibited.length === 0) return [];

    const retireStorage = newlyProhibited.includes('STORAGE' satisfies RightsUsePath);
    const action: 'QUARANTINE' | 'RETIRE' = retireStorage ? 'RETIRE' : 'QUARANTINE';
    const executedAt = input.executedAt ?? this.clock.now();

    const affected = await this.engine.query<{ artifact_id: string }>(
      `SELECT artifact_id FROM prov.prov_provider_artifacts
       WHERE provider_id = $1 AND operation_id = $2
         AND rights_version < $3 AND state = 'ACTIVE'
       ORDER BY artifact_id`,
      [input.providerId, input.operationId, input.change.toRightsVersion],
    );

    const applied: AppliedAction[] = [];
    for (const row of affected.rows) {
      const artifactId = row.artifact_id;
      const actionId = `pca:${sha256Text([input.change.changeId, artifactId].join('|'))}`;
      const inserted = await this.engine.query<{ action_id: string }>(
        `INSERT INTO prov.prov_rights_change_actions (
           action_id, change_id, artifact_id, action, executed_at, details)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (change_id, artifact_id) DO NOTHING
         RETURNING action_id`,
        [actionId, input.change.changeId, artifactId, action, executedAt, input.details ?? null],
      );
      if (inserted.rows.length === 1) {
        await this.engine.query(
          `UPDATE prov.prov_provider_artifacts
           SET state = $2, updated_at = $3
           WHERE artifact_id = $1 AND state = 'ACTIVE'`,
          [artifactId, action === 'RETIRE' ? 'RETIRED' : 'QUARANTINED', executedAt],
        );
        applied.push({ artifactId, action });
      }
    }
    return applied;
  }

  /** The enforcement ledger for one change (INV-009-visible, replay-stable). */
  async actionsForChange(changeId: string): Promise<AppliedAction[]> {
    const rows = await this.engine.query<{ artifact_id: string; action: string }>(
      `SELECT artifact_id, action FROM prov.prov_rights_change_actions
       WHERE change_id = $1 ORDER BY artifact_id`,
      [changeId],
    );
    return rows.rows.map((r) => ({
      artifactId: r.artifact_id,
      action: r.action === 'RETIRE' ? ('RETIRE' as const) : ('QUARANTINE' as const),
    }));
  }
}
