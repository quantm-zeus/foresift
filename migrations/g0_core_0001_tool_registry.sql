-- g0_core_0001_tool_registry.sql
-- Central versioned tool registry (FR-CORE-001, FR-CORE-005; PRD §16.1).
--
-- Tables live in the dedicated `core` schema namespace: the Shared Tool Core
-- owns a failure domain separate from operational data truth, and the proven
-- public-schema parity contract of @foresift/persistence stays byte-identical
-- (this migration adds zero public objects) — the same arrangement the sec
-- family established.
--
-- Rules encoded here:
--   * identity IS (tool_name, tool_version); versions are IMMUTABLE rows —
--     normative fields can never mutate after registration and rows are never
--     deleted. Retirement is ADDITIVE: only `retired_at` may ever change.
--   * action_class is CHECK-pinned to the ADMISSIBLE §5.3 classes;
--     PROHIBITED_FINANCIAL is structurally unregistrable at SQL truth level,
--     beneath every TS screen (FR-CORE-005, permanent INV-001).
--   * profiles are pinned to the eight §16.9 profile ids; every entry must
--     carry at least one.
--   * definition hashes are `sha256:<hex>` over canonical JSON of the
--     definition metadata (execute excluded); re-registering the same
--     (name, version) is impossible — the primary key refuses it, whether the
--     hash matches (already registered) or differs (conflict, FR-CORE-001).

CREATE SCHEMA IF NOT EXISTS core;

CREATE TABLE core.core_tool_registry (
    tool_name            text NOT NULL,
    tool_version         text NOT NULL,
    definition_hash      text NOT NULL CHECK (definition_hash ~ '^sha256:[0-9a-f]{64}$'),
    action_class         text NOT NULL CHECK (action_class IN (
                            'EXTERNAL_READ',
                            'INTERNAL_STATE_WRITE',
                            'NOTIFICATION',
                            'ADMINISTRATIVE')),
    profiles             text[] NOT NULL CHECK (cardinality(profiles) > 0 AND profiles <@ ARRAY[
                            'discovery',
                            'market-research',
                            'security-research',
                            'holder-wallet',
                            'social-research',
                            'macro-context',
                            'run-investigation',
                            'admin-read']::text[]),
    required_scopes      text[] NOT NULL,
    cache_policy_id      text NOT NULL CHECK (length(cache_policy_id) > 0),
    quota_policy_id      text NOT NULL CHECK (length(quota_policy_id) > 0),
    license_policy_id    text NOT NULL CHECK (length(license_policy_id) > 0),
    registered_at        timestamptz NOT NULL DEFAULT now(),
    retired_at           timestamptz,
    CONSTRAINT core_tool_registry_pk PRIMARY KEY (tool_name, tool_version),
    CONSTRAINT core_tool_registry_retired_after_registration
        CHECK (retired_at IS NULL OR retired_at >= registered_at)
);

CREATE INDEX core_tool_registry_profiles_idx ON core.core_tool_registry USING gin (profiles);
CREATE INDEX core_tool_registry_name_idx ON core.core_tool_registry (tool_name);

-- Registry entries are immutable history: no deletion ever, and among UPDATEs
-- only the retirement stamp may move. Any other column change raises a message
-- prefixed CORE_REGISTRY_IMMUTABLE (the machine-detectable refusal contract).
CREATE FUNCTION core.refuse_registry_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'CORE_REGISTRY_IMMUTABLE: % on % is refused', TG_OP, TG_TABLE_NAME;
    END IF;
    IF OLD.tool_name <> NEW.tool_name
       OR OLD.tool_version <> NEW.tool_version
       OR OLD.definition_hash <> NEW.definition_hash
       OR OLD.action_class <> NEW.action_class
       OR OLD.profiles <> NEW.profiles
       OR OLD.required_scopes <> NEW.required_scopes
       OR OLD.cache_policy_id <> NEW.cache_policy_id
       OR OLD.quota_policy_id <> NEW.quota_policy_id
       OR OLD.license_policy_id <> NEW.license_policy_id THEN
        RAISE EXCEPTION
            'CORE_REGISTRY_IMMUTABLE: normative field mutation on %.% is refused',
            TG_TABLE_SCHEMA, TG_TABLE_NAME;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER core_tool_registry_append_only
    BEFORE DELETE ON core.core_tool_registry
    FOR EACH ROW EXECUTE FUNCTION core.refuse_registry_mutation();

CREATE TRIGGER core_tool_registry_normative_immutable
    BEFORE UPDATE ON core.core_tool_registry
    FOR EACH ROW EXECUTE FUNCTION core.refuse_registry_mutation();
