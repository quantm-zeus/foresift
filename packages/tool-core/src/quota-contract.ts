/**
 * Quota extension-point contract (FR-CORE-007; PRD §16.7; milestone
 * boundary). This module defines THE stable seam only: the adapter
 * interface, reservation-row lifecycle helpers over the Phase-B guarded SQL,
 * and nothing about cost semantics. Cost, quota, and capacity logic is
 * implemented by g0-cost-capacity entirely outside `packages/tool-core/**`,
 * without editing this package.
 *
 * The shipped default "adapter" is an explicitly deny-closed TEST double in
 * `tests/fixtures/core/deny-closed-quota-adapter.ts` — never a production
 * implementation inside src/.
 */
import { ForesiftError, type QuotaModel, type WorkloadClass } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';

export interface QuotaEstimateRequest {
  readonly provider: string;
  readonly operation: string;
  readonly workloadClass: WorkloadClass;
}

export interface QuotaEstimate {
  readonly quotaModel: QuotaModel;
  readonly estimatedUnits: number;
}

export interface QuotaAdmissionDecision {
  readonly allowed: boolean;
  /** Machine reason when admission refuses (e.g. unknown cost, no budget). */
  readonly reason: string;
}

export interface ReservationRequest extends QuotaEstimateRequest {
  readonly actorId: string;
  readonly pipelineRunId: string;
  readonly stage: string;
  readonly estimate: QuotaEstimate;
}

/**
 * THE injection seam consumed by the composition root. Implementations live
 * OUTSIDE packages/tool-core/** by milestone objective.
 */
export interface QuotaReservationAdapter {
  estimate(request: QuotaEstimateRequest): Promise<QuotaEstimate>;
  admit(
    request: QuotaEstimateRequest & { readonly estimate: QuotaEstimate },
  ): Promise<QuotaAdmissionDecision>;
  reserve(request: ReservationRequest): Promise<string>;
  commit(request: { readonly reservationId: string; readonly actualUnits: number }): Promise<void>;
  release(request: { readonly reservationId: string }): Promise<void>;
}

// ── Lifecycle helpers over the Phase-B state machine ─────────────────────────
// The statements are THE guarded UPDATEs proven by
// packages/tool-core/test/migrations.spec.ts; zero rows updated means the
// caller proposed an illegal edge, which surfaces as
// QUOTA_RESERVATION_TRANSITION_ILLEGAL carrying the row's current state.

const GUARD_COMMIT = `
    UPDATE core.core_quota_reservations
    SET state = 'COMMITTED', actual_units = $2, settled_at = $3
    WHERE reservation_id = $1 AND state = 'RESERVED'
    RETURNING reservation_id`;

const GUARD_RELEASE = `
    UPDATE core.core_quota_reservations
    SET state = 'RELEASED', settled_at = $2
    WHERE reservation_id = $1 AND state IN ('PENDING','RESERVED')
    RETURNING reservation_id`;

const GUARD_RESERVE = `
    UPDATE core.core_quota_reservations
    SET state = 'RESERVED', reserved_at = $2
    WHERE reservation_id = $1 AND state = 'PENDING'
    RETURNING reservation_id`;

const GUARD_EXPIRE = `
    UPDATE core.core_quota_reservations
    SET state = 'EXPIRED', settled_at = $2
    WHERE reservation_id = $1 AND state = 'RESERVED'
    RETURNING reservation_id`;

async function currentState(
  engine: DatabaseEngine,
  reservationId: string,
): Promise<string | undefined> {
  const rows = await engine.query<{ state: string }>(
    `SELECT state FROM core.core_quota_reservations WHERE reservation_id = $1`,
    [reservationId],
  );
  return rows.rows[0]?.state;
}

async function refuseIllegal(
  engine: DatabaseEngine,
  reservationId: string,
  attempted: string,
): Promise<never> {
  const from = await currentState(engine, reservationId);
  throw new ForesiftError(
    'QUOTA_RESERVATION_TRANSITION_ILLEGAL',
    `${attempted} is not legal from ${from ?? '<missing>'}`,
    { reservationId, from: from ?? null },
  );
}

/** Insert a PENDING reservation under the (pipeline_run_id, stage) key. */
export async function insertPendingReservation(
  engine: DatabaseEngine,
  request: {
    reservationId: string;
    pipelineRunId: string;
    stage: string;
    actorId: string;
    provider: string;
    operation: string;
    workloadClass: WorkloadClass;
    estimatedUnits: number;
    createdAt?: string;
  },
): Promise<void> {
  await engine.query(
    `INSERT INTO core.core_quota_reservations
       (reservation_id, pipeline_run_id, stage, actor_id, provider, operation,
        workload_class, estimated_units, state)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PENDING')`,
    [
      request.reservationId,
      request.pipelineRunId,
      request.stage,
      request.actorId,
      request.provider,
      request.operation,
      request.workloadClass,
      String(request.estimatedUnits),
    ],
  );
}

export async function reserveReservation(
  engine: DatabaseEngine,
  request: { readonly reservationId: string; readonly at?: string },
): Promise<void> {
  const at = request.at ?? new Date().toISOString();
  const rows = await engine.query(GUARD_RESERVE, [request.reservationId, at]);
  if (rows.rows.length === 0) await refuseIllegal(engine, request.reservationId, 'reserve');
}

export async function commitReservation(
  engine: DatabaseEngine,
  request: { readonly reservationId: string; readonly actualUnits: number; readonly at?: string },
): Promise<void> {
  const at = request.at ?? new Date().toISOString();
  const rows = await engine.query(GUARD_COMMIT, [
    request.reservationId,
    String(request.actualUnits),
    at,
  ]);
  if (rows.rows.length === 0) await refuseIllegal(engine, request.reservationId, 'commit');
}

export async function releaseReservation(
  engine: DatabaseEngine,
  request: { readonly reservationId: string; readonly at?: string },
): Promise<void> {
  const at = request.at ?? new Date().toISOString();
  const rows = await engine.query(GUARD_RELEASE, [request.reservationId, at]);
  if (rows.rows.length === 0) await refuseIllegal(engine, request.reservationId, 'release');
}

export async function expireReservation(
  engine: DatabaseEngine,
  request: { readonly reservationId: string; readonly at?: string },
): Promise<void> {
  const at = request.at ?? new Date().toISOString();
  const rows = await engine.query(GUARD_EXPIRE, [request.reservationId, at]);
  if (rows.rows.length === 0) await refuseIllegal(engine, request.reservationId, 'expire');
}
