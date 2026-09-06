-- g1_exec_0002_replay_observation.sql
-- Frozen replay manifests and finite selective outcome-observation plans
-- (§31.5, §64.14 — FR-EXEC-010, FR-EXEC-011).

CREATE TABLE replay_manifests (
    replay_id                       text PRIMARY KEY,
    as_of                           timestamptz NOT NULL,
    dataset_version                 text NOT NULL,
    population_claim                text NOT NULL,
    candidate_universe_hash         text NOT NULL CHECK (
                                        candidate_universe_hash ~ '^sha256:[0-9a-f]{64}$'),
    observation_cutoff              timestamptz NOT NULL,
    collector_coverage_manifest_id  text NOT NULL,
    provider_dependence_version     text NOT NULL,
    feature_version                 text NOT NULL,
    ranking_version                 text NOT NULL,
    workflow_version                text NOT NULL,
    prompt_version                  text NOT NULL,
    tool_profile_version            text NOT NULL,
    model_profile_version           text NOT NULL,
    outcome_profile_version         text NOT NULL,
    policy_version                  text NOT NULL,
    delivery_latency_policy_version text NOT NULL,
    capacity_contract_version       text NOT NULL,
    -- FR-EXEC-010: execution assumptions and code versions are frozen here.
    -- assumptions_hash is the sha256 over the canonical frozen assumption set
    -- (pre-registered scenario payloads, policy versions — the same hash the
    -- simulator records per stress result); scenario_payloads is the exact
    -- §64.2 payload set the hash was computed over. Together they make the
    -- manifest self-verifying: a replay re-hashes the payloads and refuses
    -- on drift.
    assumptions_hash                text NOT NULL CHECK (
                                        assumptions_hash ~ '^sha256:[0-9a-f]{64}$'),
    scenario_payloads               jsonb NOT NULL CHECK (
                                        jsonb_typeof(scenario_payloads) = 'object'),
    pool_math_adapter_versions      text[] NOT NULL CHECK (cardinality(pool_math_adapter_versions) > 0),
    execution_scenario_versions     text[] NOT NULL CHECK (cardinality(execution_scenario_versions) > 0),
    artifact_ids                    text[] NOT NULL DEFAULT ARRAY[]::text[],
    holdout_exposure_snapshot_id    text NOT NULL,
    code_and_dependency_hash        text NOT NULL CHECK (
                                        code_and_dependency_hash ~ '^sha256:[0-9a-f]{64}$'),
    created_at                      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT replay_manifests_observation_cutoff_order
        CHECK (observation_cutoff <= as_of)
);

CREATE INDEX replay_manifests_as_of_idx ON replay_manifests (as_of);

CREATE TABLE outcome_observation_plans (
    plan_id                         text NOT NULL,
    plan_version                    text NOT NULL,
    candidate_id                    text NOT NULL CHECK (length(candidate_id) > 0),
    trigger_class                   text NOT NULL CHECK (trigger_class IN (
                                        'DEEP_RESEARCH', 'EARLY_WATCH',
                                        'CONFIRMED_OPPORTUNITY', 'CONTROL_SAMPLE',
                                        'SHADOW_PORTFOLIO')),
    cadence_seconds                 integer NOT NULL CHECK (cadence_seconds >= 1),
    observed_fields                 text[] NOT NULL CHECK (cardinality(observed_fields) > 0),
    provider_source_ids             text[] NOT NULL CHECK (cardinality(provider_source_ids) > 0),
    duration_seconds                integer NOT NULL CHECK (duration_seconds >= 1),
    -- Quota/capacity ceiling per FR-COST-013 dimensions.
    quota_ceiling                   jsonb NOT NULL CHECK (
                                        jsonb_typeof(quota_ceiling) = 'object'),
    degradation_policy_id           text NOT NULL,
    -- §64.14: insufficient temporal/pool-state/liquidity resolution cannot
    -- prove tradable success — the floor is declared, not inferred.
    resolution_temporal_seconds     integer NOT NULL CHECK (resolution_temporal_seconds >= 1),
    resolution_pool_state_complete  boolean NOT NULL,
    resolution_liquidity_depth_min_usd text NOT NULL CHECK (
                                        resolution_liquidity_depth_min_usd ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    -- FR-MAT-007: sampled plans store inclusion probability, stratum, and
    -- population limits; census plans carry NULLs.
    inclusion_probability           double precision CHECK (
                                        inclusion_probability IS NULL
                                        OR inclusion_probability BETWEEN 0 AND 1),
    stratum                         text,
    population_limit                text,
    registered_at                   timestamptz NOT NULL,
    created_at                      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (plan_id, plan_version),
    CONSTRAINT outcome_observation_plans_sampling_provenance CHECK (
        (inclusion_probability IS NULL AND stratum IS NULL AND population_limit IS NULL)
        OR (inclusion_probability IS NOT NULL AND stratum IS NOT NULL
            AND population_limit IS NOT NULL)),
    CONSTRAINT outcome_observation_plans_sampled_nonzero CHECK (
        inclusion_probability IS NULL OR inclusion_probability > 0),
    CONSTRAINT outcome_observation_plans_early_watch_finite CHECK (duration_seconds < 86400 * 30)
);

CREATE INDEX outcome_observation_plans_candidate_idx
    ON outcome_observation_plans (candidate_id, registered_at);

-- Append-only: plans are pre-registrations and manifests are frozen evidence.
CREATE TRIGGER replay_manifests_immutable
    BEFORE UPDATE OR DELETE ON replay_manifests
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER replay_manifests_immutable_truncate
    BEFORE TRUNCATE ON replay_manifests
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER outcome_observation_plans_immutable
    BEFORE UPDATE OR DELETE ON outcome_observation_plans
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER outcome_observation_plans_immutable_truncate
    BEFORE TRUNCATE ON outcome_observation_plans
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();
