/**
 * Guarded lifecycle transitions over the append-only prov_lifecycle_events
 * ledger (FR-PROV-001, §12.11; T110).
 *
 * Invariants carried here:
 *   * every transition validates the legal §12.11 graph BEFORE any write;
 *   * reason classes are mandatory (fail-closed — an unexplained state move
 *     refuses);
 *   * events are idempotency-fenced: the deterministic event id plus the SQL
 *     retry-fence UNIQUE make a retried transition resolve to the SAME event
 *     instead of double-appending (INV-009);
 *   * only the CONTROL-PLANE projection columns (current_state, health_status,
 *     last-verification/probe instants) ever mutate; stored historical
 *     evidence is untouched by expiry-driven exits (§12.11, INV-005/INV-006);
 *   * transitions INTO ACTIVE may be gated (the AC-270 refresh pair rule
 *     supplies the gate from the verification-TTL engine);
 *   * every appended transition is audited through the security AuditChain
 *     bridge, EXCEPT on dedupe (a replayed transition must not double-audit).
 */
import type { DatabaseEngine } from '@foresift/persistence';
import { sha256Text } from '@foresift/persistence';
import type { ClockPort, UtcTimestamp } from '@foresift/domain';
import type { ProviderLifecycleState } from './lifecycle-states.ts';
import { assertLegalLifecycleTransition } from './lifecycle-states.ts';
import type { OperationTarget } from './operation-registry.ts';
import {
  ForesiftProviderError,
  LifecycleTransitionError,
  ProvErrorCode,
} from './errors.ts';

export type { OperationTarget };

export interface LifecycleTransitionInput {
  readonly target: OperationTarget;
  readonly toState: ProviderLifecycleState;
  /** Non-empty machine-readable class, e.g. `VERIFICATION_EXPIRED:SCHEMA`. */
  readonly reasonClass: string;
  readonly actor: string;
  /**
   * Explicit idempotency key. When omitted, one is derived deterministically
   * from the full semantic tuple so retries dedupe without coordination.
   */
  readonly eventId?: string;
  /** Defaults to the injected clock's now(); sweeps pass evidence instants. */
  readonly effectiveAt?: UtcTimestamp;
  readonly occurredAt?: UtcTimestamp;
  readonly evidenceRefs?: readonly string[];
  /**
   * Optional §15.4 health projection applied atomically with the state move
   * (e.g. expiry sweeps landing PLAN_UNVERIFIED / RIGHTS_UNVERIFIED /
   * DEGRADED). Absent leaves health untouched.
   */
  readonly projectHealthStatus?: string;
}

export interface TransitionResult {
  readonly eventId: string;
  readonly fromState: ProviderLifecycleState;
  readonly toState: ProviderLifecycleState;
  readonly reasonClass: string;
  /** True when a retry resolved to the ALREADY-appended event (INV-009). */
  readonly deduped: boolean;
}

export interface LifecycleEventRecord {
  readonly seq: number;
  readonly eventId: string;
  readonly providerId: string;
  readonly operationId: string;
  readonly version: string;
  readonly fromState: string;
  readonly toState: string;
  readonly reasonClass: string;
  readonly actor: string;
  readonly occurredAt: string;
  readonly effectiveAt: string;
  readonly evidenceRefs: unknown;
}

interface LifecycleAuditSink {
  transitionAppended(input: {
    target: OperationTarget;
    eventId: string;
    fromState: string;
    toState: string;
    reasonClass: string;
    actor: string;
    occurredAt: UtcTimestamp;
    effectiveAt: UtcTimestamp;
  }): Promise<void>;
}

export interface LifecycleMachineOptions {
  readonly engine: DatabaseEngine;
  readonly clock: ClockPort;
  /** Optional AC-270 bridge; invoked when a transition targets ACTIVE. */
  readonly activationGate?: (target: OperationTarget) => Promise<void>;
  /** Optional audit sink; transitions still land in SQL when absent. */
  readonly audit?: LifecycleAuditSink;
}

interface OperationProjectionRow {
  current_state: string;
}

interface EventRow {
  seq: string | number;
  event_id: string;
  provider_id: string;
  operation_id: string;
  version: string;
  from_state: string;
  to_state: string;
  reason_class: string;
  actor: string;
  occurred_at: Date | string;
  effective_at: Date | string;
  evidence_refs: unknown;
}

function iso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString();
}

export function deriveLifecycleEventId(parts: {
  readonly target: OperationTarget;
  readonly fromState: string;
  readonly toState: string;
  readonly reasonClass: string;
  readonly effectiveAt: string;
}): string {
  return `lce:sha256:${sha256Text(
    [
      parts.target.providerId,
      parts.target.operationId,
      parts.target.version,
      parts.fromState,
      parts.toState,
      parts.reasonClass,
      parts.effectiveAt,
    ].join('|'),
  )}`;
}

export class LifecycleMachine {
  private readonly engine: DatabaseEngine;
  private readonly clock: ClockPort;
  private readonly activationGate: ((target: OperationTarget) => Promise<void>) | undefined;
  private readonly audit: LifecycleAuditSink | undefined;

  constructor(options: LifecycleMachineOptions) {
    this.engine = options.engine;
    this.clock = options.clock;
    this.activationGate = options.activationGate;
    this.audit = options.audit;
  }

  /** Current projected state, or null when the operation is unregistered. */
  async currentState(target: OperationTarget): Promise<ProviderLifecycleState | null> {
    const rows = await this.engine.query<OperationProjectionRow>(
      'SELECT current_state FROM prov.prov_operations WHERE provider_id = $1 AND operation_id = $2 AND version = $3',
      [target.providerId, target.operationId, target.version],
    );
    const row = rows.rows[0];
    return row === undefined ? null : (row.current_state as ProviderLifecycleState);
  }

  async history(target: OperationTarget): Promise<LifecycleEventRecord[]> {
    const rows = await this.engine.query<EventRow>(
      `SELECT seq, event_id, provider_id, operation_id, version,
              from_state, to_state, reason_class, actor, occurred_at,
              effective_at, evidence_refs
       FROM prov.prov_lifecycle_events
       WHERE provider_id = $1 AND operation_id = $2 AND version = $3
       ORDER BY seq`,
      [target.providerId, target.operationId, target.version],
    );
    return rows.rows.map((r) => ({
      seq: Number(r.seq),
      eventId: r.event_id,
      providerId: r.provider_id,
      operationId: r.operation_id,
      version: r.version,
      fromState: r.from_state,
      toState: r.to_state,
      reasonClass: r.reason_class,
      actor: r.actor,
      occurredAt: iso(r.occurred_at),
      effectiveAt: iso(r.effective_at),
      evidenceRefs: r.evidence_refs,
    }));
  }

  /**
   * Appends one guarded transition and projects it onto the registry row.
   * Idempotent under retry: the same semantic transition resolves to the same
   * ledger event and does NOT re-project or re-audit.
   */
  async transition(input: LifecycleTransitionInput): Promise<TransitionResult> {
    const reason = input.reasonClass.trim();
    if (reason.length === 0) {
      throw new LifecycleTransitionError(
        'a lifecycle transition requires a non-empty reason class',
        { ...input.target },
        ProvErrorCode.PROV_LIFECYCLE_REASON_REQUIRED,
      );
    }

    const existing = await this.currentState(input.target);
    if (existing === null) {
      throw new ForesiftProviderError(
        ProvErrorCode.PROV_OPERATION_UNKNOWN,
        `operation ${input.target.providerId}/${input.target.operationId}@${input.target.version} is not registered`,
        { ...input.target },
      );
    }

    const effectiveAt = input.effectiveAt ?? this.clock.now();
    const occurredAt = input.occurredAt ?? this.clock.now();

    // A retry after full completion finds the projection already moved: the
    // ORIGINAL event must resolve by its semantic tuple (the from_state it
    // recorded is the pre-transition state, no longer the projected one).
    if (existing === input.toState) {
      const prior = await this.findSemanticEvent(input.target, input.toState, reason, effectiveAt);
      if (prior !== null) {
        return {
          eventId: prior.eventId,
          fromState: prior.fromState as ProviderLifecycleState,
          toState: input.toState,
          reasonClass: prior.reasonClass,
          deduped: true,
        };
      }
      throw new LifecycleTransitionError(
        `operation already in state ${existing}; no ledger event matches this transition`,
        { ...input.target, toState: input.toState },
        ProvErrorCode.PROV_LIFECYCLE_STATE_CONFLICT,
      );
    }

    assertLegalLifecycleTransition(existing, input.toState);

    // AC-270 hook: entering ACTIVE may require fresh verification proof.
    if (input.toState === 'ACTIVE' && this.activationGate !== undefined) {
      await this.activationGate(input.target);
    }

    const eventId =
      input.eventId ??
      deriveLifecycleEventId({
        target: input.target,
        fromState: existing,
        toState: input.toState,
        reasonClass: reason,
        effectiveAt,
      });

    const inserted = await this.engine.query<{ seq: number }>(
      `INSERT INTO prov.prov_lifecycle_events (
         event_id, provider_id, operation_id, version,
         from_state, to_state, reason_class, actor, occurred_at, effective_at, evidence_refs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
       ON CONFLICT ON CONSTRAINT prov_lifecycle_events_retry_fenced
       DO NOTHING
       RETURNING seq`,
      [
        eventId,
        input.target.providerId,
        input.target.operationId,
        input.target.version,
        existing,
        input.toState,
        reason,
        input.actor,
        occurredAt,
        effectiveAt,
        JSON.stringify(input.evidenceRefs ?? []),
      ],
    );

    if (inserted.rows.length === 1) {
      // Projection update: the ONLY mutable surface on the registry row.
      await this.engine.query(
        `UPDATE prov.prov_operations
         SET current_state = $4,
             updated_at = $5,
             health_status = COALESCE($6, health_status)
         WHERE provider_id = $1 AND operation_id = $2 AND version = $3`,
        [
          input.target.providerId,
          input.target.operationId,
          input.target.version,
          input.toState,
          this.clock.now(),
          input.projectHealthStatus ?? null,
        ],
      );
      if (this.audit !== undefined) {
        await this.audit.transitionAppended({
          target: input.target,
          eventId,
          fromState: existing,
          toState: input.toState,
          reasonClass: reason,
          actor: input.actor,
          occurredAt,
          effectiveAt,
        });
      }
      return {
        eventId,
        fromState: existing,
        toState: input.toState,
        reasonClass: reason,
        deduped: false,
      };
    }

    // Lost the fence race or replayed: the SAME event already exists. Report
    // the ORIGINAL from_state it recorded (not the current projection).
    const prior = await this.findEvent(eventId);
    return {
      eventId,
      fromState:
        prior !== null ? (prior.fromState as ProviderLifecycleState) : existing,
      toState: input.toState,
      reasonClass: reason,
      deduped: true,
    };
  }

  /**
   * Resolves a prior event by its semantic tuple regardless of the recorded
   * from_state — this is what makes a fully-completed retry idempotent.
   */
  private async findSemanticEvent(
    target: OperationTarget,
    toState: string,
    reasonClass: string,
    effectiveAt: UtcTimestamp,
  ): Promise<LifecycleEventRecord | null> {
    const rows = await this.engine.query<{ event_id: string; from_state: string; reason_class: string }>(
      `SELECT event_id, from_state, reason_class
       FROM prov.prov_lifecycle_events
       WHERE provider_id = $1 AND operation_id = $2 AND version = $3
         AND to_state = $4 AND reason_class = $5 AND effective_at = $6
       ORDER BY seq DESC LIMIT 1`,
      [target.providerId, target.operationId, target.version, toState, reasonClass, effectiveAt],
    );
    const r = rows.rows[0];
    if (r === undefined) return null;
    return {
      seq: 0,
      eventId: r.event_id,
      providerId: target.providerId,
      operationId: target.operationId,
      version: target.version,
      fromState: r.from_state,
      toState,
      reasonClass: r.reason_class,
      actor: '',
      occurredAt: '',
      effectiveAt: '',
      evidenceRefs: [],
    };
  }

  private async findEvent(eventId: string): Promise<LifecycleEventRecord | null> {
    const rows = await this.engine.query<EventRow>(
      `SELECT seq, event_id, provider_id, operation_id, version,
              from_state, to_state, reason_class, actor, occurred_at,
              effective_at, evidence_refs
       FROM prov.prov_lifecycle_events WHERE event_id = $1`,
      [eventId],
    );
    const r = rows.rows[0];
    if (r === undefined) return null;
    return {
      seq: Number(r.seq),
      eventId: r.event_id,
      providerId: r.provider_id,
      operationId: r.operation_id,
      version: r.version,
      fromState: r.from_state,
      toState: r.to_state,
      reasonClass: r.reason_class,
      actor: r.actor,
      occurredAt: iso(r.occurred_at),
      effectiveAt: iso(r.effective_at),
      evidenceRefs: r.evidence_refs,
    };
  }
}
