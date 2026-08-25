-- g0_prov_0001_provider_operations.sql
-- Versioned provider-operation registry and the append-only lifecycle
-- transition ledger (FR-PROV-001, FR-PROV-004; §12.11/§15.2/§15.3/§15.4).
--
-- Tables live in the dedicated `prov` schema namespace: the provider
-- lifecycle truth engine owns a failure domain separate from operational
-- data truth (same arrangement as the proven `sec` family), and the public-
-- schema parity contract of @foresift/persistence stays byte-identical.
--
-- Rules encoded here:
--   * capability_class is CHECK-pinned to the READ_*/STREAM/QUOTE vocabulary
--     ONLY — the PROHIBITED_* classes are unrepresentable in SQL truth;
--     registration refuses them at the API layer before any row exists.
--   * current_state is CHECK-pinned to the seven §12.11 states; health_status
--     to the twelve §15.4 values; cost_class to the five §15.2 values.
--   * prov_lifecycle_events is APPEND-ONLY in SQL: BEFORE UPDATE/DELETE/
--     TRUNCATE raise LEDGER_IMMUTABLE. Corrections are compensating events.
--   * idempotency_key is UNIQUE — retries (INV-009) cannot double-append.

CREATE SCHEMA IF NOT EXISTS prov;

CREATE TABLE prov.prov_providers (
    provider_id          text PRIMARY KEY,
    provider_group       text NOT NULL,
    display_name         text NOT NULL,
    disabled_by_default  boolean NOT NULL DEFAULT true,
    registered_at        timestamptz NOT NULL
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
    supported_chains            jsonb NOT NULL CHECK (jsonb_typeof(supported_chains) = 'array'),
    supported_programs          jsonb,
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
    current_state               text NOT NULL DEFAULT 'DISCOVERED' CHECK (current_state IN (
                                  'DISCOVERED',
                                  'VERIFIED',
                                  'ACTIVE',
                                  'DEGRADED',
                                  'DEPRECATED',
                                  'BLOCKED',
                                  'REMOVED')),
    health_status               text NOT NULL DEFAULT 'HEALTHY' CHECK (health_status IN (
                                  'HEALTHY',
                                  'DEGRADED',
                                  'SCHEMA_DRIFT',
                                  'PLAN_UNVERIFIED',
                                  'RIGHTS_UNVERIFIED',
                                  'DEPRECATED',
                                  'SUNSET_PENDING',
                                  'QUOTA_LOW',
                                  'QUOTA_EXHAUSTED',
                                  'AUTH_FAILED',
                                  'UNSUPPORTED',
                                  'DISABLED')),
    cost_class                  text NOT NULL CHECK (cost_class IN (
                                  'FREE_UNMETERED',
                                  'FREE_QUOTA',
                                  'PAID_EXPLICIT',
                                  'UNKNOWN_COST',
                                  'DISABLED')),
    estimated_quota_units       numeric NOT NULL CHECK (estimated_quota_units >= 0),
    quota_reset_policy_id       text NOT NULL,
    batch_capability            jsonb,
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
    registered_at               timestamptz NOT NULL,
    PRIMARY KEY (provider_id, operation_id, version)
);

CREATE INDEX prov_operations_provider_idx ON prov.prov_operations (provider_id, operation_id);
CREATE INDEX prov_operations_state_idx ON prov.prov_operations (current_state);
CREATE INDEX prov_operations_deprecated_idx ON prov.prov_operations (deprecated_at)
    WHERE deprecated_at IS NOT NULL;

-- Affected-feature dependency registrations: first-class rows so deprecation
-- can name its blast radius (§15.4 rule 1 / rule 6).
CREATE TABLE prov.prov_operation_dependencies (
    dependency_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    consumer_kind  text NOT NULL CHECK (consumer_kind IN (
                     'FEATURE', 'TOOL', 'EXPORT', 'ALERT_DERIVATIVE')),
    consumer_key   text NOT NULL,
    provider_id    text NOT NULL,
    operation_id   text NOT NULL,
    critical_field text,
    active         boolean NOT NULL DEFAULT true,
    registered_at  timestamptz NOT NULL,
    CONSTRAINT prov_operation_dependencies_unique
      UNIQUE (consumer_kind, consumer_key, provider_id, operation_id)
);

CREATE INDEX prov_operation_dependencies_op_idx
    ON prov.prov_operation_dependencies (provider_id, operation_id) WHERE active;

-- Append-only lifecycle transition ledger (INV-004 reconstructability).
CREATE TABLE prov.prov_lifecycle_events (
    seq              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    provider_id      text NOT NULL,
    operation_id     text NOT NULL,
    operation_version text NOT NULL,
    from_state       text CHECK (from_state IN (
                       'DISCOVERED',
                       'VERIFIED',
                       'ACTIVE',
                       'DEGRADED',
                       'DEPRECATED',
                       'BLOCKED',
                       'REMOVED')),
    to_state         text NOT NULL CHECK (to_state IN (
                       'DISCOVERED',
                       'VERIFIED',
                       'ACTIVE',
                       'DEGRADED',
                       'DEPRECATED',
                       'BLOCKED',
                       'REMOVED')),
    reason_class     text NOT NULL CHECK (reason_class IN (
                       'REGISTERED_DISCOVERED',
                       'VERIFICATION_PROMOTED',
                       'ACTIVATION_APPROVED',
                       'DOCUMENTATION_EXPIRED',
                       'PRICING_PLAN_EXPIRED',
                       'QUOTA_VERIFICATION_EXPIRED',
                       'RIGHTS_EXPIRED',
                       'SCHEMA_EXPIRED',
                       'ENDPOINT_EXPIRED',
                       'AUTHENTICATION_EXPIRED',
                       'DEPRECATION_EXPIRED',
                       'LIVE_PROBE_EXPIRED',
                       'HEALTH_INCIDENT',
                       'RECOVERY_VERIFIED',
                       'DEPRECATION_MARKED',
                       'OPERATOR_BLOCK',
                       'CAPABILITY_VIOLATION_BLOCK',
                       'OPERATOR_REMOVAL',
                       'REPLACEMENT_ACTIVATED')),
    actor            text NOT NULL,
    occurred_at      timestamptz NOT NULL,
    evidence_refs    jsonb NOT NULL DEFAULT '[]'::jsonb
                       CHECK (jsonb_typeof(evidence_refs) = 'array'),
    idempotency_key  text NOT NULL,
    FOREIGN KEY (provider_id, operation_id, operation_version)
      REFERENCES prov.prov_operations (provider_id, operation_id, version),
    CONSTRAINT prov_lifecycle_events_idempotency UNIQUE (idempotency_key),
    CONSTRAINT prov_lifecycle_events_from_to_distinct CHECK (from_state IS DISTINCT FROM to_state)
);

CREATE INDEX prov_lifecycle_events_op_idx
    ON prov.prov_lifecycle_events (provider_id, operation_id, seq);

-- Shared append-only guard: every trigger using it raises a message prefixed
-- LEDGER_IMMUTABLE (the machine-detectable refusal contract).
CREATE FUNCTION prov.refuse_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'LEDGER_IMMUTABLE: % on % is refused', TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER prov_lifecycle_events_append_only
    BEFORE UPDATE OR DELETE ON prov.prov_lifecycle_events
    FOR EACH ROW EXECUTE FUNCTION prov.refuse_mutation();

CREATE TRIGGER prov_lifecycle_events_immutable_truncate
    BEFORE TRUNCATE ON prov.prov_lifecycle_events
    FOR EACH STATEMENT EXECUTE FUNCTION prov.refuse_mutation();
