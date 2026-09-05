-- g1_exec_0004_quotes_gates.sql
-- Quote evidence, tradability gate decisions, and concurrent shadow
-- positions (§64.5, §64.10, FR-EXEC-005, FR-EXEC-007, FR-EXEC-012,
-- FR-EXEC-017, FR-EXEC-019, FR-EXEC-020).

CREATE TABLE quote_evidence (
    quote_id                        text PRIMARY KEY,
    source_id                       text NOT NULL,
    source_kind                     text NOT NULL CHECK (source_kind IN (
                                        'OFFICIAL_PROGRAM_READ', 'INDEPENDENT_AGGREGATOR',
                                        'OBSERVED_TRADE')),
    in_token_mint                   text NOT NULL,
    out_token_mint                  text NOT NULL,
    in_amount                       text NOT NULL CHECK (in_amount ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    out_amount                      text NOT NULL CHECK (out_amount ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    quote_at                        timestamptz NOT NULL,
    observed_at                     timestamptz NOT NULL,
    route_legs                      jsonb NOT NULL CHECK (
                                        jsonb_typeof(route_legs) = 'array'
                                        AND jsonb_array_length(route_legs) >= 1),
    -- §64.5/INV-001: transaction-construction payloads are refused at write
    -- time; this column always stores NULL and its refusal is audited.
    transaction_construction_refused boolean NOT NULL DEFAULT true,
    transaction_payload_ref         text CHECK (transaction_payload_ref IS NULL),
    -- FR-EXEC-020: quote/reference sources are evidence, not execution truth.
    relative_uncertainty            double precision CHECK (
                                        relative_uncertainty IS NULL
                                        OR relative_uncertainty BETWEEN 0 AND 1),
    quality_codes                   text[] NOT NULL CHECK (cardinality(quality_codes) > 0),
    created_at                      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT quote_evidence_availability_order CHECK (observed_at >= quote_at),
    CONSTRAINT quote_evidence_payload_never_accepted
        CHECK (transaction_construction_refused AND transaction_payload_ref IS NULL),
    CONSTRAINT quote_evidence_quality_known
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

CREATE INDEX quote_evidence_mint_time_idx
    ON quote_evidence (in_token_mint, out_token_mint, quote_at);

CREATE TABLE tradability_gate_decisions (
    decision_id                     text PRIMARY KEY,
    candidate_id                    text NOT NULL CHECK (length(candidate_id) > 0),
    outcome_profile_version         text NOT NULL,
    scenario_id                     text NOT NULL REFERENCES execution_scenarios(scenario_id),
    scenario_version                text NOT NULL,
    -- FR-EXEC-017: required pass matrix and the recorded per-scenario results.
    required_kinds                  text[] NOT NULL CHECK (cardinality(required_kinds) > 0),
    scenario_matrix                 jsonb NOT NULL CHECK (
                                        jsonb_typeof(scenario_matrix) = 'array'
                                        AND jsonb_array_length(scenario_matrix) >= 1),
    matrix_passed                   boolean NOT NULL,
    -- FR-EXEC-012: conservative stress controls CONFIRMED_OPPORTUNITY by default.
    conservative_controlled         boolean NOT NULL DEFAULT true,
    -- FR-EXEC-007: tradability verdict may block confirmation while the
    -- diagnostic signal label is preserved verbatim.
    tradability_verdict             text NOT NULL CHECK (tradability_verdict IN (
                                        'TRADABLE', 'UNCERTAINTY_BLOCKED',
                                        'TARGET_NOT_EXECUTABLE', 'STATE_INCOMPLETE',
                                        'EXECUTION_UNAVAILABLE', 'POOL_MATH_UNSUPPORTED',
                                        'INSUFFICIENT_DATA')),
    confirmed_opportunity           boolean NOT NULL,
    block_reason                    text CHECK (
                                        block_reason IS NULL OR confirmed_opportunity = false),
    preserved_signal_label          text CHECK (preserved_signal_label IN (
                                        'SIGNAL_SUCCESS', 'SIGNAL_FAILURE')),
    -- FR-EXEC-020: uncertainty blocking recorded when the bound crosses limits.
    uncertainty_blocked             boolean NOT NULL DEFAULT false,
    -- FR-MAT-009: adverse feasible ordering with path-ambiguity flag.
    primary_ordering                text NOT NULL CHECK (primary_ordering IN (
                                        'ADVERSE_FEASIBLE', 'UNAMBIGUOUS')),
    path_ambiguous                  boolean NOT NULL,
    replay_manifest_id              text NOT NULL,
    decided_at                      timestamptz NOT NULL,
    created_at                      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tradability_gate_decisions_confirmation_coherence CHECK (
        confirmed_opportunity = (tradability_verdict = 'TRADABLE' AND matrix_passed)),
    CONSTRAINT tradability_gate_decisions_conservative_default CHECK (
        NOT confirmed_opportunity OR conservative_controlled),
    CONSTRAINT tradability_gate_decisions_ambiguity_coherence CHECK (
        path_ambiguous = (primary_ordering = 'ADVERSE_FEASIBLE'))
);

CREATE INDEX tradability_gate_decisions_candidate_idx
    ON tradability_gate_decisions (candidate_id, decided_at);

-- FR-EXEC-019: concurrent shadow positions sharing a pool, route, quote
-- asset, liquidity source, deployer cluster, or correlated exit window
-- aggregate impact and capacity; isolated fills cannot each consume the
-- same depth.
CREATE TABLE concurrent_shadow_positions (
    position_id                     text PRIMARY KEY,
    aggregate_id                    text NOT NULL,
    candidate_id                    text NOT NULL CHECK (length(candidate_id) > 0),
    pool_id                         text,
    route_id                        text,
    quote_asset_id                  text,
    shared_liquidity_identifiers    text[] NOT NULL DEFAULT ARRAY[]::text[],
    exit_window_start               timestamptz NOT NULL,
    exit_window_end                 timestamptz NOT NULL,
    requested_exit_usd              text NOT NULL CHECK (
                                        requested_exit_usd ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    pre_exit_depth_usd              text NOT NULL CHECK (
                                        pre_exit_depth_usd ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    fill_fraction                   double precision NOT NULL CHECK (fill_fraction BETWEEN 0 AND 1),
    rejected                        boolean NOT NULL,
    competition_resolution_version  text NOT NULL,
    recorded_at                     timestamptz NOT NULL,
    created_at                      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT concurrent_shadow_positions_window_order
        CHECK (exit_window_end >= exit_window_start),
    -- FR-EXEC-019/AC-236: aggregate impact and fill competition reduce or
    -- reject fills deterministically — a fill above the shared pre-exit depth
    -- is only possible when competition reduced other fills.
    CONSTRAINT concurrent_shadow_positions_fill_bounded CHECK (
        requested_exit_usd::numeric <= pre_exit_depth_usd::numeric
        OR rejected
        OR fill_fraction < 1),
    CONSTRAINT concurrent_shadow_positions_rejected_no_fill CHECK (
        NOT rejected OR fill_fraction = 0),
    CONSTRAINT concurrent_shadow_positions_sharing_key_present CHECK (
        pool_id IS NOT NULL OR route_id IS NOT NULL OR quote_asset_id IS NOT NULL
        OR cardinality(shared_liquidity_identifiers) > 0)
);

CREATE INDEX concurrent_shadow_positions_aggregate_idx
    ON concurrent_shadow_positions (aggregate_id, exit_window_start);

-- Append-only: gate decisions and concurrent-position records are historical.
CREATE TRIGGER tradability_gate_decisions_immutable
    BEFORE UPDATE OR DELETE ON tradability_gate_decisions
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER tradability_gate_decisions_immutable_truncate
    BEFORE TRUNCATE ON tradability_gate_decisions
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER quote_evidence_immutable
    BEFORE UPDATE OR DELETE ON quote_evidence
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER quote_evidence_immutable_truncate
    BEFORE TRUNCATE ON quote_evidence
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER concurrent_shadow_positions_immutable
    BEFORE UPDATE OR DELETE ON concurrent_shadow_positions
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER concurrent_shadow_positions_immutable_truncate
    BEFORE TRUNCATE ON concurrent_shadow_positions
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();
