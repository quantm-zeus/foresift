-- g2_wf_0002_outbox_deadletter.sql
-- Transactional notification outbox with lease-claimed, fenced delivery, dead
-- letters with actionable context and last-valid-checkpoint refs, and
-- reconciliation reports (FR-WF-005, FR-WF-006, FR-WF-007).
--
-- Additive only; no ALTER of any foreign family. All tables live in the
-- dedicated `wf` schema (ADR-G2WF-1).

-- --- §26.5 notification outbox --------------------------------------------

CREATE TABLE IF NOT EXISTS wf.notification_outbox (
    outbox_id           text PRIMARY KEY CHECK (length(outbox_id) > 0),
    decision_ref        text NOT NULL CHECK (length(decision_ref) > 0),
    alert_ref           text,
    channel             text NOT NULL CHECK (length(channel) > 0),
    payload_hash        text NOT NULL CHECK (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
    status              text NOT NULL CHECK (status IN (
                            'PENDING',
                            'CLAIMED',
                            'SENT',
                            'FAILED',
                            'SUPPRESSED_SHADOW',
                            'SUPPRESSED_OUTAGE')),
    claim_owner         text,
    claim_fencing_token bigint CHECK (claim_fencing_token IS NULL OR claim_fencing_token > 0),
    claim_expires_at    timestamptz,
    attempts            integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    enqueued_at         timestamptz NOT NULL DEFAULT now(),
    claimed_at          timestamptz,
    sent_at             timestamptz,
    last_error          text,
    -- A CLAIMED row must be fully shaped: owner, fence, and claim expiry are
    -- all present, so the claim can be fenced, renewed, or re-claimed
    -- deterministically (§26.5, AC-011).
    CONSTRAINT notification_outbox_claim_shape CHECK (
        status <> 'CLAIMED'
        OR (claim_owner IS NOT NULL
            AND claim_fencing_token IS NOT NULL
            AND claim_expires_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS notification_outbox_status_idx
    ON wf.notification_outbox (status, enqueued_at);

-- --- §25.9 dead letters ----------------------------------------------------

CREATE TABLE IF NOT EXISTS wf.dead_letters (
    dead_letter_id            text PRIMARY KEY CHECK (length(dead_letter_id) > 0),
    run_id                    text NOT NULL REFERENCES wf.runs(run_id),
    step_id                   text REFERENCES wf.steps(step_id),
    error_class               text NOT NULL CHECK (error_class IN (
                                  'AUTH_INVALID_KEY',
                                  'INVALID_INPUT',
                                  'RATE_LIMITED',
                                  'TIMEOUT_OR_5XX',
                                  'SCHEMA_DRIFT',
                                  'MODEL_FORMAT_ERROR',
                                  'BUDGET_EXCEEDED',
                                  'SERIALIZATION_CONFLICT',
                                  'NOTIFICATION_TRANSIENT')),
    context                   jsonb NOT NULL,
    last_valid_checkpoint_ref text CHECK (
                                  last_valid_checkpoint_ref IS NULL
                                  OR length(last_valid_checkpoint_ref) > 0),
    status                    text NOT NULL CHECK (status IN (
                                  'OPEN',
                                  'RETRIED',
                                  'RESOLVED')),
    opened_at                 timestamptz NOT NULL DEFAULT now(),
    resolved_at               timestamptz
);

CREATE INDEX IF NOT EXISTS dead_letters_status_idx ON wf.dead_letters (status, opened_at);

-- --- §25.10 reconciliation -------------------------------------------------

CREATE TABLE IF NOT EXISTS wf.reconciliation_reports (
    report_id     text PRIMARY KEY CHECK (length(report_id) > 0),
    checked_at    timestamptz NOT NULL,
    diff          jsonb NOT NULL,
    incident_refs text[] NOT NULL DEFAULT '{}'::text[]
);
