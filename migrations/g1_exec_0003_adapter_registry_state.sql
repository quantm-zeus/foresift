-- g1_exec_0003_adapter_registry_state.sql
-- Pool-math adapter registry, execution state snapshots, and adapter
-- incidents (§64.3, §64.4, §64.11 — FR-EXEC-013, FR-EXEC-014, FR-EXEC-015,
-- FR-EXEC-016, FR-EXEC-021).

CREATE TABLE pool_math_adapter_registry (
    adapter_id                      text NOT NULL,
    version                         text NOT NULL,
    chain_id                        text NOT NULL REFERENCES chains(chain_id),
    program_id                      text NOT NULL,
    supported_program_versions      text[] NOT NULL CHECK (cardinality(supported_program_versions) > 0),
    curve_types                     text[] NOT NULL CHECK (cardinality(curve_types) > 0),
    adapter_family                  text NOT NULL CHECK (adapter_family IN (
                                        'CONSTANT_PRODUCT_AMM', 'CONCENTRATED_LIQUIDITY_AMM',
                                        'DISCRETE_LIQUIDITY_BIN_AMM', 'BONDING_CURVE',
                                        'STABLE_CURVE', 'DYNAMIC_FEE_AMM', 'VIRTUAL_RESERVE',
                                        'AGGREGATED_MULTI_ROUTE_READ_ONLY', 'UNKNOWN')),
    account_layout_version          text NOT NULL,
    -- §64.3: AVAILABLE only when program/version-specific implementation and
    -- fixtures pass state-completeness and parity gates.
    support_state                   text NOT NULL CHECK (support_state IN (
                                        'AVAILABLE', 'DEGRADED', 'UNAVAILABLE')),
    parity_gate_version             text,
    fixture_bundle_hash             text CHECK (
                                        fixture_bundle_hash IS NULL
                                        OR fixture_bundle_hash ~ '^sha256:[0-9a-f]{64}$'),
    registered_at                   timestamptz NOT NULL,
    created_at                      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (adapter_id, version, chain_id, program_id, account_layout_version),
    -- FR-EXEC-013: resolution keyed by chain, program, program version, curve
    -- type, and account-layout version (family-keyed uniqueness).
    CONSTRAINT pool_math_adapter_registry_key_unique
        UNIQUE (chain_id, program_id, account_layout_version, adapter_family, version),
    -- FR-EXEC-015 at the persistence layer: generic constant-product math is
    -- allowed only for a verified constant-product pool; other families need
    -- their own adapter, and an UNKNOWN family can never be AVAILABLE.
    CONSTRAINT cp_only_for_cp CHECK (
        support_state <> 'AVAILABLE'
        OR adapter_family <> 'UNKNOWN'),
    CONSTRAINT cp_availability_requires_gates CHECK (
        support_state <> 'AVAILABLE'
        OR (parity_gate_version IS NOT NULL AND fixture_bundle_hash IS NOT NULL)),
    CONSTRAINT cp_unavailable_without_gates CHECK (
        support_state <> 'DEGRADED'
        OR parity_gate_version IS NOT NULL)
);

CREATE INDEX pool_math_adapter_registry_lookup_idx
    ON pool_math_adapter_registry (chain_id, program_id, adapter_family, support_state);

CREATE TABLE execution_state_snapshots (
    snapshot_id                     text PRIMARY KEY,
    chain_id                        text NOT NULL REFERENCES chains(chain_id),
    program_id                      text NOT NULL,
    program_version                 text NOT NULL,
    slot                            text NOT NULL CHECK (slot ~ '^[0-9]+$'),
    block_hash                      text NOT NULL,
    finality                        text NOT NULL CHECK (finality IN (
                                        'PROCESSED', 'CONFIRMED', 'FINALIZED')),
    -- FR-EXEC-014: the exact raw account-state hashes used.
    raw_account_state_hashes        text[] NOT NULL CHECK (cardinality(raw_account_state_hashes) > 0),
    reserve_vault_state             jsonb NOT NULL CHECK (jsonb_typeof(reserve_vault_state) = 'object'),
    tick_arrays                     jsonb,
    bin_arrays                      jsonb,
    -- FR-EXEC-014: the design-family curve state as observed (stable-swap amp
    -- factors, CLMM sqrt-price/curvature, virtual-reserve offsets). Bonding
    -- curves keep their dedicated record in bonding_curve_state below.
    curve_state                     jsonb,
    positions                       jsonb,
    bonding_curve_state             jsonb,
    fee_configuration               jsonb NOT NULL CHECK (jsonb_typeof(fee_configuration) = 'object'),
    dynamic_fee_parameters          jsonb,
    -- FR-EXEC-014: the exact oracle/quote inputs used for the simulation,
    -- recorded as evidence next to their source (quote_conversion_source/at).
    oracle_quote_inputs             jsonb,
    transfer_fee_semantics          jsonb,
    transfer_hook_semantics         jsonb,
    default_account_state           jsonb,
    quote_conversion_source         text NOT NULL,
    quote_conversion_at             timestamptz NOT NULL,
    route_legs                      jsonb NOT NULL CHECK (
                                        jsonb_typeof(route_legs) = 'array'
                                        AND jsonb_array_length(route_legs) >= 1),
    shared_liquidity_identifiers    text[] NOT NULL DEFAULT ARRAY[]::text[],
    pool_math_adapter_id            text NOT NULL,
    pool_math_adapter_version       text NOT NULL,
    state_completeness              text NOT NULL CHECK (state_completeness IN (
                                        'COMPLETE', 'INCOMPLETE_BLOCKING')),
    -- FR-EXEC-020: exposed uncertainty over the snapshot.
    relative_uncertainty            double precision CHECK (
                                        relative_uncertainty IS NULL
                                        OR relative_uncertainty BETWEEN 0 AND 1),
    uncertainty_policy_limit        double precision CHECK (
                                        uncertainty_policy_limit IS NULL
                                        OR uncertainty_policy_limit BETWEEN 0 AND 1),
    observed_at                     timestamptz NOT NULL,
    created_at                      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT execution_state_snapshots_uncertainty_paired CHECK (
        (relative_uncertainty IS NULL) = (uncertainty_policy_limit IS NULL))
);

CREATE INDEX execution_state_snapshots_program_slot_idx
    ON execution_state_snapshots (chain_id, program_id, slot);

-- §64.11/FR-EXEC-021: parity drift, program upgrade, deprecation, or unknown
-- extension opens an incident and degrades affected scope.
CREATE TABLE adapter_incidents (
    incident_id                     text PRIMARY KEY,
    adapter_id                      text NOT NULL,
    adapter_version                 text NOT NULL,
    cause                           text NOT NULL CHECK (cause IN (
                                        'PARITY_DRIFT', 'PROGRAM_UPGRADE', 'DEPRECATION',
                                        'UNKNOWN_EXTENSION', 'STATE_COMPLETENESS_FAILURE',
                                        'FIXTURE_FAILURE')),
    affected_scope                  jsonb NOT NULL CHECK (jsonb_typeof(affected_scope) = 'object'),
    -- Degradation after this incident (FR-EXEC-021: degrade affected tradability).
    resulting_support_state         text NOT NULL CHECK (resulting_support_state IN (
                                        'DEGRADED', 'UNAVAILABLE')),
    detected_at                     timestamptz NOT NULL,
    evidence_ids                    text[] NOT NULL CHECK (cardinality(evidence_ids) > 0),
    created_at                      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX adapter_incidents_adapter_idx
    ON adapter_incidents (adapter_id, adapter_version, detected_at);

-- Append-only: registry versions, snapshots, and incidents are historical.
CREATE TRIGGER pool_math_adapter_registry_immutable
    BEFORE UPDATE OR DELETE ON pool_math_adapter_registry
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER pool_math_adapter_registry_immutable_truncate
    BEFORE TRUNCATE ON pool_math_adapter_registry
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER execution_state_snapshots_immutable
    BEFORE UPDATE OR DELETE ON execution_state_snapshots
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER execution_state_snapshots_immutable_truncate
    BEFORE TRUNCATE ON execution_state_snapshots
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER adapter_incidents_immutable
    BEFORE UPDATE OR DELETE ON adapter_incidents
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER adapter_incidents_immutable_truncate
    BEFORE TRUNCATE ON adapter_incidents
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();
