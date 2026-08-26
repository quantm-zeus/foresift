-- g0_prov_0002_verification_ttl.sql
-- Verification records + per-kind/per-provider TTL configuration
-- (FR-PROV-002, §15.4 rule 3; AC-270).
--
-- Rules encoded here:
--   * kind is CHECK-pinned to the NINE verification kinds; source to
--     OFFICIAL_DOC | LIVE_CONTRACT (the AC-270 refresh pair requires BOTH for
--     a lapsed kind — pair logic lives in verification-ttl.ts and is parity-
--     tested against this alphabet).
--   * expires_at > verified_at always: a record can never be stored already
--     expired by construction.
--   * TTL configuration is fail-closed: evaluation looks up the exact
--     (provider_id, kind) row first, then the '*' wildcard provider row;
--     NO matching row refuses — absence of configuration never means
--     "unlimited freshness".
--   * records dedupe on idempotency_key UNIQUE so replayed verifications
--     cannot double-store.

CREATE TABLE prov.prov_verification_records (
    record_id         text PRIMARY KEY,
    provider_id       text NOT NULL,
    operation_id      text NOT NULL,
    operation_version text NOT NULL,
    kind              text NOT NULL CHECK (kind IN (
                        'DOCUMENTATION', 'PRICING_PLAN', 'QUOTA', 'RIGHTS', 'SCHEMA',
                        'ENDPOINT', 'AUTHENTICATION', 'DEPRECATION', 'LIVE_PROBE')),
    source            text NOT NULL CHECK (source IN ('OFFICIAL_DOC', 'LIVE_CONTRACT')),
    outcome           text NOT NULL CHECK (outcome IN ('PASS', 'FAIL')),
    verified_at       timestamptz NOT NULL,
    expires_at        timestamptz NOT NULL,
    evidence_refs     jsonb NOT NULL CHECK (jsonb_typeof(evidence_refs) = 'array'),
    recorded_by       text NOT NULL,
    idempotency_key   text NOT NULL UNIQUE,
    FOREIGN KEY (provider_id, operation_id, operation_version)
        REFERENCES prov.prov_operations(provider_id, operation_id, version),
    CONSTRAINT prov_verification_expiry CHECK (expires_at > verified_at)
);

CREATE INDEX prov_verification_records_lookup_idx
    ON prov.prov_verification_records (provider_id, operation_id, operation_version, kind, verified_at);

CREATE TABLE prov.prov_verification_ttl_config (
    config_id    text PRIMARY KEY,
    provider_id  text NOT NULL DEFAULT '*',
    kind         text NOT NULL CHECK (kind IN (
                   'DOCUMENTATION', 'PRICING_PLAN', 'QUOTA', 'RIGHTS', 'SCHEMA',
                   'ENDPOINT', 'AUTHENTICATION', 'DEPRECATION', 'LIVE_PROBE')),
    ttl_seconds  integer NOT NULL CHECK (ttl_seconds > 0),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT prov_verification_ttl_unique UNIQUE (provider_id, kind)
);
