-- g0_cost_0001_cost_ledgers.sql
-- Apply and rollback as one transaction. Rollback: DROP SCHEMA cost CASCADE.
-- Cost quota balances, protected reserves, and reservation accounting (FR-COST-001…003).
CREATE SCHEMA IF NOT EXISTS cost;

CREATE TABLE cost.cost_quota_balances (
  provider_id text NOT NULL,
  quota_model_id text NOT NULL CHECK (quota_model_id IN (
    'RATE_ONLY','REQUESTS_PER_PERIOD','COMPUTE_UNITS_PER_PERIOD',
    'WEIGHTED_BUCKET','CREDIT_BALANCE','UNKNOWN_CONFIGURABLE')),
  period_window_start timestamptz NOT NULL,
  period_reset_at timestamptz NOT NULL,
  cap_limit numeric NOT NULL CHECK (cap_limit >= 0),
  consumed_reserved numeric NOT NULL DEFAULT 0 CHECK (consumed_reserved >= 0),
  consumed_committed numeric NOT NULL DEFAULT 0 CHECK (consumed_committed >= 0),
  remaining_units numeric GENERATED ALWAYS AS
    (cap_limit - consumed_reserved - consumed_committed) STORED,
  PRIMARY KEY (provider_id, quota_model_id, period_window_start),
  CHECK (period_reset_at > period_window_start),
  CHECK (cap_limit - consumed_reserved - consumed_committed >= 0)
);

CREATE TABLE cost.cost_reserve_buckets (
  reserve_id text NOT NULL CHECK (reserve_id IN (
    'RISK_MONITORING','ALERT_VERIFICATION','INTERACTIVE_MCP','EMERGENCY_BACKFILL')),
  provider_id text NOT NULL,
  quota_model_id text NOT NULL,
  period_window_start timestamptz NOT NULL,
  period_reset_at timestamptz NOT NULL,
  cap_limit numeric NOT NULL CHECK (cap_limit >= 0),
  consumed_reserved numeric NOT NULL DEFAULT 0 CHECK (consumed_reserved >= 0),
  consumed_committed numeric NOT NULL DEFAULT 0 CHECK (consumed_committed >= 0),
  remaining_units numeric GENERATED ALWAYS AS
    (cap_limit - consumed_reserved - consumed_committed) STORED,
  PRIMARY KEY (reserve_id, provider_id, period_window_start),
  UNIQUE (reserve_id, provider_id, quota_model_id, period_window_start),
  FOREIGN KEY (provider_id, quota_model_id, period_window_start)
    REFERENCES cost.cost_quota_balances(provider_id, quota_model_id, period_window_start),
  CHECK (period_reset_at > period_window_start),
  CHECK (cap_limit - consumed_reserved - consumed_committed >= 0)
);

CREATE TABLE cost.cost_usage_counters (
  reservation_id text PRIMARY KEY REFERENCES core.core_quota_reservations(reservation_id),
  provider_id text NOT NULL,
  quota_model_id text NOT NULL,
  period_window_start timestamptz NOT NULL,
  reserve_id text,
  workload_class text NOT NULL CHECK (workload_class IN (
    'INTERACTIVE_HIGH','RISK_MONITOR_HIGH','SCHEDULED_NORMAL','EVALUATION_LOW','BACKFILL_LOW')),
  reserved_units numeric NOT NULL CHECK (reserved_units >= 0),
  committed_units numeric CHECK (committed_units IS NULL OR committed_units >= 0),
  state text NOT NULL CHECK (state IN ('RESERVED','COMMITTED','RELEASED','EXPIRED')),
  observed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (provider_id, quota_model_id, period_window_start)
    REFERENCES cost.cost_quota_balances(provider_id, quota_model_id, period_window_start),
  FOREIGN KEY (reserve_id, provider_id, quota_model_id, period_window_start)
    REFERENCES cost.cost_reserve_buckets(reserve_id, provider_id, quota_model_id, period_window_start),
  CONSTRAINT cost_no_reserve_invasion CHECK (
    reserve_id IS NULL OR
    (reserve_id = 'INTERACTIVE_MCP' AND workload_class = 'INTERACTIVE_HIGH') OR
    (reserve_id IN ('RISK_MONITORING','ALERT_VERIFICATION','EMERGENCY_BACKFILL')
      AND workload_class = 'RISK_MONITOR_HIGH'))
);
CREATE INDEX cost_usage_counters_period_idx
  ON cost.cost_usage_counters(provider_id, quota_model_id, period_window_start);
