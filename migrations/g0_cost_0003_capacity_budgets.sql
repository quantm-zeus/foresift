-- g0_cost_0003_capacity_budgets.sql
-- Apply and rollback as one transaction. Rollback: DROP TABLE cost.capacity_resource_budgets.
CREATE SCHEMA IF NOT EXISTS cost;
CREATE TABLE cost.capacity_resource_budgets (
  kind text PRIMARY KEY CHECK (kind IN (
    'SCHEDULER_SLOTS','WORKFLOW_STEPS','DATABASE_BYTES','OBJECT_STORE_BYTES',
    'NOTIFICATION_RATE','MODEL_TOKENS_BYOK')),
  cap_limit numeric NOT NULL CHECK (cap_limit >= 0),
  used numeric NOT NULL DEFAULT 0 CHECK (used >= 0 AND used <= cap_limit),
  forecast_used numeric NOT NULL DEFAULT 0 CHECK (forecast_used >= 0),
  degrade_behavior text NOT NULL CHECK (length(degrade_behavior) > 0),
  ceiling_exceeded_at timestamptz,
  -- No provider/quota FK exists: especially MODEL_TOKENS_BYOK is isolated.
  CHECK ((used < cap_limit AND ceiling_exceeded_at IS NULL) OR used = cap_limit)
);
