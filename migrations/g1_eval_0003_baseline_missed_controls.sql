-- g1_eval_0003_baseline_missed_controls.sql
-- Baselines, missed-opportunity analysis, symmetric champion/challenger
-- comparisons, and drift/selection controls (FR-EVAL-004/005/007/008/009).

CREATE TABLE IF NOT EXISTS baseline_results (
    baseline_result_id             text PRIMARY KEY,
    evaluation_run_id              text NOT NULL REFERENCES evaluation_runs(evaluation_run_id),
    baseline_kind                  text NOT NULL CHECK (baseline_kind IN (
        'RANDOM_ELIGIBLE_CANDIDATE',
        'PROVIDER_TRENDING_RANK',
        'FIRST_PARTY_EVENT_RECENCY_RANK',
        'NEW_POOL_RANK',
        'LIQUIDITY_ECONOMIC_VOLUME_HEURISTIC',
        'HOLDER_BUYER_GROWTH_HEURISTIC',
        'SECURITY_EXECUTION_HARD_GATE',
        'MARKET_ONLY_DETERMINISTIC_RANK_WITHOUT_LLM',
        'PARETO_LEXICOGRAPHIC_DETERMINISTIC_RANK',
        'OWNER_MANUAL_SHORTLIST')),
    baseline_version               text NOT NULL CHECK (length(baseline_version) > 0),
    metric_kind                    text NOT NULL CHECK (length(metric_kind) > 0),
    metric_value                   text NOT NULL CHECK (
                                        metric_value ~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    candidate_universe_hash        text NOT NULL CHECK (
                                        candidate_universe_hash ~ '^sha256:[0-9a-f]{64}$'),
    comparator_universe_hash       text NOT NULL CHECK (
                                        comparator_universe_hash ~ '^sha256:[0-9a-f]{64}$'),
    data_cutoff                    timestamptz NOT NULL,
    action_time_policy_version     text NOT NULL CHECK (length(action_time_policy_version) > 0),
    execution_scenario_version     text NOT NULL CHECK (length(execution_scenario_version) > 0),
    capital_budget                 text NOT NULL CHECK (
                                        capital_budget ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    strongest_eligible             boolean NOT NULL,
    computed_at                    timestamptz NOT NULL,
    created_at                     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT baseline_comparator_universe_match CHECK (
        candidate_universe_hash = comparator_universe_hash)
);

CREATE TABLE IF NOT EXISTS missed_opportunities (
    missed_opportunity_id          text PRIMARY KEY,
    evaluation_run_id              text NOT NULL REFERENCES evaluation_runs(evaluation_run_id),
    candidate_id                   text NOT NULL CHECK (length(candidate_id) > 0),
    outcome_profile_id             text NOT NULL CHECK (length(outcome_profile_id) > 0),
    outcome_profile_version        text NOT NULL CHECK (length(outcome_profile_version) > 0),
    declared_population_boundary   text NOT NULL CHECK (length(declared_population_boundary) > 0),
    existed_in_discovery_coverage  boolean NOT NULL,
    first_source                   text,
    first_source_observed_at       timestamptz,
    first_system_available_at      timestamptz,
    funnel_exit                   text NOT NULL CHECK (length(funnel_exit) > 0),
    evidence_acquisition_exit      text,
    miss_classification            text NOT NULL CHECK (miss_classification IN (
        'NOT_IN_CLAIMED_UNIVERSE', 'NOT_DISCOVERED', 'COLLECTOR_FILTER_MISS',
        'COLLECTOR_GAP', 'PROVIDER_LATE', 'IDENTITY_FAILURE', 'DATA_STALE',
        'DATA_MISSING', 'EVIDENCE_NOT_REQUESTED', 'EVIDENCE_COST_BLOCKED',
        'EVIDENCE_QUOTA_BLOCKED', 'CAPABILITY_UNAVAILABLE',
        'ELIGIBILITY_FALSE_NEGATIVE', 'SECURITY_FALSE_POSITIVE',
        'MANIPULATION_MISSED', 'WALLET_CLUSTER_MISSED',
        'SOURCE_INDEPENDENCE_OVERESTIMATED', 'RANK_BELOW_CUTOFF',
        'DIVERSITY_EXCLUDED', 'BUDGET_EXHAUSTED', 'TOOL_SELECTION_ERROR',
        'MODEL_REASONING_ERROR', 'UNSUPPORTED_CLAIM', 'POLICY_TOO_STRICT',
        'POLICY_TOO_LOOSE', 'ALERT_TOO_LATE', 'EXECUTION_MODEL_ERROR',
        'POOL_ADAPTER_UNSUPPORTED', 'QUOTE_PARITY_FAILURE',
        'OUTCOME_UNOBSERVED', 'OUTCOME_LOW_RESOLUTION',
        'SAMPLING_WEIGHT_INVALID', 'ACTION_TIME_ASYMMETRY',
        'MARKET_REGIME_SHIFT')),
    delay_decomposition            jsonb NOT NULL CHECK (
                                        jsonb_typeof(delay_decomposition) = 'object'),
    counterfactual_action_time     timestamptz NOT NULL,
    frozen_evidence_refs           jsonb NOT NULL CHECK (
                                        jsonb_typeof(frozen_evidence_refs) = 'array'),
    frozen_version_refs            jsonb NOT NULL CHECK (
                                        jsonb_typeof(frozen_version_refs) = 'object'),
    next_evaluation_dataset_id     text NOT NULL CHECK (length(next_evaluation_dataset_id) > 0),
    next_evaluation_dataset_version text NOT NULL CHECK (length(next_evaluation_dataset_version) > 0),
    analyzed_at                    timestamptz NOT NULL,
    created_at                     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT missed_first_source_pair CHECK (
        (first_source IS NULL) = (first_source_observed_at IS NULL))
);

CREATE TABLE IF NOT EXISTS champion_challenger_comparisons (
    comparison_id                 text PRIMARY KEY,
    evaluation_run_id             text NOT NULL REFERENCES evaluation_runs(evaluation_run_id),
    champion_version              text NOT NULL CHECK (length(champion_version) > 0),
    challenger_version            text NOT NULL CHECK (length(challenger_version) > 0),
    candidate_universe_hash       text NOT NULL CHECK (
                                        candidate_universe_hash ~ '^sha256:[0-9a-f]{64}$'),
    frozen_availability_boundary  timestamptz NOT NULL,
    champion_budget               text NOT NULL CHECK (
                                        champion_budget ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    challenger_budget             text NOT NULL CHECK (
                                        challenger_budget ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    budgets_equalized             boolean NOT NULL,
    external_side_effect_count    bigint NOT NULL CHECK (external_side_effect_count >= 0),
    hard_constraints_passed       boolean NOT NULL,
    primary_utility_gate_passed   boolean NOT NULL,
    deterministic_stack_result_ref text NOT NULL CHECK (length(deterministic_stack_result_ref) > 0),
    model_removed_result_ref      text,
    compared_at                   timestamptz NOT NULL,
    created_at                    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT champion_challenger_budgets_equalized CHECK (
        budgets_equalized AND champion_budget::numeric = challenger_budget::numeric),
    CONSTRAINT challenger_zero_side_effects CHECK (external_side_effect_count = 0)
);

CREATE TABLE IF NOT EXISTS drift_calibration_controls (
    control_id                    text PRIMARY KEY,
    evaluation_run_id             text NOT NULL REFERENCES evaluation_runs(evaluation_run_id),
    control_kind                  text NOT NULL CHECK (control_kind IN (
        'FEATURE_DISTRIBUTION_DRIFT', 'CALIBRATION_DRIFT', 'OUTCOME_DRIFT',
        'REGIME_DRIFT', 'EXECUTION_DIVERGENCE')),
    scope                         jsonb NOT NULL CHECK (jsonb_typeof(scope) = 'object'),
    reference_dataset_ref         text NOT NULL CHECK (length(reference_dataset_ref) > 0),
    observed_value                text NOT NULL CHECK (
                                        observed_value ~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    threshold_value               text NOT NULL CHECK (
                                        threshold_value ~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    drift_detected                boolean NOT NULL,
    response                      text NOT NULL CHECK (response IN (
        'WARN', 'DEGRADE_CONFIDENCE', 'MOVE_TO_SHADOW',
        'DISABLE_POLICY', 'REQUIRE_RECALIBRATION')),
    influence_degraded            boolean NOT NULL,
    measured_at                   timestamptz NOT NULL,
    created_at                    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT drift_detected_implies_degradation CHECK (
        NOT drift_detected OR influence_degraded)
);

CREATE TABLE IF NOT EXISTS selection_bias_diagnostics (
    diagnostic_id                 text PRIMARY KEY,
    evaluation_run_id             text NOT NULL REFERENCES evaluation_runs(evaluation_run_id),
    diagnostic_kind               text NOT NULL CHECK (diagnostic_kind IN (
        'INCLUSION_PROBABILITY', 'WEIGHT_STABILITY', 'EFFECTIVE_SAMPLE_SIZE',
        'COVARIATE_BALANCE', 'OVERLAP_SUPPORT', 'RANDOMIZED_PROBE',
        'WINNERS_CURSE')),
    estimator_kind                text NOT NULL CHECK (estimator_kind IN (
        'UNWEIGHTED', 'DESIGN_WEIGHTED', 'PROPENSITY_WEIGHTED',
        'DOUBLY_ROBUST', 'OBSERVED_SUBSET_ONLY')),
    diagnostics                   jsonb NOT NULL CHECK (jsonb_typeof(diagnostics) = 'object'),
    maximum_weight                double precision CHECK (
                                        maximum_weight IS NULL OR
                                        (maximum_weight > 0 AND maximum_weight <= 20)),
    diagnostics_valid             boolean NOT NULL,
    claim_restriction             text NOT NULL CHECK (claim_restriction IN (
        'DECLARED_UNIVERSE', 'RESTRICT_TO_WEIGHTED_STRATA',
        'RESTRICT_TO_OBSERVED_SUBSET')),
    population_claim              text NOT NULL CHECK (length(population_claim) > 0),
    computed_at                   timestamptz NOT NULL,
    created_at                    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT weighting_requires_diagnostics CHECK (
        estimator_kind NOT IN ('DESIGN_WEIGHTED', 'PROPENSITY_WEIGHTED', 'DOUBLY_ROBUST')
        OR (diagnostics_valid AND maximum_weight IS NOT NULL)),
    CONSTRAINT unsupported_weighting_restricts_claim CHECK (
        diagnostics_valid OR claim_restriction <> 'DECLARED_UNIVERSE'),
    CONSTRAINT observed_subset_estimator_restricts_claim CHECK (
        estimator_kind <> 'OBSERVED_SUBSET_ONLY'
        OR claim_restriction = 'RESTRICT_TO_OBSERVED_SUBSET')
);

CREATE INDEX IF NOT EXISTS baseline_results_run_idx
    ON baseline_results (evaluation_run_id, baseline_kind);
CREATE INDEX IF NOT EXISTS missed_opportunities_run_idx
    ON missed_opportunities (evaluation_run_id, miss_classification);

DROP TRIGGER IF EXISTS baseline_results_no_update ON baseline_results;
CREATE TRIGGER baseline_results_no_update BEFORE UPDATE OR DELETE ON baseline_results
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
DROP TRIGGER IF EXISTS missed_opportunities_no_update ON missed_opportunities;
CREATE TRIGGER missed_opportunities_no_update BEFORE UPDATE OR DELETE ON missed_opportunities
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
DROP TRIGGER IF EXISTS champion_challenger_comparisons_no_update ON champion_challenger_comparisons;
CREATE TRIGGER champion_challenger_comparisons_no_update
    BEFORE UPDATE OR DELETE ON champion_challenger_comparisons
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
DROP TRIGGER IF EXISTS drift_calibration_controls_no_update ON drift_calibration_controls;
CREATE TRIGGER drift_calibration_controls_no_update
    BEFORE UPDATE OR DELETE ON drift_calibration_controls
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
DROP TRIGGER IF EXISTS selection_bias_diagnostics_no_update ON selection_bias_diagnostics;
CREATE TRIGGER selection_bias_diagnostics_no_update
    BEFORE UPDATE OR DELETE ON selection_bias_diagnostics
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
