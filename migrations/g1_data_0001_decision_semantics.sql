-- g1_data_0001_decision_semantics.sql
-- Backfill provenance, symmetric candidate delivery timelines, and the G1
-- evidence-acquisition vocabulary (FR-DATA-007, FR-DATA-009, FR-DATA-011/012).

ALTER TABLE observations
    ADD COLUMN retrieved_as_backfill boolean NOT NULL DEFAULT false,
    ADD COLUMN unavailability_reason text,
    ADD CONSTRAINT observations_unavailability_reason_is_backfill
        CHECK (unavailability_reason IS NULL OR retrieved_as_backfill),
    ADD CONSTRAINT observations_backfill_requires_reason
        CHECK (NOT retrieved_as_backfill OR unavailability_reason IS NOT NULL),
    ADD CONSTRAINT observations_backfill_requires_actual_fetch
        CHECK (NOT retrieved_as_backfill OR fetched_at IS NOT NULL),
    ADD CONSTRAINT observations_backfill_availability_not_before_fetch
        CHECK (NOT retrieved_as_backfill OR available_at >= fetched_at),
    ADD CONSTRAINT observations_backfill_provenance
        CHECK (NOT retrieved_as_backfill OR availability_provenance IN (
            'HISTORICAL_QUERY_FETCHED_LATER',
            'MANUAL_IMPORT_AVAILABLE'));

CREATE TABLE candidate_decision_timelines (
    candidate_id                     text NOT NULL,
    policy_version                   text NOT NULL,
    decision_ready_at                timestamptz NOT NULL,
    policy_decided_at                timestamptz NOT NULL,
    workflow_completed_at            timestamptz NOT NULL,
    delivery_eligible_at             timestamptz NOT NULL,
    delivered_at                     timestamptz,
    counterfactual_delivery_version  text,
    counterfactual_delivery_at       timestamptz,
    valid_until                      timestamptz NOT NULL,
    expired_at                       timestamptz,
    created_at                       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (candidate_id, policy_version, decision_ready_at),
    CONSTRAINT cdt_delivery_eligibility_exact
        CHECK (delivery_eligible_at = GREATEST(decision_ready_at, policy_decided_at)),
    CONSTRAINT cdt_monotonic
        CHECK (decision_ready_at <= policy_decided_at
            AND policy_decided_at <= workflow_completed_at
            AND delivery_eligible_at <= workflow_completed_at
            AND (delivered_at IS NULL OR delivery_eligible_at <= delivered_at)
            AND (counterfactual_delivery_at IS NULL
                OR delivery_eligible_at <= counterfactual_delivery_at)),
    CONSTRAINT cdt_delivery_symmetry
        CHECK ((delivered_at IS NOT NULL
                AND counterfactual_delivery_at IS NULL
                AND counterfactual_delivery_version IS NULL)
            OR (delivered_at IS NULL
                AND counterfactual_delivery_at IS NOT NULL
                AND counterfactual_delivery_version IS NOT NULL)),
    CONSTRAINT cdt_action_within_validity
        CHECK (valid_until >= COALESCE(delivered_at, counterfactual_delivery_at)),
    CONSTRAINT cdt_expiration_order
        CHECK (expired_at IS NULL OR expired_at >= valid_until)
);

CREATE FUNCTION foresift_refuse_candidate_timeline_mutation() RETURNS trigger AS $fn$
BEGIN
    RAISE EXCEPTION 'candidate decision timelines are append-only'
        USING ERRCODE = 'restrict_violation';
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER candidate_decision_timelines_append_only
    BEFORE UPDATE OR DELETE ON candidate_decision_timelines
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_candidate_timeline_mutation();

CREATE TRIGGER candidate_decision_timelines_append_only_truncate
    BEFORE TRUNCATE ON candidate_decision_timelines
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_candidate_timeline_mutation();

-- ADR-1 is intentionally fail-closed: migration never guesses how a stored
-- retired member should map because TIMED_OUT/INVALID_RESPONSE also require a
-- failure_kind that the old row did not carry independently.
DO $guard$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM evidence_acquisition_decisions
        WHERE state IN ('CAPABILITY_UNAVAILABLE', 'TIMED_OUT', 'INVALID_RESPONSE')
    ) THEN
        RAISE EXCEPTION
            'retired acquisition state present; reconcile rows explicitly before G1 migration'
            USING ERRCODE = 'check_violation';
    END IF;
END;
$guard$ LANGUAGE plpgsql;

ALTER TABLE evidence_acquisition_decisions
    DROP CONSTRAINT evidence_acquisition_decisions_state_check,
    ADD COLUMN candidate_state_at_request text,
    ADD COLUMN requested_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
    ADD COLUMN expected_value_of_information double precision,
    ADD COLUMN estimated_cost numeric,
    ADD COLUMN actual_cost numeric,
    ADD COLUMN failure_kind text,
    ADD COLUMN acquisition_seed text,
    ADD CONSTRAINT evidence_acquisition_decisions_state_check CHECK (state IN (
        'NOT_REQUESTED_BY_POLICY',
        'REQUESTED',
        'COST_BLOCKED',
        'QUOTA_BLOCKED',
        'RIGHTS_BLOCKED',
        'UNSUPPORTED',
        'PROVIDER_UNAVAILABLE',
        'FAILED',
        'RETURNED_EMPTY',
        'RETURNED')),
    ADD CONSTRAINT acquisition_expected_value_bounds
        CHECK (expected_value_of_information IS NULL
            OR expected_value_of_information BETWEEN 0 AND 1),
    ADD CONSTRAINT acquisition_estimated_cost_nonnegative
        CHECK (estimated_cost IS NULL OR estimated_cost >= 0),
    ADD CONSTRAINT acquisition_actual_cost_nonnegative
        CHECK (actual_cost IS NULL OR actual_cost >= 0),
    ADD CONSTRAINT acquisition_failure_kind_valid
        CHECK ((state = 'FAILED' AND failure_kind IN ('TIMED_OUT', 'INVALID_RESPONSE'))
            OR (state <> 'FAILED' AND failure_kind IS NULL)),
    ADD CONSTRAINT acquisition_seed_is_provenance
        CHECK (acquisition_seed IS NULL OR acquisition_seed NOT LIKE 'raw:%');
