-- g1_sig_0002_funnel_vectors_ranking.sql
-- Profile-versioned candidate funnel, honest independent vectors, and ranking audits.

CREATE TABLE sig.candidate_funnel_stages (
    stage_id                         text PRIMARY KEY,
    candidate_id                     text NOT NULL,
    profile_id                       text NOT NULL,
    profile_version                  text NOT NULL,
    stage                            text NOT NULL CHECK (stage IN (
                                         'FREE_DISCOVERY_UNIVERSE_ATTRIBUTION',
                                         'IDENTITY_VALIDATION',
                                         'CAPABILITY_DATA_QUALITY_GATE',
                                         'ELIGIBILITY_GATES',
                                         'ZERO_COST_COARSE_GATE',
                                         'CHEAP_BATCH_MONITORING_PERSISTENCE_GATE',
                                         'SELECTIVE_FREE_QUOTA_VERIFICATION',
                                         'ECONOMIC_NORMALIZATION_SECURITY',
                                         'FEATURE_UPDATE',
                                         'REGIME_ROUTE_RESOLUTION',
                                         'NARRATIVE_CROSS_CHAIN_CONTEXT',
                                         'VECTOR_CONSTRUCTION',
                                         'CROWDING_DECAY_PRECHECK',
                                         'PARETO_FILTERING',
                                         'RESEARCH_PRIORITY_RANKING',
                                         'DIVERSITY_SELECTION',
                                         'AGENT_RESEARCH',
                                         'THESIS_WHY_NOW',
                                         'EVIDENCE_VALIDATION_ROBUSTNESS',
                                         'EXECUTION_TRADABILITY_GATE',
                                         'ALERT_POLICY')),
    entered_at                       timestamptz NOT NULL,
    passed                           boolean NOT NULL,
    gate_code                        text,
    gate_profile_version             text NOT NULL,
    evidence_refs                    text[] NOT NULL DEFAULT ARRAY[]::text[],
    created_at                       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT sig_gate_failure_reason_coded CHECK (
        passed OR (gate_code IS NOT NULL AND length(gate_code) > 0)),
    UNIQUE (candidate_id, profile_version, stage, entered_at)
);

CREATE TABLE sig.candidate_vectors (
    vector_id                        text PRIMARY KEY,
    candidate_id                     text NOT NULL,
    profile_version                  text NOT NULL,
    as_of                            timestamptz NOT NULL,
    vector_kind                      text NOT NULL CHECK (vector_kind IN (
                                         'OPPORTUNITY',
                                         'RISK',
                                         'DATA_QUALITY',
                                         'URGENCY',
                                         'NOVELTY',
                                         'TRADABILITY',
                                         'SOURCE_INDEPENDENCE')),
    components                       jsonb NOT NULL,
    algorithm_version                text NOT NULL CHECK (length(algorithm_version) > 0),
    lineage_ref                      text NOT NULL REFERENCES sig.feature_lineage(lineage_id),
    created_at                       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT sig_vector_components_object CHECK (
        jsonb_typeof(components) = 'object' AND components <> '{}'::jsonb),
    CONSTRAINT sig_vector_components_have_envelopes CHECK (
        NOT jsonb_path_exists(components, '$.* ? (@.type() != "object")')
        AND NOT jsonb_path_exists(components, '$.* ? (!exists(@.value))')),
    CONSTRAINT sig_vector_nulls_are_reason_coded CHECK (
        NOT jsonb_path_exists(
            components,
            '$.* ? (@.value == null && (!exists(@.qualityCodes) || @.qualityCodes.size() == 0))')),
    UNIQUE (candidate_id, profile_version, as_of, vector_kind)
);

CREATE TABLE sig.ranking_audits (
    audit_id                         text PRIMARY KEY,
    candidate_id                     text NOT NULL,
    rank_at_time                     integer NOT NULL CHECK (rank_at_time >= 1),
    ranking_version                  text NOT NULL CHECK (length(ranking_version) > 0),
    profile_version                  text NOT NULL,
    component_values                 jsonb NOT NULL CHECK (jsonb_typeof(component_values) = 'object'),
    hard_gate_results                jsonb NOT NULL CHECK (jsonb_typeof(hard_gate_results) = 'object'),
    pareto_status                    text NOT NULL CHECK (pareto_status IN (
                                         'EFFICIENT',
                                         'DOMINATED',
                                         'UNKNOWN_DIMENSION_BLOCKED')),
    diversity_adjustment             jsonb NOT NULL CHECK (jsonb_typeof(diversity_adjustment) = 'object'),
    exploration_selected             boolean NOT NULL,
    cutoff_reason                    text NOT NULL CHECK (cutoff_reason IN (
                                         'BELOW_BUDGET_CUTOFF',
                                         'HARD_GATE_FAILED',
                                         'PARETO_DOMINATED',
                                         'DIVERSITY_CONSTRAINT',
                                         'EXPLORATION_ARM',
                                         'NOT_SELECTED_WITH_REASON')),
    selection_arm                    text NOT NULL CHECK (selection_arm IN (
                                         'EXPLOITATION',
                                         'UNCERTAINTY',
                                         'RANDOM_EXPLORATION',
                                         'EVIDENCE_PROBE',
                                         'OUTCOME_OBSERVATION_ONLY',
                                         'NOT_SELECTED')),
    selection_probability            double precision CHECK (
                                         selection_probability IS NULL
                                         OR (selection_probability > 0 AND selection_probability <= 1)),
    protected_allocations            jsonb NOT NULL CHECK (jsonb_typeof(protected_allocations) = 'object'),
    capacity_admission               jsonb NOT NULL,
    algorithm_version                text NOT NULL CHECK (length(algorithm_version) > 0),
    t_decision_ready                 timestamptz NOT NULL,
    created_at                       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT sig_randomized_arm_probability CHECK (
        NOT exploration_selected OR selection_probability IS NOT NULL),
    UNIQUE (candidate_id, ranking_version, profile_version, t_decision_ready)
);

CREATE INDEX sig_funnel_candidate_idx
    ON sig.candidate_funnel_stages (candidate_id, profile_version, entered_at);
CREATE INDEX sig_vectors_candidate_idx
    ON sig.candidate_vectors (candidate_id, profile_version, as_of);
CREATE INDEX sig_ranking_audits_decision_idx
    ON sig.ranking_audits (ranking_version, profile_version, t_decision_ready, rank_at_time);

CREATE TRIGGER sig_candidate_funnel_stages_immutable
    BEFORE UPDATE OR DELETE ON sig.candidate_funnel_stages
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER sig_candidate_vectors_immutable
    BEFORE UPDATE OR DELETE ON sig.candidate_vectors
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER sig_ranking_audits_immutable
    BEFORE UPDATE OR DELETE ON sig.ranking_audits
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
