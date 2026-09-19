-- g1_obj_0003_integrity_claims.sql
-- Objective-integrity incidents, eleven-field claim scopes, promotion
-- decisions, and output language screens (FR-OBJ-006, FR-OBJ-007, FR-OBJ-010).

CREATE TABLE IF NOT EXISTS integrity_incidents (
    incident_id        text PRIMARY KEY,
    run_id             text NOT NULL REFERENCES objective_runs(run_id),
    signal             text NOT NULL CHECK (signal IN (
                             'DENOMINATOR_GAMING', 'SELECTIVE_UNIVERSE_CHANGE',
                             'REDUCED_EXPLORATION', 'DELAYED_OUTCOME_OMISSION',
                             'HORIZON_SWITCHING', 'SCENARIO_CHERRY_PICKING',
                             'REPEATED_HOLDOUT_INSPECTION')),
    verdict            text NOT NULL CHECK (verdict IN ('PASS', 'FAIL_BLOCKS_PROMOTION')),
    reason             text,
    evidence_refs      text[] NOT NULL,
    recorded_at        timestamptz NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT integrity_incidents_verdict_reason CHECK (
        (verdict = 'FAIL_BLOCKS_PROMOTION'
         AND reason IS NOT NULL AND cardinality(evidence_refs) > 0)
        OR (verdict = 'PASS' AND reason IS NULL))
);

CREATE INDEX IF NOT EXISTS integrity_incidents_run_idx ON integrity_incidents (run_id, signal);

DROP TRIGGER IF EXISTS integrity_incidents_no_update ON integrity_incidents;
CREATE TRIGGER integrity_incidents_no_update
    BEFORE UPDATE OR DELETE ON integrity_incidents
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
DROP TRIGGER IF EXISTS integrity_incidents_no_truncate ON integrity_incidents;
CREATE TRIGGER integrity_incidents_no_truncate
    BEFORE TRUNCATE ON integrity_incidents
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();

CREATE TABLE IF NOT EXISTS claim_scope_records (
    scope_id                     text PRIMARY KEY,
    run_id                       text NOT NULL REFERENCES objective_runs(run_id),
    supported_population         text NOT NULL CHECK (length(supported_population) > 0),
    profile                      text NOT NULL CHECK (length(profile) > 0),
    policy                       text NOT NULL CHECK (length(policy) > 0),
    execution_scenario           text NOT NULL CHECK (length(execution_scenario) > 0),
    delay_distribution           text NOT NULL CHECK (length(delay_distribution) > 0),
    calendar_interval            text NOT NULL CHECK (length(calendar_interval) > 0),
    market_regimes               text[] NOT NULL CHECK (cardinality(market_regimes) > 0),
    capability_state             text NOT NULL CHECK (length(capability_state) > 0),
    sample_size                  integer NOT NULL CHECK (sample_size > 0),
    cluster_effective_sample_size numeric NOT NULL CHECK (
                                     cluster_effective_sample_size > 0),
    uncertainty_method           text NOT NULL CHECK (uncertainty_method IN (
                                     'CLUSTER_BOOTSTRAP', 'BLOCK_BOOTSTRAP_CALENDAR',
                                     'BLOCK_BOOTSTRAP_REGIME',
                                     'RANDOMIZATION_INFERENCE')),
    created_at                   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT claim_scope_records_ess_bounded CHECK (
        cluster_effective_sample_size <= sample_size)
);

CREATE INDEX IF NOT EXISTS claim_scope_records_run_idx ON claim_scope_records (run_id);

DROP TRIGGER IF EXISTS claim_scope_records_no_update ON claim_scope_records;
CREATE TRIGGER claim_scope_records_no_update
    BEFORE UPDATE OR DELETE ON claim_scope_records
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
DROP TRIGGER IF EXISTS claim_scope_records_no_truncate ON claim_scope_records;
CREATE TRIGGER claim_scope_records_no_truncate
    BEFORE TRUNCATE ON claim_scope_records
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();

CREATE TABLE IF NOT EXISTS promotion_decisions (
    decision_id      text PRIMARY KEY,
    run_id           text NOT NULL REFERENCES objective_runs(run_id),
    verdict          text NOT NULL CHECK (verdict IN (
                         'PROMOTE', 'HOLD_EXPLORATORY_ONLY', 'BLOCK')),
    gate_trail       jsonb NOT NULL DEFAULT '[]'::jsonb
                         CHECK (jsonb_typeof(gate_trail) = 'array'
                                AND jsonb_array_length(gate_trail) > 0),
    decided_at       timestamptz NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS promotion_decisions_run_idx ON promotion_decisions (run_id, verdict);

DROP TRIGGER IF EXISTS promotion_decisions_no_update ON promotion_decisions;
CREATE TRIGGER promotion_decisions_no_update
    BEFORE UPDATE OR DELETE ON promotion_decisions
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
DROP TRIGGER IF EXISTS promotion_decisions_no_truncate ON promotion_decisions;
CREATE TRIGGER promotion_decisions_no_truncate
    BEFORE TRUNCATE ON promotion_decisions
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();

CREATE TABLE IF NOT EXISTS output_language_screens (
    screen_id                text PRIMARY KEY,
    output_id                text NOT NULL CHECK (length(output_id) > 0),
    prohibited_claims_found  text[] NOT NULL CHECK (
                                 prohibited_claims_found <@ ARRAY[
                                     'GUARANTEED_PROFIT', 'ASSURED_RETURN',
                                     'RISK_FREE_PROFIT', 'CERTAIN_GAIN']::text[]),
    disclosure               text NOT NULL CHECK (
                                 disclosure LIKE '%evidence-backed research signals%'
                                 AND disclosure LIKE '%realized outcome remains uncertain%'),
    screen_passed             boolean NOT NULL,
    screened_at              timestamptz NOT NULL,
    created_at               timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT output_language_screens_pass_clean CHECK (
        screen_passed = false OR cardinality(prohibited_claims_found) = 0)
);

CREATE INDEX IF NOT EXISTS output_language_screens_output_idx ON output_language_screens (output_id);

DROP TRIGGER IF EXISTS output_language_screens_no_update ON output_language_screens;
CREATE TRIGGER output_language_screens_no_update
    BEFORE UPDATE OR DELETE ON output_language_screens
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
DROP TRIGGER IF EXISTS output_language_screens_no_truncate ON output_language_screens;
CREATE TRIGGER output_language_screens_no_truncate
    BEFORE TRUNCATE ON output_language_screens
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();
