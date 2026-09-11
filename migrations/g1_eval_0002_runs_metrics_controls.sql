-- g1_eval_0002_runs_metrics_controls.sql
-- Frozen evaluation runs, mature-denominator metrics, correlated intervals,
-- negative controls, and statistical incidents (FR-EVAL-002/003/009 and
-- FR-MAT-004/005).

CREATE TABLE IF NOT EXISTS evaluation_runs (
    evaluation_run_id              text PRIMARY KEY,
    experiment_id                  text NOT NULL REFERENCES evaluation_experiments(experiment_id),
    replay_kind                    text NOT NULL CHECK (replay_kind IN (
                                        'REALIZABLE_REPLAY', 'LIVE_SHADOW',
                                        'FORWARD_CONFIRMATION', 'ORACLE_DIAGNOSTIC',
                                        'PROVIDER_AVAILABILITY_EXPERIMENT')),
    as_of                          timestamptz NOT NULL,
    dataset_version                text NOT NULL CHECK (length(dataset_version) > 0),
    population_claim               text NOT NULL CHECK (length(population_claim) > 0),
    candidate_universe_hash        text NOT NULL CHECK (
                                        candidate_universe_hash ~ '^sha256:[0-9a-f]{64}$'),
    observation_cutoff             timestamptz NOT NULL,
    collector_coverage_manifest_id text NOT NULL,
    provider_dependence_version    text NOT NULL,
    feature_version                text NOT NULL,
    ranking_version                text NOT NULL,
    workflow_version               text NOT NULL,
    prompt_version                 text NOT NULL,
    tool_profile_version           text NOT NULL,
    model_profile_version          text NOT NULL,
    outcome_profile_version        text NOT NULL,
    policy_version                 text NOT NULL,
    delivery_latency_policy_version text NOT NULL,
    capacity_contract_version      text NOT NULL,
    pool_math_adapter_versions     jsonb NOT NULL CHECK (
                                        jsonb_typeof(pool_math_adapter_versions) = 'array'),
    execution_scenario_versions    jsonb NOT NULL CHECK (
                                        jsonb_typeof(execution_scenario_versions) = 'array'),
    artifact_ids                   jsonb NOT NULL CHECK (jsonb_typeof(artifact_ids) = 'array'),
    holdout_exposure_snapshot_id   text NOT NULL CHECK (length(holdout_exposure_snapshot_id) > 0),
    code_and_dependency_hash       text NOT NULL CHECK (
                                        code_and_dependency_hash ~ '^sha256:[0-9a-f]{64}$'),
    exec_replay_manifest_ref       text NOT NULL CHECK (length(exec_replay_manifest_ref) > 0),
    network_access                 boolean NOT NULL DEFAULT false,
    started_at                     timestamptz NOT NULL,
    completed_at                   timestamptz,
    created_at                     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT evaluation_run_cutoff CHECK (observation_cutoff <= as_of),
    CONSTRAINT evaluation_run_completion CHECK (
        completed_at IS NULL OR completed_at >= started_at),
    CONSTRAINT replay_network_access_denied CHECK (
        NOT network_access OR replay_kind = 'PROVIDER_AVAILABILITY_EXPERIMENT')
);

CREATE TABLE IF NOT EXISTS evaluation_metric_results (
    metric_result_id               text PRIMARY KEY,
    evaluation_run_id              text NOT NULL REFERENCES evaluation_runs(evaluation_run_id),
    metric_kind                    text NOT NULL CHECK (metric_kind IN (
        'LCB95_NET_SHADOW_PORTFOLIO_UTILITY_PER_CAPITAL_DAY',
        'NET_PNL', 'EXPECTANCY', 'PROFIT_FACTOR', 'DRAWDOWN', 'CVAR',
        'CAPITAL_UTILIZATION', 'TURNOVER', 'CONCENTRATION', 'OPPORTUNITY_COST',
        'PRECISION_AT_K', 'RECALL_AT_ELIGIBLE_GEMS', 'NDCG_AT_K',
        'FALSE_DISCOVERY_RATE', 'FALSE_REJECTION_RATE',
        'MEDIAN_SUCCESSFUL_ASSET_RANK', 'MEDIAN_ACTIONABLE_LEAD_TIME',
        'MFE', 'MAE', 'TARGET_DURATION', 'LIQUIDITY_SURVIVAL', 'SECURITY_SURVIVAL',
        'TRADABLE_SUCCESS_BY_NOTIONAL', 'TRADABLE_SUCCESS_DETERMINISTIC_DELAY',
        'TRADABLE_SUCCESS_P50_DELAY', 'TRADABLE_SUCCESS_P90_DELAY',
        'FILL_EXIT_SURVIVAL', 'PARTIAL_FILL_RATE', 'SIGNAL_TO_TRADABLE_DIVERGENCE',
        'OUTCOME_MATURITY_RATE', 'OUTCOME_CENSORING_RATE', 'OUTCOME_INVALID_DATA_RATE',
        'EXECUTABLE_TARGET_FALSE_POSITIVE_RATE', 'DISCOVERY_COVERAGE', 'SOURCE_OVERLAP')),
    metric_value                   text NOT NULL CHECK (
                                        metric_value ~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    lower_bound                    text CHECK (
                                        lower_bound IS NULL OR lower_bound ~
                                        '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    upper_bound                    text CHECK (
                                        upper_bound IS NULL OR upper_bound ~
                                        '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    maturity_scope                 text NOT NULL CHECK (maturity_scope IN (
                                        'FINAL_FULLY_MATURED', 'PROVISIONAL_MATURED_AND_PARTIAL',
                                        'PROVISIONAL_ALL_STATES')),
    final_result                   boolean NOT NULL,
    -- MAT migrations sort after EVAL migrations globally, so this immutable
    -- content reference is validated by the repository after both families
    -- exist rather than by a forward SQL foreign key.
    denominator_disclosure_ref     text NOT NULL CHECK (length(denominator_disclosure_ref) > 0),
    computed_at                    timestamptz NOT NULL,
    created_at                     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT metric_interval_pair CHECK ((lower_bound IS NULL) = (upper_bound IS NULL)),
    CONSTRAINT metric_interval_order CHECK (
        lower_bound IS NULL OR lower_bound::numeric <= upper_bound::numeric),
    CONSTRAINT final_metric_requires_matured CHECK (
        NOT final_result OR maturity_scope = 'FINAL_FULLY_MATURED')
);

CREATE TABLE IF NOT EXISTS clustered_interval_runs (
    interval_run_id                text PRIMARY KEY,
    evaluation_run_id              text NOT NULL REFERENCES evaluation_runs(evaluation_run_id),
    metric_kind                    text NOT NULL CHECK (length(metric_kind) > 0),
    interval_method                text NOT NULL CHECK (interval_method IN (
                                        'CLUSTER_BOOTSTRAP', 'BLOCK_BOOTSTRAP_CALENDAR',
                                        'BLOCK_BOOTSTRAP_REGIME', 'RANDOMIZATION_INFERENCE')),
    cluster_definition             text NOT NULL CHECK (cluster_definition IN (
                                        'CALENDAR', 'DEPLOYER', 'FUNDING_CLUSTER',
                                        'WALLET_ENTITY', 'LAUNCHPAD', 'NARRATIVE',
                                        'POOL', 'SOURCE', 'REGIME')),
    naive_sample_size              bigint NOT NULL CHECK (naive_sample_size >= 0),
    cluster_count                  bigint NOT NULL CHECK (cluster_count >= 0),
    effective_independent_sample_size double precision NOT NULL
                                        CHECK (effective_independent_sample_size >= 0 AND
                                               effective_independent_sample_size <= naive_sample_size),
    minimum_effective_sample_size  double precision NOT NULL
                                        CHECK (minimum_effective_sample_size > 0),
    ess_gate_passed                boolean NOT NULL,
    promotion_eligible             boolean NOT NULL,
    point_estimate                 text NOT NULL CHECK (
                                        point_estimate ~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    lower_bound                    text NOT NULL CHECK (
                                        lower_bound ~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    upper_bound                    text NOT NULL CHECK (
                                        upper_bound ~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    alternate_cluster_sensitivity jsonb NOT NULL CHECK (
                                        jsonb_typeof(alternate_cluster_sensitivity) = 'object'),
    computed_at                    timestamptz NOT NULL,
    created_at                     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT clustered_interval_order CHECK (
        lower_bound::numeric <= point_estimate::numeric AND
        point_estimate::numeric <= upper_bound::numeric),
    CONSTRAINT ess_gate_truth CHECK (
        ess_gate_passed =
        (effective_independent_sample_size >= minimum_effective_sample_size)),
    CONSTRAINT low_ess_blocks_promotion CHECK (ess_gate_passed OR NOT promotion_eligible)
);

CREATE TABLE IF NOT EXISTS evaluation_incidents (
    incident_id                    text PRIMARY KEY,
    evaluation_run_id              text NOT NULL REFERENCES evaluation_runs(evaluation_run_id),
    incident_trigger               text NOT NULL CHECK (incident_trigger IN (
        'LEAKAGE_OR_NEGATIVE_CONTROL_FAILURE', 'EXHAUSTED_HOLDOUT_AS_UNTOUCHED',
        'INVALID_SAMPLING_OR_EVIDENCE_PROPENSITY', 'MULTIPLE_TESTING_REGISTRY_MISMATCH',
        'CLUSTER_ESS_BELOW_GATE', 'ACTION_TIME_ASYMMETRY',
        'POOL_ADAPTER_PARITY_INVALIDATION', 'POPULATION_CLAIM_EXCEEDS_UNIVERSE',
        'CHAMPION_CHALLENGER_MATERIAL_DIVERGENCE')),
    affected_scope                 jsonb NOT NULL CHECK (jsonb_typeof(affected_scope) = 'object'),
    influence_paused               boolean NOT NULL,
    opened_at                      timestamptz NOT NULL,
    resolved_at                    timestamptz,
    resolution_ref                 text,
    created_at                     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT evaluation_incident_pauses_influence CHECK (influence_paused),
    CONSTRAINT evaluation_incident_resolution CHECK (
        (resolved_at IS NULL) = (resolution_ref IS NULL) AND
        (resolved_at IS NULL OR resolved_at >= opened_at))
);

CREATE TABLE IF NOT EXISTS negative_control_runs (
    control_run_id                 text PRIMARY KEY,
    evaluation_run_id              text NOT NULL REFERENCES evaluation_runs(evaluation_run_id),
    control_kind                   text NOT NULL CHECK (control_kind IN (
        'OUTCOME_LABEL_PERMUTATION', 'FEATURE_TIMESTAMP_SHIFT',
        'DELAYED_PROVIDER_PLACEBO', 'BACKFILLED_AVAILABILITY_PLACEBO',
        'SYNTHETIC_NULL_FEATURES', 'FORBIDDEN_FUTURE_COLUMN_SCAN',
        'OUTCOME_COLUMN_SCAN', 'SAME_ASSET_LEAKAGE_SCAN',
        'SAME_ENTITY_LEAKAGE_SCAN', 'OVERLAPPING_WINDOW_LEAKAGE_SCAN',
        'PROVIDER_ID_ONLY_PREDICTOR', 'SOURCE_ID_ONLY_PREDICTOR',
        'RANDOMIZED_MODEL_OUTPUT_CONTROL', 'RANDOMIZED_TOOL_SELECTION_CONTROL')),
    seed_provenance                text NOT NULL CHECK (
                                        length(seed_provenance) > 0 AND seed_provenance NOT LIKE 'raw:%'),
    observed_lift                  text NOT NULL CHECK (
                                        observed_lift ~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    material_lift_threshold        text NOT NULL CHECK (
                                        material_lift_threshold ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    unexpected_material_lift       boolean NOT NULL,
    promotion_blocked              boolean NOT NULL,
    incident_id                    text REFERENCES evaluation_incidents(incident_id),
    executed_at                    timestamptz NOT NULL,
    created_at                     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT negative_control_lift_truth CHECK (
        unexpected_material_lift =
        (abs(observed_lift::numeric) > material_lift_threshold::numeric)),
    CONSTRAINT negative_control_lift_incident CHECK (
        NOT unexpected_material_lift OR
        (incident_id IS NOT NULL AND promotion_blocked))
);

CREATE INDEX IF NOT EXISTS evaluation_runs_as_of_idx ON evaluation_runs (as_of);
CREATE INDEX IF NOT EXISTS evaluation_metrics_run_idx ON evaluation_metric_results
    (evaluation_run_id, metric_kind);

DROP TRIGGER IF EXISTS evaluation_runs_no_update ON evaluation_runs;
CREATE TRIGGER evaluation_runs_no_update BEFORE UPDATE OR DELETE ON evaluation_runs
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
DROP TRIGGER IF EXISTS evaluation_metric_results_no_update ON evaluation_metric_results;
CREATE TRIGGER evaluation_metric_results_no_update BEFORE UPDATE OR DELETE ON evaluation_metric_results
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
DROP TRIGGER IF EXISTS clustered_interval_runs_no_update ON clustered_interval_runs;
CREATE TRIGGER clustered_interval_runs_no_update BEFORE UPDATE OR DELETE ON clustered_interval_runs
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
DROP TRIGGER IF EXISTS evaluation_incidents_no_update ON evaluation_incidents;
CREATE TRIGGER evaluation_incidents_no_update BEFORE UPDATE OR DELETE ON evaluation_incidents
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
DROP TRIGGER IF EXISTS negative_control_runs_no_update ON negative_control_runs;
CREATE TRIGGER negative_control_runs_no_update BEFORE UPDATE OR DELETE ON negative_control_runs
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
