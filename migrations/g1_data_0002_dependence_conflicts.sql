-- g1_data_0002_dependence_conflicts.sql
-- Point-in-time source dependence and raw-observation-preserving provider
-- conflicts (FR-DATA-013, FR-DATA-014, FR-DATA-016).

ALTER TABLE source_dependence_edges
    ADD COLUMN valid_from timestamptz,
    ADD COLUMN valid_until timestamptz,
    ADD COLUMN method text,
    ADD COLUMN evidence_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
    ADD COLUMN confidence double precision,
    ADD COLUMN effective_independence_multiplier double precision;

-- Upgrade the proven G0 empirical edges without backdating them. Their G1
-- validity begins only when the edge itself first became available. The
-- multiplier uses the already-published G0 threshold table and is deliberately
-- conservative for any material observed-dependence dimension.
UPDATE source_dependence_edges
SET valid_from = available_at,
    method = 'EMPIRICAL',
    confidence = 1,
    effective_independence_multiplier = CASE
        WHEN value_error_timing_correlation >= 0.8
          OR outage_overlap >= 0.5
          OR first_seen_lag_agreement >= 0.7
          OR fingerprint_similarity >= 0.9
        THEN 0.5
        ELSE 1
    END;

ALTER TABLE source_dependence_edges
    ALTER COLUMN valid_from SET NOT NULL,
    ALTER COLUMN method SET NOT NULL,
    ALTER COLUMN confidence SET NOT NULL,
    ALTER COLUMN effective_independence_multiplier SET NOT NULL,
    ADD CONSTRAINT source_dependence_edges_validity_order
        CHECK (valid_until IS NULL OR valid_until >= valid_from),
    ADD CONSTRAINT source_dependence_edges_method_check
        CHECK (method IN ('DECLARED', 'EMPIRICAL')),
    ADD CONSTRAINT source_dependence_edges_confidence_check
        CHECK (confidence BETWEEN 0 AND 1),
    ADD CONSTRAINT source_dependence_edges_multiplier_check
        CHECK (effective_independence_multiplier BETWEEN 0 AND 1),
    ADD CONSTRAINT source_dependence_edges_not_before_availability
        CHECK (valid_from >= available_at);

CREATE TABLE empirical_dependence_observations (
    observation_id                  text PRIMARY KEY,
    source_a                        text NOT NULL REFERENCES source_identities(source_id),
    source_b                        text NOT NULL REFERENCES source_identities(source_id),
    correlated_values               double precision NOT NULL
        CHECK (correlated_values BETWEEN -1 AND 1),
    correlated_errors               double precision NOT NULL
        CHECK (correlated_errors BETWEEN -1 AND 1),
    update_timing_sync               double precision NOT NULL
        CHECK (update_timing_sync BETWEEN 0 AND 1),
    first_seen_sync                  double precision NOT NULL
        CHECK (first_seen_sync BETWEEN 0 AND 1),
    outage_overlap                   double precision NOT NULL
        CHECK (outage_overlap BETWEEN 0 AND 1),
    schema_fingerprint_similarity    double precision NOT NULL
        CHECK (schema_fingerprint_similarity BETWEEN 0 AND 1),
    common_missingness               double precision NOT NULL
        CHECK (common_missingness BETWEEN 0 AND 1),
    declared_upstream_relationship   text NOT NULL
        CHECK (length(btrim(declared_upstream_relationship)) > 0),
    estimated_at                     timestamptz NOT NULL,
    estimated_from                   timestamptz NOT NULL,
    estimated_to                     timestamptz NOT NULL,
    created_at                       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT empirical_dependence_canonical_order CHECK (source_a < source_b),
    CONSTRAINT empirical_dependence_window_order
        CHECK (estimated_from <= estimated_to AND estimated_to <= estimated_at)
);

CREATE INDEX empirical_dependence_pair_time_idx
    ON empirical_dependence_observations (source_a, source_b, estimated_at);

CREATE TABLE provider_conflicts (
    conflict_id                 text PRIMARY KEY,
    subject_observation_ids     text[] NOT NULL
        CHECK (cardinality(subject_observation_ids) >= 2),
    conflict_class              text NOT NULL CHECK (conflict_class IN (
        'BENIGN_LATENCY_ROUNDING_VARIANCE',
        'COMMON_UPSTREAM_DUPLICATION',
        'MATERIAL_DISAGREEMENT',
        'UNRESOLVED_DECISION_CRITICAL')),
    field_path                  text NOT NULL CHECK (length(btrim(field_path)) > 0),
    resolved_by_rule            text,
    quality_code                text NOT NULL DEFAULT 'CONFLICTING'
        CHECK (quality_code = 'CONFLICTING'),
    available_at                timestamptz NOT NULL,
    created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX provider_conflicts_available_at_idx ON provider_conflicts (available_at);

CREATE FUNCTION foresift_refuse_g1_data_mutation() RETURNS trigger AS $fn$
BEGIN
    RAISE EXCEPTION '% records are append-only', TG_TABLE_NAME
        USING ERRCODE = 'restrict_violation';
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER empirical_dependence_observations_append_only
    BEFORE UPDATE OR DELETE ON empirical_dependence_observations
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_g1_data_mutation();

CREATE TRIGGER empirical_dependence_observations_append_only_truncate
    BEFORE TRUNCATE ON empirical_dependence_observations
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_g1_data_mutation();

CREATE TRIGGER provider_conflicts_append_only
    BEFORE UPDATE OR DELETE ON provider_conflicts
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_g1_data_mutation();

CREATE TRIGGER provider_conflicts_append_only_truncate
    BEFORE TRUNCATE ON provider_conflicts
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_g1_data_mutation();
