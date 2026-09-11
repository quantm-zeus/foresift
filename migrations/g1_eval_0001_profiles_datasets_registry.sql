-- g1_eval_0001_profiles_datasets_registry.sql
-- Immutable profiles, leakage-safe datasets, and pre-registered experiments
-- (FR-EVAL-001/009; §8.3–8.9 and §31.2–31.3).

CREATE TABLE IF NOT EXISTS outcome_profiles (
    profile_id                     text NOT NULL CHECK (length(profile_id) > 0),
    version                        text NOT NULL CHECK (length(version) > 0),
    human_name                     text NOT NULL CHECK (length(human_name) > 0),
    research_only_disclosure       text NOT NULL CHECK (length(research_only_disclosure) > 0),
    population_scope               text NOT NULL CHECK (population_scope IN (
                                        'SUPPORTED_PROGRAM_UNIVERSE',
                                        'PROSPECTIVELY_OBSERVED_UNIVERSE',
                                        'AGGREGATE_PROVIDER_UNIVERSE',
                                        'AUTHORIZED_LAUNCH_UNIVERSE',
                                        'STRATIFIED_SAMPLED_UNIVERSE',
                                        'CURRENTLY_OBSERVED_SUBSET_ONLY')),
    inclusion_mechanism            jsonb NOT NULL CHECK (jsonb_typeof(inclusion_mechanism) = 'object'),
    eligibility                    jsonb NOT NULL CHECK (jsonb_typeof(eligibility) = 'object'),
    signal_success                 jsonb NOT NULL CHECK (jsonb_typeof(signal_success) = 'object'),
    tradable_success               jsonb NOT NULL CHECK (jsonb_typeof(tradable_success) = 'object'),
    tradable_failure               jsonb NOT NULL CHECK (jsonb_typeof(tradable_failure) = 'object'),
    neutral                        jsonb NOT NULL CHECK (
                                        jsonb_typeof(neutral) IN ('object', 'string')),
    censoring_policy               jsonb NOT NULL CHECK (jsonb_typeof(censoring_policy) = 'object'),
    invalid_data_policy            jsonb NOT NULL CHECK (jsonb_typeof(invalid_data_policy) = 'object'),
    horizons                       jsonb NOT NULL CHECK (
                                        jsonb_typeof(horizons) = 'array' AND jsonb_array_length(horizons) > 0),
    maturity_policy                jsonb NOT NULL CHECK (jsonb_typeof(maturity_policy) = 'object'),
    observation_resolution_policy  jsonb NOT NULL CHECK (
                                        jsonb_typeof(observation_resolution_policy) = 'object'),
    risk_survival_constraints      jsonb NOT NULL CHECK (
                                        jsonb_typeof(risk_survival_constraints) = 'object'),
    required_capabilities          jsonb NOT NULL CHECK (jsonb_typeof(required_capabilities) = 'array'),
    required_evidence_families     jsonb NOT NULL CHECK (jsonb_typeof(required_evidence_families) = 'array'),
    execution_scenario_matrix      jsonb NOT NULL CHECK (jsonb_typeof(execution_scenario_matrix) = 'object'),
    owner                          text NOT NULL CHECK (length(owner) > 0),
    approval_artifact_ref          text NOT NULL CHECK (length(approval_artifact_ref) > 0),
    rollback_target                text NOT NULL CHECK (length(rollback_target) > 0),
    created_at                     timestamptz NOT NULL,
    activated_at                   timestamptz,
    deprecated_at                  timestamptz,
    PRIMARY KEY (profile_id, version),
    CONSTRAINT outcome_profile_lifecycle_order CHECK (
        (activated_at IS NULL OR activated_at >= created_at) AND
        (deprecated_at IS NULL OR deprecated_at >= COALESCE(activated_at, created_at)))
);

CREATE TABLE IF NOT EXISTS evaluation_datasets (
    dataset_id                     text NOT NULL CHECK (length(dataset_id) > 0),
    version                        text NOT NULL CHECK (length(version) > 0),
    partition                      text NOT NULL CHECK (partition IN (
                                        'TRAIN', 'CALIBRATION', 'VALIDATION',
                                        'FINAL_HOLDOUT', 'LIVE_SHADOW', 'FORWARD_CONFIRMATION')),
    holdout_exposure               text NOT NULL CHECK (holdout_exposure IN (
                                        'UNEXPOSED', 'METRIC_ONLY_EXPOSED', 'OWNER_REVIEWED',
                                        'TUNING_EXPOSED', 'EXHAUSTED')),
    frozen                         boolean NOT NULL,
    population_scope               text NOT NULL CHECK (population_scope IN (
                                        'SUPPORTED_PROGRAM_UNIVERSE',
                                        'PROSPECTIVELY_OBSERVED_UNIVERSE',
                                        'AGGREGATE_PROVIDER_UNIVERSE',
                                        'AUTHORIZED_LAUNCH_UNIVERSE',
                                        'STRATIFIED_SAMPLED_UNIVERSE',
                                        'CURRENTLY_OBSERVED_SUBSET_ONLY')),
    candidate_universe_hash        text NOT NULL CHECK (
                                        candidate_universe_hash ~ '^sha256:[0-9a-f]{64}$'),
    universe_manifest_ref          text NOT NULL CHECK (length(universe_manifest_ref) > 0),
    observation_start              timestamptz NOT NULL,
    observation_end                timestamptz NOT NULL,
    embargo_start                  timestamptz,
    embargo_end                    timestamptz,
    leakage_group_keys             jsonb NOT NULL CHECK (
                                        jsonb_typeof(leakage_group_keys) = 'array' AND
                                        jsonb_array_length(leakage_group_keys) > 0),
    created_at                     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (dataset_id, version),
    CONSTRAINT evaluation_dataset_window CHECK (observation_end > observation_start),
    CONSTRAINT evaluation_dataset_embargo_pair CHECK (
        (embargo_start IS NULL) = (embargo_end IS NULL)),
    CONSTRAINT evaluation_dataset_embargo_order CHECK (
        embargo_start IS NULL OR embargo_end > embargo_start),
    CONSTRAINT final_holdout_frozen_unexposed CHECK (
        partition <> 'FINAL_HOLDOUT' OR (frozen AND holdout_exposure = 'UNEXPOSED'))
);

CREATE TABLE IF NOT EXISTS evaluation_experiments (
    experiment_id                  text PRIMARY KEY,
    hypothesis                     text NOT NULL CHECK (length(hypothesis) > 0),
    primary_metric                 text NOT NULL CHECK (length(primary_metric) > 0),
    hard_constraints               jsonb NOT NULL CHECK (jsonb_typeof(hard_constraints) = 'object'),
    candidate_population           jsonb NOT NULL CHECK (jsonb_typeof(candidate_population) = 'object'),
    profile_scope                  jsonb NOT NULL CHECK (jsonb_typeof(profile_scope) IN ('array', 'object')),
    regime_scope                   jsonb NOT NULL CHECK (jsonb_typeof(regime_scope) IN ('array', 'object')),
    execution_scope                jsonb NOT NULL CHECK (jsonb_typeof(execution_scope) IN ('array', 'object')),
    champion_version               text NOT NULL CHECK (length(champion_version) > 0),
    challenger_version             text NOT NULL CHECK (length(challenger_version) > 0),
    preprocessing_features         jsonb NOT NULL CHECK (jsonb_typeof(preprocessing_features) = 'object'),
    sample_size_power_target       jsonb NOT NULL CHECK (jsonb_typeof(sample_size_power_target) = 'object'),
    cluster_definition             text NOT NULL CHECK (length(cluster_definition) > 0),
    multiple_testing_family        text NOT NULL CHECK (multiple_testing_family IN (
                                        'BENJAMINI_HOCHBERG', 'BONFERRONI', 'HOLM',
                                        'FAMILY_WISE_ERROR', 'FALSE_DISCOVERY_RATE',
                                        'HIERARCHICAL_TESTING', 'RANDOMIZATION_INFERENCE',
                                        'REGISTERED_OTHER')),
    statistical_method             text NOT NULL CHECK (length(statistical_method) > 0),
    stopping_rule                  jsonb NOT NULL CHECK (jsonb_typeof(stopping_rule) = 'object'),
    confirmatory                   boolean NOT NULL,
    registered_at                  timestamptz NOT NULL,
    created_at                     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT experiment_preregistered CHECK (registered_at <= created_at)
);

DROP TRIGGER IF EXISTS outcome_profiles_no_update ON outcome_profiles;
CREATE TRIGGER outcome_profiles_no_update BEFORE UPDATE OR DELETE ON outcome_profiles
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
DROP TRIGGER IF EXISTS evaluation_datasets_no_update ON evaluation_datasets;
CREATE TRIGGER evaluation_datasets_no_update BEFORE UPDATE OR DELETE ON evaluation_datasets
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
DROP TRIGGER IF EXISTS evaluation_experiments_no_update ON evaluation_experiments;
CREATE TRIGGER evaluation_experiments_no_update BEFORE UPDATE OR DELETE ON evaluation_experiments
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
