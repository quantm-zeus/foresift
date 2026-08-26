-- g0_core_0003_quota_reservations.sql
-- Atomic quota reservation records (FR-CORE-007; PRD §16.7; INV-009).
--
-- The table pins the §16.7 state-machine vocabulary; the TRANSITIONS are
-- enforced by WHERE-guarded UPDATEs issued at this boundary (see
-- @foresift/tool-core reservation lifecycle helpers) so each guarded statement
-- is atomic and retry-idempotent:
--
--   reserve:  state='PENDING'  -> 'RESERVED'
--   commit:   state='RESERVED' -> 'COMMITTED' (actual units recorded)
--   release:  state IN ('PENDING','RESERVED') -> 'RELEASED'
--   expire:   state='RESERVED' -> 'EXPIRED'
--   replays:  COMMITTED->COMMITTED and RELEASED->RELEASED converge (no error,
--             no double count); every other transition matches zero rows.
--
-- Rules encoded here:
--   * idempotency key IS (pipeline_run_id, stage): a retried pipeline stage
--     converges onto the SAME reservation row instead of reserving twice.
--   * workload_class is CHECK-pinned to the five §16.8 classes.
--   * estimated units are always present; actual units appear only on commit.
--   * dimension columns (actor/provider/operation/workload class) make every
--     reserved unit attributable for downstream cost/quota semantics, which
--     live OUTSIDE packages/tool-core/** behind the QuotaReservationAdapter
--     seam — this table carries STATE, never policy values.

CREATE SCHEMA IF NOT EXISTS core;

CREATE TABLE core.core_quota_reservations (
    reservation_id    text PRIMARY KEY,
    pipeline_run_id   text NOT NULL CHECK (length(pipeline_run_id) > 0),
    stage             text NOT NULL CHECK (length(stage) > 0),
    actor_id          text NOT NULL CHECK (length(actor_id) > 0),
    provider          text NOT NULL CHECK (length(provider) > 0),
    operation         text NOT NULL CHECK (length(operation) > 0),
    workload_class    text NOT NULL CHECK (workload_class IN (
                        'INTERACTIVE_HIGH',
                        'RISK_MONITOR_HIGH',
                        'SCHEDULED_NORMAL',
                        'EVALUATION_LOW',
                        'BACKFILL_LOW')),
    estimated_units   numeric NOT NULL CHECK (estimated_units >= 0),
    actual_units      numeric CHECK (actual_units IS NULL OR actual_units >= 0),
    state             text NOT NULL CHECK (state IN (
                        'PENDING',
                        'RESERVED',
                        'COMMITTED',
                        'RELEASED',
                        'EXPIRED')),
    created_at        timestamptz NOT NULL DEFAULT now(),
    reserved_at       timestamptz,
    settled_at        timestamptz,
    CONSTRAINT core_quota_reservation_idempotency
        UNIQUE (pipeline_run_id, stage)
);
