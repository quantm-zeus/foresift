-- g0_cost_0001_cost_ledgers.sql
-- ROLLBACK (operator controlled): DROP SCHEMA cost CASCADE;
-- Atomic quota, protected-reserve and actual-usage ledgers (FR-COST-001…003).

CREATE SCHEMA IF NOT EXISTS cost;

CREATE TABLE cost.cost_quota_balances (
    provider_id             text        NOT NULL,
    quota_model_id          text        NOT NULL,
    period_window_start     timestamptz NOT NULL,
    period_window_end       timestamptz NOT NULL,
    cap_limit               numeric     NOT NULL CHECK (cap_limit >= 0),
    reset_policy_id         text        NOT NULL,
    verification_expires_at timestamptz NOT NULL,
    PRIMARY KEY (provider_id, quota_model_id, period_window_start),
    CHECK (period_window_end > period_window_start)
);

CREATE TABLE cost.cost_reserve_buckets (
    reserve_id          text        NOT NULL CHECK (reserve_id IN (
                          'RISK_MONITORING', 'ALERT_VERIFICATION',
                          'INTERACTIVE_MCP', 'EMERGENCY_BACKFILL')),
    provider_id         text        NOT NULL,
    period_window_start timestamptz NOT NULL,
    cap_limit           numeric     NOT NULL CHECK (cap_limit >= 0),
    consumed_units      numeric     NOT NULL DEFAULT 0 CHECK (consumed_units >= 0),
    PRIMARY KEY (reserve_id, provider_id, period_window_start),
    CHECK (consumed_units <= cap_limit)
);

CREATE TABLE cost.cost_usage_counters (
    provider_id          text        NOT NULL,
    quota_model_id       text        NOT NULL,
    period_window_start  timestamptz NOT NULL,
    workload_class       text        NOT NULL CHECK (workload_class IN (
                           'INTERACTIVE_HIGH', 'RISK_MONITOR_HIGH',
                           'SCHEDULED_NORMAL', 'EVALUATION_LOW', 'BACKFILL_LOW')),
    reserve_id           text,
    cap_limit            numeric     NOT NULL CHECK (cap_limit >= 0),
    consumed_reserved    numeric     NOT NULL DEFAULT 0 CHECK (consumed_reserved >= 0),
    consumed_committed   numeric     NOT NULL DEFAULT 0 CHECK (consumed_committed >= 0),
    remaining_units      numeric     NOT NULL,
    observed_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider_id, quota_model_id, period_window_start, workload_class),
    FOREIGN KEY (provider_id, quota_model_id, period_window_start)
      REFERENCES cost.cost_quota_balances(provider_id, quota_model_id, period_window_start),
    FOREIGN KEY (reserve_id, provider_id, period_window_start)
      REFERENCES cost.cost_reserve_buckets(reserve_id, provider_id, period_window_start),
    CHECK (remaining_units = cap_limit - consumed_reserved - consumed_committed),
    CHECK (remaining_units >= 0),
    -- Broad scan/evaluation/scheduled work is structurally unable to invade a reserve.
    CHECK (reserve_id IS NULL OR workload_class IN ('INTERACTIVE_HIGH', 'RISK_MONITOR_HIGH'))
);

CREATE INDEX cost_usage_observed_idx
  ON cost.cost_usage_counters(observed_at, provider_id, quota_model_id);
