-- g0_prov_0002_verification_ttl.sql
-- Verification records and per-kind/per-provider TTL configuration
-- (FR-PROV-002; §15.4 rules 3/4, AC-270).
--
-- Rules encoded here:
--   * kind is CHECK-pinned to the nine verification kinds (the eight kinds
--     named by FR-PROV-002 plus LIVE_PROBE for FR-PROV-001's "last live
--     probe"); source is OFFICIAL_DOC | LIVE_CONTRACT.
--   * idempotency: a (operation ref, kind, source, verified_at) tuple is
--     UNIQUE — retries cannot double-record a verification (INV-009).
--   * TTL configuration rows are explicit per (provider, kind): the ABSENCE
--     of a row refuses freshness evaluation fail-closed — there is no
--     implicit default TTL anywhere.
--   * verification records are append-only history; expiry is evaluated at
--     use time, never enforced by mutating stored rows.

CREATE TABLE prov.prov_verification_ttl_config (
    provider_id  text NOT NULL,
    kind         text NOT NULL CHECK (kind IN (
                   'DOCUMENTATION',
                   'PRICING_PLAN',
                   'QUOTA',
                   'RIGHTS',
                   'SCHEMA',
                   'ENDPOINT',
                   'AUTHENTICATION',
                   'DEPRECATION',
                   'LIVE_PROBE')),
    ttl_seconds  integer NOT NULL CHECK (ttl_seconds > 0),
    updated_at   timestamptz NOT NULL,
    PRIMARY KEY (provider_id, kind)
);

CREATE TABLE prov.prov_verification_records (
    verification_seq  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    provider_id       text NOT NULL,
    operation_id      text NOT NULL,
    operation_version text NOT NULL,
    kind              text NOT NULL CHECK (kind IN (
                        'DOCUMENTATION',
                        'PRICING_PLAN',
                        'QUOTA',
                        'RIGHTS',
                        'SCHEMA',
                        'ENDPOINT',
                        'AUTHENTICATION',
                        'DEPRECATION',
                        'LIVE_PROBE')),
    source            text NOT NULL CHECK (source IN ('OFFICIAL_DOC', 'LIVE_CONTRACT')),
    outcome           text NOT NULL CHECK (outcome IN ('SUCCEEDED', 'FAILED')),
    verified_at       timestamptz NOT NULL,
    expires_at        timestamptz NOT NULL,
    evidence_refs     jsonb NOT NULL CHECK (jsonb_typeof(evidence_refs) = 'array'
                                            AND jsonb_array_length(evidence_refs) >= 1),
    FOREIGN KEY (provider_id, operation_id, operation_version)
      REFERENCES prov.prov_operations (provider_id, operation_id, version),
    CONSTRAINT prov_verification_records_idempotency
      UNIQUE (provider_id, operation_id, operation_version, kind, source, verified_at),
    CONSTRAINT prov_verification_records_window CHECK (expires_at > verified_at)
);

CREATE INDEX prov_verification_records_lookup_idx
    ON prov.prov_verification_records (provider_id, operation_id, kind, verified_at DESC);
