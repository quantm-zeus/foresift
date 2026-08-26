-- g0_prov_0001_provider_operations.sql
-- Provider operation registry and append-only lifecycle ledger
-- (FR-PROV-001, §12.11, §15.3, §15.4).
--
-- Tables live in the dedicated `prov` schema namespace (same failure-domain
-- arrangement as the proven `sec` schema: this migration adds zero public
-- objects so the public-schema parity contract of @foresift/persistence stays
-- byte-identical).
--
-- Rules encoded here:
--   * capability_class is CHECK-pinned to the ALLOWED §15.2 classes only —
--     the prohibited trading/signing/submit/custody classes are
--     UNREPRESENTABLE in SQL truth; registration refuses them at the API
--     layer as well (double enforcement).
--   * current_state is CHECK-pinned to the seven §12.11 states;
--     health_status to the twelve §15.4 values.
--   * operations are versioned and immutable per version: rows are never
--     updated except for the CONTROL-PLANE projection columns the lifecycle
--     machine owns (current_state, health_status, last-verification/probe
--     instants). Definition fields themselves are written once.
--   * prov_lifecycle_events is APPEND-ONLY in SQL: BEFORE UPDATE/DELETE/
--     TRUNCATE raise PROV_LEDGER_IMMUTABLE. Corrections are compensating
--     events, never edits (§12.11; INV-005/INV-006 historical evidence is
--     never mutated by expiry-driven exits from ACTIVE).
--   * retries cannot double-append: a UNIQUE index over
--     (provider_id, operation_id, version, from_state, to_state,
--      reason_class, effective_at) makes every guarded transition
--     idempotent under retry (INV-009).

CREATE SCHEMA IF NOT EXISTS prov;

CREATE TABLE prov.prov_providers (
    provider_id         text PRIMARY KEY,
    display_name        text NOT NULL,
    provider_group      text NOT NULL,
    disabled_by_default boolean NOT NULL DEFAULT TRUE,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE prov.prov_operations (
    provider_id            text NOT NULL REFERENCES prov.prov_providers(provider_id),
    operation_id           text NOT NULL,
    version                text NOT NULL,
    -- §15.2 capability/cost declaration (prohibited classes unrepresentable)
    capability_class       text NOT NULL CHECK (capability_class IN (
                             'READ_MARKET',
                             'READ_SECURITY',
                             'READ_IDENTITY',
                             'READ_TRANSACTION_RAW',
                             'READ_TRANSACTION_HISTORY',
                             'READ_ACCOUNT_STATE',
                             'READ_SOCIAL_AGGREGATE',
                             'STREAM_PROGRAM_EVENT',
                             'QUOTE_READ_ONLY')),
    cost_class             text NOT NULL CHECK (cost_class IN (
                             'FREE_UNMETERED', 'FREE_QUOTA', 'PAID_EXPLICIT',
                             'UNKNOWN_COST', 'DISABLED')),
    -- §15.3 definition fields
    supported_chains       text[]  NOT NULL CHECK (array_length(supported_chains, 1) >= 1),
    supported_programs     jsonb   NOT NULL DEFAULT '[]'::jsonb,
    input_schema_id        text    NOT NULL,
    raw_output_schema_id   text    NOT NULL,
    normalized_output_schema_id text NOT NULL,
    quota_model_id         text    NOT NULL,
    cache_policy_id        text    NOT NULL,
    timeout_ms             integer NOT NULL CHECK (timeout_ms > 0),
    retry_policy_id        text    NOT NULL,
    declared_independence_group text NOT NULL,
    upstream_lineage       text[]  NOT NULL DEFAULT '{}'::text[],
    license_policy_id      text    NOT NULL,
    estimated_quota_units  integer NOT NULL CHECK (estimated_quota_units >= 0),
    quota_reset_policy_id  text    NOT NULL,
    batch_capability       jsonb,
    minimum_candidate_stage text,
    protected_reserve_eligible boolean NOT NULL DEFAULT FALSE,
    allowed_in_strict_free boolean NOT NULL DEFAULT FALSE,
    paid_fallback_allowed  boolean NOT NULL DEFAULT FALSE,
    -- FR-PROV-001 tracked truth: last documentation verification / live probe
    last_documentation_verification_at timestamptz,
    last_live_probe_at                 timestamptz,
    -- deprecation metadata (FR-PROV-003)
    deprecated_at           timestamptz,
    sunset_at               timestamptz,
    replacement_operation_id text,
    verification_expires_at timestamptz NOT NULL,
    -- scan-surface metadata
    forbidden_output_fields text[] NOT NULL DEFAULT '{}'::text[],
    negative_capabilities   text[] NOT NULL DEFAULT '{}'::text[],
    -- §12.11 control-plane projection (mutated ONLY by the lifecycle machine)
    current_state           text NOT NULL CHECK (current_state IN (
                              'DISCOVERED', 'VERIFIED', 'ACTIVE', 'DEGRADED',
                              'DEPRECATED', 'BLOCKED', 'REMOVED')),
    health_status           text NOT NULL CHECK (health_status IN (
                              'HEALTHY', 'DEGRADED', 'SCHEMA_DRIFT',
                              'PLAN_UNVERIFIED', 'RIGHTS_UNVERIFIED',
                              'DEPRECATED', 'SUNSET_PENDING', 'QUOTA_LOW',
                              'QUOTA_EXHAUSTED', 'AUTH_FAILED', 'UNSUPPORTED',
                              'DISABLED')),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider_id, operation_id, version)
);

CREATE INDEX prov_operations_current_state_idx
    ON prov.prov_operations (current_state);
CREATE INDEX prov_operations_provider_idx
    ON prov.prov_operations (provider_id, operation_id);

CREATE TABLE prov.prov_operation_dependencies (
    dependency_id     text PRIMARY KEY,
    consumer_kind     text NOT NULL CHECK (consumer_kind IN (
                        'FEATURE', 'TOOL', 'EXPORT', 'ALERT_DERIVATIVE')),
    consumer_key      text NOT NULL,
    provider_id       text NOT NULL,
    operation_id      text NOT NULL,
    operation_version text NOT NULL,
    active            boolean NOT NULL DEFAULT TRUE,
    registered_at     timestamptz NOT NULL,
    FOREIGN KEY (provider_id, operation_id, operation_version)
        REFERENCES prov.prov_operations (provider_id, operation_id, version),
    UNIQUE (consumer_kind, consumer_key, provider_id, operation_id,
            operation_version)
);

CREATE INDEX prov_operation_dependencies_target_idx
    ON prov.prov_operation_dependencies (provider_id, operation_id, operation_version);

-- Append-only transition ledger: the lifecycle machine's event source of
-- truth. Historical evidence is immutable; projection columns above are the
-- only mutable surface.
CREATE TABLE prov.prov_lifecycle_events (
    seq               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id          text NOT NULL UNIQUE,
    provider_id       text NOT NULL,
    operation_id      text NOT NULL,
    version           text NOT NULL,
    from_state        text NOT NULL CHECK (from_state IN (
                        'DISCOVERED', 'VERIFIED', 'ACTIVE', 'DEGRADED',
                        'DEPRECATED', 'BLOCKED', 'REMOVED')),
    to_state          text NOT NULL CHECK (to_state IN (
                        'DISCOVERED', 'VERIFIED', 'ACTIVE', 'DEGRADED',
                        'DEPRECATED', 'BLOCKED', 'REMOVED')),
    reason_class      text NOT NULL CHECK (length(reason_class) > 0),
    actor             text NOT NULL,
    occurred_at       timestamptz NOT NULL,
    effective_at      timestamptz NOT NULL,
    evidence_refs     jsonb NOT NULL DEFAULT '[]'::jsonb,
    recorded_at       timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (provider_id, operation_id, version)
        REFERENCES prov.prov_operations (provider_id, operation_id, version),
    -- INV-009 idempotency fence: a retried transition resolves to the SAME
    -- event instead of double-appending.
    CONSTRAINT prov_lifecycle_events_retry_fenced UNIQUE (
        provider_id, operation_id, version, from_state, to_state,
        reason_class, effective_at)
);

CREATE INDEX prov_lifecycle_events_target_idx
    ON prov.prov_lifecycle_events (provider_id, operation_id, version, seq);

-- Shared append-only guard: every trigger using it raises a message prefixed
-- PROV_LEDGER_IMMUTABLE (the machine-detectable refusal contract).
CREATE FUNCTION prov.refuse_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'PROV_LEDGER_IMMUTABLE: % on % is refused', TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER prov_lifecycle_events_append_only
    BEFORE UPDATE OR DELETE ON prov.prov_lifecycle_events
    FOR EACH ROW EXECUTE FUNCTION prov.refuse_mutation();

-- Row-level triggers do not fire on TRUNCATE; refuse it statement-wise too
-- (same rule as g0_sec_0001) so a DDL-capable role cannot wipe lifecycle
-- history without residue.
CREATE TRIGGER prov_lifecycle_events_immutable_truncate
    BEFORE TRUNCATE ON prov.prov_lifecycle_events
    FOR EACH STATEMENT EXECUTE FUNCTION prov.refuse_mutation();
