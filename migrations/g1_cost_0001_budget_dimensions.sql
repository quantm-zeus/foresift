-- g1_cost_0001_budget_dimensions.sql
-- Apply and rollback as one transaction. Rollback: DROP the two tables.
-- Budget policy split into six dimensions with per-dimension actuals
-- (FR-COST-011, §62.2, plan ADR-1: provider_mode lives ONLY on DATA_PROVIDER,
-- and "free" in one dimension never implies zero total cost — §62.12).
CREATE SCHEMA IF NOT EXISTS cost;

CREATE TABLE cost.budget_policies (
  policy_id        text PRIMARY KEY,
  dimension        text NOT NULL CHECK (dimension IN (
    'DATA_PROVIDER','MODEL','COMPUTE_WORKFLOW','DATABASE_STORAGE',
    'OBJECT_STORAGE_EGRESS','NOTIFICATION')),
  provider_mode    text CHECK (provider_mode IN (
    'STRICT_FREE','FREE_FIRST','PAID_ALLOWED')),
  cap_limit        numeric NOT NULL CHECK (cap_limit >= 0),
  currency_or_unit text NOT NULL CHECK (length(currency_or_unit) > 0),
  version          text NOT NULL CHECK (length(version) > 0),
  active           boolean NOT NULL DEFAULT FALSE,
  activated_at     timestamptz,
  superseded_by    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (provider_mode IS NULL OR dimension = 'DATA_PROVIDER'),
  CHECK (NOT active OR activated_at IS NOT NULL),
  UNIQUE (dimension, version)
);
CREATE UNIQUE INDEX budget_policies_one_active_idx
  ON cost.budget_policies(dimension) WHERE active = TRUE;

CREATE TABLE cost.budget_consumption_totals (
  dimension           text NOT NULL CHECK (dimension IN (
    'DATA_PROVIDER','MODEL','COMPUTE_WORKFLOW','DATABASE_STORAGE',
    'OBJECT_STORAGE_EGRESS','NOTIFICATION')),
  period_window_start timestamptz NOT NULL,
  period_reset_at     timestamptz NOT NULL,
  cap_limit           numeric NOT NULL CHECK (cap_limit >= 0),
  consumed            numeric NOT NULL DEFAULT 0 CHECK (consumed >= 0),
  rendered_classes    text NOT NULL,  -- JSON object, the 7 §62.12 classes
  PRIMARY KEY (dimension, period_window_start),
  CHECK (period_reset_at > period_window_start)
);
-- rendered_classes JSON keys are pinned by the shared schema
-- (BudgetConsumptionTotalsSchema) and by test to exactly:
--   'PAID_DATA_SPEND','FREE_QUOTA_CONSUMPTION','MODEL_SPEND','INFRASTRUCTURE_SPEND',
--   'STORAGE_EGRESS_SPEND','NOTIFICATION_SPEND','HUMAN_REVIEW_EFFORT'
