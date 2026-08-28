-- g0_cost_0004_resource_forecast_snapshots.sql
-- ROLLBACK: DROP TABLE cost.capacity_replay_runs; DROP TABLE cost.resource_forecast_snapshots;
-- Verified capacity snapshots and deterministic replay outcomes (FR-COST-006/009).

CREATE SCHEMA IF NOT EXISTS cost;

CREATE TABLE cost.resource_forecast_snapshots (
    snapshot_id              text        PRIMARY KEY,
    plan_version_id          text        NOT NULL,
    verified_at              timestamptz NOT NULL,
    expires_at               timestamptz NOT NULL,
    plan_limits_json         jsonb       NOT NULL,
    observed_usage_json      jsonb       NOT NULL,
    estimated_forecast_json  jsonb       NOT NULL,
    CHECK (expires_at > verified_at),
    CHECK (jsonb_typeof(plan_limits_json) = 'object'),
    CHECK (jsonb_typeof(observed_usage_json) = 'object'),
    CHECK (jsonb_typeof(estimated_forecast_json) = 'object')
);

CREATE INDEX resource_forecast_snapshots_expiry_idx
  ON cost.resource_forecast_snapshots(expires_at, plan_version_id);

CREATE TABLE cost.capacity_replay_runs (
    replay_id     text        PRIMARY KEY,
    snapshot_id   text        NOT NULL REFERENCES cost.resource_forecast_snapshots(snapshot_id),
    mode          text        NOT NULL CHECK (mode IN ('expected', 'stress')),
    blocking_flag boolean     NOT NULL,
    incident_id   text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CHECK (blocking_flag OR incident_id IS NULL)
);
