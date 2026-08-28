-- g0_cost_0003_capacity_budgets.sql
-- ROLLBACK: DROP TABLE cost.capacity_resource_budgets;
-- Independently capped system and BYOK resource dimensions (FR-COST-009/010).

CREATE SCHEMA IF NOT EXISTS cost;

CREATE TABLE cost.capacity_resource_budgets (
    kind                text        PRIMARY KEY CHECK (kind IN (
                          'SCHEDULER_SLOTS', 'WORKFLOW_STEPS', 'DATABASE_BYTES',
                          'OBJECT_STORE_BYTES', 'NOTIFICATION_RATE', 'MODEL_TOKENS_BYOK')),
    budget_namespace    text        NOT NULL,
    cap_limit           numeric     NOT NULL CHECK (cap_limit >= 0),
    used                numeric     NOT NULL DEFAULT 0 CHECK (used >= 0),
    forecast_used       numeric     NOT NULL DEFAULT 0 CHECK (forecast_used >= 0),
    degrade_behavior    text        NOT NULL,
    ceiling_exceeded_at timestamptz,
    CHECK (used <= cap_limit),
    CHECK ((kind = 'MODEL_TOKENS_BYOK' AND budget_namespace = 'BYOK_MODEL') OR
           (kind <> 'MODEL_TOKENS_BYOK' AND budget_namespace = 'SYSTEM'))
);
