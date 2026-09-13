-- g2_prod_0001_module_registry.sql
-- Governed production module-state registry: scope-exact append-only module
-- states, the governed transition log, and immutable activation-gate
-- evaluations (FR-PROD-001, FR-PROD-002, §69.2–§69.5, AC-152).
--
-- Every table lives in the dedicated `prod` schema, never `public`
-- (ADR-G2PROD-1): the landed AC-261 recovery probe asserts the absence of
-- unqualified tables and the admin/recovery packages get stable qualified
-- names. Additive only; no ALTER of any foreign family.

CREATE SCHEMA IF NOT EXISTS prod;

-- --- §69.2 governed module/artifact lifecycle -------------------------------

-- One scope-exact, append-only module-state row. Reassessment inserts a NEW row
-- and then sets the OLD row's superseded_by exactly once; every other rewrite
-- (identity, scope, lifecycle/readiness state, activation ref, timestamps,
-- delete, truncate) is refused by the trigger below. `ACTIVE` requires an
-- activation gate evaluation reference (AC-152): deployment is not activation.
CREATE TABLE IF NOT EXISTS prod.module_states (
    state_row_id          text PRIMARY KEY CHECK (length(state_row_id) > 0),
    module_id             text NOT NULL CHECK (length(module_id) > 0),
    artifact_set_hash     text NOT NULL CHECK (artifact_set_hash ~ '^sha256:[0-9a-f]{64}$'),
    -- The exact §69.5 scope: profile/policy/regime/execution/delay/population
    -- plus whether the scope specifies the PROVEN precondition.
    scope                 jsonb NOT NULL CHECK (jsonb_typeof(scope) = 'object'),
    lifecycle_state       text NOT NULL CHECK (lifecycle_state IN (
                              'IMPLEMENTED',
                              'AVAILABLE',
                              'SHADOW',
                              'PROVEN',
                              'ACTIVE',
                              'DEGRADED',
                              'PAUSED',
                              'RETIRED',
                              'DISABLED')),
    operational_readiness text NOT NULL CHECK (operational_readiness IN (
                              'NOT_READY',
                              'READY_FOR_COLLECTION',
                              'READY_FOR_SHADOW_RESEARCH',
                              'READY_FOR_SHADOW_ALERTS',
                              'READY_FOR_ACTIVE_PROFILE')),
    distribution_readiness text NOT NULL CHECK (distribution_readiness IN (
                              'PRIVATE_ONLY',
                              'WORKSPACE_TECHNICALLY_READY',
                              'WORKSPACE_AUTHORIZED',
                              'PUBLIC_TECHNICALLY_READY',
                              'PUBLIC_AUTHORIZED')),
    activation_event_ref  text,
    superseded_by         text,
    created_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT module_states_scope_complete CHECK (
        scope ?& ARRAY[
            'profile_version',
            'policy_version',
            'regime_scope',
            'execution_scenario',
            'delay_policy',
            'population_claim',
            'requires_proven'
        ]
    ),
    CONSTRAINT module_states_superseded_by_fk
        FOREIGN KEY (superseded_by) REFERENCES prod.module_states(state_row_id),
    -- AC-152: ACTIVE is not a declaration; it requires a recorded gate result.
    CONSTRAINT module_states_active_requires_gate_evaluation CHECK (
        lifecycle_state <> 'ACTIVE' OR activation_event_ref IS NOT NULL
    ),
    CONSTRAINT module_states_no_self_supersede CHECK (
        superseded_by IS NULL OR superseded_by <> state_row_id
    )
);

CREATE INDEX IF NOT EXISTS module_states_module_idx
    ON prod.module_states (module_id, created_at);
CREATE INDEX IF NOT EXISTS module_states_lifecycle_idx
    ON prod.module_states (lifecycle_state);

-- Immutable by construction. TRUNCATE is handled FIRST: statement-level
-- truncate rows have no OLD/NEW, so a fall-through would compare all-NULL and
-- wrongly allow it. The ONLY legal UPDATE is a one-time supersede pointer.
CREATE OR REPLACE FUNCTION prod.foresift_prod_refuse_module_state_rewrite() RETURNS trigger AS $fn$
BEGIN
    IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
        RAISE EXCEPTION 'module states are append-only: a change records a new row (delete/truncate refused)'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.state_row_id IS DISTINCT FROM OLD.state_row_id
        OR NEW.module_id IS DISTINCT FROM OLD.module_id
        OR NEW.artifact_set_hash IS DISTINCT FROM OLD.artifact_set_hash
        OR NEW.scope IS DISTINCT FROM OLD.scope
        OR NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state
        OR NEW.operational_readiness IS DISTINCT FROM OLD.operational_readiness
        OR NEW.distribution_readiness IS DISTINCT FROM OLD.distribution_readiness
        OR NEW.activation_event_ref IS DISTINCT FROM OLD.activation_event_ref
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR NEW.superseded_by IS NULL
        OR OLD.superseded_by IS NOT NULL
    THEN
        RAISE EXCEPTION 'module states are append-only: only a one-time supersede pointer may be set'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS module_states_no_rewrite ON prod.module_states;
CREATE TRIGGER module_states_no_rewrite
    BEFORE UPDATE OR DELETE ON prod.module_states
    FOR EACH ROW EXECUTE FUNCTION prod.foresift_prod_refuse_module_state_rewrite();
DROP TRIGGER IF EXISTS module_states_no_truncate ON prod.module_states;
CREATE TRIGGER module_states_no_truncate
    BEFORE TRUNCATE ON prod.module_states
    FOR EACH STATEMENT EXECUTE FUNCTION prod.foresift_prod_refuse_module_state_rewrite();
-- Schema hygiene: retire any pre-fix function that lived in `public` via
-- search_path.
DROP FUNCTION IF EXISTS public.foresift_prod_refuse_module_state_rewrite();

-- --- §69.11/§69.12 governed transition log ----------------------------------

-- Append-only transition log. `from_state` may be the §69.2 seed
-- NOT_IMPLEMENTED (a module that had no governed row); a self-transition is
-- refused. Actor and reason are mandatory: classification can never be
-- self-assigned by the changed module.
CREATE TABLE IF NOT EXISTS prod.state_transitions (
    transition_id         text PRIMARY KEY CHECK (length(transition_id) > 0),
    state_row_id          text NOT NULL CHECK (length(state_row_id) > 0),
    from_state            text NOT NULL CHECK (from_state IN (
                              'NOT_IMPLEMENTED',
                              'IMPLEMENTED',
                              'AVAILABLE',
                              'SHADOW',
                              'PROVEN',
                              'ACTIVE',
                              'DEGRADED',
                              'PAUSED',
                              'RETIRED',
                              'DISABLED')),
    to_state              text NOT NULL CHECK (to_state IN (
                              'IMPLEMENTED',
                              'AVAILABLE',
                              'SHADOW',
                              'PROVEN',
                              'ACTIVE',
                              'DEGRADED',
                              'PAUSED',
                              'RETIRED',
                              'DISABLED')),
    change_classification text NOT NULL CHECK (change_classification IN (
                              'NON_MATERIAL_COMPATIBLE',
                              'MATERIAL_OPERATIONAL',
                              'MATERIAL_EVALUATION',
                              'MATERIAL_SECURITY_OR_RIGHTS')),
    gate_evaluation_ref   text,
    reason                text NOT NULL CHECK (length(reason) > 0),
    actor_ref             text NOT NULL CHECK (length(actor_ref) > 0),
    created_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT state_transitions_state_row_fk
        FOREIGN KEY (state_row_id) REFERENCES prod.module_states(state_row_id),
    CONSTRAINT state_transitions_no_self_transition CHECK (from_state <> to_state)
);

CREATE INDEX IF NOT EXISTS state_transitions_state_row_idx
    ON prod.state_transitions (state_row_id, created_at);

-- Append-only: no UPDATE/DELETE/TRUNCATE path exists at all.
CREATE OR REPLACE FUNCTION prod.foresift_prod_refuse_transition_mutation() RETURNS trigger AS $fn$
BEGIN
    IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
        RAISE EXCEPTION 'state transitions are append-only (delete/truncate refused)'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RAISE EXCEPTION 'state transitions are append-only: a change records a new transition'
        USING ERRCODE = 'restrict_violation';
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS state_transitions_no_mutation ON prod.state_transitions;
CREATE TRIGGER state_transitions_no_mutation
    BEFORE UPDATE OR DELETE ON prod.state_transitions
    FOR EACH ROW EXECUTE FUNCTION prod.foresift_prod_refuse_transition_mutation();
DROP TRIGGER IF EXISTS state_transitions_no_truncate ON prod.state_transitions;
CREATE TRIGGER state_transitions_no_truncate
    BEFORE TRUNCATE ON prod.state_transitions
    FOR EACH STATEMENT EXECUTE FUNCTION prod.foresift_prod_refuse_transition_mutation();
DROP FUNCTION IF EXISTS public.foresift_prod_refuse_transition_mutation();

-- --- §69.4/§69.5/§69.9 immutable activation-gate evaluations ----------------

-- One immutable gate evaluation for an exact scope hash. A PASS carries no
-- failing gate and a REFUSE always names one; every evaluation expires, so a
-- stale gate result can never be re-used as current evidence.
CREATE TABLE IF NOT EXISTS prod.activation_gate_evaluations (
    evaluation_id         text PRIMARY KEY CHECK (length(evaluation_id) > 0),
    scope_hash            text NOT NULL CHECK (scope_hash ~ '^sha256:[0-9a-f]{64}$'),
    gate_kind             text NOT NULL CHECK (gate_kind IN (
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
    verdict               text NOT NULL CHECK (verdict IN ('PASS', 'REFUSE')),
    failing_gate          text CHECK (failing_gate IS NULL OR failing_gate IN (
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
    evidence_refs         jsonb NOT NULL CHECK (jsonb_typeof(evidence_refs) = 'array'),
    capacity_contract_ref text,
    evaluated_at          timestamptz NOT NULL DEFAULT now(),
    expires_at            timestamptz NOT NULL,
    CONSTRAINT activation_gate_evaluations_verdict_consistency CHECK (
        (verdict = 'PASS' AND failing_gate IS NULL)
        OR (verdict = 'REFUSE' AND failing_gate IS NOT NULL)
    ),
    CONSTRAINT activation_gate_evaluations_expiry_order CHECK (expires_at > evaluated_at)
);

CREATE INDEX IF NOT EXISTS activation_gate_evaluations_scope_idx
    ON prod.activation_gate_evaluations (scope_hash, gate_kind, evaluated_at);

-- Fully immutable: a re-evaluation is a NEW row, never an in-place edit.
CREATE OR REPLACE FUNCTION prod.foresift_prod_refuse_gate_evaluation_mutation() RETURNS trigger AS $fn$
BEGIN
    IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
        RAISE EXCEPTION 'activation gate evaluations are immutable (delete/truncate refused)'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RAISE EXCEPTION 'activation gate evaluations are immutable: a re-evaluation is a new row'
        USING ERRCODE = 'restrict_violation';
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS activation_gate_evaluations_no_mutation ON prod.activation_gate_evaluations;
CREATE TRIGGER activation_gate_evaluations_no_mutation
    BEFORE UPDATE OR DELETE ON prod.activation_gate_evaluations
    FOR EACH ROW EXECUTE FUNCTION prod.foresift_prod_refuse_gate_evaluation_mutation();
DROP TRIGGER IF EXISTS activation_gate_evaluations_no_truncate ON prod.activation_gate_evaluations;
CREATE TRIGGER activation_gate_evaluations_no_truncate
    BEFORE TRUNCATE ON prod.activation_gate_evaluations
    FOR EACH STATEMENT EXECUTE FUNCTION prod.foresift_prod_refuse_gate_evaluation_mutation();
DROP FUNCTION IF EXISTS public.foresift_prod_refuse_gate_evaluation_mutation();
