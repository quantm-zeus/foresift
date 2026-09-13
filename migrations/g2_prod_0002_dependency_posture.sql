-- g2_prod_0002_dependency_posture.sql
-- Containment/rollback events, §40 dependency-group ordering, the critical
-- external-dependency register and SLA rows, and the §69.6 declared
-- best-effort posture (FR-PROD-003, FR-PROD-004, AC-153, AC-278, AC-279).
--
-- Additive only; no ALTER of a foreign family. All tables live in the
-- dedicated `prod` schema (ADR-G2PROD-1).

-- --- §69.11 automatic containment -------------------------------------------

-- A failed critical gate contains the SMALLEST affected scope: the trigger gate
-- and reason are mandatory, and `auto_reactivation_allowed` is pinned false so
-- only an explicit revalidation event can clear it (AC-278). The one-time
-- `cleared_by_event_ref` pointer is the only legal mutation.
CREATE TABLE IF NOT EXISTS prod.containment_events (
    containment_id            text PRIMARY KEY CHECK (length(containment_id) > 0),
    module_id                 text NOT NULL CHECK (length(module_id) > 0),
    scope_hash                text NOT NULL CHECK (scope_hash ~ '^sha256:[0-9a-f]{64}$'),
    action                    text NOT NULL CHECK (action IN ('DEGRADED', 'PAUSED', 'DISABLED')),
    trigger_gate_kind         text NOT NULL CHECK (trigger_gate_kind IN (
                                  'IMPLEMENTED_PRESENT',
                                  'AVAILABLE_EVIDENCE',
                                  'PROVEN_PRESENT',
                                  'STATISTICAL_EVIDENCE_SCOPE',
                                  'NEGATIVE_CONTROLS',
                                  'CLUSTERED_INTERVALS',
                                  'CALIBRATION_MATURITY',
                                  'VERIFIED_GATE_EVIDENCE',
                                  'CAPACITY_CONTRACT',
                                  'DISTRIBUTION_EVIDENCE',
                                  'NO_OPEN_CONTAINMENT')),
    reason                    text NOT NULL CHECK (length(reason) > 0),
    auto_reactivation_allowed boolean NOT NULL DEFAULT false,
    cleared_by_event_ref      text,
    created_at                timestamptz NOT NULL DEFAULT now(),
    -- AC-278: containment never auto-reactivates.
    CONSTRAINT containment_events_no_auto_reactivation CHECK (auto_reactivation_allowed = false)
);

CREATE INDEX IF NOT EXISTS containment_events_scope_idx
    ON prod.containment_events (module_id, scope_hash, created_at);

CREATE OR REPLACE FUNCTION prod.foresift_prod_refuse_containment_rewrite() RETURNS trigger AS $fn$
BEGIN
    IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
        RAISE EXCEPTION 'containment events are append-only: a clear records an event (delete/truncate refused)'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.containment_id IS DISTINCT FROM OLD.containment_id
        OR NEW.module_id IS DISTINCT FROM OLD.module_id
        OR NEW.scope_hash IS DISTINCT FROM OLD.scope_hash
        OR NEW.action IS DISTINCT FROM OLD.action
        OR NEW.trigger_gate_kind IS DISTINCT FROM OLD.trigger_gate_kind
        OR NEW.reason IS DISTINCT FROM OLD.reason
        OR NEW.auto_reactivation_allowed IS DISTINCT FROM OLD.auto_reactivation_allowed
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR NEW.cleared_by_event_ref IS NULL
        OR OLD.cleared_by_event_ref IS NOT NULL
    THEN
        RAISE EXCEPTION 'containment events are append-only: only a one-time clear pointer may be set'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS containment_events_no_rewrite ON prod.containment_events;
CREATE TRIGGER containment_events_no_rewrite
    BEFORE UPDATE OR DELETE ON prod.containment_events
    FOR EACH ROW EXECUTE FUNCTION prod.foresift_prod_refuse_containment_rewrite();
DROP TRIGGER IF EXISTS containment_events_no_truncate ON prod.containment_events;
CREATE TRIGGER containment_events_no_truncate
    BEFORE TRUNCATE ON prod.containment_events
    FOR EACH STATEMENT EXECUTE FUNCTION prod.foresift_prod_refuse_containment_rewrite();
DROP FUNCTION IF EXISTS public.foresift_prod_refuse_containment_rewrite();

-- --- §69.11/AC-279 rollback events ------------------------------------------

-- Rollback restores a previously approved IMMUTABLE artifact set, creates a NEW
-- activation event (never reusing one), preserves every historical decision,
-- and references the targeted candidate re-evaluation that must complete before
-- alert delivery resumes.
CREATE TABLE IF NOT EXISTS prod.rollback_events (
    rollback_id                 text PRIMARY KEY CHECK (length(rollback_id) > 0),
    module_id                   text NOT NULL CHECK (length(module_id) > 0),
    restored_artifact_set_hash  text NOT NULL CHECK (restored_artifact_set_hash ~ '^sha256:[0-9a-f]{64}$'),
    prior_activation_event_ref  text NOT NULL CHECK (length(prior_activation_event_ref) > 0),
    new_activation_event_ref    text NOT NULL CHECK (length(new_activation_event_ref) > 0),
    history_preserved           boolean NOT NULL DEFAULT true,
    candidate_reevaluation_ref  text NOT NULL CHECK (length(candidate_reevaluation_ref) > 0),
    created_at                  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT rollback_events_new_activation_event_unique
        UNIQUE (new_activation_event_ref),
    CONSTRAINT rollback_events_history_preserved CHECK (history_preserved = true),
    CONSTRAINT rollback_events_new_event_is_new CHECK (
        new_activation_event_ref <> prior_activation_event_ref
    )
);

CREATE INDEX IF NOT EXISTS rollback_events_module_idx
    ON prod.rollback_events (module_id, created_at);

CREATE OR REPLACE FUNCTION prod.foresift_prod_refuse_rollback_mutation() RETURNS trigger AS $fn$
BEGIN
    IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
        RAISE EXCEPTION 'rollback events are append-only (delete/truncate refused)'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RAISE EXCEPTION 'rollback events are append-only: history is never rewritten'
        USING ERRCODE = 'restrict_violation';
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rollback_events_no_mutation ON prod.rollback_events;
CREATE TRIGGER rollback_events_no_mutation
    BEFORE UPDATE OR DELETE ON prod.rollback_events
    FOR EACH ROW EXECUTE FUNCTION prod.foresift_prod_refuse_rollback_mutation();
DROP TRIGGER IF EXISTS rollback_events_no_truncate ON prod.rollback_events;
CREATE TRIGGER rollback_events_no_truncate
    BEFORE TRUNCATE ON prod.rollback_events
    FOR EACH STATEMENT EXECUTE FUNCTION prod.foresift_prod_refuse_rollback_mutation();
DROP FUNCTION IF EXISTS public.foresift_prod_refuse_rollback_mutation();

-- --- §40 dependency-group ordering (§40, FR-PROD-003) -----------------------

-- Build/test ordering status over the authoritative manifest G0…G7 DAG.
-- Completion means production-ready code — migrations, tests, observability,
-- diagnostics, runbooks, conformance, recovery — and NEVER automatic
-- opportunity activation, so `activates_opportunities` is pinned false.
CREATE TABLE IF NOT EXISTS prod.dependency_groups (
    group_id                   text PRIMARY KEY CHECK (group_id IN (
                                   'G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7')),
    depends_on                 jsonb NOT NULL CHECK (jsonb_typeof(depends_on) = 'array'),
    status                     text NOT NULL CHECK (status IN (
                                   'OPEN', 'IN_PROGRESS', 'COMPLETE', 'BLOCKED')),
    manifest_requirement_count integer NOT NULL CHECK (manifest_requirement_count >= 0),
    evidence_refs              jsonb NOT NULL CHECK (jsonb_typeof(evidence_refs) = 'array'),
    activates_opportunities    boolean NOT NULL DEFAULT false,
    updated_at                 timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT dependency_groups_never_activate CHECK (activates_opportunities = false)
);

-- --- §69.6 critical external-dependency register and SLA rows ---------------

CREATE TABLE IF NOT EXISTS prod.critical_dependencies (
    dependency_id text PRIMARY KEY CHECK (length(dependency_id) > 0),
    kind          text NOT NULL CHECK (kind IN (
                      'PROVIDER', 'SCHEDULER', 'OBJECT_STORE', 'DATABASE', 'MCP_CLIENT', 'OTHER')),
    owner         text NOT NULL CHECK (length(owner) > 0),
    critical      boolean NOT NULL DEFAULT true
);

-- An `applicable` SLA must carry its reference; a non-applicable one must not,
-- so "no SLA" cannot masquerade as coverage.
CREATE TABLE IF NOT EXISTS prod.sla_register (
    sla_id        text PRIMARY KEY CHECK (length(sla_id) > 0),
    dependency_id text NOT NULL CHECK (length(dependency_id) > 0),
    applicable    boolean NOT NULL,
    sla_ref       text,
    verified_at   timestamptz NOT NULL,
    expires_at    timestamptz,
    CONSTRAINT sla_register_dependency_fk
        FOREIGN KEY (dependency_id) REFERENCES prod.critical_dependencies(dependency_id),
    CONSTRAINT sla_register_applicability_consistency CHECK (
        (applicable = true AND sla_ref IS NOT NULL)
        OR (applicable = false AND sla_ref IS NULL)
    ),
    CONSTRAINT sla_register_expiry_order CHECK (
        expires_at IS NULL OR expires_at > verified_at
    )
);

CREATE INDEX IF NOT EXISTS sla_register_dependency_idx
    ON prod.sla_register (dependency_id, verified_at);

-- --- §69.6 declared best-effort posture (AC-153) ----------------------------

-- The declared posture. A best-effort declaration may relax ONLY freshness,
-- breadth, depth, and opportunity alert availability; it can NEVER weaken a
-- protected dimension (identity, point-in-time, audit, duplicate prevention,
-- security, execution semantics, capacity enforcement, critical risk
-- monitoring, claim boundaries). Both the weakened and protected sets are
-- enforced in SQL so a capacity/quota failure cannot be used to weaken safety.
CREATE TABLE IF NOT EXISTS prod.best_effort_declarations (
    declaration_id       text PRIMARY KEY CHECK (length(declaration_id) > 0),
    posture              text NOT NULL CHECK (posture IN (
                             'SLA_BACKED', 'FREE_TIER_BEST_EFFORT')),
    degraded_scope       jsonb NOT NULL CHECK (jsonb_typeof(degraded_scope) = 'object'),
    missing_sla_refs     jsonb NOT NULL CHECK (jsonb_typeof(missing_sla_refs) = 'array'),
    weakened_dimensions  text[] NOT NULL DEFAULT '{}',
    protected_dimensions text[] NOT NULL,
    reason               text NOT NULL CHECK (length(reason) > 0),
    declared_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT best_effort_declarations_weaken_only_relaxable CHECK (
        weakened_dimensions <@ ARRAY[
            'freshness',
            'breadth',
            'depth',
            'alert_availability'
        ]::text[]
    ),
    CONSTRAINT best_effort_declarations_never_weaken_protected CHECK (
        NOT (weakened_dimensions && ARRAY[
            'identity',
            'point_in_time',
            'audit',
            'duplicate_prevention',
            'security',
            'execution_semantics',
            'capacity',
            'critical_risk_monitoring',
            'claim_boundaries'
        ]::text[])
    ),
    CONSTRAINT best_effort_declarations_protected_complete CHECK (
        protected_dimensions @> ARRAY[
            'identity',
            'point_in_time',
            'audit',
            'duplicate_prevention',
            'security',
            'execution_semantics',
            'capacity',
            'critical_risk_monitoring',
            'claim_boundaries'
        ]::text[]
    ),
    CONSTRAINT best_effort_declarations_sla_backed_no_weakening CHECK (
        posture <> 'SLA_BACKED' OR coalesce(array_length(weakened_dimensions, 1), 0) = 0
    )
);

-- Declarations are immutable records: a posture change is a NEW declaration.
CREATE OR REPLACE FUNCTION prod.foresift_prod_refuse_posture_rewrite() RETURNS trigger AS $fn$
BEGIN
    IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
        RAISE EXCEPTION 'best-effort declarations are immutable (delete/truncate refused)'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RAISE EXCEPTION 'best-effort declarations are immutable: a posture change is a new declaration'
        USING ERRCODE = 'restrict_violation';
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS best_effort_declarations_no_mutation ON prod.best_effort_declarations;
CREATE TRIGGER best_effort_declarations_no_mutation
    BEFORE UPDATE OR DELETE ON prod.best_effort_declarations
    FOR EACH ROW EXECUTE FUNCTION prod.foresift_prod_refuse_posture_rewrite();
DROP TRIGGER IF EXISTS best_effort_declarations_no_truncate ON prod.best_effort_declarations;
CREATE TRIGGER best_effort_declarations_no_truncate
    BEFORE TRUNCATE ON prod.best_effort_declarations
    FOR EACH STATEMENT EXECUTE FUNCTION prod.foresift_prod_refuse_posture_rewrite();
DROP FUNCTION IF EXISTS public.foresift_prod_refuse_posture_rewrite();
