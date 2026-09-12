-- g2_wf_0004_decision_outbox.sql
-- Generic commit-boundary tables for the §26.5 transactional outbox (FR-WF-006,
-- AC-011, AC-061) plus the supporting claim-lease index for the crash-safe
-- delivery workers.
--
-- `wf.decision_commits` is the decision record the outbox entry references;
-- `wf.alert_records` is the alert record that must commit in the SAME
-- transaction. A provider outage suppresses the notification
-- (`SUPPRESSED_OUTAGE`) while PRESERVING both records (AC-061); a shadow run
-- tags the outbox row `SUPPRESSED_SHADOW` and never delivers (FR-WF-008).
--
-- Additive only; no ALTER of any foreign family, and no rewrite of an applied
-- migration. All tables live in the dedicated `wf` schema (ADR-G2WF-1).

-- --- §26.5 decision commits -------------------------------------------------

CREATE TABLE IF NOT EXISTS wf.decision_commits (
    decision_id   text PRIMARY KEY CHECK (length(decision_id) > 0),
    run_id        text NOT NULL REFERENCES wf.runs(run_id),
    decision_kind text NOT NULL CHECK (length(decision_kind) > 0),
    payload       jsonb NOT NULL,
    payload_hash  text NOT NULL CHECK (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
    committed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS decision_commits_run_idx
    ON wf.decision_commits (run_id, committed_at);

-- --- §26.5 alert records ----------------------------------------------------

CREATE TABLE IF NOT EXISTS wf.alert_records (
    alert_id     text PRIMARY KEY CHECK (length(alert_id) > 0),
    decision_id  text NOT NULL REFERENCES wf.decision_commits(decision_id),
    alert_class  text NOT NULL CHECK (length(alert_class) > 0),
    payload      jsonb NOT NULL,
    payload_hash text NOT NULL CHECK (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alert_records_decision_idx
    ON wf.alert_records (decision_id);

-- --- §26.5 claim-lease scan -------------------------------------------------

-- The delivery workers claim PENDING rows and re-claim orphaned CLAIMED rows
-- whose lease expired (`claim_expires_at <= now`). This index keeps both scans
-- bounded as the outbox grows.
CREATE INDEX IF NOT EXISTS notification_outbox_claim_idx
    ON wf.notification_outbox (status, claim_expires_at);
