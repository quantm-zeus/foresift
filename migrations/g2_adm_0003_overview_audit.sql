-- g2_adm_0003_overview_audit.sql
-- Provider-call-free overview snapshots and the high-impact admin action audit
-- (FR-ADM-001/003/007, PRD §28.2, §35.1, §33.6; AC-060, AC-061, AC-062).
--
-- All tables live in the dedicated `adm` schema, never `public`
-- (ADR-G2ADM-1). Additive only; foreign state (workflow runs, alerts,
-- capability states, capacity contracts, backup evidence) is referenced by id
-- and never duplicated.

-- --- §28.2 immutable overview snapshots -------------------------------------

-- One immutable overview assembly. `provider_calls_triggered` and
-- `external_write_attempts` are SQL-pinned to 0: §28.2 forbids a dashboard
-- refresh from triggering external provider calls, and the zero counters make
-- the property auditable rather than conventional. Each section carries its
-- owning package, row refs, and freshness inside the `sections` array.
CREATE TABLE IF NOT EXISTS adm.overview_snapshots (
    snapshot_id             text PRIMARY KEY CHECK (length(snapshot_id) > 0),
    generated_at            timestamptz NOT NULL,
    system_mode             text NOT NULL CHECK (system_mode IN (
                                'ACTIVE',
                                'SHADOW',
                                'DEGRADED',
                                'PAUSED',
                                'READ_ONLY',
                                'DISABLED')),
    sections                jsonb NOT NULL CHECK (
                                jsonb_typeof(sections) = 'array'
                                AND jsonb_array_length(sections) > 0
                            ),
    source_refs             jsonb NOT NULL CHECK (jsonb_typeof(source_refs) = 'array'),
    section_hashes          jsonb NOT NULL CHECK (jsonb_typeof(section_hashes) = 'object'),
    read_model_hash         text NOT NULL CHECK (read_model_hash ~ '^sha256:[0-9a-f]{64}$'),
    provider_calls_triggered integer NOT NULL CHECK (provider_calls_triggered = 0),
    external_write_attempts  integer NOT NULL CHECK (external_write_attempts = 0)
);

CREATE INDEX IF NOT EXISTS overview_snapshots_generated_idx
    ON adm.overview_snapshots (generated_at);

-- Fully immutable: an overview refresh is a NEW snapshot.
CREATE OR REPLACE FUNCTION adm.foresift_adm_refuse_overview_snapshot_mutation() RETURNS trigger AS $fn$
BEGIN
    IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
        RAISE EXCEPTION 'overview snapshots are immutable (delete/truncate refused)'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RAISE EXCEPTION 'overview snapshots are immutable: a refresh records a new snapshot'
        USING ERRCODE = 'restrict_violation';
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS overview_snapshots_no_mutation ON adm.overview_snapshots;
CREATE TRIGGER overview_snapshots_no_mutation
    BEFORE UPDATE OR DELETE ON adm.overview_snapshots
    FOR EACH ROW EXECUTE FUNCTION adm.foresift_adm_refuse_overview_snapshot_mutation();
DROP TRIGGER IF EXISTS overview_snapshots_no_truncate ON adm.overview_snapshots;
CREATE TRIGGER overview_snapshots_no_truncate
    BEFORE TRUNCATE ON adm.overview_snapshots
    FOR EACH STATEMENT EXECUTE FUNCTION adm.foresift_adm_refuse_overview_snapshot_mutation();
DROP FUNCTION IF EXISTS public.foresift_adm_refuse_overview_snapshot_mutation();

-- --- §35.1 immutable high-impact admin action audit -------------------------

-- Append-only audit of every high-impact control and kill-switch action —
-- ALLOWED and REFUSED alike. A refusal always names its stable machine code; an
-- allowed action always carries its idempotency key plus step-up and CSRF
-- references, so an allowed action can never be an anonymous act. The UNIQUE
-- idempotency_key collapses a replay onto the first recorded decision (a
-- missing-key refusal records NULL, which UNIQUE permits repeatedly).
CREATE TABLE IF NOT EXISTS adm.admin_action_audit (
    action_id          text PRIMARY KEY CHECK (length(action_id) > 0),
    action_kind        text NOT NULL CHECK (action_kind IN (
                           'CONFIG_VALIDATE',
                           'CONFIG_ACTIVATE',
                           'CONFIG_ROLLBACK',
                           'SCHEDULE_ENABLE',
                           'SCHEDULE_PAUSE',
                           'SCHEDULE_RESUME',
                           'SCHEDULE_RUN_NOW',
                           'SCHEDULE_DRY_RUN',
                           'SCHEDULE_DISABLE',
                           'SCHEDULE_DELETE',
                           'KILL_SWITCH_ENGAGE',
                           'KILL_SWITCH_DISENGAGE')),
    target_ref         text NOT NULL CHECK (length(target_ref) > 0),
    target_version_ref text,
    actor_ref          text NOT NULL CHECK (length(actor_ref) > 0),
    step_up_ref        text,
    csrf_ref           text,
    idempotency_key    text UNIQUE CHECK (idempotency_key IS NULL OR length(idempotency_key) > 0),
    reason             text NOT NULL CHECK (length(reason) > 0),
    outcome            text NOT NULL CHECK (outcome IN ('ALLOWED', 'REFUSED')),
    refusal_code       text CHECK (refusal_code IS NULL OR refusal_code IN (
                           'ADMIN_ACTION_REQUEST_INVALID',
                           'ADMIN_CONTROL_ACTION_UNKNOWN',
                           'ADMIN_STEP_UP_MISSING',
                           'ADMIN_STEP_UP_STALE',
                           'ADMIN_AUTHENTICATOR_CLASS_INSUFFICIENT',
                           'ADMIN_ACTION_SCOPE_MISMATCH',
                           'ADMIN_CSRF_INVALID',
                           'ADMIN_IDEMPOTENCY_KEY_MISSING',
                           'ADMIN_REASON_MISSING',
                           'ADMIN_AUDIT_HEALTH_BLOCKED',
                           'ADMIN_ACTION_REFUSED',
                           'ADMIN_CONFIG_VERSION_UNKNOWN',
                           'ADMIN_CONFIG_VERSION_IMMUTABLE',
                           'ADMIN_CONFIG_LIFECYCLE_TRANSITION_INVALID',
                           'ADMIN_RESOLVED_PREVIEW_PRECEDENCE_INVALID',
                           'ADMIN_KILL_SWITCH_KIND_UNKNOWN',
                           'ADMIN_KILL_SWITCH_ENGAGED',
                           'ADMIN_KILL_SWITCH_STATE_UNREADABLE',
                           'ADMIN_KILL_SWITCH_TRANSITION_INVALID',
                           'ADMIN_OVERVIEW_SECTION_UNKNOWN',
                           'ADMIN_SURFACE_FAILURE')),
    before_hash        text CHECK (before_hash IS NULL OR before_hash ~ '^sha256:[0-9a-f]{64}$'),
    after_hash         text CHECK (after_hash IS NULL OR after_hash ~ '^sha256:[0-9a-f]{64}$'),
    audit_ref          text,
    recorded_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT admin_action_audit_allowed_evidence CHECK (
        outcome <> 'ALLOWED'
        OR (idempotency_key IS NOT NULL
            AND step_up_ref IS NOT NULL AND length(step_up_ref) > 0
            AND csrf_ref IS NOT NULL AND length(csrf_ref) > 0)
    ),
    CONSTRAINT admin_action_audit_refusal_requires_code CHECK (
        outcome <> 'REFUSED' OR refusal_code IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS admin_action_audit_recorded_idx
    ON adm.admin_action_audit (recorded_at);
CREATE INDEX IF NOT EXISTS admin_action_audit_target_idx
    ON adm.admin_action_audit (action_kind, target_ref, recorded_at);

-- Append-only: no UPDATE/DELETE/TRUNCATE path exists at all.
CREATE OR REPLACE FUNCTION adm.foresift_adm_refuse_action_audit_mutation() RETURNS trigger AS $fn$
BEGIN
    IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
        RAISE EXCEPTION 'admin action audit is append-only (delete/truncate refused)'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RAISE EXCEPTION 'admin action audit is append-only: a decision is never rewritten'
        USING ERRCODE = 'restrict_violation';
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS admin_action_audit_no_mutation ON adm.admin_action_audit;
CREATE TRIGGER admin_action_audit_no_mutation
    BEFORE UPDATE OR DELETE ON adm.admin_action_audit
    FOR EACH ROW EXECUTE FUNCTION adm.foresift_adm_refuse_action_audit_mutation();
DROP TRIGGER IF EXISTS admin_action_audit_no_truncate ON adm.admin_action_audit;
CREATE TRIGGER admin_action_audit_no_truncate
    BEFORE TRUNCATE ON adm.admin_action_audit
    FOR EACH STATEMENT EXECUTE FUNCTION adm.foresift_adm_refuse_action_audit_mutation();
DROP FUNCTION IF EXISTS public.foresift_adm_refuse_action_audit_mutation();
