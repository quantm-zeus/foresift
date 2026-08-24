-- g0_data_0003_quality_sources.sql
-- Field-level data-quality codes (FR-DATA-005) and source lineage /
-- independence groups (FR-DATA-006, §11.7, ADR-052, INV-008).

CREATE TABLE observation_field_quality (
    field_quality_id text PRIMARY KEY,
    observation_id   text NOT NULL REFERENCES observations(observation_id),
    field_path       text NOT NULL,
    value_raw        text,
    quality_codes    text[] NOT NULL
        CHECK (array_length(quality_codes, 1) >= 1)
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
            'RETROSPECTIVE_ONLY']::text[]),
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (observation_id, field_path),
    -- "null alone is insufficient" (§13.9): a stored null needs at least one
    -- explicit code, and VALID-only does not explain a null.
    CONSTRAINT observation_field_quality_null_requires_code
        CHECK (value_raw IS NOT NULL OR (
            array_length(quality_codes, 1) >= 1
            AND NOT quality_codes <@ ARRAY['VALID']::text[]))
);

CREATE TABLE source_identities (
    source_id           text PRIMARY KEY,
    brand_provider      text NOT NULL,
    operation           text NOT NULL,
    upstream_lineage_key text NOT NULL,
    endpoint_region     text NOT NULL,
    collection_method   text NOT NULL CHECK (collection_method IN (
                            'POLLING_API',
                            'AUTHORIZED_PUSH',
                            'FIRST_PARTY_COLLECTOR',
                            'MANUAL_IMPORT')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    -- A source identity is the full five-field tuple (§11.7); the same brand
    -- on a different operation is a DIFFERENT source.
    UNIQUE (brand_provider, operation, upstream_lineage_key, endpoint_region, collection_method)
);

CREATE TABLE independence_groups (
    group_id            text PRIMARY KEY,
    upstream_lineage_key text NOT NULL UNIQUE,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE source_group_memberships (
    group_id        text NOT NULL REFERENCES independence_groups(group_id),
    source_identity_id text NOT NULL REFERENCES source_identities(source_id),
    joined_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, source_identity_id)
);

-- Pairwise empirical-dependence edges. Inputs live in [0,1] (correlation in
-- [-1,1]); the label records whether inputs were available at the edge's
-- available_at or computed later as diagnostics only (AC-247 substrate).
CREATE TABLE source_dependence_edges (
    edge_id                     text PRIMARY KEY,
    source_a                    text NOT NULL REFERENCES source_identities(source_id),
    source_b                    text NOT NULL REFERENCES source_identities(source_id),
    shared_upstream_lineage_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
    value_error_timing_correlation double precision NOT NULL
        CHECK (value_error_timing_correlation BETWEEN -1 AND 1),
    outage_overlap              double precision NOT NULL CHECK (outage_overlap BETWEEN 0 AND 1),
    first_seen_lag_agreement    double precision NOT NULL CHECK (first_seen_lag_agreement BETWEEN 0 AND 1),
    fingerprint_similarity      double precision NOT NULL CHECK (fingerprint_similarity BETWEEN 0 AND 1),
    label                       text NOT NULL CHECK (label IN (
                                    'AVAILABLE_AT_THE_TIME',
                                    'DIAGNOSTIC_RETROSPECTIVE')),
    available_at                timestamptz NOT NULL,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT source_dependence_edges_canonical_order CHECK (source_a < source_b),
    CONSTRAINT source_dependence_edges_distinct CHECK (source_a <> source_b)
);
