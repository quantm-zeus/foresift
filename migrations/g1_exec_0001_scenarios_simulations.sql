-- g1_exec_0001_scenarios_simulations.sql
-- Pre-registered execution scenarios, exit-policy experiments, and execution
-- simulations (§64.2, §64.6, §64.7, §8.2, §12.8 — FR-EXEC-001, FR-EXEC-002,
-- FR-EXEC-004, FR-EXEC-006, FR-EXEC-007, FR-EXEC-009).

CREATE TABLE execution_scenarios (
    scenario_id                     text PRIMARY KEY,
    version                         text NOT NULL,
    notional_usd                    text NOT NULL CHECK (
                                        notional_usd ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    deterministic_action_delay_seconds integer NOT NULL
                                        CHECK (deterministic_action_delay_seconds >= 0),
    empirical_action_delay_policy_id text,
    entry_policy_version_id         text NOT NULL,
    exit_policy_version_id          text NOT NULL,
    maximum_entry_impact            double precision NOT NULL
                                        CHECK (maximum_entry_impact >= 0),
    maximum_exit_impact             double precision NOT NULL
                                        CHECK (maximum_exit_impact >= 0),
    allow_partial_fill              boolean NOT NULL,
    minimum_fill_fraction           double precision NOT NULL
                                        CHECK (minimum_fill_fraction BETWEEN 0 AND 1),
    maximum_fill_duration_seconds   integer NOT NULL
                                        CHECK (maximum_fill_duration_seconds >= 0),
    fee_policy_version_id           text NOT NULL,
    conservative_stress_policy_id   text NOT NULL,
    required_pool_adapter_coverage  text NOT NULL CHECK (required_pool_adapter_coverage IN (
                                        'COMPLETE', 'BOUNDED_APPROXIMATION')),
    registered_at                   timestamptz NOT NULL,
    created_at                      timestamptz NOT NULL DEFAULT now(),
    -- §64.2: scenarios are pre-registered; identity is versioned.
    CONSTRAINT execution_scenarios_identity_unique
        UNIQUE (scenario_id, version),
    -- FR-EXEC-009: one pre-registered primary exit policy per scenario.
    CONSTRAINT execution_scenarios_partial_fill_coherence
        CHECK (allow_partial_fill OR minimum_fill_fraction >= 1),
    CONSTRAINT execution_scenarios_delay_policy_present
        CHECK (empirical_action_delay_policy_id IS NULL
            OR length(empirical_action_delay_policy_id) > 0)
);

CREATE INDEX execution_scenarios_registered_at_idx
    ON execution_scenarios (registered_at);

CREATE TABLE exit_policy_experiments (
    experiment_id                   text PRIMARY KEY,
    scenario_id                     text NOT NULL REFERENCES execution_scenarios(scenario_id),
    scenario_version                text NOT NULL,
    exit_policy_kind                text NOT NULL CHECK (exit_policy_kind IN (
                                        'FIXED_HORIZON', 'TAKE_PROFIT_STOP_LOSS',
                                        'TRAILING_EXIT', 'STAGED_EXIT',
                                        'LIQUIDITY_RISK_DETERIORATION',
                                        'THESIS_INVALIDATION')),
    exit_policy_version_id          text NOT NULL,
    is_primary                      boolean NOT NULL,
    parameters                      jsonb NOT NULL CHECK (jsonb_typeof(parameters) = 'object'),
    registered_at                   timestamptz NOT NULL,
    created_at                      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT exit_policy_experiments_policy_version_unique
        UNIQUE (scenario_id, scenario_version, exit_policy_version_id),
    -- FR-EXEC-009: multiple exit policies are evaluated only as pre-registered
    -- separate experiments; the single-primary rule is enforced by the partial
    -- unique index below.
    CONSTRAINT exit_policy_experiments_policy_version_present
        CHECK (exit_policy_version_id IS NOT NULL)
);

CREATE UNIQUE INDEX exit_policy_experiments_primary_per_scenario_idx
    ON exit_policy_experiments (scenario_id, scenario_version)
    WHERE is_primary;

CREATE TABLE execution_simulations (
    simulation_id                   text PRIMARY KEY,
    candidate_id                    text NOT NULL CHECK (length(candidate_id) > 0),
    scenario_id                     text NOT NULL REFERENCES execution_scenarios(scenario_id),
    scenario_version                text NOT NULL,
    outcome_profile_version         text NOT NULL,
    -- §64.6 entry model
    requested_quantity              text NOT NULL CHECK (
                                        requested_quantity ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    filled_quantity                 text NOT NULL CHECK (
                                        filled_quantity ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    fill_fraction                   double precision NOT NULL
                                        CHECK (fill_fraction BETWEEN 0 AND 1),
    average_execution_price         text NOT NULL CHECK (
                                        average_execution_price ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    marginal_price_impact           double precision NOT NULL CHECK (marginal_price_impact >= 0),
    average_price_impact            double precision NOT NULL CHECK (average_price_impact >= 0),
    failed_amount                   text NOT NULL CHECK (
                                        failed_amount ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    entry_started_at                timestamptz NOT NULL,
    entry_completed_at              timestamptz NOT NULL,
    entry_status                    text NOT NULL CHECK (entry_status IN (
                                        'EXECUTED_FULL', 'EXECUTION_PARTIAL',
                                        'EXECUTION_UNAVAILABLE', 'POOL_MATH_UNSUPPORTED',
                                        'INSUFFICIENT_DATA')),
    -- §64.7 exit model (nullable: scenario may not reach an exit)
    exit_policy_version_id          text,
    exit_trigger_at                 timestamptz,
    exit_completed_at               timestamptz,
    exit_fill_fraction              double precision CHECK (exit_fill_fraction BETWEEN 0 AND 1),
    exit_status                     text CHECK (exit_status IN (
                                        'EXECUTED_FULL', 'EXECUTION_PARTIAL',
                                        'EXECUTION_UNAVAILABLE', 'POOL_MATH_UNSUPPORTED',
                                        'INSUFFICIENT_DATA')),
    -- §64.9 net-return components (non-negative decimal strings; never floats)
    gross_return_usd                text NOT NULL CHECK (
                                        gross_return_usd ~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    pool_fees_usd                   text NOT NULL CHECK (pool_fees_usd ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    aggregator_fees_usd             text NOT NULL CHECK (aggregator_fees_usd ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    token_transfer_fees_usd         text NOT NULL CHECK (token_transfer_fees_usd ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    priority_network_fees_usd       text NOT NULL CHECK (priority_network_fees_usd ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    execution_impact_usd            text NOT NULL CHECK (execution_impact_usd ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    failed_attempts_usd             text NOT NULL CHECK (failed_attempts_usd ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    partial_fill_penalty_usd        text NOT NULL CHECK (partial_fill_penalty_usd ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    residual_inventory_usd          text NOT NULL CHECK (residual_inventory_usd ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    adverse_selection_mev_buffer_usd text NOT NULL CHECK (adverse_selection_mev_buffer_usd ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    quote_conversion_depeg_usd      text NOT NULL CHECK (quote_conversion_depeg_usd ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    account_creation_rent_usd       text NOT NULL CHECK (account_creation_rent_usd ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    net_return_usd                  text NOT NULL CHECK (
                                        net_return_usd ~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    -- §8.2 outcome classes + §12.8 maturity + censor reasons
    signal_label                    text CHECK (signal_label IN (
                                        'SIGNAL_SUCCESS', 'SIGNAL_FAILURE')),
    tradable_label                  text CHECK (tradable_label IN (
                                        'TRADABLE_SUCCESS', 'TRADABLE_FAILURE',
                                        'TRADABLE_NEUTRAL', 'NEUTRAL', 'PENDING',
                                        'CENSORED', 'INVALID_DATA')),
    tradable_failure_reason         text CHECK (tradable_failure_reason IN (
                                        'SECURITY_OR_LIQUIDITY', 'EXPLICIT_FAILURE_CLAUSE')),
    tradability_verdict             text NOT NULL CHECK (tradability_verdict IN (
                                        'TRADABLE', 'UNCERTAINTY_BLOCKED',
                                        'TARGET_NOT_EXECUTABLE', 'STATE_INCOMPLETE',
                                        'EXECUTION_UNAVAILABLE', 'POOL_MATH_UNSUPPORTED',
                                        'INSUFFICIENT_DATA')),
    primary_ordering                text NOT NULL CHECK (primary_ordering IN (
                                        'ADVERSE_FEASIBLE', 'UNAMBIGUOUS')),
    path_ambiguous                  boolean NOT NULL,
    outcome_maturity                text NOT NULL CHECK (outcome_maturity IN (
                                        'PENDING', 'PARTIALLY_MATURED', 'FULLY_MATURED',
                                        'CENSORED', 'INVALID_DATA')),
    censor_reason                   text,
    state_snapshot_id               text NOT NULL,
    replay_manifest_id              text NOT NULL,
    observed_at                     timestamptz NOT NULL,
    available_at                    timestamptz NOT NULL,
    quality_codes                   text[] NOT NULL CHECK (cardinality(quality_codes) > 0),
    schema_registry_version         integer NOT NULL CHECK (schema_registry_version = 1),
    created_at                      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT execution_simulations_availability_order
        CHECK (available_at >= observed_at),
    -- §64.7/FR-MAT-009: trigger time and completion time are separate and ordered.
    CONSTRAINT execution_simulations_exit_order
        CHECK (exit_trigger_at IS NULL OR exit_completed_at IS NULL
            OR exit_completed_at >= exit_trigger_at),
    -- §8.2: signal labels live on a separate axis and never overwrite tradable labels.
    CONSTRAINT execution_simulations_signal_axis_separate
        CHECK (tradable_label IS NULL OR tradable_label NOT LIKE 'SIGNAL_%'),
    CONSTRAINT execution_simulations_failure_reason_requires_label
        CHECK (tradable_failure_reason IS NULL
            OR tradable_label = 'TRADABLE_FAILURE'),
    -- FR-EXEC-006/INV-011: SIGNAL_SUCCESS cannot be rendered as profit when
    -- TRADABLE_SUCCESS is absent or failed.
    CONSTRAINT signal_success_never_profit CHECK (
        signal_label <> 'SIGNAL_SUCCESS'
        OR tradable_label = 'TRADABLE_SUCCESS'
        OR gross_return_usd ~ '^-' OR gross_return_usd = '0'),
    -- §64.4/AC-232/INV-011: an incomplete or unavailable execution state
    -- cannot confirm a tradable success.
    CONSTRAINT incomplete_state_cannot_confirm_tradable CHECK (
        NOT (tradable_label = 'TRADABLE_SUCCESS' AND (
            entry_status IN ('EXECUTION_UNAVAILABLE', 'POOL_MATH_UNSUPPORTED',
                             'INSUFFICIENT_DATA')
            OR (exit_status IS NOT NULL AND exit_status IN (
                   'EXECUTION_UNAVAILABLE', 'POOL_MATH_UNSUPPORTED',
                   'INSUFFICIENT_DATA'))))),
    -- §12.8: censoring/invalid data carry explicit reasons and are not
    -- silently mapped to failure (AC-124).
    CONSTRAINT execution_simulations_censor_reasons_explicit CHECK (
        (tradable_label NOT IN ('CENSORED', 'INVALID_DATA'))
        OR censor_reason IS NOT NULL),
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
    ON execution_simulations (candidate_id, scenario_id, scenario_version);
CREATE INDEX execution_simulations_label_idx
    ON execution_simulations (tradable_label, outcome_maturity);

-- FR-EXEC-009: a tradable success must correspond to the pre-registered
-- primary exit policy of its scenario version. CHECK constraints cannot
-- carry subqueries, so the primary-exit binding is enforced by trigger.
CREATE FUNCTION foresift_refuse_unprimary_exit_success() RETURNS trigger AS $fn$
BEGIN
    IF NEW.tradable_label = 'TRADABLE_SUCCESS' THEN
        IF NEW.exit_policy_version_id IS NULL THEN
            RAISE EXCEPTION 'tradable success requires an exit policy'
                USING ERRCODE = 'check_violation';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM exit_policy_experiments e
            WHERE e.scenario_id = NEW.scenario_id
              AND e.scenario_version = NEW.scenario_version
              AND e.is_primary
              AND e.exit_policy_version_id = NEW.exit_policy_version_id
        ) THEN
            RAISE EXCEPTION
                'tradable success must use the pre-registered primary exit policy (FR-EXEC-009)'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER execution_simulations_primary_exit_binding
    BEFORE INSERT ON execution_simulations
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_unprimary_exit_success();

-- Append-only: simulations are historical evidence and are never rewritten
-- (G0 immutability pattern; corrections create new rows).
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
