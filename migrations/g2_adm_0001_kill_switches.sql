-- g2_adm_0001_kill_switches.sql
-- Admin kill-switch state: scope-exact append-only switch states and the
-- immutable audit event log (FR-ADM-007, PRD §28.13, §35.1; AC-061, AC-262).
--
-- Every table lives in the dedicated `adm` schema, never `public`
-- (ADR-G2ADM-1): the landed AC-261 recovery probe asserts the absence of
-- unqualified tables and the admin/recovery packages get stable qualified
-- names. Additive only; no ALTER of any foreign family.
--
-- Fail-closed by construction: a switch resolves to ENGAGED when no open state
-- row exists, so absence is never permission. A state row is a NEW row plus a
-- one-time supersede pointer on the old row — its scope, state, actor, reason,
-- and timestamps are never rewritten. Events are append-only and immutable.

CREATE SCHEMA IF NOT EXISTS adm;

-- --- §28.13 scope-exact switch state ----------------------------------------

-- One scope-exact, append-only kill-switch state row. Engaging/releasing inserts
-- a NEW row and sets the OLD row's superseded_by exactly once (enforced by the
-- trigger below); every other rewrite — identity, scope, state, actor, reason,
-- expiry, timestamps, delete, truncate — is refused. At most one open
-- (superseded_by IS NULL) row exists per (switch_kind, scope_hash).
CREATE TABLE IF NOT EXISTS adm.kill_switch_states (
    state_row_id  text PRIMARY KEY CHECK (length(state_row_id) > 0),
    switch_kind   text NOT NULL CHECK (switch_kind IN (
                      'DISABLE_ALL_AUTOMATION',
                      'DISABLE_ALL_MODEL_CALLS',
                      'DISABLE_ALL_PROVIDER_CALLS',
                      'DISABLE_NOTIFICATIONS',
                      'REVOKE_ALL_MCP_CLIENTS',
                      'EMERGENCY_READ_ONLY_MODE')),
    scope         jsonb NOT NULL CHECK (jsonb_typeof(scope) = 'object'),
    scope_hash    text NOT NULL CHECK (scope_hash ~ '^sha256:[0-9a-f]{64}$'),
    state         text NOT NULL CHECK (state IN ('ENGAGED', 'DISENGAGED')),
    reason        text,
    actor_ref     text,
    step_up_ref   text,
    audit_ref     text,
    -- A state that expires resolves to the closed (ENGAGED) state once passed.
    expires_at    timestamptz,
    superseded_by text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT kill_switch_states_scope_complete CHECK (
        scope ?& ARRAY['scopeKind', 'scopeRef']
    ),
    CONSTRAINT kill_switch_states_superseded_fk
        FOREIGN KEY (superseded_by) REFERENCES adm.kill_switch_states(state_row_id)
        DEFERRABLE INITIALLY DEFERRED,
    -- §28.13/§35.1: engaging a switch is never an anonymous act.
    CONSTRAINT kill_switch_states_engaged_evidence CHECK (
        state <> 'ENGAGED'
        OR (actor_ref IS NOT NULL AND length(actor_ref) > 0
            AND reason IS NOT NULL AND length(reason) > 0)
    ),
    CONSTRAINT kill_switch_states_no_self_supersede CHECK (
        superseded_by IS NULL OR superseded_by <> state_row_id
    )
);

CREATE INDEX IF NOT EXISTS kill_switch_states_kind_idx
    ON adm.kill_switch_states (switch_kind, created_at);
-- Exactly one open state per exact scope; resolution reads this row only.
CREATE UNIQUE INDEX IF NOT EXISTS kill_switch_states_open_unique
    ON adm.kill_switch_states (switch_kind, scope_hash)
    WHERE superseded_by IS NULL;

-- Immutable by construction. TRUNCATE is handled FIRST: statement-level
-- truncate rows have no OLD/NEW, so a fall-through would compare all-NULL and
-- wrongly allow it. The ONLY legal UPDATE is a one-time supersede pointer.
CREATE OR REPLACE FUNCTION adm.foresift_adm_refuse_kill_switch_state_rewrite() RETURNS trigger AS $fn$
BEGIN
    IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
        RAISE EXCEPTION 'kill-switch states are append-only: a change records a new row (delete/truncate refused)'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.state_row_id IS DISTINCT FROM OLD.state_row_id
        OR NEW.switch_kind IS DISTINCT FROM OLD.switch_kind
        OR NEW.scope IS DISTINCT FROM OLD.scope
        OR NEW.scope_hash IS DISTINCT FROM OLD.scope_hash
        OR NEW.state IS DISTINCT FROM OLD.state
        OR NEW.reason IS DISTINCT FROM OLD.reason
        OR NEW.actor_ref IS DISTINCT FROM OLD.actor_ref
        OR NEW.step_up_ref IS DISTINCT FROM OLD.step_up_ref
        OR NEW.audit_ref IS DISTINCT FROM OLD.audit_ref
        OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR NEW.superseded_by IS NULL
        OR OLD.superseded_by IS NOT NULL
    THEN
        RAISE EXCEPTION 'kill-switch states are append-only: only a one-time supersede pointer may be set'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS kill_switch_states_no_rewrite ON adm.kill_switch_states;
CREATE TRIGGER kill_switch_states_no_rewrite
    BEFORE UPDATE OR DELETE ON adm.kill_switch_states
    FOR EACH ROW EXECUTE FUNCTION adm.foresift_adm_refuse_kill_switch_state_rewrite();
DROP TRIGGER IF EXISTS kill_switch_states_no_truncate ON adm.kill_switch_states;
CREATE TRIGGER kill_switch_states_no_truncate
    BEFORE TRUNCATE ON adm.kill_switch_states
    FOR EACH STATEMENT EXECUTE FUNCTION adm.foresift_adm_refuse_kill_switch_state_rewrite();
DROP FUNCTION IF EXISTS public.foresift_adm_refuse_kill_switch_state_rewrite();

-- --- §28.13/§35.1 immutable switch events -----------------------------------

-- One audit event per transition, carrying the acting actor, fresh step-up
-- reference, CSRF reference, idempotency key, reason, and audit reference.
-- A replayed transition collapses on the UNIQUE idempotency_key, so a retried
-- engage/release writes nothing a second time. from_state is NULL for the first
-- recorded transition; a no-op transition is refused.
CREATE TABLE IF NOT EXISTS adm.kill_switch_events (
    event_id        text PRIMARY KEY CHECK (length(event_id) > 0),
    switch_kind     text NOT NULL CHECK (switch_kind IN (
                        'DISABLE_ALL_AUTOMATION',
                        'DISABLE_ALL_MODEL_CALLS',
                        'DISABLE_ALL_PROVIDER_CALLS',
                        'DISABLE_NOTIFICATIONS',
                        'REVOKE_ALL_MCP_CLIENTS',
                        'EMERGENCY_READ_ONLY_MODE')),
    from_state      text CHECK (from_state IS NULL OR from_state IN ('ENGAGED', 'DISENGAGED')),
    to_state        text NOT NULL CHECK (to_state IN ('ENGAGED', 'DISENGAGED')),
    scope           jsonb NOT NULL CHECK (jsonb_typeof(scope) = 'object'),
    scope_hash      text NOT NULL CHECK (scope_hash ~ '^sha256:[0-9a-f]{64}$'),
    reason          text NOT NULL CHECK (length(reason) > 0),
    actor_ref       text NOT NULL CHECK (length(actor_ref) > 0),
    step_up_ref     text NOT NULL CHECK (length(step_up_ref) > 0),
    csrf_ref        text NOT NULL CHECK (length(csrf_ref) > 0),
    idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) > 0),
    audit_ref       text NOT NULL CHECK (length(audit_ref) > 0),
    occurred_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT kill_switch_events_scope_complete CHECK (
        scope ?& ARRAY['scopeKind', 'scopeRef']
    ),
    CONSTRAINT kill_switch_events_state_change CHECK (
        from_state IS NULL OR from_state <> to_state
    )
);

CREATE INDEX IF NOT EXISTS kill_switch_events_kind_idx
    ON adm.kill_switch_events (switch_kind, occurred_at);

-- Append-only: no UPDATE/DELETE/TRUNCATE path exists at all.
CREATE OR REPLACE FUNCTION adm.foresift_adm_refuse_kill_switch_event_mutation() RETURNS trigger AS $fn$
BEGIN
    IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
        RAISE EXCEPTION 'kill-switch events are append-only (delete/truncate refused)'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RAISE EXCEPTION 'kill-switch events are append-only: a change records a new event'
        USING ERRCODE = 'restrict_violation';
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS kill_switch_events_no_mutation ON adm.kill_switch_events;
CREATE TRIGGER kill_switch_events_no_mutation
    BEFORE UPDATE OR DELETE ON adm.kill_switch_events
    FOR EACH ROW EXECUTE FUNCTION adm.foresift_adm_refuse_kill_switch_event_mutation();
DROP TRIGGER IF EXISTS kill_switch_events_no_truncate ON adm.kill_switch_events;
CREATE TRIGGER kill_switch_events_no_truncate
    BEFORE TRUNCATE ON adm.kill_switch_events
    FOR EACH STATEMENT EXECUTE FUNCTION adm.foresift_adm_refuse_kill_switch_event_mutation();
DROP FUNCTION IF EXISTS public.foresift_adm_refuse_kill_switch_event_mutation();
