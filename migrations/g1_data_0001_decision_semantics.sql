-- g1_data_0001_decision_semantics.sql
-- Honest retrospective provenance (FR-DATA-007) and the candidate decision
-- timeline used by delivered and non-delivered evaluation arms (FR-DATA-009).

ALTER TABLE backfill_receipts
    ADD COLUMN retrieved_as_backfill boolean NOT NULL DEFAULT true,
    ADD COLUMN original_event_coordinates jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN fetched_at timestamptz,
    ADD COLUMN earliest_available_at timestamptz,
    ADD COLUMN earlier_unavailability_reason text;

-- The G0 names are retained as compatibility aliases.  New writes populate
-- both pairs; these constraints make disagreement impossible.
UPDATE backfill_receipts
   SET fetched_at = retrieved_at,
       earliest_available_at = available_at,
       earlier_unavailability_reason = backfill_reason;

ALTER TABLE backfill_receipts
    ALTER COLUMN fetched_at SET NOT NULL,
    ALTER COLUMN earliest_available_at SET NOT NULL,
    ALTER COLUMN earlier_unavailability_reason SET NOT NULL,
    ADD CONSTRAINT backfill_is_retrieved_as_backfill CHECK (retrieved_as_backfill),
    ADD CONSTRAINT backfill_fetched_alias_exact CHECK (fetched_at = retrieved_at),
    ADD CONSTRAINT backfill_available_alias_exact CHECK (earliest_available_at = available_at),
    ADD CONSTRAINT backfill_coordinates_are_object
      CHECK (jsonb_typeof(original_event_coordinates) = 'object'),
    ADD CONSTRAINT backfill_reason_nonempty CHECK (length(earlier_unavailability_reason) > 0),
    ADD CONSTRAINT backfill_event_cannot_supply_availability
      CHECK (earliest_available_at >= historical_event_at),
    ADD CONSTRAINT backfill_no_early_availability_without_live_proof
      CHECK (availability_proof_method = 'LIVE_RECEIPT_REFERENCE'
             OR earliest_available_at >= fetched_at);

CREATE TABLE candidate_decision_timelines (
    decision_id                       text PRIMARY KEY,
    candidate_id                      text NOT NULL,
    decision_ready_at                 timestamptz NOT NULL,
    policy_decided_at                 timestamptz NOT NULL,
    workflow_completed_at             timestamptz NOT NULL,
    delivery_eligible_at              timestamptz NOT NULL,
    delivered_at                      timestamptz,
    counterfactual_delivery_at        timestamptz,
    counterfactual_delivery_version   text,
    comparison_entry_at               timestamptz,
    created_at                        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT decision_timeline_monotonic CHECK (
      decision_ready_at <= policy_decided_at
      AND policy_decided_at <= workflow_completed_at
      AND workflow_completed_at <= delivery_eligible_at
      AND (delivered_at IS NULL OR delivery_eligible_at <= delivered_at)
    ),
    CONSTRAINT decision_timeline_arm_shape CHECK (
      (delivered_at IS NOT NULL
       AND counterfactual_delivery_at IS NULL
       AND counterfactual_delivery_version IS NULL
       AND comparison_entry_at IS NULL)
      OR
      (delivered_at IS NULL
       AND counterfactual_delivery_at IS NOT NULL
       AND counterfactual_delivery_version IS NOT NULL
       AND length(counterfactual_delivery_version) > 0
       AND comparison_entry_at IS NOT NULL)
    ),
    CONSTRAINT decision_timeline_counterfactual_not_before_eligible CHECK (
      counterfactual_delivery_at IS NULL
      OR counterfactual_delivery_at >= delivery_eligible_at
    ),
    CONSTRAINT decision_timeline_entry_not_before_counterfactual CHECK (
      counterfactual_delivery_at IS NULL
      OR comparison_entry_at >= counterfactual_delivery_at
    )
);

CREATE INDEX candidate_decision_timelines_candidate_idx
    ON candidate_decision_timelines (candidate_id, decision_ready_at);

CREATE TRIGGER candidate_decision_timelines_immutable
    BEFORE UPDATE OR DELETE ON candidate_decision_timelines
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();

CREATE TRIGGER candidate_decision_timelines_immutable_truncate
    BEFORE TRUNCATE ON candidate_decision_timelines
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();
