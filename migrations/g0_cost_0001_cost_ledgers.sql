-- g0_cost_0001_cost_ledgers.sql
-- Free-quota balances, protected reserve buckets, and observed usage actuals
-- (FR-COST-001…003). Applied atomically by the migration runner.
-- Rollback (before dependent migrations): DROP SCHEMA cost CASCADE;

CREATE SCHEMA IF NOT EXISTS cost;

CREATE TABLE cost.cost_quota_balances (
    provider_id        text NOT NULL CHECK (length(provider_id) > 0),
    quota_model_id     text NOT NULL CHECK (length(quota_model_id) > 0),
    period_window_start timestamptz NOT NULL,
    period_window_end   timestamptz NOT NULL,
    cap_limit           numeric NOT NULL CHECK (cap_limit >= 0),
    consumed_reserved  numeric NOT NULL DEFAULT 0 CHECK (consumed_reserved >= 0),
    consumed_committed numeric NOT NULL DEFAULT 0 CHECK (consumed_committed >= 0),
    remaining_units    numeric GENERATED ALWAYS AS
                         (cap_limit - consumed_reserved - consumed_committed) STORED,
    PRIMARY KEY (provider_id, quota_model_id, period_window_start),
    CHECK (period_window_end > period_window_start),
    CHECK (cap_limit - consumed_reserved - consumed_committed >= 0)
);

CREATE TABLE cost.cost_reserve_buckets (
    reserve_id          text NOT NULL CHECK (reserve_id IN (
                          'RISK_MONITORING', 'ALERT_VERIFICATION',
                          'INTERACTIVE_MCP', 'EMERGENCY_BACKFILL')),
    provider_id         text NOT NULL CHECK (length(provider_id) > 0),
    period_window_start timestamptz NOT NULL,
    cap_limit           numeric NOT NULL CHECK (cap_limit >= 0),
    consumed_units      numeric NOT NULL DEFAULT 0 CHECK (consumed_units >= 0),
    remaining_units     numeric GENERATED ALWAYS AS (cap_limit - consumed_units) STORED,
    PRIMARY KEY (reserve_id, provider_id, period_window_start),
    CHECK (cap_limit - consumed_units >= 0)
);

CREATE TABLE cost.cost_usage_counters (
    provider_id         text NOT NULL,
    quota_model_id      text NOT NULL,
    period_window_start timestamptz NOT NULL,
    workload_class      text NOT NULL CHECK (workload_class IN (
                          'INTERACTIVE_HIGH', 'RISK_MONITOR_HIGH',
                          'SCHEDULED_NORMAL', 'EVALUATION_LOW', 'BACKFILL_LOW')),
    reserve_id          text,
    reserve_key         text GENERATED ALWAYS AS (coalesce(reserve_id, 'GENERAL_POOL')) STORED,
    protected_reserve_eligible boolean NOT NULL DEFAULT FALSE,
    observed_units      numeric NOT NULL DEFAULT 0 CHECK (observed_units >= 0),
    observed_at         timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (provider_id, quota_model_id, period_window_start)
      REFERENCES cost.cost_quota_balances
        (provider_id, quota_model_id, period_window_start),
    FOREIGN KEY (reserve_id, provider_id, period_window_start)
      REFERENCES cost.cost_reserve_buckets
        (reserve_id, provider_id, period_window_start),
    -- No reserve invasion: only explicitly eligible, non-broad work can name
    -- a reserve. General-pool usage always leaves reserve_id NULL.
    CHECK (reserve_id IS NULL OR protected_reserve_eligible),
    CHECK (reserve_id IS NULL OR workload_class NOT IN (
      'SCHEDULED_NORMAL', 'EVALUATION_LOW', 'BACKFILL_LOW')),
    PRIMARY KEY (provider_id, quota_model_id, period_window_start,
                 workload_class, reserve_key)
);

CREATE INDEX cost_usage_counters_window_idx
    ON cost.cost_usage_counters (period_window_start, provider_id, quota_model_id);

-- Private accounting link: core owns reservation lifecycle; cost owns which
-- independently capped pool funded that reservation.
CREATE TABLE cost.cost_quota_allocations (
    reservation_id     text PRIMARY KEY
      REFERENCES core.core_quota_reservations(reservation_id),
    provider_id        text NOT NULL,
    quota_model_id     text NOT NULL,
    period_window_start timestamptz NOT NULL,
    reserve_id         text,
    reserved_units     numeric NOT NULL CHECK (reserved_units >= 0),
    settled            boolean NOT NULL DEFAULT FALSE,
    FOREIGN KEY (provider_id, quota_model_id, period_window_start)
      REFERENCES cost.cost_quota_balances
        (provider_id, quota_model_id, period_window_start),
    FOREIGN KEY (reserve_id, provider_id, period_window_start)
      REFERENCES cost.cost_reserve_buckets
        (reserve_id, provider_id, period_window_start)
);
