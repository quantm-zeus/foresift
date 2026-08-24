/**
 * Capability pauses and the activation-event ledger over sec.capability_pauses
 * + sec.activation_events (AC-278, AC-279; FR-SEC-011/FR-SEC-012).
 *
 * Pause semantics: a failed critical gate pauses ONLY the smallest affected
 * scope, with a durable reason linked to its opening incident. Reactivation
 * is NEVER automatic — `refuseAutoReactivation` exists precisely so a caller
 * cannot even express an auto-resume without hitting a typed refusal; resume
 * requires an explicit actor AND an audit reference, and lands a
 * RESUME_AFTER_RE_EVALUATION activation event whose re-evaluation marker must
 * be consumed before alerting may resume.
 *
 * Rollback semantics: restoring a prior approved set appends a NEW ledger
 * event (ROLLBACK_RESTORE) referencing the immutable snapshot of the restored
 * event — history is never rewritten (SQL trigger refuses UPDATE/DELETE).
 */
import type { UtcTimestamp } from '@foresift/domain';
import type { ActivationEventType } from '@foresift/shared-schemas';
import { GatePauseError, SecErrorCode } from './errors.ts';

export interface PauseInput {
  readonly pauseId: string;
  readonly scope: string;
  readonly reason: string;
  readonly openingIncidentId: string;
  readonly pausedAt: UtcTimestamp;
}

export interface ResumeInput {
  readonly pauseId: string;
  /** The explicit human actor performing the audited resume. */
  readonly resumedByActor: string;
  readonly resumedAt: UtcTimestamp;
  /** Reference to the audit entry recording this resume decision. */
  readonly auditRef: string;
}

interface PauseRow {
  pause_id: string;
  scope: string;
  reason: string;
  opening_incident_id: string;
  paused_at: Date | string;
  resumed_at: Date | string | null;
  resumed_by_actor: string | null;
}

interface ActivationRow {
  event_id: string;
  event_type: string;
  scope: string;
  at: Date | string;
  actor: string;
  approved_set_snapshot_ref: string;
  restored_from_event_id: string | null;
  reevaluation_marker: string | null;
}

function normalize(value: Date | string | null): UtcTimestamp | null {
  if (value === null) return null;
  if (typeof value === 'string') return value as UtcTimestamp;
  return value.toISOString().replace('.000Z', 'Z') as UtcTimestamp;
}

/**
 * Machine-checked refusal of automatic reactivation (AC-278). Any code path
 * that "just flips the pause off" must route through here and fail.
 */
export function refuseAutoReactivation(): never {
  throw new GatePauseError(
    'automatic reactivation is refused; resume requires explicit audited approval',
    {},
    SecErrorCode.SEC_PAUSE_AUTO_REACTIVATION_REFUSED,
  );
}

export class GatePauses {
  private readonly engine: import('@foresift/persistence').DatabaseEngine;

  constructor(engine: import('@foresift/persistence').DatabaseEngine) {
    this.engine = engine;
  }

  async open(input: PauseInput): Promise<PauseRow> {
    const inserted = await this.engine.query<PauseRow>(
      `INSERT INTO sec.capability_pauses
         (pause_id, scope, reason, opening_incident_id, paused_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.pauseId, input.scope, input.reason, input.openingIncidentId, input.pausedAt],
    );
    return this.rowOrThrow(inserted.rows[0]);
  }

  /**
   * Explicit audited resume. Refuses when the pause is already resumed and
   * when no audit reference is supplied.
   */
  async resume(input: ResumeInput): Promise<PauseRow> {
    if (input.auditRef.trim() === '') {
      throw new GatePauseError(
        'resume requires the audit reference of its explicit approval',
        { pauseId: input.pauseId },
        SecErrorCode.SEC_PAUSE_RESUME_AUDIT_REQUIRED,
      );
    }
    const updated = await this.engine.query<PauseRow>(
      `UPDATE sec.capability_pauses
       SET resumed_at = $2, resumed_by_actor = $3
       WHERE pause_id = $1 AND resumed_at IS NULL
       RETURNING *`,
      [input.pauseId, input.resumedAt, input.resumedByActor],
    );
    const row = this.rowOrThrow(
      updated.rows[0],
      `pause ${input.pauseId} is not actively paused (already resumed or unknown)`,
    );
    // The resume itself is an auditable activation-ledger event carrying the
    // re-evaluation marker consumers must honor before alerting resumes.
    await this.recordActivation({
      eventId: `${input.pauseId}-resume`,
      eventType: 'RESUME_AFTER_RE_EVALUATION',
      scope: row.scope,
      at: input.resumedAt,
      actor: input.resumedByActor,
      approvedSetSnapshotRef: input.auditRef,
      reevaluationMarker: `pending:${input.pauseId}`,
    });
    return row;
  }

  /** Whether a scope (exactly) is currently paused. */
  async isPaused(scope: string): Promise<boolean> {
    const rows = await this.engine.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM sec.capability_pauses WHERE scope = $1 AND resumed_at IS NULL',
      [scope],
    );
    return Number(rows.rows[0]?.n ?? '0') > 0;
  }

  /**
   * Append an activation-ledger event. ROLLBACK_RESTORE events MUST name the
   * historical event being restored (SQL CHECK enforces it too).
   */
  async recordActivation(input: {
    eventId: string;
    eventType: ActivationEventType;
    scope: string;
    at: UtcTimestamp;
    actor: string;
    approvedSetSnapshotRef: string;
    restoredFromEventId?: string | undefined;
    reevaluationMarker?: string | undefined;
  }): Promise<ActivationRow> {
    const inserted = await this.engine.query<ActivationRow>(
      `INSERT INTO sec.activation_events
         (event_id, event_type, scope, at, actor, approved_set_snapshot_ref,
          restored_from_event_id, reevaluation_marker)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        input.eventId,
        input.eventType,
        input.scope,
        input.at,
        input.actor,
        input.approvedSetSnapshotRef,
        input.restoredFromEventId ?? null,
        input.reevaluationMarker ?? null,
      ],
    );
    return inserted.rows[0] as ActivationRow;
  }

  /**
   * Rollback: restore the approved set of a PRIOR activation event by
   * appending a NEW event that references the old immutable snapshot.
   * Historical decisions are preserved by construction (append-only).
   */
  async rollbackRestore(input: {
    eventId: string;
    restoreOfEventId: string;
    scope: string;
    at: UtcTimestamp;
    actor: string;
  }): Promise<ActivationRow> {
    const prior = await this.engine.query<ActivationRow>(
      'SELECT * FROM sec.activation_events WHERE event_id = $1',
      [input.restoreOfEventId],
    );
    const priorRow = prior.rows[0];
    if (priorRow === undefined) {
      throw new GatePauseError(
        `cannot restore unknown activation event ${input.restoreOfEventId}`,
        { restoreOfEventId: input.restoreOfEventId },
      );
    }
    return this.recordActivation({
      eventId: input.eventId,
      eventType: 'ROLLBACK_RESTORE',
      scope: input.scope,
      at: input.at,
      actor: input.actor,
      approvedSetSnapshotRef: priorRow.approved_set_snapshot_ref,
      restoredFromEventId: input.restoreOfEventId,
      reevaluationMarker: `pending:${input.eventId}`,
    });
  }

  /** All ledger events for a scope, in append order (history preservation). */
  async history(scope: string): Promise<ActivationRow[]> {
    const rows = await this.engine.query<ActivationRow>(
      'SELECT * FROM sec.activation_events WHERE scope = $1 ORDER BY recorded_seq',
      [scope],
    );
    return rows.rows;
  }

  private rowOrThrow(row: PauseRow | undefined, message = 'pause insert returned no row'): PauseRow {
    if (row === undefined) {
      throw new GatePauseError(message, {});
    }
    return {
      ...row,
      paused_at: normalize(row.paused_at) as unknown as Date | string,
      resumed_at: normalize(row.resumed_at),
    };
  }
}
