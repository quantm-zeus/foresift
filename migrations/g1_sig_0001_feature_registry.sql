-- g1_sig_0001_feature_registry.sql
-- Versioned signal feature definitions, derived-value lineage, and cohort truth.

CREATE SCHEMA IF NOT EXISTS sig;

CREATE TABLE sig.feature_definitions (
    feature_id                       text NOT NULL,
    version                          integer NOT NULL CHECK (version >= 1),
    description                      text NOT NULL CHECK (length(description) > 0),
    formula                          text NOT NULL CHECK (length(formula) > 0),
    input_fields                     text[] NOT NULL,
    unit                             text NOT NULL,
    windows                          text[] NOT NULL DEFAULT ARRAY[]::text[],
    minimum_observations             integer NOT NULL CHECK (minimum_observations >= 1),
    null_policy                      text NOT NULL CHECK (length(null_policy) > 0),
    outlier_policy                   text NOT NULL CHECK (length(outlier_policy) > 0),
    update_policy                    text NOT NULL CHECK (length(update_policy) > 0),
    freshness_limit_seconds          integer NOT NULL CHECK (freshness_limit_seconds >= 0),
    cohort_definition_id             text,
    evidence_requirements            text[] NOT NULL DEFAULT ARRAY[]::text[],
    minimum_denominator              integer,
    is_numeric                       boolean NOT NULL DEFAULT TRUE,
    stability_transform              text,
    shrinkage_policy                 text,
    capped_contribution              double precision CHECK (
                                         capped_contribution IS NULL
                                         OR (capped_contribution > 0 AND capped_contribution <= 1)),
    outlier_policy_is_robust         boolean NOT NULL DEFAULT FALSE,
    cohort_fallback_policy_id        text,
    economic_event_required          boolean NOT NULL DEFAULT FALSE,
    created_at                       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (feature_id, version),
    CONSTRAINT sig_numeric_feature_stability_defined CHECK (
        NOT is_numeric OR (
            minimum_denominator IS NOT NULL
            AND minimum_denominator >= 1
            AND stability_transform IS NOT NULL
            AND length(stability_transform) > 0
            AND shrinkage_policy IS NOT NULL
            AND length(shrinkage_policy) > 0
            AND cohort_fallback_policy_id IS NOT NULL
            AND length(cohort_fallback_policy_id) > 0
            AND outlier_policy_is_robust)),
    CONSTRAINT sig_ranking_features_capped CHECK (
        NOT is_numeric OR capped_contribution IS NOT NULL)
);

CREATE TABLE sig.feature_lineage (
    lineage_id                       text PRIMARY KEY,
    feature_id                       text NOT NULL,
    feature_version                  integer NOT NULL,
    entity_id                        text NOT NULL,
    profile_id                       text NOT NULL,
    window_start                     timestamptz,
    window_end                       timestamptz NOT NULL,
    input_observation_ids            text[] NOT NULL DEFAULT ARRAY[]::text[],
    input_evidence_ids               text[] NOT NULL DEFAULT ARRAY[]::text[],
    input_hashes                     text[] NOT NULL,
    calculation_code_version         text NOT NULL CHECK (length(calculation_code_version) > 0),
    calculated_at                    timestamptz NOT NULL,
    quality_codes                    text[] NOT NULL,
    event_time_resolved_at           timestamptz NOT NULL,
    created_at                       timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (feature_id, feature_version)
        REFERENCES sig.feature_definitions(feature_id, version),
    CONSTRAINT sig_lineage_hashes_present CHECK (cardinality(input_hashes) > 0),
    CONSTRAINT sig_lineage_window_order CHECK (
        window_start IS NULL OR window_start < window_end),
    CONSTRAINT sig_lineage_replay_boundary CHECK (event_time_resolved_at <= calculated_at)
);

CREATE TABLE sig.cohort_snapshots (
    snapshot_id                      text PRIMARY KEY,
    feature_id                       text NOT NULL,
    feature_version                  integer NOT NULL,
    entity_id                        text NOT NULL,
    cohort_chain                     text NOT NULL,
    cohort_launchpad                 text,
    cohort_age_band                  text,
    cohort_market_cap_band           text,
    cohort_liquidity_band            text,
    cohort_narrative                 text,
    cohort_regime                    text,
    fallback_level                   text NOT NULL CHECK (fallback_level IN (
                                         'EXACT_COHORT',
                                         'REMOVE_NARRATIVE',
                                         'REMOVE_REGIME',
                                         'WIDEN_MARKET_CAP_BAND',
                                         'WIDEN_AGE_BAND',
                                         'CHAIN_LAUNCHPAD',
                                         'OWN_HISTORY_ANOMALY')),
    cohort_size                      integer NOT NULL CHECK (cohort_size >= 0),
    effective_sample_size            double precision NOT NULL CHECK (effective_sample_size >= 0),
    peer_percentile                  double precision CHECK (peer_percentile BETWEEN 0 AND 1),
    low_sample_warning               boolean NOT NULL DEFAULT FALSE,
    computed_at                      timestamptz NOT NULL,
    FOREIGN KEY (feature_id, feature_version)
        REFERENCES sig.feature_definitions(feature_id, version)
);

CREATE INDEX sig_feature_lineage_lookup_idx
    ON sig.feature_lineage (feature_id, feature_version, entity_id, event_time_resolved_at);
CREATE INDEX sig_cohort_snapshots_lookup_idx
    ON sig.cohort_snapshots (feature_id, feature_version, entity_id, computed_at);

CREATE TRIGGER sig_feature_definitions_immutable
    BEFORE UPDATE OR DELETE ON sig.feature_definitions
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER sig_feature_definitions_immutable_truncate
    BEFORE TRUNCATE ON sig.feature_definitions
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER sig_feature_lineage_immutable
    BEFORE UPDATE OR DELETE ON sig.feature_lineage
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER sig_feature_lineage_immutable_truncate
    BEFORE TRUNCATE ON sig.feature_lineage
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();
