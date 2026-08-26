-- g0_prov_0002_verification_ttl.sql
-- Verification records and per-kind/per-provider TTL configuration
-- (FR-PROV-002, §15.4 rule 3/4, AC-270).
--
-- Rules encoded here:
--   * kind is CHECK-pinned across the NINE verification kinds (the eight the
--     requirement names plus LIVE_PROBE freshness from FR-PROV-001).
--   * source is OFFICIAL_DOC | LIVE_CONTRACT; outcome PASSED | FAILED |
--     INCONCLUSIVE. Only PASSED records ever count as fresh.
--   * every record carries at least one evidence reference and an expiry
--     instant strictly after its verification instant.
--   * records are append-only: corrections are NEW records with later
--     verified_at, never edits (INV-005/INV-006).
--   * TTL configuration rows are per-kind with an OPTIONAL per-provider
--     override; a MISSING configuration is a refusal at evaluation time
--     (fail-closed: no implicit infinite freshness).

CREATE TABLE prov.prov_verification_ttl_configs (
    config_id   text PRIMARY KEY,
    provider_id text REFERENCES prov.prov_providers(provider_id),
    kind        text NOT NULL CHECK (kind IN (
                  'DOCUMENTATION', 'PRICING_PLAN', 'QUOTA', 'RIGHTS',
                  'SCHEMA', 'ENDPOINT', 'AUTHENTICATION', 'DEPRECATION',
                  'LIVE_PROBE')),
    ttl_seconds integer NOT NULL CHECK (ttl_seconds > 0),
    updated_at  timestamptz NOT NULL,
    CONSTRAINT prov_verification_ttl_configs_scope UNIQUE (provider_id, kind)
);

CREATE TABLE prov.prov_verification_records (
    seq               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    verification_id   text NOT NULL UNIQUE,
    provider_id       text NOT NULL,
    operation_id      text NOT NULL,
    operation_version text NOT NULL,
    kind              text NOT NULL CHECK (kind IN (
                        'DOCUMENTATION', 'PRICING_PLAN', 'QUOTA', 'RIGHTS',
                        'SCHEMA', 'ENDPOINT', 'AUTHENTICATION', 'DEPRECATION',
                        'LIVE_PROBE')),
    source            text NOT NULL CHECK (source IN ('OFFICIAL_DOC', 'LIVE_CONTRACT')),
    outcome           text NOT NULL CHECK (outcome IN ('PASSED', 'FAILED', 'INCONCLUSIVE')),
    verified_at       timestamptz NOT NULL,
    expires_at        timestamptz NOT NULL,
    evidence_refs     jsonb NOT NULL,
    notes             text,
    recorded_at       timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (provider_id, operation_id, operation_version)
        REFERENCES prov.prov_operations (provider_id, operation_id, version),
    CONSTRAINT prov_verification_records_window CHECK (expires_at > verified_at),
    CONSTRAINT prov_verification_records_evidence_required CHECK (
        jsonb_typeof(evidence_refs) = 'array' AND jsonb_array_length(evidence_refs) >= 1),
    -- INV-009 idempotency fence for verification ingestion retries.
    CONSTRAINT prov_verification_records_retry_fenced UNIQUE (
        provider_id, operation_id, operation_version, kind, source,
        outcome, verified_at)
);

CREATE INDEX prov_verification_records_lookup_idx
    ON prov.prov_verification_records (provider_id, operation_id, operation_version, kind, verified_at);

CREATE TRIGGER prov_verification_records_append_only
    BEFORE UPDATE OR DELETE ON prov.prov_verification_records
    FOR EACH ROW EXECUTE FUNCTION prov.refuse_mutation();

CREATE TRIGGER prov_verification_records_immutable_truncate
    BEFORE TRUNCATE ON prov.prov_verification_records
    FOR EACH STATEMENT EXECUTE FUNCTION prov.refuse_mutation();
