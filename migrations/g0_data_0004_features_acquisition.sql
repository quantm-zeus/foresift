-- g0_data_0004_features_acquisition.sql
-- Online/offline feature consistency (FR-DATA-004, §14.3/§14.4) and evidence
-- acquisition state (§13.8) with write-before-retrieval ordering (AC-243),
-- plus content-addressed frozen evidence bundles.

CREATE TABLE feature_definitions (
    definition_id  text PRIMARY KEY,
    name           text NOT NULL,
    version        integer NOT NULL CHECK (version >= 1),
    unit_semantics text NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (name, version)
);

CREATE TABLE feature_values (
    value_id                text PRIMARY KEY,
    definition_id           text NOT NULL REFERENCES feature_definitions(definition_id),
    feature_version         integer NOT NULL CHECK (feature_version >= 1),
    computation_code_version text NOT NULL CHECK (length(computation_code_version) > 0),
    subject_key             text NOT NULL,
    event_at                timestamptz NOT NULL,
    -- Decimal-string values at an explicit scale; NULL only with explicit codes.
    decimal_string          text CHECK (decimal_string ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    scale                   integer CHECK (scale BETWEEN 0 AND 36),
    quality_codes           text[] NOT NULL DEFAULT ARRAY[]::text[]
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
            'RETROSPECTIVE_ONLY']::text[]),
    population_kind         text NOT NULL CHECK (population_kind IN (
                                'FULL_UNIVERSE',
                                'DEEP_RESEARCH_SELECTED',
                                'CONTROL_GROUP',
                                'EXPLORATION_ARM')),
    lineage_refs            text[] NOT NULL DEFAULT ARRAY[]::text[],
    store_class             text NOT NULL CHECK (store_class IN ('ONLINE', 'OFFLINE')),
    created_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT feature_values_quantity_pair_complete
        CHECK ((decimal_string IS NULL) = (scale IS NULL)),
    CONSTRAINT feature_values_scale_matches_fraction_digits
        CHECK (decimal_string IS NULL OR scale = CASE
            WHEN position('.' in decimal_string) = 0 THEN 0
            ELSE length(decimal_string) - position('.' in decimal_string)
        END),
    CONSTRAINT feature_values_null_requires_explicit_code
        CHECK (decimal_string IS NOT NULL OR (
            array_length(quality_codes, 1) >= 1
            AND NOT quality_codes <@ ARRAY['VALID']::text[])),
    -- One value per (definition version, store class, subject, event time).
    UNIQUE (definition_id, feature_version, store_class, subject_key, event_at)
);

CREATE INDEX feature_values_subject_idx ON feature_values (subject_key, event_at);

-- §13.8 acquisition records: the exact PRD interface plus the storage
-- semantics — randomized probes persist nonzero assignment probability and
-- decision impact BEFORE retrieval completion.
CREATE TABLE evidence_acquisition_decisions (
    decision_id                  text PRIMARY KEY,
    candidate_id                 text NOT NULL,
    evidence_family              text NOT NULL,
    policy_version               text NOT NULL,
    state                        text NOT NULL CHECK (state IN (
                                     'NOT_REQUESTED_BY_POLICY',
                                     'REQUESTED',
                                     'COST_BLOCKED',
                                     'QUOTA_BLOCKED',
                                     'CAPABILITY_UNAVAILABLE',
                                     'RIGHTS_BLOCKED',
                                     'PROVIDER_UNAVAILABLE',
                                     'TIMED_OUT',
                                     'RETURNED',
                                     'INVALID_RESPONSE')),
    requested_at                 timestamptz,
    completed_at                 timestamptz,
    assignment_probability       double precision
        CHECK (assignment_probability IS NULL
               OR (assignment_probability > 0 AND assignment_probability < 1)),
    estimated_decision_impact    double precision
        CHECK (estimated_decision_impact IS NULL OR estimated_decision_impact BETWEEN 0 AND 1),
    estimated_information_value  double precision
        CHECK (estimated_information_value IS NULL OR estimated_information_value BETWEEN 0 AND 1),
    actual_decision_changed      boolean,
    evidence_ids                 text[] NOT NULL DEFAULT ARRAY[]::text[],
    impact_recorded_at           timestamptz,
    created_at                   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT acquisition_not_requested_has_no_lifecycle
        CHECK (state <> 'NOT_REQUESTED_BY_POLICY' OR (
            requested_at IS NULL AND completed_at IS NULL AND assignment_probability IS NULL)),
    CONSTRAINT acquisition_completion_requires_request
        CHECK (completed_at IS NULL OR requested_at IS NOT NULL),
    CONSTRAINT acquisition_completion_not_before_request
        CHECK (completed_at IS NULL OR completed_at >= requested_at),
    -- AC-243 write-before-retrieval: a completed retrieval must have had the
    -- probe assignment + decision-impact state recorded no later than then.
    CONSTRAINT acquisition_impact_before_retrieval_completion
        CHECK (completed_at IS NULL OR (
            assignment_probability IS NOT NULL
            AND impact_recorded_at IS NOT NULL
            AND impact_recorded_at <= completed_at))
);

CREATE INDEX acquisition_candidate_idx ON evidence_acquisition_decisions (candidate_id);

-- Frozen evidence bundles: content-addressed; identical content cannot be
-- re-frozen under another identity. Originals are immutable once frozen.
CREATE TABLE evidence_bundles (
    bundle_id    text PRIMARY KEY,
    content_hash text NOT NULL UNIQUE CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
    manifest     jsonb NOT NULL,
    frozen_at    timestamptz NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- foresift_refuse_mutation() is defined in g0_data_0002 (applied earlier,
-- lexicographic order) — same cross-file dependency pattern as g0_data_0007.
CREATE TRIGGER evidence_bundles_immutable
    BEFORE UPDATE OR DELETE ON evidence_bundles
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();

-- Row-level triggers do not fire on TRUNCATE; refuse it statement-wise too.
CREATE TRIGGER evidence_bundles_immutable_truncate
    BEFORE TRUNCATE ON evidence_bundles
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();
