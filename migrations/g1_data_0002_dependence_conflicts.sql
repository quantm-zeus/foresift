-- g1_data_0002_dependence_conflicts.sql
-- Reconciled acquisition truth (FR-DATA-011/012).  The dependence/conflict
-- tables later in this migration are the authoritative G1 audit substrate.

ALTER TABLE evidence_acquisition_decisions
    DROP CONSTRAINT evidence_acquisition_decisions_state_check,
    ADD CONSTRAINT evidence_acquisition_decisions_state_check CHECK (state IN (
      'NOT_REQUESTED_BY_POLICY', 'REQUESTED', 'COST_BLOCKED', 'QUOTA_BLOCKED',
      'RIGHTS_BLOCKED', 'UNSUPPORTED', 'PROVIDER_UNAVAILABLE', 'FAILED',
      'RETURNED_EMPTY', 'RETURNED')),
    ADD COLUMN candidate_state_at_request jsonb,
    ADD COLUMN requested_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
    ADD COLUMN expected_value_of_information double precision,
    ADD COLUMN estimated_cost double precision,
    ADD COLUMN actual_cost double precision,
    ADD COLUMN seed_provenance text,
    ADD COLUMN failure_kind text;

UPDATE evidence_acquisition_decisions
   SET expected_value_of_information = estimated_information_value;

ALTER TABLE evidence_acquisition_decisions
    ADD CONSTRAINT acquisition_candidate_state_object CHECK (
      candidate_state_at_request IS NULL OR jsonb_typeof(candidate_state_at_request) = 'object'),
    ADD CONSTRAINT acquisition_evi_alias_exact CHECK (
      expected_value_of_information IS NOT DISTINCT FROM estimated_information_value),
    ADD CONSTRAINT acquisition_estimated_cost_nonnegative CHECK (
      estimated_cost IS NULL OR estimated_cost >= 0),
    ADD CONSTRAINT acquisition_actual_cost_nonnegative CHECK (
      actual_cost IS NULL OR actual_cost >= 0),
    ADD CONSTRAINT acquisition_failure_kind_vocabulary CHECK (
      failure_kind IS NULL OR failure_kind IN (
        'COST_LIMIT', 'QUOTA_LIMIT', 'RIGHTS_POLICY', 'UNSUPPORTED_CAPABILITY',
        'PROVIDER_UNAVAILABLE', 'REQUEST_FAILED', 'EMPTY_RESULT')),
    ADD CONSTRAINT acquisition_not_requested_has_no_g1_lifecycle CHECK (
      state <> 'NOT_REQUESTED_BY_POLICY' OR (
        requested_fields = ARRAY[]::text[] AND estimated_cost IS NULL
        AND actual_cost IS NULL AND seed_provenance IS NULL AND failure_kind IS NULL)),
    ADD CONSTRAINT acquisition_returned_empty_has_no_evidence CHECK (
      state <> 'RETURNED_EMPTY' OR cardinality(evidence_ids) = 0);

-- FR-DATA-013: declared and estimated dependence retain their validity and
-- their exact effect on the independent-evidence count.
CREATE TABLE dependence_edge_validity (
    edge_id                         text PRIMARY KEY,
    source_a                       text NOT NULL,
    source_b                       text NOT NULL,
    dependence_kind                text NOT NULL CHECK (dependence_kind IN ('DECLARED', 'EMPIRICAL')),
    valid_from                     timestamptz NOT NULL,
    valid_until                    timestamptz,
    method                         text NOT NULL,
    evidence_ids                   text[] NOT NULL DEFAULT ARRAY[]::text[],
    confidence                     double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    effective_independent_count_delta double precision NOT NULL CHECK (effective_independent_count_delta <= 0),
    available_at                   timestamptz NOT NULL,
    created_at                     timestamptz NOT NULL DEFAULT now(),
    CHECK (source_a < source_b),
    CHECK (valid_until IS NULL OR valid_until > valid_from)
);

-- FR-DATA-016: classification never replaces raw observations; it references
-- every immutable observation involved in the conflict.
CREATE TABLE provider_conflicts (
    conflict_id                  text PRIMARY KEY,
    observation_ids             text[] NOT NULL CHECK (cardinality(observation_ids) >= 2),
    classification              text NOT NULL CHECK (classification IN (
      'BENIGN_LATENCY_OR_ROUNDING', 'COMMON_UPSTREAM_DUPLICATION',
      'MATERIAL_DISAGREEMENT', 'UNRESOLVED_DECISION_CRITICAL')),
    decision_critical           boolean NOT NULL,
    rationale                   text NOT NULL,
    classified_at               timestamptz NOT NULL,
    classifier_version          text NOT NULL,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    CHECK ((classification = 'UNRESOLVED_DECISION_CRITICAL') = decision_critical)
);
