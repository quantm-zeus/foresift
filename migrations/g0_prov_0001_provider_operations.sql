-- g0_prov_0001_provider_operations.sql
-- Provider operation registry + append-only lifecycle ledger (FR-PROV-001,
-- §12.11/§15.2/§15.3/§15.4).
--
-- Tables live in the dedicated `prov` schema namespace: same arrangement as
-- the security perimeter (`sec`), keeping the proven public-schema parity
-- contract of @foresift/persistence byte-identical (this migration adds zero
-- public objects).
--
-- Rules encoded here:
--   * capability_class is CHECK-pinned to the §15.2 READ_*/STREAM_/QUOTE_
--     vocabulary. The PROHIBITED_* classes are NOT in the alphabet — a
--     prohibited capability value is UNREPRESENTABLE at the storage layer,
--     mirroring the API-level registration refusal in @foresift/provider-lifecycle.
--   * cost_class is CHECK-pinned to the five §15.2 classes.
--   * current_state is CHECK-pinned to the seven §12.11 lifecycle states;
--     health_status to the twelve §15.4 values. The legal-transition GRAPH
--     lives in code (lifecycle-states.ts) and is parity-tested against these
--     CHECKs — SQL constrains values, TS constrains edges.
--   * prov_lifecycle_events is APPEND-ONLY in SQL: BEFORE UPDATE/DELETE raise
--     PROV_IMMUTABLE (machine-detectable refusal contract). Retries dedupe on
--     idempotency_key UNIQUE plus a composite uniqueness over the transition
--     tuple so no double-append can survive either fence.
--   * NOTE on ordering: this family sorts lexicographically BETWEEN g0_dr_*
--     and g0_sec_* ('prov' < 'sec'). Fresh databases apply the full set in one
--     pass; there are no pre-prov persistent databases in G0 (greenfield), so
--     the migrator's out-of-order defense stays silent.

CREATE SCHEMA IF NOT EXISTS prov;

CREATE TABLE prov.prov_providers (
    provider_id         text PRIMARY KEY,
    display_name        text NOT NULL,
    provider_group      text NOT NULL,
    disabled_by_default boolean NOT NULL DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE prov.prov_operations (
    provider_id                 text NOT NULL REFERENCES prov.prov_providers(provider_id),
    operation_id                text NOT NULL,
    version                     text NOT NULL,
    capability_class            text NOT NULL CHECK (capability_class IN (
                                  'READ_MARKET',
                                  'READ_SECURITY',
                                  'READ_IDENTITY',
                                  'READ_TRANSACTION_RAW',
                                  'READ_TRANSACTION_HISTORY',
                                  'READ_ACCOUNT_STATE',
                                  'READ_SOCIAL_AGGREGATE',
                                  'STREAM_PROGRAM_EVENT',
                                  'QUOTE_READ_ONLY')),
    cost_class                  text NOT NULL CHECK (cost_class IN (
                                  'FREE_UNMETERED', 'FREE_QUOTA', 'PAID_EXPLICIT',
                                  'UNKNOWN_COST', 'DISABLED')),
    current_state               text NOT NULL DEFAULT 'DISCOVERED' CHECK (current_state IN (
                                  'DISCOVERED', 'VERIFIED', 'ACTIVE', 'DEGRADED',
                                  'DEPRECATED', 'BLOCKED', 'REMOVED')),
    health_status               text NOT NULL DEFAULT 'HEALTHY' CHECK (health_status IN (
                                  'HEALTHY', 'DEGRADED', 'SCHEMA_DRIFT', 'PLAN_UNVERIFIED',
                                  'RIGHTS_UNVERIFIED', 'DEPRECATED', 'SUNSET_PENDING',
                                  'QUOTA_LOW', 'QUOTA_EXHAUSTED', 'AUTH_FAILED',
                                  'UNSUPPORTED', 'DISABLED')),
    supported_chains            jsonb NOT NULL CHECK (jsonb_typeof(supported_chains) = 'array'),
    supported_programs          jsonb CHECK (supported_programs IS NULL
                                  OR jsonb_typeof(supported_programs) = 'array'),
    input_schema_id             text NOT NULL,
    raw_output_schema_id        text NOT NULL,
    normalized_output_schema_id text NOT NULL,
    quota_model_id              text NOT NULL,
    cache_policy_id             text NOT NULL,
    timeout_ms                  integer NOT NULL CHECK (timeout_ms > 0),
    retry_policy_id             text NOT NULL,
    declared_independence_group text NOT NULL,
    upstream_lineage            jsonb NOT NULL CHECK (jsonb_typeof(upstream_lineage) = 'array'),
    license_policy_id           text NOT NULL,
    estimated_quota_units       numeric NOT NULL CHECK (estimated_quota_units >= 0),
    quota_reset_policy_id       text NOT NULL,
    batch_max_entities          integer,
    batch_max_bytes             integer,
    minimum_candidate_stage     text,
    protected_reserve_eligible  boolean NOT NULL,
    allowed_in_strict_free      boolean NOT NULL,
    paid_fallback_allowed       boolean NOT NULL,
    deprecated_at               timestamptz,
    sunset_at                   timestamptz,
    replacement_operation_id    text,
    verification_expires_at     timestamptz NOT NULL,
    forbidden_output_fields     jsonb NOT NULL CHECK (jsonb_typeof(forbidden_output_fields) = 'array'),
    negative_capabilities       jsonb NOT NULL CHECK (jsonb_typeof(negative_capabilities) = 'array'),
    registered_at               timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider_id, operation_id, version),
    CONSTRAINT prov_operations_batch_shape CHECK (
        batch_max_entities IS NULL OR batch_max_entities > 0),
    CONSTRAINT prov_operations_deprecation_fields CHECK (
        deprecated_at IS NULL OR replacement_operation_id IS NOT NULL)
);

CREATE TABLE prov.prov_operation_dependencies (
    dependency_id     text PRIMARY KEY,
    consumer_kind     text NOT NULL CHECK (consumer_kind IN (
                        'FEATURE', 'TOOL', 'EXPORT', 'ALERT_DERIVATIVE')),
    consumer_key      text NOT NULL,
    critical_field    text,
    provider_id       text NOT NULL,
    operation_id      text NOT NULL,
    operation_version text NOT NULL,
    active            boolean NOT NULL DEFAULT true,
    registered_at     timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (provider_id, operation_id, operation_version)
        REFERENCES prov.prov_operations(provider_id, operation_id, version),
    CONSTRAINT prov_operation_dependencies_unique UNIQUE (
        consumer_kind, consumer_key, provider_id, operation_id, operation_version)
);

CREATE INDEX prov_operation_dependencies_op_idx
    ON prov.prov_operation_dependencies (provider_id, operation_id, operation_version);
CREATE INDEX prov_operations_state_idx ON prov.prov_operations (current_state);

-- Append-only transition ledger. from_state/to_state restate the §12.11
-- alphabet; edge legality is validated in code BEFORE append and parity-tested
-- against the state CHECKs.
CREATE TABLE prov.prov_lifecycle_events (
    seq               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    provider_id       text NOT NULL,
    operation_id      text NOT NULL,
    operation_version text NOT NULL,
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
    evidence_refs     jsonb NOT NULL CHECK (jsonb_typeof(evidence_refs) = 'array'),
    audit_entry_seq   bigint,
    idempotency_key   text NOT NULL UNIQUE,
    FOREIGN KEY (provider_id, operation_id, operation_version)
        REFERENCES prov.prov_operations(provider_id, operation_id, version),
    CONSTRAINT prov_lifecycle_events_retry_tuple UNIQUE (
        provider_id, operation_id, operation_version, from_state, to_state,
        reason_class, effective_at)
);

CREATE INDEX prov_lifecycle_events_op_idx
    ON prov.prov_lifecycle_events (provider_id, operation_id, operation_version, seq);

-- Shared append-only guard for this schema namespace: every trigger using it
-- raises a message prefixed PROV_IMMUTABLE (the machine-detectable refusal).
CREATE FUNCTION prov.refuse_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'PROV_IMMUTABLE: % on % is refused', TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER prov_lifecycle_events_append_only
    BEFORE UPDATE OR DELETE ON prov.prov_lifecycle_events
    FOR EACH ROW EXECUTE FUNCTION prov.refuse_mutation();

-- Row-level triggers do not fire on TRUNCATE; refuse it statement-wise too
-- (same rule as sec_audit_events) so historical evidence cannot be wiped.
CREATE TRIGGER prov_lifecycle_events_immutable_truncate
    BEFORE TRUNCATE ON prov.prov_lifecycle_events
    FOR EACH STATEMENT EXECUTE FUNCTION prov.refuse_mutation();
