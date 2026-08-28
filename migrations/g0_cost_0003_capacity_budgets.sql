-- g0_cost_0003_capacity_budgets.sql
-- Independently capped sustainable resource dimensions (FR-COST-009/010).
-- Rollback: DROP TABLE cost.capacity_resource_budgets;

CREATE TABLE cost.capacity_resource_budgets (
    kind                text PRIMARY KEY CHECK (kind IN (
                          'SCHEDULER_SLOTS', 'WORKFLOW_STEPS',
                          'DATABASE_BYTES', 'OBJECT_STORE_BYTES',
                          'NOTIFICATION_RATE', 'MODEL_TOKENS_BYOK')),
    budget_namespace    text NOT NULL CHECK (budget_namespace IN ('CAPACITY', 'BYOK_MODEL')),
    cap_limit           numeric NOT NULL CHECK (cap_limit >= 0),
    used                numeric NOT NULL DEFAULT 0 CHECK (used >= 0),
    forecast_used       numeric NOT NULL DEFAULT 0 CHECK (forecast_used >= 0),
    degrade_behavior    text NOT NULL CHECK (length(degrade_behavior) > 0),
    ceiling_exceeded_at timestamptz,
    CHECK (used <= cap_limit),
    CHECK ((kind = 'MODEL_TOKENS_BYOK' AND budget_namespace = 'BYOK_MODEL') OR
           (kind <> 'MODEL_TOKENS_BYOK' AND budget_namespace = 'CAPACITY'))
);
