-- g1_mat_0002_promotion_evidence.sql
-- Exact, mature execution evidence required for production promotion
-- (FR-MAT-008/009/011/012).

CREATE TABLE IF NOT EXISTS promotion_evidence_records (
    promotion_evidence_id          text PRIMARY KEY,
    candidate_id                   text NOT NULL CHECK (length(candidate_id) > 0),
    outcome_profile_id             text NOT NULL CHECK (length(outcome_profile_id) > 0),
    outcome_profile_version        text NOT NULL CHECK (length(outcome_profile_version) > 0),
    scenario_id                    text NOT NULL CHECK (length(scenario_id) > 0),
    scenario_version               text NOT NULL CHECK (length(scenario_version) > 0),
    outcome_label                  text NOT NULL CHECK (outcome_label IN (
                                        'SIGNAL_SUCCESS', 'SIGNAL_FAILURE',
                                        'TRADABLE_SUCCESS', 'TRADABLE_FAILURE',
                                        'NEUTRAL', 'PENDING', 'CENSORED', 'INVALID_DATA')),
    outcome_maturity               text NOT NULL CHECK (outcome_maturity IN (
                                        'PENDING', 'PARTIALLY_MATURED', 'FULLY_MATURED',
                                        'CENSORED', 'INVALID_DATA')),
    evidence_resolution            text NOT NULL CHECK (evidence_resolution IN (
                                        'COARSE_SIGNAL', 'HIGH_RESOLUTION_EXECUTION',
                                        'EXACT_CONFIGURATION_EXECUTION')),
    required_notional              text NOT NULL CHECK (
                                        required_notional ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    required_delay_policy_id       text NOT NULL CHECK (length(required_delay_policy_id) > 0),
    required_adapter_version       text NOT NULL CHECK (length(required_adapter_version) > 0),
    required_route_id              text NOT NULL CHECK (length(required_route_id) > 0),
    required_exit_policy_id        text NOT NULL CHECK (length(required_exit_policy_id) > 0),
    exact_configuration_match      boolean NOT NULL,
    production_promotion_eligible  boolean NOT NULL,
    primary_ordering               text NOT NULL CHECK (primary_ordering IN (
                                        'ADVERSE_FEASIBLE', 'UNAMBIGUOUS')),
    path_ambiguous                 boolean NOT NULL,
    optimistic_sensitivity         jsonb CHECK (
                                        optimistic_sensitivity IS NULL OR
                                        jsonb_typeof(optimistic_sensitivity) = 'object'),
    expiry_side_effect             text CHECK (expiry_side_effect IN (
                                        'ALERT_EXPIRED', 'ALERT_CANCELLED', 'THESIS_INVALIDATED')),
    expiry_side_effect_at          timestamptz,
    gain_observed_at               timestamptz,
    post_expiry_gain_excluded      boolean NOT NULL DEFAULT false,
    capacity_limited               boolean NOT NULL DEFAULT false,
    maximum_executable_notional    text CHECK (
                                        maximum_executable_notional IS NULL OR
                                        maximum_executable_notional ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    total_deployable_portfolio_capacity text CHECK (
                                        total_deployable_portfolio_capacity IS NULL OR
                                        total_deployable_portfolio_capacity ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
    larger_capital_simulation_ref  text,
    evidence_refs                  jsonb NOT NULL CHECK (jsonb_typeof(evidence_refs) = 'array'),
    recorded_at                    timestamptz NOT NULL,
    created_at                     timestamptz NOT NULL DEFAULT now(),
    -- A coarse signal can be retained as evidence but can never authorize
    -- promotion. Promotion is bound to fully matured exact execution.
    CONSTRAINT promotion_requires_exact_mature_execution CHECK (
        NOT production_promotion_eligible OR (
            outcome_label = 'TRADABLE_SUCCESS'
            AND outcome_maturity = 'FULLY_MATURED'
            AND evidence_resolution IN (
                'HIGH_RESOLUTION_EXECUTION', 'EXACT_CONFIGURATION_EXECUTION')
            AND exact_configuration_match)),
    CONSTRAINT coarse_signal_cannot_promote CHECK (
        evidence_resolution <> 'COARSE_SIGNAL' OR NOT production_promotion_eligible),
    CONSTRAINT ambiguous_path_uses_adverse_primary CHECK (
        NOT path_ambiguous OR primary_ordering = 'ADVERSE_FEASIBLE'),
    CONSTRAINT optimistic_requires_adverse_primary CHECK (
        optimistic_sensitivity IS NULL OR
        (path_ambiguous AND primary_ordering = 'ADVERSE_FEASIBLE')),
    CONSTRAINT expiry_side_effect_timestamped CHECK (
        (expiry_side_effect IS NULL) = (expiry_side_effect_at IS NULL)),
    CONSTRAINT post_expiry_gain_exclusion CHECK (
        gain_observed_at IS NULL OR expiry_side_effect_at IS NULL OR
        gain_observed_at <= expiry_side_effect_at OR post_expiry_gain_excluded),
    CONSTRAINT capacity_disclosure_pair CHECK (
        (maximum_executable_notional IS NULL) =
        (total_deployable_portfolio_capacity IS NULL)),
    CONSTRAINT capacity_limited_disclosed CHECK (
        NOT capacity_limited OR maximum_executable_notional IS NOT NULL),
    CONSTRAINT larger_capital_requires_simulation CHECK (
        larger_capital_simulation_ref IS NULL OR
        (maximum_executable_notional IS NOT NULL AND
         length(larger_capital_simulation_ref) > 0))
);

CREATE INDEX IF NOT EXISTS promotion_evidence_candidate_idx ON promotion_evidence_records
    (candidate_id, outcome_profile_id, outcome_profile_version);

DROP TRIGGER IF EXISTS promotion_evidence_records_no_update ON promotion_evidence_records;
CREATE TRIGGER promotion_evidence_records_no_update
    BEFORE UPDATE OR DELETE ON promotion_evidence_records
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
