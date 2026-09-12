-- g2_wf_0003_schedule_forecasts.sql
-- §33.6 cost-forecast persistence backing the forecast-before-enable gate
-- (FR-WF-004, AC-063) plus the dedicated outbox fencing sequence reserved for
-- the lease-claimed notification-delivery slice (FR-WF-006).
--
-- Additive only; no ALTER of any foreign family. All tables/sequences live in
-- the dedicated `wf` schema (ADR-G2WF-1).

CREATE TABLE IF NOT EXISTS wf.schedule_forecasts (
    forecast_id  text PRIMARY KEY CHECK (length(forecast_id) > 0),
    schedule_id  text NOT NULL REFERENCES wf.schedules(schedule_id),
    version_id   text NOT NULL,
    computed_at  timestamptz NOT NULL,
    payload      jsonb NOT NULL,
    payload_hash text NOT NULL CHECK (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
    created_at   timestamptz NOT NULL DEFAULT now(),
    -- A forecast may only reference a version owned by ITS schedule (the
    -- composite target is `schedule_versions_identity_unique`), mirroring the
    -- runs->version pin so a forecast can never be attached cross-schedule.
    CONSTRAINT schedule_forecasts_version_belongs_to_schedule
        FOREIGN KEY (schedule_id, version_id)
        REFERENCES wf.schedule_versions (schedule_id, version_id)
);

-- Latest-forecast lookup for the enable/resume gate.
CREATE INDEX IF NOT EXISTS schedule_forecasts_schedule_idx
    ON wf.schedule_forecasts (schedule_id, computed_at DESC);

-- Dedicated fencing sequence for the §26.5 outbox claim protocol (FR-WF-006).
-- Kept SEPARATE from wf_lease_fencing_seq so a step-lease takeover and an
-- outbox claim can never share a token stream (a takeover must never fence an
-- unrelated claim). The outbox claim SQL lands with the delivery-worker slice;
-- the sequence is provisioned here so a later migration never has to alter an
-- applied one.
CREATE SEQUENCE IF NOT EXISTS wf.wf_outbox_fencing_seq AS bigint START WITH 1 INCREMENT BY 1;
