/**
 * Guarded lifecycle transitions over the append-only `prov.prov_lifecycle_events`
 * ledger (FR-PROV-001, §12.11; plan material decision 4).
 *
 * Every transition:
 *   - validates the edge against the legal graph (lifecycle-states.ts);
 *   - REQUIRES a non-empty reason class;
 *   - appends exactly one immutable ledger event, deduped on the caller's
 *     idempotency key AND on the transition tuple — retries can never
 *     double-append (INV-009), and a retry that disagrees with the recorded
 *     outcome is a loud conflict, not a silent second truth;
 *   - projects current_state (and optionally health_status) onto the registry
 *     row;
 *   - emits every critical transition through the security AuditChain bridge.
 *
 * Expiry-driven exits from ACTIVE append events and project state ONLY —
 * stored historical evidence is never mutated (§12.11).
 */
import type { DatabaseEngine } from '@foresift/persistence';
import type { UtcTimestamp } from '@foresift/domain';
import { assertTransitionLegal, type LifecycleState } from './lifecycle-states.ts';
import type { OperationRef } from './operation-registry.ts';
import { LifecycleTransitionError, ProvErrorCode } from './errors.ts';
import type { LifecycleAuditBridge } from './audit-bridges.ts';

export const TRANSITION_REASON_CLASSES = [
  'REGISTRATION_VERIFIED',
  'OPERATION_ACTIVATED',
  'HEALTH_EXCURSION',
  'HEALTH_RECOVERED',
  'VERIFICATION_EXPIRED_DOCUMENTATION',
  'VERIFICATION_EXPIRED_PRICING_PLAN',
  'VERIFICATION_EXPIRED_QUOTA',
  'VERIFICATION_EXPIRED_RIGHTS',
  'VERIFICATION_EXPIRED_SCHEMA',
  'VERIFICATION_EXPIRED_ENDPOINT',
  'VERIFICATION_EXPIRED_AUTHENTICATION',
  'VERIFICATION_EXPIRED_DEPRECATION',
  'VERIFICATION_EXPIRED_LIVE_PROBE',
  'VERIFICATION_REFRESHED',
  'DEPRECATION_MARKED',
  'PROHIBITED_CAPABILITY_ENFORCED',
  'OPERATOR_BLOCK',
  'OPERATION_RETIRED',
] as const;

export type TransitionReasonClass = (typeof TRANSITION_REASON_CLASSES)[number];

export interface LifecycleTransitionInput {
  readonly ref: OperationRef;
  readonly to: LifecycleState;
  /** Why the edge is being taken; one of the stable reason classes. */
  readonly reasonClass: TransitionReasonClass;
  readonly actor: string;
  readonly occurredAt: UtcTimestamp;
  readonly effectiveAt: UtcTimestamp;
  readonly evidenceRefs?: readonly string[];
  /** Caller-supplied dedupe key (e.g. sweep run + kind + day). */
  readonly idempotencyKey: string;
  /** Optional health-status projection alongside the state change. */
  readonly projectHealthStatus?: string;
}

interface EventRow {
  seq: string | number;
  idempotency_key: string;
  from_state: string;
  to_state: string;
  reason_class: string;
  effective_at: Date | string;
}

interface CurrentStateRow {
  current_state: string;
  health_status: string;
}

export class LifecycleMachine {
  private readonly engine: DatabaseEngine;
  private readonly bridge: LifecycleAuditBridge | undefined;

  constructor(engine: DatabaseEngine, bridge?: LifecycleAuditBridge) {
    this.engine = engine;
    this.bridge = bridge;
  }

  async currentState(ref: OperationRef): Promise<LifecycleState> {
    const rows = await this.engine.query<CurrentStateRow>(
      'SELECT current_state, health_status FROM prov.prov_operations WHERE provider_id = $1 AND operation_id = $2 AND version = $3',
      [ref.providerId, ref.operationId, ref.version],
    );
    const row = rows.rows[0];
    if (row === undefined) {
      throw new LifecycleTransitionError(
        `operation ${ref.providerId}/${ref.operationId}@${ref.version} is not registered`,
        { ref: JSON.stringify(ref) },
        ProvErrorCode.PROV_OPERATION_UNKNOWN,
      );
    }
    return row.current_state as LifecycleState;
  }

  async currentHealthStatus(ref: OperationRef): Promise<string> {
    const rows = await this.engine.query<CurrentStateRow>(
      'SELECT current_state, health_status FROM prov.prov_operations WHERE provider_id = $1 AND operation_id = $2 AND version = $3',
      [ref.providerId, ref.operationId, ref.version],
    );
    const row = rows.rows[0];
    if (row === undefined) {
      throw new LifecycleTransitionError(
        `operation ${ref.providerId}/${ref.operationId}@${ref.version} is not registered`,
        { ref: JSON.stringify(ref) },
        ProvErrorCode.PROV_OPERATION_UNKNOWN,
      );
    }
    return row.health_status;
  }

  /**
   * Take one guarded transition. Returns the ledger seq of the appended (or
   * already-present, identical) event.
   */
  async transition(input: LifecycleTransitionInput): Promise<{ seq: number }> {
    if (input.reasonClass.trim() === '') {
      throw new LifecycleTransitionError(
        'a lifecycle transition requires a non-empty reason class',
        { ref: JSON.stringify(input.ref) },
        ProvErrorCode.PROV_LIFECYCLE_REASON_REQUIRED,
      );
    }
    if (!(TRANSITION_REASON_CLASSES as readonly string[]).includes(input.reasonClass)) {
      throw new LifecycleTransitionError(
        `reason class '${input.reasonClass}' is not part of the stable vocabulary`,
        { reasonClass: input.reasonClass },
        ProvErrorCode.PROV_LIFECYCLE_REASON_REQUIRED,
      );
    }

    // Idempotent replay FIRST: a retry whose key already records exactly this
    // transition succeeds regardless of the CURRENT projected state (the
    // first attempt already moved it — that is the point of a retry). Only a
    // NEW edge needs legality; a disagreeing retry is a loud conflict.
    const existing = await this.engine.query<EventRow>(
      'SELECT seq, idempotency_key, from_state, to_state, reason_class, effective_at FROM prov.prov_lifecycle_events WHERE idempotency_key = $1',
      [input.idempotencyKey],
    );
    const prior = existing.rows[0];
    if (prior !== undefined) {
      return assertSameTransition(prior, input);
    }

    assertTransitionLegal(await this.currentState(input.ref), input.to);

    return this.engine.transaction(async (tx) => {
      // Re-check under the transaction: a concurrent same-key append wins and
      // this call degrades to the same replay/conflict verdict.
      const raced = await tx.query<EventRow>(
        'SELECT seq, idempotency_key, from_state, to_state, reason_class, effective_at FROM prov.prov_lifecycle_events WHERE idempotency_key = $1',
        [input.idempotencyKey],
      );
      const racedRow = raced.rows[0];
      if (racedRow !== undefined) {
        return assertSameTransition(racedRow, input);
      }

      const from = await this.currentState(input.ref);

      // Bridge FIRST (same engine → nested savepoint): the audit entry exists
      // before the ledger row does, so the immutable event can carry its
      // chain back-reference at INSERT time instead of ever being updated.
      let auditEntrySeq: number | null = null;
      if (this.bridge !== undefined) {
        const auditEntry = await this.bridge.recordTransition({
          occurredAt: input.occurredAt,
          actor: input.actor,
          ref: input.ref,
          fromState: from,
          toState: input.to,
          reasonClass: input.reasonClass,
          evidenceRefs: input.evidenceRefs ?? [],
        });
        auditEntrySeq = Number(auditEntry.seq);
      }

      const appended = await tx.query<EventRow>(
        `INSERT INTO prov.prov_lifecycle_events (
           provider_id, operation_id, operation_version, from_state, to_state,
           reason_class, actor, occurred_at, effective_at, evidence_refs,
           audit_entry_seq, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
         RETURNING seq, from_state, to_state, reason_class`,
        [
          input.ref.providerId,
          input.ref.operationId,
          input.ref.version,
          from,
          input.to,
          input.reasonClass,
          input.actor,
          input.occurredAt,
          input.effectiveAt,
          JSON.stringify([...(input.evidenceRefs ?? [])]),
          auditEntrySeq,
          input.idempotencyKey,
        ],
      );
      const appendedRow = appended.rows[0];
      if (appendedRow === undefined) {
        throw new LifecycleTransitionError('ledger append returned no row', {
          idempotencyKey: input.idempotencyKey,
        });
      }

      // Project current state (+ optional health status). Historical evidence
      // lives only in the ledger and is never rewritten by this UPDATE.
      await tx.query(
        `UPDATE prov.prov_operations SET current_state = $4 ${
          input.projectHealthStatus !== undefined ? ', health_status = $5' : ''
        } WHERE provider_id = $1 AND operation_id = $2 AND version = $3`,
        input.projectHealthStatus !== undefined
          ? [
              input.ref.providerId,
              input.ref.operationId,
              input.ref.version,
              input.to,
              input.projectHealthStatus,
            ]
          : [input.ref.providerId, input.ref.operationId, input.ref.version, input.to],
      );

      return { seq: Number(appendedRow.seq) };
    });
  }

  /** Ledger history for one operation version (ascending). */
  async history(ref: OperationRef): Promise<
    readonly {
      seq: number;
      fromState: LifecycleState;
      toState: LifecycleState;
      reasonClass: string;
      occurredAt: UtcTimestamp;
      effectiveAt: UtcTimestamp;
      auditEntrySeq: number | null;
    }[]
  > {
    const rows = await this.engine.query<{
      seq: string | number;
      from_state: string;
      to_state: string;
      reason_class: string;
      occurred_at: Date | string;
      effective_at: Date | string;
      audit_entry_seq: string | null;
    }>(
      `SELECT seq, from_state, to_state, reason_class, occurred_at, effective_at, audit_entry_seq
       FROM prov.prov_lifecycle_events
       WHERE provider_id = $1 AND operation_id = $2 AND operation_version = $3
       ORDER BY seq`,
      [ref.providerId, ref.operationId, ref.version],
    );
    return rows.rows.map((r) => ({
      seq: Number(r.seq),
      fromState: r.from_state as LifecycleState,
      toState: r.to_state as LifecycleState,
      reasonClass: r.reason_class,
      occurredAt: normalize(r.occurred_at),
      effectiveAt: normalize(r.effective_at),
      auditEntrySeq: r.audit_entry_seq === null ? null : Number(r.audit_entry_seq),
    }));
  }
}

function normalize(value: Date | string): UtcTimestamp {
  if (typeof value === 'string') return value as UtcTimestamp;
  return value.toISOString().replace('.000Z', 'Z') as UtcTimestamp;
}

/**
 * A replayed idempotency key must agree with the recorded event in FULL
 * (to_state + reason_class + effective_at) — otherwise refuse loudly instead
 * of silently creating a second truth. Returns the recorded seq on agreement.
 */
function assertSameTransition(
  prior: EventRow,
  input: LifecycleTransitionInput,
): { seq: number } {
  const sameTuple =
    prior.to_state === input.to &&
    prior.reason_class === input.reasonClass &&
    normalize(prior.effective_at) === input.effectiveAt;
  if (!sameTuple) {
    throw new LifecycleTransitionError(
      `idempotency key '${input.idempotencyKey}' already records a DIFFERENT transition`,
      {
        idempotencyKey: input.idempotencyKey,
        recordedTo: prior.to_state,
        recordedReason: prior.reason_class,
      },
      ProvErrorCode.PROV_LIFECYCLE_IDEMPOTENCY_CONFLICT,
    );
  }
  return { seq: Number(prior.seq) };
}
