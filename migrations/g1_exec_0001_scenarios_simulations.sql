-- g1_exec_0001_scenarios_simulations.sql
-- §64.2 pre-registered execution scenarios, FR-EXEC-009 pre-registered
-- exit-policy experiments, and §8.2/§64.12 execution simulations
-- (FR-EXEC-001/002/004/006/007/009).
--
-- Pre-registration (§64.2, FR-EXEC-009): scenarios and exit-policy experiments
-- carry explicit pre_registered_at / registered_at instants and are append-only;
-- post-hoc selection among them is prevented by immutability of the registration
-- record itself, not by a self-referential timestamp comparison.

CREATE TABLE execution_scenarios (
    scenario_id                     text PRIMARY KEY,
    version                         text NOT NULL,
    notional_usd                    text NOT NULL CHECK (notional_usd ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    deterministic_action_delay_seconds integer NOT NULL CHECK (
                                        deterministic_action_delay_seconds >= 0),
    empirical_action_delay_policy_id text,
    entry_policy_version_id         text NOT NULL,
    exit_policy_version_id          text NOT NULL,
    maximum_entry_impact            double precision NOT NULL CHECK (
                                        maximum_entry_impact BETWEEN 0 AND 1),
    maximum_exit_impact             double precision NOT NULL CHECK (
                                        maximum_exit_impact BETWEEN 0 AND 1),
    allow_partial_fill              boolean NOT NULL,
    minimum_fill_fraction           double precision NOT NULL CHECK (
                                        minimum_fill_fraction BETWEEN 0 AND 1),
    maximum_fill_duration_seconds   integer NOT NULL CHECK (maximum_fill_duration_seconds >= 0),
    fee_policy_version_id           text NOT NULL,
    conservative_stress_policy_id   text NOT NULL,
    required_pool_adapter_coverage  text NOT NULL CHECK (
                                        required_pool_adapter_coverage IN (
                                            'COMPLETE', 'BOUNDED_APPROXIMATION')),
    registered_at                   timestamptz NOT NULL,
    created_at                      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT execution_scenarios_partial_fill_law
        CHECK (NOT allow_partial_fill OR minimum_fill_fraction > 0)
);

CREATE TABLE exit_policy_experiments (
    experiment_id                   text PRIMARY KEY,
    scenario_id                     text NOT NULL REFERENCES execution_scenarios(scenario_id),
    exit_policy_version_id          text NOT NULL,
    exit_policy_kind                text NOT NULL CHECK (exit_policy_kind IN (
                                        'FIXED_HORIZON', 'TAKE_PROFIT_STOP_LOSS',
                                        'TRAILING_EXIT', 'STAGED_EXIT',
                                        'LIQUIDITY_RISK_DETERIORATION',
                                        'THESIS_INVALIDATION')),
    is_primary                      boolean NOT NULL,
    pre_registered_at               timestamptz NOT NULL,
    registered_before_any_outcome   boolean NOT NULL CHECK (registered_before_any_outcome),
    created_at                      timestamptz NOT NULL DEFAULT now()
);

-- FR-EXEC-009: at most one pre-registered primary per scenario; secondary
-- (non-primary) experiments remain unlimited.
CREATE UNIQUE INDEX exit_policy_experiments_primary_idx
    ON exit_policy_experiments (scenario_id)
    WHERE is_primary;

CREATE TABLE execution_simulations (
    simulation_id                   text PRIMARY KEY,
    scenario_id                     text NOT NULL REFERENCES execution_scenarios(scenario_id),
    candidate_id                    text NOT NULL,
    outcome_class                   text NOT NULL CHECK (outcome_class IN (
                                        'SIGNAL_SUCCESS', 'SIGNAL_FAILURE',
                                        'TRADABLE_SUCCESS', 'TRADABLE_FAILURE',
                                        'TRADABLE_NEUTRAL', 'NEUTRAL',
                                        'PENDING', 'CENSORED', 'INVALID_DATA')),
    outcome_maturity                text NOT NULL CHECK (outcome_maturity IN (
                                        'PENDING', 'PARTIALLY_MATURED',
                                        'FULLY_MATURED', 'CENSORED', 'INVALID_DATA')),
    censor_reason                   text,
    invalid_reason                  text,
    signal_class                    text NOT NULL CHECK (signal_class IN (
                                        'SIGNAL_SUCCESS', 'SIGNAL_FAILURE',
                                        'NEUTRAL', 'PENDING', 'CENSORED', 'INVALID_DATA')),
    tradability_verdict             text NOT NULL CHECK (tradability_verdict IN (
                                        'CONFIRMED_TRADABLE',
                                        'BLOCKED_INCOMPLETE_STATE',
                                        'BLOCKED_UNCERTAINTY_BOUND',
                                        'BLOCKED_STRESS_PASS_MATRIX',
                                        'BLOCKED_EXECUTION_UNAVAILABLE',
                                        'BLOCKED_TARGET_NOT_EXECUTABLE',
                                        'BLOCKED_OBSERVATION_PLAN')),
    execution_status                text NOT NULL CHECK (execution_status IN (
                                        'EXECUTED_FULL', 'EXECUTION_PARTIAL',
                                        'EXECUTION_UNAVAILABLE',
                                        'POOL_MATH_UNSUPPORTED', 'INSUFFICIENT_DATA')),
    state_completeness              text NOT NULL CHECK (state_completeness IN (
                                        'COMPLETE', 'INCOMPLETE_BLOCKING')),
    uncertainty_bound               double precision NOT NULL CHECK (
                                        uncertainty_bound BETWEEN 0 AND 1),
    uncertainty_policy_limit        double precision NOT NULL CHECK (
                                        uncertainty_policy_limit BETWEEN 0 AND 1),
    net_return_usd                  text CHECK (net_return_usd IS NULL OR net_return_usd ~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    profit_rendered                 boolean NOT NULL,
    quality_codes                   text[] NOT NULL CHECK (cardinality(quality_codes) > 0),
    observed_at                     timestamptz NOT NULL,
    available_at                    timestamptz NOT NULL,
    created_at                      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT execution_simulations_availability_order
        CHECK (available_at >= observed_at),
    CONSTRAINT execution_simulations_signal_success_never_profit
        -- FR-EXEC-006 / INV-011: SIGNAL_SUCCESS cannot be rendered as profit
        -- when TRADABLE_SUCCESS is absent or failed.
        CHECK (NOT profit_rendered OR outcome_class = 'TRADABLE_SUCCESS'),
    CONSTRAINT execution_simulations_incomplete_state_cannot_confirm_tradable
        -- FR-EXEC-020 / AC-232: incomplete state blocks confirmed tradability.
        CHECK (NOT (state_completeness = 'INCOMPLETE_BLOCKING'
            AND tradability_verdict = 'CONFIRMED_TRADABLE')),
    CONSTRAINT execution_simulations_uncertainty_blocks_tradability
        -- FR-EXEC-020: an uncertainty bound at/above the policy limit blocks.
        CHECK (NOT (uncertainty_bound >= uncertainty_policy_limit
            AND tradability_verdict = 'CONFIRMED_TRADABLE')),
    CONSTRAINT execution_simulations_censored_reason_present
        -- AC-124: censored outcomes retain explicit reasons.
        CHECK (outcome_class <> 'CENSORED' OR censor_reason IS NOT NULL),
    CONSTRAINT execution_simulations_invalid_reason_present
        -- AC-124: invalid outcomes retain explicit reasons.
        CHECK (outcome_class <> 'INVALID_DATA' OR invalid_reason IS NOT NULL),
    CONSTRAINT execution_simulations_maturity_matches_outcome
        CHECK (NOT (outcome_maturity IN ('CENSORED', 'INVALID_DATA'))
            OR outcome_class IN ('CENSORED', 'INVALID_DATA')),
    CONSTRAINT execution_simulations_isolated_wick_not_tradable_success
        -- FR-EXEC-004 / AC-122: an isolated wick is recorded as execution
        -- unavailable (§13.9 code or execution_status) and can never count as
        -- tradable success nor confirm tradability.
        CHECK (NOT (quality_codes @> ARRAY['EXECUTION_UNAVAILABLE']
                OR execution_status = 'EXECUTION_UNAVAILABLE')
            OR (outcome_class <> 'TRADABLE_SUCCESS'
                AND tradability_verdict <> 'CONFIRMED_TRADABLE')),
    CONSTRAINT execution_simulations_quality_known
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

CREATE INDEX execution_simulations_candidate_idx
    ON execution_simulations (candidate_id, observed_at);
CREATE INDEX execution_simulations_scenario_idx
    ON execution_simulations (scenario_id, observed_at);

CREATE TRIGGER execution_scenarios_immutable
    BEFORE UPDATE OR DELETE ON execution_scenarios
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER execution_scenarios_immutable_truncate
    BEFORE TRUNCATE ON execution_scenarios
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER exit_policy_experiments_immutable
    BEFORE UPDATE OR DELETE ON exit_policy_experiments
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER exit_policy_experiments_immutable_truncate
    BEFORE TRUNCATE ON exit_policy_experiments
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER execution_simulations_immutable
    BEFORE UPDATE OR DELETE ON execution_simulations
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER execution_simulations_immutable_truncate
    BEFORE TRUNCATE ON execution_simulations
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();
