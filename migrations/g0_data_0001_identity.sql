-- g0_data_0001_identity.sql
-- Canonical asset/pool/migration identity (FR-DATA-001).
--
-- Identity rules encoded here (PRD §11.2/§11.4/§11.5/§11.6):
--   * an asset representation IS (chain_id, canonical_address); unique.
--   * asset_id groups representations ONLY through verified equivalence kinds.
--   * pool_id composes exactly chain_id/dex_id/pool_address.
--   * symbols and names are descriptive columns ONLY — no uniqueness anywhere.
--   * token decimals are sourced/cross-checked/versioned via observations.
--   * launch_pool -> migration_event -> migrated_pool edges with boundary rules.

CREATE TABLE chains (
    chain_id            text PRIMARY KEY,
    namespace           text NOT NULL,
    reference           text NOT NULL,
    mapping_quality     text NOT NULL CHECK (mapping_quality IN (
                            'REGISTERED_CAIP2',
                            'REGISTERED_EIP155_REFERENCE',
                            'INTERNAL_VERSIONED',
                            'UNVERIFIED_ASSERTION')),
    internal_id_version integer,
    CONSTRAINT chains_internal_versioned_requires_id_version
        CHECK (mapping_quality <> 'INTERNAL_VERSIONED' OR internal_id_version IS NOT NULL)
);

-- Single authoritative copy of the §13.9 vocabulary inside SQL truth.
-- Parity against @foresift/domain ALL_QUALITY_CODES is asserted by tests;
-- array-valued quality columns below must keep their <@ lists in sync with it.
CREATE TABLE quality_codes (
    code text PRIMARY KEY
);

INSERT INTO quality_codes (code) VALUES
    ('VALID'), ('MISSING_PROVIDER'), ('NOT_REQUESTED_BY_POLICY'),
    ('UNSUPPORTED_CHAIN'), ('UNSUPPORTED_PROGRAM_VERSION'), ('STALE'),
    ('PARTIAL'), ('ESTIMATED'), ('CONFLICTING'), ('REORG_PENDING'),
    ('GAP_AFFECTED'), ('LOW_SAMPLE'), ('DECIMAL_UNCERTAIN'),
    ('LICENSE_RESTRICTED'), ('SCHEMA_DEGRADED'), ('DEPRECATED_OPERATION'),
    ('COST_BLOCKED'), ('QUOTA_RESERVE_PROTECTED'), ('CAPACITY_BLOCKED'),
    ('EXECUTION_UNAVAILABLE'), ('EXECUTION_PARTIAL'), ('POOL_MATH_UNSUPPORTED'),
    ('QUOTE_PARITY_FAILED'), ('TOKEN_EXTENSION_UNKNOWN'), ('SUPPLY_UNCERTAIN'),
    ('SYSTEM_ADDRESS_UNCERTAIN'), ('SOCIAL_UNAVAILABLE'),
    ('SOURCE_DEPENDENCE_HIGH'), ('OUTCOME_PENDING'), ('OUTCOME_CENSORED'),
    ('RETROSPECTIVE_ONLY');

CREATE TABLE dexes (
    chain_id text NOT NULL REFERENCES chains(chain_id),
    dex_id   text NOT NULL,
    PRIMARY KEY (chain_id, dex_id)
);

CREATE TABLE assets (
    asset_id   text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE asset_representations (
    chain_id          text NOT NULL REFERENCES chains(chain_id),
    canonical_address text NOT NULL,
    decimals_state    text NOT NULL DEFAULT 'SOURCED' CHECK (decimals_state IN (
                          'SOURCED', 'CROSS_CHECKED', 'CONFLICTING')),
    decimals          integer CHECK (decimals BETWEEN 0 AND 36),
    -- Address normalization is chain-specific (§11.2); G0 registers the two
    -- supported namespaces and refuses every other shape fail-closed.
    CONSTRAINT asset_representations_namespace_supported
        CHECK (split_part(chain_id, ':', 1) IN ('eip155', 'solana')),
    CONSTRAINT asset_representations_evm_address_shape
        CHECK (split_part(chain_id, ':', 1) <> 'eip155'
               OR canonical_address ~ '^0x[0-9a-f]{40}$'),
    CONSTRAINT asset_representations_solana_address_shape
        CHECK (split_part(chain_id, ':', 1) <> 'solana'
               OR canonical_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
    CONSTRAINT asset_representations_conflicting_has_no_decimals
        CHECK (decimals_state <> 'CONFLICTING' OR decimals IS NULL),
    PRIMARY KEY (chain_id, canonical_address)
);

-- Verified-equivalence membership: heuristic merges have no representation.
CREATE TABLE asset_memberships (
    asset_id          text NOT NULL REFERENCES assets(asset_id),
    chain_id          text NOT NULL,
    canonical_address text NOT NULL,
    verification      text NOT NULL CHECK (verification IN (
                          'BRIDGE_VERIFIED',
                          'NATIVE_WRAPPER_DECLARED',
                          'ISSUER_ATTESTED')),
    created_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, canonical_address),
    FOREIGN KEY (chain_id, canonical_address)
        REFERENCES asset_representations(chain_id, canonical_address)
);

CREATE TABLE pools (
    pool_id      text PRIMARY KEY,
    chain_id     text NOT NULL REFERENCES chains(chain_id),
    dex_id       text NOT NULL,
    pool_address text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (chain_id, dex_id) REFERENCES dexes(chain_id, dex_id),
    CONSTRAINT pools_identity_composition
        CHECK (pool_id = chain_id || '/' || dex_id || '/' || pool_address),
    CONSTRAINT pools_namespace_supported
        CHECK (split_part(chain_id, ':', 1) IN ('eip155', 'solana')),
    CONSTRAINT pools_evm_address_shape
        CHECK (split_part(chain_id, ':', 1) <> 'eip155'
               OR pool_address ~ '^0x[0-9a-f]{40}$'),
    CONSTRAINT pools_solana_address_shape
        CHECK (split_part(chain_id, ':', 1) <> 'solana'
               OR pool_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')
);

-- Pair observations: quote/base orientation is per-pool; a provider's "best"
-- pair never overwrites others without evidence, so rows accumulate.
CREATE TABLE pairs (
    pair_id                text PRIMARY KEY,
    pool_id                text NOT NULL REFERENCES pools(pool_id),
    base_asset_id          text NOT NULL REFERENCES assets(asset_id),
    quote_asset_id         text NOT NULL REFERENCES assets(asset_id),
    orientation_unverified boolean NOT NULL DEFAULT false,
    observed_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pairs_distinct_sides CHECK (base_asset_id <> quote_asset_id)
);

-- Launch pools retained as first-class identity (§11.6 lineage endpoints).
CREATE TABLE launches (
    launch_id   text PRIMARY KEY,
    pool_id     text NOT NULL UNIQUE REFERENCES pools(pool_id),
    launched_at timestamptz,
    source_ref  text NOT NULL
);

CREATE TABLE migration_edges (
    migration_id     text PRIMARY KEY,
    launch_pool_id   text NOT NULL REFERENCES pools(pool_id),
    migrated_pool_id text NOT NULL REFERENCES pools(pool_id),
    status           text NOT NULL CHECK (status IN ('CONFIRMED', 'AMBIGUOUS')),
    migrated_at      timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT migration_edges_no_self_loop
        CHECK (launch_pool_id <> migrated_pool_id),
    CONSTRAINT migration_edges_confirmed_requires_boundary
        CHECK (status <> 'CONFIRMED' OR migrated_at IS NOT NULL),
    CONSTRAINT migration_edges_ambiguous_has_no_boundary
        CHECK (status <> 'AMBIGUOUS' OR migrated_at IS NULL)
);

-- Decimals observations: sourced, cross-checked, versioned (never guessed).
CREATE TABLE token_decimal_observations (
    observation_id    text PRIMARY KEY,
    chain_id          text NOT NULL,
    canonical_address text NOT NULL,
    decimals          integer NOT NULL CHECK (decimals BETWEEN 0 AND 36),
    state             text NOT NULL CHECK (state IN (
                          'SOURCED', 'CROSS_CHECKED', 'CONFLICTING')),
    observed_at       timestamptz NOT NULL,
    source_ref        text NOT NULL,
    FOREIGN KEY (chain_id, canonical_address)
        REFERENCES asset_representations(chain_id, canonical_address)
);
