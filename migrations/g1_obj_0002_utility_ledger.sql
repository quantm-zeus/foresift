-- g1_obj_0002_utility_ledger.sql
-- Per-capital-day net utility with twelve integer micro-unit decomposition
-- lines plus a reconciliation CHECK (FR-OBJ-001, FR-OBJ-004; ADR-OBJ-01).

CREATE TABLE IF NOT EXISTS capital_day_utility (
    run_id                           text NOT NULL REFERENCES objective_runs(run_id),
    capital_day                      date NOT NULL,
    gross_return_micros              bigint NOT NULL,
    execution_costs_micros           bigint NOT NULL,
    failed_partial_fills_micros      bigint NOT NULL,
    drawdown_micros                  bigint NOT NULL,
    cvar_micros                      bigint NOT NULL,
    capital_utilization_micros       bigint NOT NULL,
    turnover_micros                  bigint NOT NULL,
    opportunity_cost_micros          bigint NOT NULL,
    concentration_micros             bigint NOT NULL,
    shared_liquidity_impact_micros   bigint NOT NULL,
    provider_model_infra_cost_micros bigint NOT NULL,
    uncertainty_micros               bigint NOT NULL,
    daily_net_micros                 bigint NOT NULL,
    consumed_ess_reference           text NOT NULL CHECK (
                                         length(consumed_ess_reference) > 0),
    lower_bound_utility_micros       bigint NOT NULL,
    schema_registry_version          integer NOT NULL CHECK (schema_registry_version = 1),
    created_at                       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT capital_day_utility_pkey PRIMARY KEY (run_id, capital_day),
    CONSTRAINT capital_day_utility_reconciles CHECK (
        gross_return_micros + execution_costs_micros
        + failed_partial_fills_micros + drawdown_micros + cvar_micros
        + capital_utilization_micros + turnover_micros + opportunity_cost_micros
        + concentration_micros + shared_liquidity_impact_micros
        + provider_model_infra_cost_micros + uncertainty_micros
        = daily_net_micros)
);

CREATE INDEX IF NOT EXISTS capital_day_utility_run_idx ON capital_day_utility (run_id);

DROP TRIGGER IF EXISTS capital_day_utility_no_update ON capital_day_utility;
CREATE TRIGGER capital_day_utility_no_update
    BEFORE UPDATE OR DELETE ON capital_day_utility
    FOR EACH ROW EXECUTE FUNCTION foresift_refuse_mutation();
DROP TRIGGER IF EXISTS capital_day_utility_no_truncate ON capital_day_utility;
CREATE TRIGGER capital_day_utility_no_truncate
    BEFORE TRUNCATE ON capital_day_utility
    FOR EACH STATEMENT EXECUTE FUNCTION foresift_refuse_mutation();
