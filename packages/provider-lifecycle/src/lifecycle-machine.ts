/**
 * Guarded lifecycle transitions over the append-only ledger (FR-PROV-001;
 * §12.11, §15.4; plan material decision 4).
 *
 * Every transition is EVENT-SOURCED: `prov_lifecycle_events` is the system of
 * record and `prov_operations.current_state` is a PROJECTION kept in the same
 * transaction. Rules enforced here:
 *
 *   * graph legality — requireLegalTransition refuses edges outside the
 *     seven-edge §12.11 graph (fail-closed);
 *   * reason classes are mandatory and vocabulary-pinned; expiry-driven
 *     exits from ACTIVE must carry `*_EXPIRED` classes so sweeps stay
 *     distinguishable from operator actions in the ledger;
 *   * idempotency — retries dedupe on the idempotency_key UNIQUE constraint
 *     (INV-009): a replayed key with an identical payload returns the
 *     original event without double-appending; a replayed key with a
 *     DIFFERENT payload is a conflict, never silently absorbed;
 *   * fencing — the projection row is locked FOR UPDATE inside the
 *     transaction so two concurrent transitions cannot both claim the same
 *     predecessor state;
 *   * historical evidence is never mutated — expiry-driven exits append new
 *     events only (SQL triggers make this structural, INV-004);
 *   * critical transitions flow through the ProviderAuditBridge into the
 *     security AuditChain when one is wired.
 */
import { fixedClock, utcTimestamp, type ClockPort } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import {
  LifecycleEventRecordSchema,
  TRANSITION_REASON_CLASSES,
  type HealthStatus,
  type LifecycleEventRecord,
  type LifecycleState,
  type TransitionReasonClass,
} from './schemas.ts';
import { LifecycleStateSchema } from './schemas.ts';
import { requireLegalTransition } from './lifecycle-states.ts';
import {
  LifecycleTransitionError,
  ProvErrorCode,
  RegistryError,
} from './errors.ts';
import type { ProviderAuditBridge } from './audit-bridges.ts';

export interface LifecycleMachineOptions {
  readonly engine: DatabaseEngine;
  /** Injected clock (Constitution XI) — never the wall clock. */
  readonly clock?: ClockPort;
  /** Optional security-chain bridge for critical transitions. */
  readonly audit?: ProviderAuditBridge;
}

export interface TransitionInput {
  readonly providerId: string;
  readonly operationId: string;
  readonly operationVersion: string;
  readonly toState: LifecycleState;
  readonly reasonClass: TransitionReasonClass;
  readonly actor: string;
  /** Retry fence. The same key with the same payload replays idempotently. */
  readonly idempotencyKey: string;
  readonly evidenceRefs?: readonly string[];
  /** Optional simultaneous health-status projection update. */
  readonly nextHealthStatus?: HealthStatus;
}

export interface TransitionResult {
  readonly event: LifecycleEventRecord;
  /** True when a prior attempt with the SAME payload was replayed, not re-applied. */
  readonly idempotentReplay: boolean;
}

interface OperationRow {
  current_state: string;
  health_status: string;
}

interface EventRow {
  seq: string | number;
  provider_id: string;
  operation_id: string;
  operation_version: string;
  from_state: string | null;
  to_state: string;
  reason_class: string;
  actor: string;
  occurred_at: Date | string;
  evidence_refs: unknown;
  idempotency_key: string;
}

function rowToEvent(row: EventRow): LifecycleEventRecord {
  return LifecycleEventRecordSchema.parse({
    seq: Number(row.seq),
    providerId: row.provider_id,
    operationId: row.operation_id,
    operationVersion: row.operation_version,
    fromState: row.from_state,
    toState: row.to_state,
    reasonClass: row.reason_class,
    actor: row.actor,
    occurredAt:
      typeof row.occurred_at === 'string'
        ? row.occurred_at
        : row.occurred_at.toISOString().replace('.000Z', 'Z'),
    evidenceRefs: row.evidence_refs,
    idempotencyKey: row.idempotency_key,
  });
}

const IDEMPOTENCY_CONSTRAINT = 'prov_lifecycle_events_idempotency';

export class LifecycleMachine {
  private readonly engine: DatabaseEngine;
  private readonly clock: ClockPort;
  private readonly audit: ProviderAuditBridge | undefined;

  constructor(options: LifecycleMachineOptions) {
    this.engine = options.engine;
    this.clock = options.clock ?? fixedClock(utcTimestamp('1970-01-01T00:00:00Z'));
    this.audit = options.audit;
  }

  /**
   * Apply one guarded transition. Fails closed on illegal edges, unknown
   * states/reason classes, and unknown operations; dedupes retries by
   * idempotency key.
   */
  async transition(input: TransitionInput): Promise<TransitionResult> {
    if (!TRANSITION_REASON_CLASSES.includes(input.reasonClass)) {
      throw new RegistryError(
        `unknown transition reason class ${input.reasonClass}`,
        { reasonClass: input.reasonClass },
        ProvErrorCode.PROV_TRANSITION_REASON_REQUIRED,
      );
    }
    const toState = LifecycleStateSchema.safeParse(input.toState);
    if (!toState.success) {
      throw new RegistryError(
        `unknown lifecycle state ${String(input.toState)}`,
        {},
        ProvErrorCode.PROV_STATE_UNKNOWN,
      );
    }

    const applied = await this.engine.transaction(async (tx) => {
      // Fence: lock the projection row so concurrent transitions serialize
      // per operation version and each sees its true predecessor state.
      const rows = await tx.query<OperationRow>(
        `SELECT current_state, health_status FROM prov.prov_operations
         WHERE provider_id = $1 AND operation_id = $2 AND version = $3
         FOR UPDATE`,
        [input.providerId, input.operationId, input.operationVersion],
      );
      const op = rows.rows[0];
      if (op === undefined) {
        throw new RegistryError(
          `operation not registered: ${input.providerId}/${input.operationId}@${input.operationVersion}`,
          {
            providerId: input.providerId,
            operationId: input.operationId,
            version: input.operationVersion,
          },
          ProvErrorCode.PROV_OPERATION_UNKNOWN,
        );
      }

      // Replay check FIRST: a known key short-circuits before any mutation.
      const existing = await tx.query<EventRow>(
        'SELECT * FROM prov.prov_lifecycle_events WHERE idempotency_key = $1',
        [input.idempotencyKey],
      );
      const prior = existing.rows[0];
      if (prior !== undefined) {
        assertSameIntent(prior, input);
        return { event: rowToEvent(prior), idempotentReplay: true };
      }

      const fromState = LifecycleStateSchema.parse(op.current_state);
      try {
        requireLegalTransition(fromState, toState.data);
      } catch (error) {
        if (error instanceof LifecycleTransitionError) {
          throw new LifecycleTransitionError(
            error.message,
            {
              ...error.detail,
              providerId: input.providerId,
              operationId: input.operationId,
              version: input.operationVersion,
            },
            error.code as ProvErrorCode,
          );
        }
        throw error;
      }

      // Vocabulary-to-edge coherence (§15.4): sweeps must stay distinguishable
      // from operator actions in the ledger.
      //
      // 1. `*_EXPIRED` classes accompany ONLY exits from ACTIVE.
      if (
        input.reasonClass.endsWith('_EXPIRED') &&
        !(fromState === 'ACTIVE' && toState.data !== 'ACTIVE')
      ) {
        throw new LifecycleTransitionError(
          `expiry reason class ${input.reasonClass} is only valid exiting ACTIVE`,
          { reasonClass: input.reasonClass, fromState, toState: toState.data },
        );
      }
      // 2. Recovery/activation classes land ONLY in ACTIVE.
      if (
        (input.reasonClass === 'ACTIVATION_APPROVED' ||
          input.reasonClass === 'RECOVERY_VERIFIED') &&
        toState.data !== 'ACTIVE'
      ) {
        throw new LifecycleTransitionError(
          `${input.reasonClass} is only valid entering ACTIVE`,
          { reasonClass: input.reasonClass, toState: toState.data },
        );
      }
      // 3. Registration genesis is appended by the registry, never re-faked.
      if (input.reasonClass === 'REGISTERED_DISCOVERED') {
        throw new LifecycleTransitionError(
          'REGISTERED_DISCOVERED is reserved for registration genesis events',
          { reasonClass: input.reasonClass },
        );
      }
      // 4. Exits from ACTIVE name WHY: an expired verification kind, a health
      //    incident, deprecation, or an explicit operator/replacement action.
      if (
        fromState === 'ACTIVE' &&
        toState.data !== 'ACTIVE' &&
        !input.reasonClass.endsWith('_EXPIRED') &&
        input.reasonClass !== 'HEALTH_INCIDENT' &&
        input.reasonClass !== 'DEPRECATION_MARKED' &&
        input.reasonClass !== 'OPERATOR_BLOCK' &&
        input.reasonClass !== 'CAPABILITY_VIOLATION_BLOCK' &&
        input.reasonClass !== 'OPERATOR_REMOVAL' &&
        input.reasonClass !== 'REPLACEMENT_ACTIVATED'
      ) {
        throw new LifecycleTransitionError(
          `exit from ACTIVE requires an expiry, incident, or operator reason class, got ${input.reasonClass}`,
          { reasonClass: input.reasonClass },
        );
      }

      const occurredAt = this.clock.now();
      const inserted = await tx.query<EventRow>(
        `INSERT INTO prov.prov_lifecycle_events (
           provider_id, operation_id, operation_version, from_state, to_state,
           reason_class, actor, occurred_at, evidence_refs, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
         RETURNING *`,
        [
          input.providerId,
          input.operationId,
          input.operationVersion,
          fromState,
          toState.data,
          input.reasonClass,
          input.actor,
          occurredAt,
          JSON.stringify(input.evidenceRefs ?? []),
          input.idempotencyKey,
        ],
      );
      const event = inserted.rows[0];
      if (event === undefined) {
        throw new LifecycleTransitionError('transition insert returned no row', {});
      }

      // Projection update in the SAME transaction — readers of current_state
      // see exactly the committed ledger tail or nothing.
      await tx.query(
        `UPDATE prov.prov_operations SET current_state = $4
           ${input.nextHealthStatus !== undefined ? ', health_status = $5' : ''}
         WHERE provider_id = $1 AND operation_id = $2 AND version = $3`,
        input.nextHealthStatus !== undefined
          ? [
              input.providerId,
              input.operationId,
              input.operationVersion,
              toState.data,
              input.nextHealthStatus,
            ]
          : [input.providerId, input.operationId, input.operationVersion, toState.data],
      );

      return { event: rowToEvent(event), idempotentReplay: false };
    });

    if (!applied.idempotentReplay) {
      await this.audit?.transitionApplied(applied.event);
    }
    return applied;
  }

  /** Current projected state + health for one exact operation version. */
  async projection(
    providerId: string,
    operationId: string,
    operationVersion: string,
  ): Promise<{ currentState: LifecycleState; healthStatus: HealthStatus } | undefined> {
    const rows = await this.engine.query<OperationRow>(
      `SELECT current_state, health_status FROM prov.prov_operations
       WHERE provider_id = $1 AND operation_id = $2 AND version = $3`,
      [providerId, operationId, operationVersion],
    );
    const row = rows.rows[0];
    if (row === undefined) return undefined;
    return {
      currentState: LifecycleStateSchema.parse(row.current_state),
      healthStatus: row.health_status as HealthStatus,
    };
  }

  /**
   * Full event history ascending by seq — the reconstructable walk (INV-004):
   * folding these events over the graph must reproduce the projection.
   */
  async history(
    providerId: string,
    operationId: string,
    operationVersion: string,
  ): Promise<LifecycleEventRecord[]> {
    const rows = await this.engine.query<EventRow>(
      `SELECT * FROM prov.prov_lifecycle_events
       WHERE provider_id = $1 AND operation_id = $2 AND operation_version = $3
       ORDER BY seq ASC`,
      [providerId, operationId, operationVersion],
    );
    return rows.rows.map(rowToEvent);
  }
}

/** A replayed key must carry the same intent — otherwise it is a conflict. */
function assertSameIntent(
  prior: EventRow,
  input: TransitionInput,
): void {
  const matches =
    prior.provider_id === input.providerId &&
    prior.operation_id === input.operationId &&
    prior.operation_version === input.operationVersion &&
    prior.to_state === input.toState &&
    prior.reason_class === input.reasonClass &&
    prior.actor === input.actor;
  if (!matches) {
    throw new RegistryError(
      `idempotency key already used by a different transition: ${input.idempotencyKey}`,
      { idempotencyKey: input.idempotencyKey },
      ProvErrorCode.PROV_IDEMPOTENCY_KEY_CONFLICT,
    );
  }
}

export { IDEMPOTENCY_CONSTRAINT };
