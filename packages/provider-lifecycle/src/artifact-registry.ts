/**
 * Provider-artifact registry (FR-PROV-009; §15.6, AC-273). Artifacts carry
 * the rights version CAPTURED AT INGESTION — use-time decisions evaluate
 * against that captured version, never the latest declaration. When a
 * rights change TIGHTENS, every ACTIVE artifact of the operation is
 * enumerated into exactly-one durable QUARANTINE|RETIRE action row (the
 * UNIQUE(change_id, artifact_id) constraint is the exactly-once fence);
 * execution is recorded explicitly with a timestamp and a state flip —
 * never implied.
 */
import { randomUUID } from 'node:crypto';
import type { ClockPort } from '@foresift/domain';
import { fixedClock, utcTimestamp } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import { ProvErrorCode, RightsChangeError } from './errors.ts';
import {
  ProviderArtifactRecordSchema,
  RightsChangeActionRecordSchema,
  type ProviderArtifactRecord,
  type RightsChangeActionKind,
  type RightsChangeActionRecord,
  type RightsChangeRecord,
} from './schemas.ts';

/**
 * Use paths whose prohibition makes an artifact UNFIT to remain in active
 * circulation at all (RETIRE); other tightenings only pull it out of model
 * context and downstream consumption (QUARANTINE).
 */
const RETIRE_TRIGGERING_USES: ReadonlySet<string> = new Set([
  'REDISTRIBUTION',
  'RAW_EXPORT',
  'PUBLIC_ALERT_DERIVATIVE',
]);

interface ArtifactRow {
  artifact_id: string;
  object_ref: string;
  provider_id: string;
  operation_id: string;
  operation_version: string;
  rights_version: number;
  state: string;
  captured_at: Date | string;
}

function iso(value: Date | string): string {
  return typeof value === 'string'
    ? value.replace(' ', 'T')
    : value.toISOString().replace('.000Z', 'Z');
}

function rowToArtifact(row: ArtifactRow): ProviderArtifactRecord {
  return ProviderArtifactRecordSchema.parse({
    artifactId: row.artifact_id,
    objectRef: row.object_ref,
    providerId: row.provider_id,
    operationId: row.operation_id,
    operationVersion: row.operation_version,
    rightsVersion: Number(row.rights_version),
    state: row.state,
    capturedAt: iso(row.captured_at),
  });
}

interface ActionRow {
  action_id: string;
  change_id: string;
  artifact_id: string;
  action: string;
  created_at: Date | string;
  executed_at: Date | string | null;
}

function rowToAction(row: ActionRow): RightsChangeActionRecord {
  return RightsChangeActionRecordSchema.parse({
    actionId: row.action_id,
    changeId: row.change_id,
    artifactId: row.artifact_id,
    action: row.action,
    createdAt: iso(row.created_at),
    executedAt: row.executed_at === null ? null : iso(row.executed_at),
  });
}

export class ArtifactRegistry {
  private readonly engine: DatabaseEngine;
  private readonly clock: ClockPort;

  constructor(options: {
    readonly engine: DatabaseEngine;
    /** Injected clock (Constitution XI). */
    readonly clock?: ClockPort;
  }) {
    this.engine = options.engine;
    this.clock = options.clock ?? fixedClock(utcTimestamp('1970-01-01T00:00:00Z'));
  }

  /**
   * Register one ingested artifact as ACTIVE against the CURRENT rights
   * version — the capture-time snapshot every later decision honors.
   */
  async registerArtifact(input: {
    readonly objectRef: string;
    readonly providerId: string;
    readonly operationId: string;
    readonly operationVersion: string;
    readonly rightsVersion: number;
    readonly artifactId?: string | undefined;
    readonly capturedAt?: string | undefined;
  }): Promise<ProviderArtifactRecord> {
    const inserted = await this.engine.query<ArtifactRow>(
      `INSERT INTO prov.prov_provider_artifacts (
         artifact_id, object_ref, provider_id, operation_id,
         operation_version, rights_version, state, captured_at)
       VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7)
       RETURNING *`,
      [
        input.artifactId ?? `art-${randomUUID()}`,
        input.objectRef,
        input.providerId,
        input.operationId,
        input.operationVersion,
        input.rightsVersion,
        input.capturedAt ?? this.clock.now(),
      ],
    );
    return rowToArtifact(inserted.rows[0]!);
  }

  async get(artifactId: string): Promise<ProviderArtifactRecord | undefined> {
    const rows = await this.engine.query<ArtifactRow>(
      'SELECT * FROM prov.prov_provider_artifacts WHERE artifact_id = $1',
      [artifactId],
    );
    const row = rows.rows[0];
    return row === undefined ? undefined : rowToArtifact(row);
  }

  async listActive(providerId: string, operationId: string): Promise<ProviderArtifactRecord[]> {
    const rows = await this.engine.query<ArtifactRow>(
      `SELECT * FROM prov.prov_provider_artifacts
       WHERE provider_id = $1 AND operation_id = $2 AND state = 'ACTIVE'
       ORDER BY captured_at ASC`,
      [providerId, operationId],
    );
    return rows.rows.map(rowToArtifact);
  }

  async listActions(changeId: string): Promise<RightsChangeActionRecord[]> {
    const rows = await this.engine.query<ActionRow>(
      `SELECT * FROM prov.prov_rights_change_actions
       WHERE change_id = $1 ORDER BY created_at ASC`,
      [changeId],
    );
    return rows.rows.map(rowToAction);
  }

  /**
   * Enumerate the tightening consequences of one rights change over all
   * ACTIVE artifacts of the operation. Idempotent by construction: the
   * UNIQUE(change_id, artifact_id) fence turns re-planning into a no-op and
   * the durable rows — not memory — are the enumeration.
   */
  async planTighteningActions(change: RightsChangeRecord): Promise<RightsChangeActionRecord[]> {
    const actives = await this.listActive(change.providerId, change.operationId);
    if (actives.length === 0) return [];
    const kind: RightsChangeActionKind =
      change.newlyProhibitedUses.some((use) => RETIRE_TRIGGERING_USES.has(use))
        ? 'RETIRE'
        : 'QUARANTINE';

    for (const artifact of actives) {
      await this.engine.query(
        `INSERT INTO prov.prov_rights_change_actions (
           action_id, change_id, artifact_id, action, created_at, executed_at)
         VALUES ($1,$2,$3,$4,$5,NULL)
         ON CONFLICT (change_id, artifact_id) DO NOTHING`,
        [
          `pact-${randomUUID()}`,
          change.changeId,
          artifact.artifactId,
          kind,
          this.clock.now(),
        ],
      );
    }
    // The durable rows are the truth; read them back in deterministic order.
    return (await this.listActions(change.changeId)).sort((a, b) =>
      a.artifactId.localeCompare(b.artifactId),
    );
  }

  /**
   * Execute one planned action: record executed_at and flip the artifact
   * state. Re-execution refuses rather than double-flipping.
   */
  async executeAction(actionId: string): Promise<{
    action: RightsChangeActionRecord;
    artifact: ProviderArtifactRecord;
  }> {
    const currentRows = await this.engine.query<ActionRow>(
      'SELECT * FROM prov.prov_rights_change_actions WHERE action_id = $1',
      [actionId],
    );
    const current = currentRows.rows[0];
    if (current === undefined) {
      throw new RightsChangeError(
        `rights-change action ${actionId} does not exist`,
        { actionId },
        ProvErrorCode.PROV_RIGHTS_ACTION_INCOMPLETE,
      );
    }
    const existing = rowToAction(current);
    if (existing.executedAt !== null) {
      throw new RightsChangeError(
        `rights-change action ${actionId} was already executed`,
        { actionId },
        ProvErrorCode.PROV_RIGHTS_ACTION_INCOMPLETE,
      );
    }
    const now = this.clock.now();
    const targetState: ProviderArtifactRecord['state'] =
      existing.action === 'RETIRE' ? 'RETIRED' : 'QUARANTINED';
    await this.engine.query(
      'UPDATE prov.prov_rights_change_actions SET executed_at = $2 WHERE action_id = $1',
      [actionId, now],
    );
    await this.engine.query(
      'UPDATE prov.prov_provider_artifacts SET state = $2 WHERE artifact_id = $1',
      [existing.artifactId, targetState],
    );
    const executedRows = await this.engine.query<ActionRow>(
      'SELECT * FROM prov.prov_rights_change_actions WHERE action_id = $1',
      [actionId],
    );
    const artifact = await this.get(existing.artifactId);
    if (artifact === undefined) {
      throw new RightsChangeError(
        `artifact ${existing.artifactId} vanished while executing ${actionId}`,
        {},
        ProvErrorCode.PROV_RIGHTS_ACTION_INCOMPLETE,
      );
    }
    return { action: rowToAction(executedRows.rows[0]!), artifact };
  }
}
