-- g2_wf_0001_schedules_runs.sql
-- Durable workflow substrate: versioned schedules with immutable configuration
-- versions, the idempotent §25.2 trigger inbox, the exactly-one-run dedupe key,
-- durable §25.5 steps, and monotonically fenced step leases
-- (FR-WF-001, FR-WF-002, FR-WF-003, FR-WF-004, FR-WF-008).
--
-- Every table lives in the dedicated `wf` schema, never `public` (ADR-G2WF-1):
-- the recovery probe asserts the absence of unqualified workflow tables.
-- Additive only; no ALTER of any foreign family.

CREATE SCHEMA IF NOT EXISTS wf;

-- --- §25.11 schedules and immutable versions -------------------------------

CREATE TABLE IF NOT EXISTS wf.schedules (
    schedule_id        text PRIMARY KEY CHECK (length(schedule_id) > 0),
    name               text NOT NULL CHECK (length(name) > 0),
    concurrency_policy text NOT NULL CHECK (concurrency_policy IN (
                           'SKIP_IF_RUNNING',
                           'QUEUE_AFTER_RUNNING',
                           'CANCEL_PREVIOUS',
                           'ALLOW_PARALLEL')),
    status             text NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
                           'DRAFT',
                           'ACTIVE',
                           'PAUSED',
                           'DISABLED')),
    current_version_id text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wf.schedule_versions (
    version_id      text PRIMARY KEY CHECK (length(version_id) > 0),
    schedule_id     text NOT NULL REFERENCES wf.schedules(schedule_id),
    config_hash     text NOT NULL CHECK (config_hash ~ '^sha256:[0-9a-f]{64}$'),
    resolved_config jsonb NOT NULL,
    shadow          boolean NOT NULL DEFAULT false,
    superseded_by   text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    -- Identity of a version WITHIN its owning schedule; the target of the
    -- composite run->version pin below, so a run can never resolve a version
    -- that belongs to a different schedule (INV-004, §25.11).
    CONSTRAINT schedule_versions_identity_unique UNIQUE (schedule_id, version_id),
    CONSTRAINT schedule_versions_superseded_by_fk
        FOREIGN KEY (superseded_by) REFERENCES wf.schedule_versions(version_id)
);

-- Forward pointer from a schedule to its current immutable version. Added here
-- (after `schedule_versions` exists) because a table cannot reference a
-- not-yet-created table; the guard makes re-application idempotent.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'schedules_current_version_fk'
          AND conrelid = 'wf.schedules'::regclass
    ) THEN
        ALTER TABLE wf.schedules
            ADD CONSTRAINT schedules_current_version_fk
            FOREIGN KEY (current_version_id) REFERENCES wf.schedule_versions(version_id);
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS schedule_versions_schedule_idx ON wf.schedule_versions (schedule_id);

-- Immutable by construction: a configuration change inserts a NEW version row
-- and then sets the OLD row's superseded_by exactly once. Every other rewrite
-- (identity, config, shadow flag, timestamps, delete, truncate) is refused.
-- TRUNCATE is handled FIRST: statement-level truncate rows have no OLD/NEW, so
-- a fall-through would compare all-NULL and wrongly allow it.
CREATE OR REPLACE FUNCTION wf.foresift_wf_refuse_version_rewrite() RETURNS trigger AS $fn$
BEGIN
    IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
        RAISE EXCEPTION 'schedule versions are immutable: configuration changes create a new version (delete/truncate refused)'
            USING ERRCODE = 'restrict_violation';
    END IF;
    -- The ONLY legal UPDATE is a one-time supersede pointer: superseded_by
    -- goes NULL -> non-null and every other column stays byte-identical.
    IF NEW.version_id IS DISTINCT FROM OLD.version_id
        OR NEW.schedule_id IS DISTINCT FROM OLD.schedule_id
        OR NEW.config_hash IS DISTINCT FROM OLD.config_hash
        OR NEW.resolved_config IS DISTINCT FROM OLD.resolved_config
        OR NEW.shadow IS DISTINCT FROM OLD.shadow
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR NEW.superseded_by IS NULL
        OR OLD.superseded_by IS NOT NULL
    THEN
        RAISE EXCEPTION 'schedule versions are immutable: only a one-time supersede pointer may be set'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS schedule_versions_no_rewrite ON wf.schedule_versions;
CREATE TRIGGER schedule_versions_no_rewrite
    BEFORE UPDATE OR DELETE ON wf.schedule_versions
    FOR EACH ROW EXECUTE FUNCTION wf.foresift_wf_refuse_version_rewrite();
DROP TRIGGER IF EXISTS schedule_versions_no_truncate ON wf.schedule_versions;
CREATE TRIGGER schedule_versions_no_truncate
    BEFORE TRUNCATE ON wf.schedule_versions
    FOR EACH STATEMENT EXECUTE FUNCTION wf.foresift_wf_refuse_version_rewrite();
-- Retire the pre-fix unqualified function (schema hygiene): it lived in
-- `public` via search_path and raised the generic "observations are immutable"
-- message. Triggers now point at the wf-scoped function above.
DROP FUNCTION IF EXISTS public.foresift_wf_refuse_version_rewrite();

-- --- §25.2 trigger inbox ---------------------------------------------------

CREATE TABLE IF NOT EXISTS wf.trigger_inbox (
    inbox_id                      text PRIMARY KEY CHECK (length(inbox_id) > 0),
    source                        text NOT NULL CHECK (length(source) > 0),
    external_message_id           text NOT NULL CHECK (length(external_message_id) > 0),
    canonical_external_message_id text NOT NULL CHECK (length(canonical_external_message_id) > 0),
    schedule_id                   text NOT NULL REFERENCES wf.schedules(schedule_id),
    scheduled_for                 timestamptz NOT NULL,
    payload_hash                  text NOT NULL CHECK (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
    received_at                   timestamptz NOT NULL,
    verified_at                   timestamptz,
    processed_run_id              text,
    status                        text NOT NULL CHECK (status IN (
                                      'RECEIVED',
                                      'VERIFIED',
                                      'PROCESSED',
                                      'DUPLICATE_COLLAPSED',
                                      'REJECTED')),
    CONSTRAINT trigger_inbox_identity_unique
        UNIQUE (source, canonical_external_message_id),
    -- Identity of an inbox row WITHIN its target schedule: the target of the
    -- composite run->inbox pin below, so a run can never consume a delivery
    -- addressed to a different schedule (§25.3 step 5).
    CONSTRAINT trigger_inbox_identity_per_schedule
        UNIQUE (schedule_id, inbox_id)
);

CREATE INDEX IF NOT EXISTS trigger_inbox_status_idx ON wf.trigger_inbox (status, received_at);

-- --- §25.2/§25.6 runs ------------------------------------------------------

CREATE TABLE IF NOT EXISTS wf.runs (
    run_id                                text PRIMARY KEY CHECK (length(run_id) > 0),
    schedule_id                           text NOT NULL REFERENCES wf.schedules(schedule_id),
    resolved_schedule_version             text NOT NULL,
    inbox_id                              text NOT NULL UNIQUE,
    trigger_source                        text NOT NULL CHECK (length(trigger_source) > 0),
    trigger_external_message_id           text NOT NULL CHECK (length(trigger_external_message_id) > 0),
    trigger_canonical_external_message_id text NOT NULL CHECK (
                                              length(trigger_canonical_external_message_id) > 0),
    concurrency_policy                    text NOT NULL CHECK (concurrency_policy IN (
                                              'SKIP_IF_RUNNING',
                                              'QUEUE_AFTER_RUNNING',
                                              'CANCEL_PREVIOUS',
                                              'ALLOW_PARALLEL')),
    concurrency_outcome                   text NOT NULL CHECK (concurrency_outcome IN (
                                              'SKIP_IF_RUNNING',
                                              'QUEUE_AFTER_RUNNING',
                                              'CANCEL_PREVIOUS',
                                              'ALLOW_PARALLEL')),
    shadow                                boolean NOT NULL DEFAULT false,
    status                                text NOT NULL CHECK (status IN (
                                              'PENDING',
                                              'RUNNING',
                                              'WAITING',
                                              'SUCCEEDED',
                                              'FAILED',
                                              'CANCELLED',
                                              'DEAD_LETTERED')),
    deadline                              timestamptz NOT NULL,
    started_at                            timestamptz,
    completed_at                          timestamptz,
    -- Run dedupe key: a duplicate delivery that reaches run creation still
    -- converges on exactly one logical run (AC-010).
    CONSTRAINT runs_dedupe_unique
        UNIQUE (schedule_id, resolved_schedule_version, inbox_id),
    -- A run may only pin a version owned by ITS schedule: the composite FK
    -- targets `schedule_versions_identity_unique (schedule_id, version_id)`,
    -- so a cross-schedule pin is impossible at the storage layer (INV-004).
    CONSTRAINT runs_version_belongs_to_schedule
        FOREIGN KEY (schedule_id, resolved_schedule_version)
        REFERENCES wf.schedule_versions (schedule_id, version_id),
    -- A run may only consume a delivery addressed to ITS schedule, so an inbox
    -- row can never be re-pointed at another schedule's run (§25.3, AC-010).
    CONSTRAINT runs_inbox_belongs_to_schedule
        FOREIGN KEY (schedule_id, inbox_id)
        REFERENCES wf.trigger_inbox (schedule_id, inbox_id)
);

CREATE INDEX IF NOT EXISTS runs_schedule_status_idx ON wf.runs (schedule_id, status);

-- --- §25.5 steps -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS wf.steps (
    step_id          text PRIMARY KEY CHECK (length(step_id) > 0),
    run_id           text NOT NULL REFERENCES wf.runs(run_id),
    step_type        text NOT NULL CHECK (length(step_type) > 0),
    idempotency_key  text NOT NULL CHECK (length(idempotency_key) > 0),
    attempt          integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    input_hash       text CHECK (input_hash IS NULL OR input_hash ~ '^sha256:[0-9a-f]{64}$'),
    output_hash      text CHECK (output_hash IS NULL OR output_hash ~ '^sha256:[0-9a-f]{64}$'),
    status           text NOT NULL CHECK (status IN (
                         'PENDING',
                         'RUNNING',
                         'SUCCEEDED',
                         'FAILED_RETRYABLE',
                         'FAILED_EXHAUSTED',
                         'SKIPPED_POLICY')),
    lease_owner      text,
    lease_version    integer NOT NULL DEFAULT 0 CHECK (lease_version >= 0),
    lease_expires_at timestamptz,
    started_at       timestamptz,
    completed_at     timestamptz,
    error_class      text CHECK (error_class IS NULL OR error_class IN (
                         'AUTH_INVALID_KEY',
                         'INVALID_INPUT',
                         'RATE_LIMITED',
                         'TIMEOUT_OR_5XX',
                         'SCHEMA_DRIFT',
                         'MODEL_FORMAT_ERROR',
                         'BUDGET_EXCEEDED',
                         'SERIALIZATION_CONFLICT',
                         'NOTIFICATION_TRANSIENT')),
    retryable        boolean,
    -- One idempotent step execution per key per run.
    CONSTRAINT steps_idempotency_unique UNIQUE (run_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS steps_run_status_idx ON wf.steps (run_id, status);

-- --- §25.7 step leases -----------------------------------------------------

-- Dedicated sequence: fencing tokens are globally increasing, therefore
-- monotonic per resource key. A takeover ALWAYS allocates a fresh token via
-- nextval, so a stale holder's token can never re-match.
CREATE SEQUENCE IF NOT EXISTS wf.wf_lease_fencing_seq AS bigint START WITH 1 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS wf.step_leases (
    resource_key  text PRIMARY KEY CHECK (length(resource_key) > 0),
    owner         text NOT NULL CHECK (length(owner) > 0),
    fencing_token bigint NOT NULL DEFAULT nextval('wf.wf_lease_fencing_seq')
                      CHECK (fencing_token > 0),
    acquired_at   timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    released_at   timestamptz,
    CONSTRAINT step_leases_expiry_shape CHECK (expires_at > acquired_at),
    CONSTRAINT step_leases_release_shape CHECK (released_at IS NULL OR released_at >= acquired_at)
);

-- §25.7 monotonic fencing is a STORAGE guarantee, not merely an app
-- convention: a lease may never move to a different resource key and its
-- fencing token may never DECREASE, so a stale holder can never regress a
-- lease even with a hand-written statement. An UNCHANGED token is legal: a
-- takeover always allocates a strictly larger token, while an ordinary holder
-- operation (releasing, extending expiry, updating owner metadata) keeps the
-- token and is guarded at row level by the `fencing_token = $n` predicate in
-- the repository SQL. Refusing equality here would make release impossible.
CREATE OR REPLACE FUNCTION wf.foresift_wf_refuse_lease_regression() RETURNS trigger AS $fn$
BEGIN
    IF NEW.resource_key IS DISTINCT FROM OLD.resource_key
        OR NEW.fencing_token < OLD.fencing_token
    THEN
        RAISE EXCEPTION 'step leases are monotonically fenced: an UPDATE must keep the resource key and must not decrease the fencing token'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS step_leases_no_regression ON wf.step_leases;
CREATE TRIGGER step_leases_no_regression
    BEFORE UPDATE ON wf.step_leases
    FOR EACH ROW EXECUTE FUNCTION wf.foresift_wf_refuse_lease_regression();
