-- g1_solsec_0004_system_addresses.sql
-- Versioned infrastructure-address classification and exclusion audit (FR-SOLSEC-006).

CREATE TABLE system_address_registry (
    registry_entry_id    text PRIMARY KEY,
    chain_id             text NOT NULL REFERENCES chains(chain_id),
    address              text NOT NULL,
    role                 text NOT NULL CHECK (role IN (
                             'PROGRAM', 'ROUTER', 'POOL', 'LAUNCHPAD', 'BRIDGE',
                             'EXCHANGE_SERVICE', 'MARKET_MAKER', 'FEE_COLLECTOR',
                             'BURN_LOCK', 'UNKNOWN_INFRASTRUCTURE')),
    valid_from           timestamptz NOT NULL,
    valid_until          timestamptz,
    source_id            text NOT NULL REFERENCES source_identities(source_id),
    confidence           double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    review_state         text NOT NULL CHECK (review_state IN (
                             'PENDING', 'REVIEWED', 'REJECTED')),
    registry_version     integer NOT NULL CHECK (registry_version > 0),
    evidence_ids         text[] NOT NULL CHECK (cardinality(evidence_ids) > 0),
    created_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT system_address_registry_valid_interval
        CHECK (valid_until IS NULL OR valid_until > valid_from),
    CONSTRAINT system_address_exclusion_floor CHECK (
        review_state <> 'REVIEWED'
        OR role = 'UNKNOWN_INFRASTRUCTURE'
        OR confidence >= 0.80),
    CONSTRAINT system_address_registry_identity_version_unique
        UNIQUE (chain_id, address, registry_version, valid_from)
);

CREATE INDEX system_address_registry_point_in_time_idx
    ON system_address_registry (chain_id, address, valid_from, valid_until);

CREATE TABLE system_address_exclusions_applied (
    exclusion_id       text PRIMARY KEY,
    registry_entry_id  text NOT NULL REFERENCES system_address_registry(registry_entry_id),
    -- Logical event reference: g1_solsec sorts before g1_trd, so the later
    -- economic-event family cannot be a migration-time foreign key here.
    economic_event_id  text NOT NULL,
    excluded           boolean NOT NULL,
    raw_flow_ref       text NOT NULL CHECK (raw_flow_ref ~ '^sha256:[0-9a-f]{64}$'),
    applied_at         timestamptz NOT NULL,
    registry_version   integer NOT NULL CHECK (registry_version > 0),
    quality_codes      text[] NOT NULL CHECK (cardinality(quality_codes) > 0),
    created_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT system_address_exclusions_quality_known
        CHECK (quality_codes <@ ARRAY[
            'VALID','MISSING_PROVIDER','NOT_REQUESTED_BY_POLICY',
            'UNSUPPORTED_CHAIN','UNSUPPORTED_PROGRAM_VERSION','STALE',
            'PARTIAL','ESTIMATED','CONFLICTING','REORG_PENDING',
            'GAP_AFFECTED','LOW_SAMPLE','DECIMAL_UNCERTAIN',
            'LICENSE_RESTRICTED','SCHEMA_DEGRADED','DEPRECATED_OPERATION',
            'COST_BLOCKED','QUOTA_RESERVE_PROTECTED','CAPACITY_BLOCKED',
            'EXECUTION_UNAVAILABLE','EXECUTION_PARTIAL','POOL_MATH_UNSUPPORTED',
            'QUOTE_PARITY_FAILED','TOKEN_EXTENSION_UNKNOWN','SUPPLY_UNCERTAIN',
            'SYSTEM_ADDRESS_UNCERTAIN','SOCIAL_UNAVAILABLE',
            'SOURCE_DEPENDENCE_HIGH','OUTCOME_PENDING','OUTCOME_CENSORED',
            'RETROSPECTIVE_ONLY']::text[])
);

CREATE INDEX system_address_exclusions_event_idx
    ON system_address_exclusions_applied (economic_event_id, applied_at);

CREATE TRIGGER system_address_registry_immutable
    BEFORE UPDATE OR DELETE ON system_address_registry
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER system_address_registry_immutable_truncate
    BEFORE TRUNCATE ON system_address_registry
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();
