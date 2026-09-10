-- g1_mat_0001_maturity_ledger.sql
-- Immutable outcome-maturity, denominator, subjective-utility, and sampling
-- ledgers (FR-MAT-001/002/003/006/007/010; §12.8 and §68.1–10).

CREATE TABLE IF NOT EXISTS outcome_maturity_states (
    maturity_state_id              text PRIMARY KEY,
    candidate_id                   text NOT NULL CHECK (length(candidate_id) > 0),
    outcome_profile_id             text NOT NULL CHECK (length(outcome_profile_id) > 0),
    outcome_profile_version        text NOT NULL CHECK (length(outcome_profile_version) > 0),
    horizon                        text NOT NULL CHECK (horizon IN ('5M', '24H', '7D', '30D')),
    scenario_id                    text NOT NULL CHECK (length(scenario_id) > 0),
    scenario_version               text NOT NULL CHECK (length(scenario_version) > 0),
    maturity_state                 text NOT NULL CHECK (maturity_state IN (
                                        'PENDING', 'PARTIALLY_MATURED', 'FULLY_MATURED',
                                        'CENSORED', 'INVALID_DATA')),
    censor_reason                  text CHECK (censor_reason IN (
                                        'RIGHTS_DRIVEN_DELETION',
                                        'PERMANENT_IDENTITY_AMBIGUITY',
                                        'UNRECOVERABLE_OBSERVATION_GAP',
                                        'UNSUPPORTED_HISTORICAL_POOL_STATE',
                                        'CHAIN_ARCHIVE_UNAVAILABILITY')),
    invalid_reason                 text CHECK (invalid_reason IN (
                                        'CORRUPTED_SAMPLING_ASSIGNMENT',
                                        'IMPOSSIBLE_TIME_ORDER',
                                        'FAILED_POOL_PARITY',
                                        'UNRESOLVABLE_DECIMALS',
                                        'AVAILABILITY_CANNOT_BE_ESTABLISHED')),
    matured_at                     timestamptz,
    observed_at                    timestamptz NOT NULL,
    available_at                   timestamptz NOT NULL,
    evidence_refs                  jsonb NOT NULL DEFAULT '[]'::jsonb
                                        CHECK (jsonb_typeof(evidence_refs) = 'array'),
    created_at                     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT outcome_maturity_dimension_unique UNIQUE (
        candidate_id, outcome_profile_id, outcome_profile_version,
        horizon, scenario_id, scenario_version),
    CONSTRAINT outcome_maturity_availability_order CHECK (available_at >= observed_at),
    CONSTRAINT outcome_maturity_reason_required CHECK (
        (maturity_state = 'CENSORED' AND censor_reason IS NOT NULL AND invalid_reason IS NULL)
        OR (maturity_state = 'INVALID_DATA' AND invalid_reason IS NOT NULL AND censor_reason IS NULL)
        OR (maturity_state NOT IN ('CENSORED', 'INVALID_DATA')
            AND censor_reason IS NULL AND invalid_reason IS NULL)),
    CONSTRAINT outcome_maturity_terminal_time CHECK (
        (maturity_state IN ('FULLY_MATURED', 'CENSORED', 'INVALID_DATA')) =
        (matured_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS outcome_maturity_lookup_idx ON outcome_maturity_states
    (outcome_profile_id, outcome_profile_version, horizon, maturity_state);

CREATE TABLE IF NOT EXISTS maturity_transitions (
    transition_id                  text PRIMARY KEY,
    maturity_state_id              text NOT NULL REFERENCES outcome_maturity_states(maturity_state_id),
    from_state                     text NOT NULL CHECK (from_state IN (
                                        'PENDING', 'PARTIALLY_MATURED', 'FULLY_MATURED',
                                        'CENSORED', 'INVALID_DATA')),
    to_state                       text NOT NULL CHECK (to_state IN (
                                        'PENDING', 'PARTIALLY_MATURED', 'FULLY_MATURED',
                                        'CENSORED', 'INVALID_DATA')),
    reason                         text NOT NULL CHECK (length(reason) > 0),
    evidence_refs                  jsonb NOT NULL DEFAULT '[]'::jsonb
                                        CHECK (jsonb_typeof(evidence_refs) = 'array'),
    transitioned_at                timestamptz NOT NULL,
    recorded_at                    timestamptz NOT NULL DEFAULT now(),
    -- PENDING may progress; PARTIALLY_MATURED cannot reset; terminal states
    -- (including censor/invalid) are absorbing.
    CONSTRAINT maturity_transition_monotone CHECK (
        (from_state = 'PENDING' AND to_state IN (
            'PARTIALLY_MATURED', 'FULLY_MATURED', 'CENSORED', 'INVALID_DATA'))
        OR (from_state = 'PARTIALLY_MATURED' AND to_state IN (
            'FULLY_MATURED', 'CENSORED', 'INVALID_DATA')))
);

CREATE TABLE IF NOT EXISTS outcome_denominator_disclosures (
    disclosure_id                 text PRIMARY KEY,
    evaluation_run_id             text NOT NULL CHECK (length(evaluation_run_id) > 0),
    outcome_profile_id            text NOT NULL,
    outcome_profile_version       text NOT NULL,
    horizon                       text NOT NULL CHECK (horizon IN ('5M', '24H', '7D', '30D')),
    observation_collection_scope  text NOT NULL CHECK (length(observation_collection_scope) > 0),
    report_scope                  text NOT NULL CHECK (length(report_scope) > 0),
    eligible_count                bigint NOT NULL CHECK (eligible_count >= 0),
    fully_matured_valid_count     bigint NOT NULL CHECK (fully_matured_valid_count >= 0),
    pending_count                 bigint NOT NULL CHECK (pending_count >= 0),
    partially_matured_count       bigint NOT NULL CHECK (partially_matured_count >= 0),
    censored_count                bigint NOT NULL CHECK (censored_count >= 0),
    invalid_data_count            bigint NOT NULL CHECK (invalid_data_count >= 0),
    low_resolution_count          bigint NOT NULL CHECK (low_resolution_count >= 0),
    rights_blocked_count          bigint NOT NULL CHECK (rights_blocked_count >= 0),
    unobserved_count              bigint NOT NULL CHECK (unobserved_count >= 0),
    disclosed_at                 timestamptz NOT NULL,
    created_at                    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT denominator_classes_bounded CHECK (
        fully_matured_valid_count + pending_count + partially_matured_count +
        censored_count + invalid_data_count + low_resolution_count +
        rights_blocked_count + unobserved_count <= eligible_count)
);

-- Deliberately has no foreign key to any objective outcome table. Subjective
-- labels are a physically separate family and cannot rewrite ground truth.
CREATE TABLE IF NOT EXISTS subjective_utility_records (
    subjective_utility_id          text PRIMARY KEY,
    subject_id                     text NOT NULL CHECK (length(subject_id) > 0),
    candidate_id                   text NOT NULL CHECK (length(candidate_id) > 0),
    label_family                   text NOT NULL CHECK (label_family IN (
                                        'SUBJECTIVE_USER_UTILITY', 'HUMAN_EXPERT_JUDGMENT')),
    utility_label                  text NOT NULL CHECK (length(utility_label) > 0),
    utility_value                  text CHECK (
                                        utility_value IS NULL OR utility_value ~
                                        '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    rationale                     text,
    recorded_at                   timestamptz NOT NULL,
    created_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outcome_sampling_strata (
    stratum_id                     text PRIMARY KEY,
    sampling_plan_id               text NOT NULL CHECK (length(sampling_plan_id) > 0),
    dimensions                     jsonb NOT NULL CHECK (jsonb_typeof(dimensions) = 'object'),
    eligible_count                 bigint NOT NULL CHECK (eligible_count >= 0),
    target_sample_count            bigint NOT NULL CHECK (target_sample_count >= 0),
    registered_at                  timestamptz NOT NULL,
    created_at                     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (sampling_plan_id, dimensions)
);

CREATE TABLE IF NOT EXISTS outcome_sampling_assignments (
    assignment_id                  text PRIMARY KEY,
    sampling_plan_id               text NOT NULL CHECK (length(sampling_plan_id) > 0),
    candidate_id                   text NOT NULL CHECK (length(candidate_id) > 0),
    stratum_id                     text NOT NULL REFERENCES outcome_sampling_strata(stratum_id),
    inclusion_probability          double precision NOT NULL
                                        CHECK (inclusion_probability > 0 AND inclusion_probability <= 1),
    selected                       boolean NOT NULL,
    selection_time                 timestamptz NOT NULL,
    selection_reason               text NOT NULL CHECK (length(selection_reason) > 0),
    seed_provenance                text NOT NULL CHECK (
                                        length(seed_provenance) > 0 AND seed_provenance NOT LIKE 'raw:%'),
    created_at                     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (sampling_plan_id, candidate_id)
);

DROP TRIGGER IF EXISTS outcome_maturity_states_no_update ON outcome_maturity_states;
CREATE TRIGGER outcome_maturity_states_no_update
    BEFORE UPDATE OR DELETE ON outcome_maturity_states
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
DROP TRIGGER IF EXISTS denominator_disclosures_no_update ON outcome_denominator_disclosures;
CREATE TRIGGER denominator_disclosures_no_update
    BEFORE UPDATE OR DELETE ON outcome_denominator_disclosures
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
DROP TRIGGER IF EXISTS subjective_utility_records_no_update ON subjective_utility_records;
CREATE TRIGGER subjective_utility_records_no_update
    BEFORE UPDATE OR DELETE ON subjective_utility_records
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
DROP TRIGGER IF EXISTS outcome_sampling_assignments_no_update ON outcome_sampling_assignments;
CREATE TRIGGER outcome_sampling_assignments_no_update
    BEFORE UPDATE OR DELETE ON outcome_sampling_assignments
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
