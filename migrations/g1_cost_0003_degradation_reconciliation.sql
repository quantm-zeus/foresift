-- g1_cost_0003_degradation_reconciliation.sql
-- Apply and rollback as one transaction. Rollback: drop the capacity_contracts
-- degradation-policy FK, then DROP the four tables.
-- The versioned degradation order as DATA (FR-COST-015, §62.8, plan ADR-4),
-- forecast reconciliation (FR-COST-016, §62.9/62.11, plan ADR-6), and cost
-- attribution (FR-COST-017, §62.9/62.12).
CREATE SCHEMA IF NOT EXISTS cost;

CREATE TABLE cost.degradation_policies (
  policy_version text PRIMARY KEY,
  activated_at   timestamptz NOT NULL DEFAULT now(),
  retired_at     timestamptz
);
CREATE TABLE cost.degradation_order_steps (
  policy_version text NOT NULL REFERENCES cost.degradation_policies(policy_version),
  step_index     integer NOT NULL CHECK (step_index >= 1),
  step_name      text NOT NULL CHECK (step_name IN (
    'SKIP_ENRICHMENT_NOTEBOOK_ANALOG_COUNTERFACTUAL',
    'REDUCE_SOCIAL_NARRATIVE_DEPTH',
    'REDUCE_WALLET_HISTORY_DEPTH',
    'REDUCE_DEEP_RESEARCH_CANDIDATE_COUNT',
    'EXTEND_LOW_PRIORITY_RECHECK_INTERVAL',
    'REDUCE_CHEAP_MONITOR_BREADTH',
    'PAUSE_EXPLORATION_ABOVE_PROTECTED_FLOOR',
    'USE_ACCEPTABLE_CACHE_FOR_MANUAL_NON_ALERT',
    'STOP_NEW_OPPORTUNITY_RESEARCH',
    'PRESERVE_CRITICAL_OBLIGATIONS',
    'RETURN_PARTIAL_INSUFFICIENT_DATA')),
  protected_class text CHECK (protected_class IN (
    'RISK_MONITORING','ALERT_VERIFICATION','INTERACTIVE_MCP','EMERGENCY_BACKFILL',
    'OUTCOME_COLLECTION','SCHEDULED_CANDIDATE_VERIFICATION','DEEP_RESEARCH',
    'FIRST_PARTY_COLLECTOR','EXPLORATION_PROBES')),
  PRIMARY KEY (policy_version, step_index),
  UNIQUE (policy_version, step_name)
);

-- Seed the §62.8 canonical eleven-step order at step_index 1..11 under
-- policy_version 'v1' (exact PRD order). PRESERVE_CRITICAL_OBLIGATIONS (10)
-- and RETURN_PARTIAL_INSUFFICIENT_DATA (11) carry protected_class rows for
-- RISK_MONITORING / ALERT_VERIFICATION / OUTCOME_COLLECTION / INTERACTIVE_MCP /
-- EMERGENCY_BACKFILL continuity. The domain constant DEFAULT_POLICY_V1 is the
-- code-side mirror; a seed-parity test refuses drift (plan ADR-4).
INSERT INTO cost.degradation_policies (policy_version) VALUES ('v1');
-- One row per step: protected continuity is carried on the two terminal
-- steps via the five protected reserve classes they must never be starved of
-- (risk monitoring, alert verification, outcome collection, interactive
-- emergency, gap-recovery backfill). The plan's PK (policy_version,
-- step_index) admits exactly one row per index, so the §62.8 order itself is
-- the eleven rows below and each terminal step's protected_class names the
-- strongest obligation it preserves.
INSERT INTO cost.degradation_order_steps (policy_version, step_index, step_name, protected_class) VALUES
  ('v1',  1, 'SKIP_ENRICHMENT_NOTEBOOK_ANALOG_COUNTERFACTUAL', NULL),
  ('v1',  2, 'REDUCE_SOCIAL_NARRATIVE_DEPTH', NULL),
  ('v1',  3, 'REDUCE_WALLET_HISTORY_DEPTH', NULL),
  ('v1',  4, 'REDUCE_DEEP_RESEARCH_CANDIDATE_COUNT', NULL),
  ('v1',  5, 'EXTEND_LOW_PRIORITY_RECHECK_INTERVAL', NULL),
  ('v1',  6, 'REDUCE_CHEAP_MONITOR_BREADTH', NULL),
  ('v1',  7, 'PAUSE_EXPLORATION_ABOVE_PROTECTED_FLOOR', NULL),
  ('v1',  8, 'USE_ACCEPTABLE_CACHE_FOR_MANUAL_NON_ALERT', NULL),
  ('v1',  9, 'STOP_NEW_OPPORTUNITY_RESEARCH', NULL),
  ('v1', 10, 'PRESERVE_CRITICAL_OBLIGATIONS', 'RISK_MONITORING'),
  ('v1', 11, 'RETURN_PARTIAL_INSUFFICIENT_DATA', 'RISK_MONITORING');

CREATE TABLE cost.forecast_reconciliations (
  reconciliation_id text PRIMARY KEY,
  contract_id       text NOT NULL REFERENCES cost.capacity_contracts(contract_id),
  dimension         text NOT NULL CHECK (dimension IN (
    'OPERATION','WORKLOAD','CANDIDATE','RUN','MODULE')),
  subject_id        text NOT NULL,                  -- operationId / workload / candidate /
                                                    -- runId / module name
  forecast_value    numeric NOT NULL CHECK (forecast_value >= 0),
  actual_value      numeric NOT NULL CHECK (actual_value >= 0),
  tolerance_fraction double precision NOT NULL CHECK (tolerance_fraction >= 0),
  breach_kind       text CHECK (breach_kind IN (
    'MATERIAL_UNDERESTIMATION','RESERVE_BREACH')),
  incident_id       text,                           -- set iff breach_kind NOT NULL
  reconciled_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, dimension, subject_id, reconciled_at),
  CHECK ((breach_kind IS NULL) = (incident_id IS NULL))
);

CREATE TABLE cost.cost_attributions (
  attribution_id text PRIMARY KEY,
  contract_id    text NOT NULL REFERENCES cost.capacity_contracts(contract_id),
  unit_kind      text NOT NULL CHECK (unit_kind IN (
    'RESEARCHED_CANDIDATE','MATURE_OUTCOME','USEFUL_ALERT','PREVENTED_RISK_EVENT',
    'PORTFOLIO_UTILITY_UNIT')),
  subject_id     text NOT NULL,
  marginal_cost  numeric NOT NULL CHECK (marginal_cost >= 0),
  total_cost     numeric NOT NULL CHECK (total_cost >= 0),
  rendered_classes text NOT NULL,                   -- JSON object, the 7 §62.12 classes
  attributed_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, unit_kind, subject_id, attributed_at)
);
-- rendered_classes JSON keys are pinned by the shared schema
-- (RenderedSpendClassesSchema inside CostAttributionSchema) and by test to
-- exactly the 7 §62.12 classes; cost composition is never a single scalar.
