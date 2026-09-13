-- g2_adm_0002_configuration_versions.sql
-- Admin configuration control plane: immutable configuration versions and
-- immutable resolved-configuration previews (FR-ADM-003, PRD §28.3–§28.5;
-- AC-014, AC-063).
--
-- All tables live in the dedicated `adm` schema, never `public`
-- (ADR-G2ADM-1). Additive only; no FOREIGN ALTER and no duplication of
-- `wf.schedule_versions` or any other owner table — the owning package's
-- version is referenced by id (`owner_version_ref`), never copied.

-- --- §28.4 precedence-order law ---------------------------------------------

-- The §28.4 chain is an ordered list of layers that is a STRICTLY ASCENDING
-- subsequence of:
--   SYSTEM_DEFAULTS < WORKFLOW_VERSION < AGENT_PROFILE_VERSION
--                    < SCHEDULE_VERSION < RUN_NOW_OVERRIDE
-- A reordered or duplicated chain is refused here so a preview can never be
-- silently misinterpreted by a consumer.
CREATE OR REPLACE FUNCTION adm.foresift_adm_precedence_chain_ordered(chain jsonb)
RETURNS boolean AS $fn$
DECLARE
    layers text[] := ARRAY[
        'SYSTEM_DEFAULTS',
        'WORKFLOW_VERSION',
        'AGENT_PROFILE_VERSION',
        'SCHEDULE_VERSION',
        'RUN_NOW_OVERRIDE'
    ];
    item       text;
    layer_rank integer;
    last_rank  integer := 0;
BEGIN
    IF chain IS NULL OR jsonb_typeof(chain) <> 'array' OR jsonb_array_length(chain) = 0 THEN
        RETURN false;
    END IF;
    FOR item IN SELECT jsonb_array_elements_text(chain) LOOP
        layer_rank := array_position(layers, item);
        IF layer_rank IS NULL OR layer_rank <= last_rank THEN
            RETURN false;
        END IF;
        last_rank := layer_rank;
    END LOOP;
    RETURN true;
END;
$fn$ LANGUAGE plpgsql IMMUTABLE;

-- --- §28.3 immutable configuration versions ---------------------------------

-- One immutable configuration version, unique per (config_kind, config_id,
-- version). Content and resolved-configuration hashes pin the exact bytes an
-- active run resolves; an edit inserts a NEW version and sets the old row's
-- superseded_by once. The only column the trigger permits updating is the
-- governed lifecycle_state (DRAFT → VALIDATED → APPROVED → ACTIVE →
-- DEPRECATED → ROLLED_BACK); content, identity, hashes, and timestamps are
-- immutable. An ACTIVE version always names its approval reference.
CREATE TABLE IF NOT EXISTS adm.configuration_versions (
    config_version_id    text PRIMARY KEY CHECK (length(config_version_id) > 0),
    config_kind          text NOT NULL CHECK (config_kind IN (
                             'PROMPT',
                             'AGENT_PROFILE',
                             'MODEL_PROFILE',
                             'TOOL_PROFILE',
                             'WORKFLOW',
                             'FEATURE_DEFINITION',
                             'RANKING_POLICY',
                             'OUTCOME_PROFILE',
                             'ALERT_POLICY',
                             'SCHEDULE')),
    config_id            text NOT NULL CHECK (length(config_id) > 0),
    version              integer NOT NULL CHECK (version > 0),
    owner_version_ref    text,
    config_hash          text NOT NULL CHECK (config_hash ~ '^sha256:[0-9a-f]{64}$'),
    lifecycle_state      text NOT NULL CHECK (lifecycle_state IN (
                             'DRAFT',
                             'VALIDATED',
                             'APPROVED',
                             'ACTIVE',
                             'DEPRECATED',
                             'ROLLED_BACK')),
    resolved_config      jsonb NOT NULL CHECK (jsonb_typeof(resolved_config) = 'object'),
    resolved_config_hash text NOT NULL CHECK (resolved_config_hash ~ '^sha256:[0-9a-f]{64}$'),
    superseded_by        text,
    rolled_back_from     text,
    approved_by_ref      text,
    created_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT configuration_versions_unique UNIQUE (config_kind, config_id, version),
    CONSTRAINT configuration_versions_superseded_fk
        FOREIGN KEY (superseded_by) REFERENCES adm.configuration_versions(config_version_id),
    CONSTRAINT configuration_versions_rolled_back_fk
        FOREIGN KEY (rolled_back_from) REFERENCES adm.configuration_versions(config_version_id),
    CONSTRAINT configuration_versions_active_requires_approval CHECK (
        lifecycle_state <> 'ACTIVE' OR (approved_by_ref IS NOT NULL AND length(approved_by_ref) > 0)
    ),
    CONSTRAINT configuration_versions_no_self_supersede CHECK (
        superseded_by IS NULL OR superseded_by <> config_version_id
    ),
    CONSTRAINT configuration_versions_no_self_rollback CHECK (
        rolled_back_from IS NULL OR rolled_back_from <> config_version_id
    )
);

CREATE INDEX IF NOT EXISTS configuration_versions_identity_idx
    ON adm.configuration_versions (config_kind, config_id, version);
CREATE INDEX IF NOT EXISTS configuration_versions_lifecycle_idx
    ON adm.configuration_versions (lifecycle_state);

-- The §28.3 lifecycle transition law, enforced in SQL so an out-of-band
-- UPDATE cannot skip a gate.
CREATE OR REPLACE FUNCTION adm.foresift_adm_lifecycle_transition_allowed(
    from_state text,
    to_state text
) RETURNS boolean AS $fn$
BEGIN
    RETURN CASE from_state
        WHEN 'DRAFT' THEN to_state = 'VALIDATED'
        WHEN 'VALIDATED' THEN to_state = 'APPROVED'
        WHEN 'APPROVED' THEN to_state IN ('ACTIVE', 'DEPRECATED')
        WHEN 'ACTIVE' THEN to_state IN ('DEPRECATED', 'ROLLED_BACK')
        WHEN 'DEPRECATED' THEN to_state = 'ROLLED_BACK'
        ELSE false
    END;
END;
$fn$ LANGUAGE plpgsql IMMUTABLE;

-- Immutable by construction. TRUNCATE is handled FIRST (no OLD/NEW rows).
-- Content/identity/hash/time columns are never updatable; lifecycle_state only
-- advances along the §28.3 law; superseded_by is set exactly once.
CREATE OR REPLACE FUNCTION adm.foresift_adm_refuse_config_version_rewrite() RETURNS trigger AS $fn$
BEGIN
    IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
        RAISE EXCEPTION 'configuration versions are immutable: an edit records a new version (delete/truncate refused)'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.config_version_id IS DISTINCT FROM OLD.config_version_id
        OR NEW.config_kind IS DISTINCT FROM OLD.config_kind
        OR NEW.config_id IS DISTINCT FROM OLD.config_id
        OR NEW.version IS DISTINCT FROM OLD.version
        OR NEW.owner_version_ref IS DISTINCT FROM OLD.owner_version_ref
        OR NEW.config_hash IS DISTINCT FROM OLD.config_hash
        OR NEW.resolved_config IS DISTINCT FROM OLD.resolved_config
        OR NEW.resolved_config_hash IS DISTINCT FROM OLD.resolved_config_hash
        OR NEW.rolled_back_from IS DISTINCT FROM OLD.rolled_back_from
        OR NEW.approved_by_ref IS DISTINCT FROM OLD.approved_by_ref
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'configuration versions are immutable: only the lifecycle state may advance'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state
        AND NOT adm.foresift_adm_lifecycle_transition_allowed(OLD.lifecycle_state, NEW.lifecycle_state)
    THEN
        RAISE EXCEPTION 'configuration lifecycle transition is not allowed by §28.3'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.superseded_by IS DISTINCT FROM OLD.superseded_by
        AND NOT (OLD.superseded_by IS NULL AND NEW.superseded_by IS NOT NULL)
    THEN
        RAISE EXCEPTION 'a configuration version may be superseded exactly once'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS configuration_versions_no_rewrite ON adm.configuration_versions;
CREATE TRIGGER configuration_versions_no_rewrite
    BEFORE UPDATE OR DELETE ON adm.configuration_versions
    FOR EACH ROW EXECUTE FUNCTION adm.foresift_adm_refuse_config_version_rewrite();
DROP TRIGGER IF EXISTS configuration_versions_no_truncate ON adm.configuration_versions;
CREATE TRIGGER configuration_versions_no_truncate
    BEFORE TRUNCATE ON adm.configuration_versions
    FOR EACH STATEMENT EXECUTE FUNCTION adm.foresift_adm_refuse_config_version_rewrite();
DROP FUNCTION IF EXISTS public.foresift_adm_refuse_config_version_rewrite();

-- --- §28.4 immutable resolved-configuration previews ------------------------

-- The resolved configuration an operator previewed, with the exact §28.4
-- precedence chain that produced it and the resolved hash. Immutable: a
-- recomputation is a NEW row; a stale (expired) preview is refused by the
-- control plane rather than re-used.
CREATE TABLE IF NOT EXISTS adm.resolved_config_previews (
    preview_id        text PRIMARY KEY CHECK (length(preview_id) > 0),
    config_version_id text NOT NULL CHECK (length(config_version_id) > 0),
    precedence        jsonb NOT NULL CHECK (
                          jsonb_typeof(precedence) = 'array'
                          AND jsonb_array_length(precedence) > 0
                          AND adm.foresift_adm_precedence_chain_ordered(precedence)
                      ),
    resolved_config   jsonb NOT NULL CHECK (jsonb_typeof(resolved_config) = 'object'),
    resolved_hash     text NOT NULL CHECK (resolved_hash ~ '^sha256:[0-9a-f]{64}$'),
    computed_at       timestamptz NOT NULL,
    expires_at        timestamptz NOT NULL,
    CONSTRAINT resolved_config_previews_version_fk
        FOREIGN KEY (config_version_id) REFERENCES adm.configuration_versions(config_version_id),
    CONSTRAINT resolved_config_previews_expiry_order CHECK (expires_at > computed_at)
);

CREATE INDEX IF NOT EXISTS resolved_config_previews_version_idx
    ON adm.resolved_config_previews (config_version_id, computed_at);

-- Fully immutable: a recomputation is a NEW preview.
CREATE OR REPLACE FUNCTION adm.foresift_adm_refuse_preview_mutation() RETURNS trigger AS $fn$
BEGIN
    IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
        RAISE EXCEPTION 'resolved-configuration previews are immutable (delete/truncate refused)'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RAISE EXCEPTION 'resolved-configuration previews are immutable: a recomputation is a new preview'
        USING ERRCODE = 'restrict_violation';
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS resolved_config_previews_no_mutation ON adm.resolved_config_previews;
CREATE TRIGGER resolved_config_previews_no_mutation
    BEFORE UPDATE OR DELETE ON adm.resolved_config_previews
    FOR EACH ROW EXECUTE FUNCTION adm.foresift_adm_refuse_preview_mutation();
DROP TRIGGER IF EXISTS resolved_config_previews_no_truncate ON adm.resolved_config_previews;
CREATE TRIGGER resolved_config_previews_no_truncate
    BEFORE TRUNCATE ON adm.resolved_config_previews
    FOR EACH STATEMENT EXECUTE FUNCTION adm.foresift_adm_refuse_preview_mutation();
DROP FUNCTION IF EXISTS public.foresift_adm_refuse_preview_mutation();
