-- g0_cost_0004_resource_forecast_snapshots.sql
-- Apply and rollback as one transaction. Rollback: DROP the replay and snapshot tables.
CREATE SCHEMA IF NOT EXISTS cost;
CREATE TABLE cost.resource_forecast_snapshots (
  snapshot_id text PRIMARY KEY,
  plan_version_id text NOT NULL,
  verified_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > verified_at),
  plan_limits_json jsonb NOT NULL,
  observed_usage_json jsonb NOT NULL,
  estimated_forecast_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX resource_forecast_snapshots_expiry_idx
  ON cost.resource_forecast_snapshots(expires_at);
CREATE TABLE cost.capacity_replay_runs (
  replay_id text PRIMARY KEY,
  snapshot_id text NOT NULL REFERENCES cost.resource_forecast_snapshots(snapshot_id),
  mode text NOT NULL CHECK (mode IN ('expected','stress')),
  blocking_flag boolean NOT NULL,
  incident_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX capacity_replay_runs_snapshot_idx ON cost.capacity_replay_runs(snapshot_id);
