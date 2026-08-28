-- g0_cost_0004_resource_forecast_snapshots.sql
-- Verified-plan snapshots and deterministic capacity replay records
-- (FR-COST-006/009). Rollback: drop the replay table, then snapshots.

CREATE TABLE cost.resource_forecast_snapshots (
    snapshot_id             text PRIMARY KEY,
    plan_version_id         text NOT NULL CHECK (length(plan_version_id) > 0),
    verified_at             timestamptz NOT NULL,
    expires_at              timestamptz NOT NULL,
    plan_limits_json        jsonb NOT NULL,
    observed_usage_json     jsonb NOT NULL,
    estimated_forecast_json jsonb NOT NULL,
    CHECK (expires_at > verified_at),
    CHECK (jsonb_typeof(plan_limits_json) = 'object'),
    CHECK (jsonb_typeof(observed_usage_json) = 'object'),
    CHECK (jsonb_typeof(estimated_forecast_json) = 'object')
);

CREATE INDEX resource_forecast_snapshots_expiry_idx
    ON cost.resource_forecast_snapshots (expires_at, plan_version_id);

CREATE TABLE cost.capacity_replay_runs (
    replay_id     text PRIMARY KEY,
    snapshot_id   text NOT NULL REFERENCES cost.resource_forecast_snapshots(snapshot_id),
    mode          text NOT NULL CHECK (mode IN ('expected', 'stress')),
    blocking_flag boolean NOT NULL,
    incident_id   text,
    replayed_at   timestamptz NOT NULL DEFAULT now(),
    result_json   jsonb NOT NULL DEFAULT '{}'::jsonb,
    CHECK (NOT blocking_flag OR incident_id IS NOT NULL)
);

CREATE INDEX capacity_replay_runs_snapshot_idx
    ON cost.capacity_replay_runs (snapshot_id, mode);
