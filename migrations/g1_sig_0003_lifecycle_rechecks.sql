-- g1_sig_0003_lifecycle_rechecks.sql
-- Risk-separated lifecycle transitions and finite adaptive-recheck allocation.

CREATE TABLE sig.candidate_lifecycle (
    transition_id                    text PRIMARY KEY,
    candidate_id                     text NOT NULL,
    profile_version                  text NOT NULL,
    from_state                       text CHECK (from_state IN (
                                         'DISCOVERED', 'QUALIFIED', 'EMERGING', 'CONFIRMED',
                                         'MONITORING', 'DECAYING', 'REJECTED', 'ARCHIVED')),
    to_state                         text NOT NULL CHECK (to_state IN (
                                         'DISCOVERED', 'QUALIFIED', 'EMERGING', 'CONFIRMED',
                                         'MONITORING', 'DECAYING', 'REJECTED', 'ARCHIVED')),
    reason                           text NOT NULL CHECK (length(reason) > 0),
    persistence_measure              double precision,
    dwell_since_prior_transition     interval CHECK (
                                         dwell_since_prior_transition IS NULL
                                         OR dwell_since_prior_transition >= interval '0 seconds'),
    policy_version                   text NOT NULL CHECK (length(policy_version) > 0),
    tradability_verdict              text CHECK (tradability_verdict IN (
                                         'TRADABLE',
                                         'UNCERTAINTY_BLOCKED',
                                         'TARGET_NOT_EXECUTABLE',
                                         'STATE_INCOMPLETE',
                                         'EXECUTION_UNAVAILABLE',
                                         'POOL_MATH_UNSUPPORTED',
                                         'INSUFFICIENT_DATA')),
    diagnostic_signal_labels         text[] NOT NULL DEFAULT ARRAY[]::text[],
    thesis_invalidation_conditions   jsonb CHECK (
                                         thesis_invalidation_conditions IS NULL
                                         OR jsonb_typeof(thesis_invalidation_conditions) = 'array'),
    transitioned_at                  timestamptz NOT NULL,
    created_at                       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT sig_lifecycle_state_change CHECK (from_state IS DISTINCT FROM to_state),
    CONSTRAINT sig_confirmed_requires_tradability CHECK (
        to_state <> 'CONFIRMED' OR tradability_verdict = 'TRADABLE')
);

CREATE TABLE sig.recheck_budgets (
    candidate_id                     text NOT NULL,
    profile_version                  text NOT NULL,
    max_rechecks                     integer NOT NULL CHECK (max_rechecks >= 0),
    max_recheck_provider_calls       integer NOT NULL CHECK (max_recheck_provider_calls >= 0),
    max_recheck_model_cost           double precision NOT NULL CHECK (max_recheck_model_cost >= 0),
    backoff_factor                   double precision NOT NULL CHECK (backoff_factor > 1),
    minimum_expected_information_gain double precision NOT NULL CHECK (
                                         minimum_expected_information_gain >= 0),
    next_check_at                    timestamptz NOT NULL,
    expires_at                       timestamptz NOT NULL,
    rechecks_used                    integer NOT NULL DEFAULT 0 CHECK (
                                         rechecks_used >= 0 AND rechecks_used <= max_rechecks),
    provider_calls_used              integer NOT NULL DEFAULT 0 CHECK (
                                         provider_calls_used >= 0
                                         AND provider_calls_used <= max_recheck_provider_calls),
    model_cost_used                  double precision NOT NULL DEFAULT 0 CHECK (
                                         model_cost_used >= 0
                                         AND model_cost_used <= max_recheck_model_cost),
    starved_since                    timestamptz,
    created_at                       timestamptz NOT NULL DEFAULT now(),
    updated_at                       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (candidate_id, profile_version),
    CONSTRAINT sig_recheck_budget_order CHECK (expires_at > next_check_at)
);

CREATE TABLE sig.recheck_decisions (
    decision_id                      text PRIMARY KEY,
    candidate_id                     text NOT NULL,
    profile_version                  text NOT NULL,
    decided_at                       timestamptz NOT NULL,
    decision                         text NOT NULL CHECK (decision IN (
                                         'RECHECK_NOW',
                                         'DEFER_BACKOFF',
                                         'STARVED_SKIP',
                                         'EXPIRED_STOP',
                                         'BUDGET_EXHAUSTED_STOP',
                                         'INFO_VALUE_BELOW_FLOOR_SKIP')),
    expected_decision_impact         double precision,
    boundary_proximity               double precision,
    expected_state_change            double precision,
    information_gap                  double precision,
    risk_urgency                     double precision,
    candidate_utility                double precision,
    quota_cost                       double precision CHECK (quota_cost IS NULL OR quota_cost >= 0),
    information_value                double precision,
    provider_calls_costed            integer NOT NULL DEFAULT 0 CHECK (provider_calls_costed >= 0),
    model_cost_costed                double precision NOT NULL DEFAULT 0 CHECK (model_cost_costed >= 0),
    protected_reserve_class          text CHECK (protected_reserve_class IN (
                                         'RISK_MONITORING',
                                         'ALERT_VERIFICATION',
                                         'INTERACTIVE_MCP',
                                         'EMERGENCY_BACKFILL',
                                         'OUTCOME_COLLECTION',
                                         'SCHEDULED_CANDIDATE_VERIFICATION',
                                         'DEEP_RESEARCH',
                                         'FIRST_PARTY_COLLECTOR',
                                         'EXPLORATION_PROBES')),
    created_at                       timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (candidate_id, profile_version)
        REFERENCES sig.recheck_budgets(candidate_id, profile_version)
);

CREATE INDEX sig_lifecycle_candidate_idx
    ON sig.candidate_lifecycle (candidate_id, profile_version, transitioned_at);
CREATE INDEX sig_recheck_decisions_candidate_idx
    ON sig.recheck_decisions (candidate_id, profile_version, decided_at);

CREATE TRIGGER sig_candidate_lifecycle_immutable
    BEFORE UPDATE OR DELETE ON sig.candidate_lifecycle
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER sig_recheck_decisions_immutable
    BEFORE UPDATE OR DELETE ON sig.recheck_decisions
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
CREATE TRIGGER sig_recheck_decisions_immutable_truncate
    BEFORE TRUNCATE ON sig.recheck_decisions
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();
