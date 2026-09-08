-- g1_cost_0002_capacity_contracts.sql
-- Apply and rollback as one transaction. Rollback: DROP the two new tables and
-- restore the four-member reserve_id CHECK (the pre-migration guard makes the
-- restore safe on any state).
-- Versioned Sustainable Capacity Contracts, the nine-class §62.4 reserve
-- vocabulary extension, and the borrowing audit (FR-COST-012, FR-COST-013,
-- AC-227, plan ADR-2/ADR-3).
CREATE SCHEMA IF NOT EXISTS cost;

-- ---------------------------------------------------------------------------
-- §62.4 nine-class reserve vocabulary: member-additive CHECK rebuild on
-- cost.cost_reserve_buckets (plan ADR-2). Guarded: the migration aborts if any
-- existing reserve_id is outside the four G0 members, so no existing row can
-- violate the widened CHECK and the G0 spellings stay byte-identical.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  outside_g0 integer;
BEGIN
  SELECT COUNT(*) INTO outside_g0
    FROM cost.cost_reserve_buckets
   WHERE reserve_id NOT IN (
    'RISK_MONITORING','ALERT_VERIFICATION','INTERACTIVE_MCP','EMERGENCY_BACKFILL');
  IF outside_g0 > 0 THEN
    RAISE EXCEPTION 'RESERVE_CLASS_GUARD_ABORTED: % existing reserve_id row(s) outside the four G0 members', outside_g0;
  END IF;
END $$;

ALTER TABLE cost.cost_reserve_buckets DROP CONSTRAINT cost_reserve_buckets_reserve_id_check;
ALTER TABLE cost.cost_reserve_buckets
  ADD CONSTRAINT cost_reserve_buckets_reserve_id_check
  CHECK (reserve_id IN (
    'RISK_MONITORING','ALERT_VERIFICATION','INTERACTIVE_MCP','EMERGENCY_BACKFILL',
    'OUTCOME_COLLECTION','SCHEDULED_CANDIDATE_VERIFICATION','DEEP_RESEARCH',
    'FIRST_PARTY_COLLECTOR','EXPLORATION_PROBES'));

CREATE TABLE cost.capacity_contracts (
  contract_id   text PRIMARY KEY,
  version       text NOT NULL CHECK (length(version) > 0),
  schedule_ref  text NOT NULL CHECK (length(schedule_ref) > 0),
  profile_ref   text NOT NULL CHECK (length(profile_ref) > 0),
  horizon_days  integer NOT NULL CHECK (horizon_days >= 30),
  candidate_load_json  jsonb NOT NULL,   -- 7 §62.5 rate fields (newAssetsPerDayExpected,
                                         -- newAssetsPerDayStress, cheapMonitorRowsPerDay,
                                         -- promotedCandidatesPerDay,
                                         -- activeRiskCandidatesPerDay,
                                         -- highResolutionOutcomeCasesPerDay,
                                         -- interactiveInvestigationsPerDay)
  provider_envelope_json jsonb NOT NULL, -- array of {operationId, callsExpected, callsStress,
                                         -- quotaUnitsExpected, quotaUnitsStress,
                                         -- streamedBytesExpected?, streamedBytesStress?,
                                         -- retryAllowance, reserveClass?}
  system_envelope_json jsonb NOT NULL,   -- 13 §62.5 fields (modelInputTokens, modelOutputTokens,
                                         -- modelSpendUsd, workflowSteps, schedulerMessages,
                                         -- databaseReads, databaseWrites, databaseStorageBytes,
                                         -- objectOperations, objectStorageBytes, egressBytes,
                                         -- notificationSends, concurrency)
  retry_allowance integer NOT NULL CHECK (retry_allowance >= 0),
  protected_reserves_json jsonb NOT NULL, -- {reserveClass -> allocation fraction}; sum <= 1
  minimum_headroom_fraction double precision NOT NULL
    CHECK (minimum_headroom_fraction >= 0 AND minimum_headroom_fraction <= 1),
  safety_margin_fraction double precision NOT NULL
    CHECK (safety_margin_fraction >= 0 AND safety_margin_fraction <= 1),
  degradation_policy_version text NOT NULL,
  verified_at   timestamptz NOT NULL,
  expires_at    timestamptz NOT NULL,
  result        text NOT NULL CHECK (result IN ('PASS','FAIL','UNVERIFIED')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_ref, profile_ref, version),
  CHECK (expires_at > verified_at),
  CHECK (result <> 'PASS' OR verified_at IS NOT NULL)
);
ALTER TABLE cost.capacity_contracts ADD COLUMN active boolean NOT NULL DEFAULT FALSE;
CREATE INDEX capacity_contracts_schedule_idx
  ON cost.capacity_contracts(schedule_ref, profile_ref, active DESC);
-- one active contract per (schedule_ref, profile_ref); a schedule/profile WITHOUT an
-- active PASS contract is unactivatable (FR-COST-012, enforced by admission control)
CREATE UNIQUE INDEX capacity_contracts_one_active_idx
  ON cost.capacity_contracts(schedule_ref, profile_ref) WHERE active = TRUE;
-- degradation_policy_version FK is declared in g1_cost_0003 (referential
-- closure after the target table exists — g0_dr_0004 precedent); the version
-- text itself must be a live degradation policy version at write time
-- (enforced by admission control and the schema mirrors).

CREATE TABLE cost.contract_reserves_borrowed (
  borrow_id    text PRIMARY KEY,
  contract_id  text NOT NULL REFERENCES cost.capacity_contracts(contract_id),
  reserve_class text NOT NULL CHECK (reserve_class IN (
    'RISK_MONITORING','ALERT_VERIFICATION','INTERACTIVE_MCP','EMERGENCY_BACKFILL',
    'OUTCOME_COLLECTION','SCHEDULED_CANDIDATE_VERIFICATION','DEEP_RESEARCH',
    'FIRST_PARTY_COLLECTOR','EXPLORATION_PROBES')),
  borrowed_by_class text NOT NULL CHECK (borrowed_by_class IN (
    'RISK_MONITORING','ALERT_VERIFICATION','INTERACTIVE_MCP','EMERGENCY_BACKFILL',
    'OUTCOME_COLLECTION','SCHEDULED_CANDIDATE_VERIFICATION','DEEP_RESEARCH',
    'FIRST_PARTY_COLLECTOR','EXPLORATION_PROBES')),
  units        numeric NOT NULL CHECK (units > 0),
  policy_version text NOT NULL,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (borrowed_by_class <> reserve_class)      -- same class is never "borrowing"
);
