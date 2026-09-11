-- g1_obj_0001_objective_runs.sql
-- Frozen objective runs with eight comparability dimensions and append-only
-- semantics (FR-OBJ-001, FR-OBJ-002). Corrections are new runs, never edits.

CREATE OR REPLACE FUNCTION foresift_refuse_objective_mutation() RETURNS trigger AS $fn$
BEGIN
    RAISE EXCEPTION 'frozen objective records are immutable: corrections are new runs'
        USING ERRCODE = 'restrict_violation';
END;
$fn$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS objective_runs (
    run_id                       text PRIMARY KEY,
    config_content_hash          text NOT NULL CHECK (
                                     config_content_hash ~ '^sha256:[0-9a-f]{64}$'),
    candidate_universe_id        text NOT NULL CHECK (length(candidate_universe_id) > 0),
    candidate_universe_hash      text NOT NULL CHECK (
                                     candidate_universe_hash ~ '^sha256:[0-9a-f]{64}$'),
    population_claim_id          text NOT NULL CHECK (length(population_claim_id) > 0),
    capital_micros               bigint NOT NULL CHECK (capital_micros > 0),
    window_start                 timestamptz NOT NULL,
    window_end                   timestamptz NOT NULL,
    execution_scenario_id        text NOT NULL CHECK (length(execution_scenario_id) > 0),
    execution_scenario_version   text NOT NULL CHECK (length(execution_scenario_version) > 0),
    delay_policy_id              text NOT NULL CHECK (length(delay_policy_id) > 0),
    delay_policy_version         text NOT NULL CHECK (length(delay_policy_version) > 0),
    data_cutoff                  timestamptz NOT NULL,
    correlated_exposure_constraints text[] NOT NULL DEFAULT '{}'::text[],
    comparability                text NOT NULL CHECK (comparability IN (
                                     'COMPARABLE', 'EXPLORATORY_ONLY')),
    exploratory_reason           text,
    schema_registry_version      integer NOT NULL CHECK (schema_registry_version = 1),
    created_at                   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT objective_runs_window_ordered CHECK (window_end > window_start),
    CONSTRAINT objective_runs_exploratory_reason CHECK (
        (comparability = 'EXPLORATORY_ONLY' AND exploratory_reason IS NOT NULL)
        OR (comparability = 'COMPARABLE' AND exploratory_reason IS NULL))
);

CREATE INDEX IF NOT EXISTS objective_runs_universe_idx ON objective_runs
    (candidate_universe_id, comparability);

DROP TRIGGER IF EXISTS objective_runs_no_update ON objective_runs;
CREATE TRIGGER objective_runs_no_update
    BEFORE UPDATE OR DELETE ON objective_runs
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_objective_mutation();
DROP TRIGGER IF EXISTS objective_runs_no_truncate ON objective_runs;
CREATE TRIGGER objective_runs_no_truncate
    BEFORE TRUNCATE ON objective_runs
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_objective_mutation();
