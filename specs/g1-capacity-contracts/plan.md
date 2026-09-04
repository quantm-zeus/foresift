# Implementation Plan: g1-capacity-contracts

**Package**: `g1-capacity-contracts` | **Date**: 2026-09-04 | **Spec**: `specs/g1-capacity-contracts/spec.md` (scoped derivative of PRD §62 in full + manifest FR-COST-011…017)
**Authority**: PRD wins over every word below; material decisions are recorded as proposed ADR texts in this file.

## Summary

Operate the G1 capacity governance layer ON TOP of the proven G0 free-first cost
plane, along four seams, without rewriting any proven behavior:

1. **Independent budget dimensions (FR-COST-011, §62.2/62.12)** — the six-dimension
   budget-policy vocabulary (DATA_PROVIDER / MODEL / COMPUTE_WORKFLOW /
   DATABASE_STORAGE / OBJECT_STORAGE_EGRESS / NOTIFICATION), per-dimension policy
   records with data-provider mode (STRICT_FREE / FREE_FIRST / PAID_ALLOWED) on the
   DATA_PROVIDER dimension, and the seven-class cost composition renderer that
   structurally forbids "zero paid data" from rendering as "zero total cost".
2. **Versioned Sustainable Capacity Contracts (FR-COST-012/013, §62.5)** — the exact
   §62.5 interface as a Zod schema + `g1_cost_*` persistence: candidateLoad rates,
   providerEnvelope (calls/quota/bytes expected+stress, retry allowance, reserve
   class), systemEnvelope (13 quantities incl. database writes AND reads, storage,
   egress, notifications, scheduler messages, object operations), minimumHeadroom-
   Fraction, degradationPolicyVersion, 30-day horizon law, verifiedAt/expiresAt and
   result PASS | FAIL | UNVERIFIED.
3. **Admission control + degradation (FR-COST-014/015, §62.6–62.8)** — a
   whole-configuration forecast gate (the six §62.6 block conditions) in front of
   activation; the deterministic versioned degradation order as seeded policy DATA
   (eleven ordered steps preserving critical risk monitoring, alert verification,
   outcome observation, collector continuity, interactive emergency reserve before
   social/analog/wallet-history/exploration/broad-scan depth) with a resolver that
   admits/reduces/rejects and never pays silently.
4. **Reconciliation + attribution (FR-COST-016/017, §62.9/62.11)** — forecast-vs-actual
   reconciliation by operation/workload/candidate/run/module with automatic incidents
   on material underestimation or reserve breach (wiring the G0 tolerance seam), and
   total + marginal cost attribution per researched candidate, mature outcome, useful
   alert, prevented risk event, and portfolio-utility unit with all seven §62.12
   spend classes carried.

New migrations `g1_cost_0001..0003` (additive; the proven `cost` family pattern
extended in row count only — no new family, no migrator source change); extended
fixtures under `tests/fixtures/cost/`; shared AC-100…105 and AC-224…229 suites
extended in place (facet convention); telemetry `cost.catalog.json` extended with the
central parity suite in the same package.

## Technical Context

- **Language/runtime**: TypeScript (ESM, strict, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`) in the existing pnpm workspace; Bun Test is the
  repository test authority.
- **Storage**: PostgreSQL schema via `@foresift/persistence` (`DatabaseEngine`
  seam); tests run on PGlite per ADR-0014. Migrations are the SQL source of truth.
  The G0 cost tables live in the `cost` schema and are intentionally ABSENT from the
  Drizzle mirror (mirror parity test enumerates `public` only); G1 follows the same
  law — `cost.*` tables are accessed via `DatabaseEngine.query` (G0
  `packages/quota-forecast/src/usage-ledger.ts` precedent), so this package makes NO
  `packages/persistence/**` writes at all.
- **Validation**: Zod schemas authoritative in `packages/shared-schemas` (ADR-0013).
  Closed vocabularies (budget dimensions, data-provider modes, reserve classes,
  degradation steps, attribution dimensions, cost rendering classes, contract
  results, incident kinds) are declared in `packages/domain` and imported — never
  restated — by `packages/shared-schemas`. Unknown values fail closed with stable
  `ErrorCode`s.
- **Extend-not-rewrite**: every G0 module in `packages/cost-router`,
  `packages/capacity-planner`, `packages/quota-forecast` keeps its exported behavior;
  G1 modules import and layer over them. `plan-verifier.ts`, `capacity-replay.ts`,
  `forecast.ts`, `strict-free-guard.ts`, `paid-policy.ts` are consumed, never
  reworked. `packages/shared-schemas/src/cost.ts` registry version bumps 1→2
  (additive shapes only).
- **Test stack**: Bun Test; new suites colocated per package
  (`packages/*/test/*.spec.ts`) plus in-place extensions of the shared
  `tests/acceptance` / `tests/negative` AC files; the coordinator manifest
  (`evidence/bun-migration/bun-migration-manifest.json`) is regenerated after new
  test files exist so `test:all` workloads classify them (PGlite suites →
  DATABASE_PGLITE).
- **Telemetry**: declarative catalogs only (`telemetry/cost.*` extended) — emitter
  wiring is G2, never in this package's verification.

## Constitution Check

- **I. Product-Contract Authority**: scope limited to the seven assigned
  requirements; §62 quoted surfaces (62.2–62.12) are implemented as specified, no
  reinterpretation. The §62.5 interface is transcribed field-for-field.
- **III. Read-only law**: capacity governance only admits/reduces/rejects
  computation; no execution, custody, signing, or submission surface (INV-001).
- **Evidence law**: every AC gets positive AND negative proof at the manifest
  paths; determinism over the degradation order is proven by pure-function tests
  (no AI, no probabilistic step in the order).
- **Fail-closed**: unknown budget dimension, unknown reserve class, unknown
  degradation step, expired contract, unverifiable plan, and zero-cost-overclaim
  composition all refuse with typed errors — never guess, never default-open.

## Data model (SQL truth under `migrations/`)

### `g1_cost_0001_budget_dimensions.sql` (family `cost`)

```text
CREATE TABLE cost.budget_policies (                 -- FR-COST-011, §62.2
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

CREATE TABLE cost.budget_consumption_totals (       -- per-dimension actuals (FR-COST-011)
  dimension          text NOT NULL CHECK (dimension IN (
    'DATA_PROVIDER','MODEL','COMPUTE_WORKFLOW','DATABASE_STORAGE',
    'OBJECT_STORAGE_EGRESS','NOTIFICATION')),
  period_window_start timestamptz NOT NULL,
  period_reset_at     timestamptz NOT NULL,
  cap_limit           numeric NOT NULL CHECK (cap_limit >= 0),
  consumed            numeric NOT NULL DEFAULT 0 CHECK (consumed >= 0),
  rendered_classes    text NOT NULL,                -- JSON object, the 7 §62.12 classes
  PRIMARY KEY (dimension, period_window_start),
  CHECK (period_reset_at > period_window_start)
);
-- rendered_classes JSON keys pinned by schema + test to exactly:
--   'PAID_DATA_SPEND','FREE_QUOTA_CONSUMPTION','MODEL_SPEND','INFRASTRUCTURE_SPEND',
--   'STORAGE_EGRESS_SPEND','NOTIFICATION_SPEND','HUMAN_REVIEW_EFFORT'
```

### `g1_cost_0002_capacity_contracts.sql`

```text
ALTER TABLE cost.cost_reserve_buckets               -- §62.4 nine-class extension (ADR-2)
  member-ADDITIVE CHECK rebuild on reserve_id, guarded:
  pre-migration SELECT aborts if any reserve_id NOT IN the four G0 members
  (no existing row can violate the widened CHECK; G0 spellings preserved):
  old: ('RISK_MONITORING','ALERT_VERIFICATION','INTERACTIVE_MCP','EMERGENCY_BACKFILL')
  new: ('RISK_MONITORING','ALERT_VERIFICATION','INTERACTIVE_MCP','EMERGENCY_BACKFILL',
        'OUTCOME_COLLECTION','SCHEDULED_CANDIDATE_VERIFICATION','DEEP_RESEARCH',
        'FIRST_PARTY_COLLECTOR','EXPLORATION_PROBES')

CREATE TABLE cost.capacity_contracts (              -- FR-COST-012/013, §62.5 exact
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
  degradation_policy_version text NOT NULL REFERENCES cost.degradation_policies(policy_version),
  verified_at   timestamptz NOT NULL,
  expires_at    timestamptz NOT NULL,
  result        text NOT NULL CHECK (result IN ('PASS','FAIL','UNVERIFIED')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_ref, profile_ref, version),
  CHECK (expires_at > verified_at),
  CHECK (result <> 'PASS' OR verified_at IS NOT NULL)
);
CREATE INDEX capacity_contracts_schedule_idx
  ON cost.capacity_contracts(schedule_ref, profile_ref, active DESC);
ALTER TABLE cost.capacity_contracts ADD COLUMN active boolean NOT NULL DEFAULT FALSE;
-- one active contract per (schedule_ref, profile_ref); a schedule/profile WITHOUT an
-- active PASS contract is unactivatable (FR-COST-012, enforced by admission control)
CREATE UNIQUE INDEX capacity_contracts_one_active_idx
  ON cost.capacity_contracts(schedule_ref, profile_ref) WHERE active = TRUE;
CREATE TABLE cost.contract_reserves_borrowed (      -- §62.4 borrowing audit
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
```

### `g1_cost_0003_degradation_reconciliation.sql`

```text
CREATE TABLE cost.degradation_policies (            -- FR-COST-015, §62.8 as DATA
  policy_version text PRIMARY KEY,
  activated_at   timestamptz NOT NULL DEFAULT now(),
  retired_at     timestamptz
);
CREATE TABLE cost.degradation_order_steps (         -- deterministic, versioned ORDER
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
-- Migration seeds the §62.8 canonical eleven-step order at step_index 1..11 under
-- policy_version 'v1' (exact literals above, in PRD order); PRESERVE_CRITICAL_OBLIGATIONS
-- (10) and RETURN_PARTIAL_INSUFFICIENT_DATA (11) carry protected_class rows for
-- RISK_MONITORING / ALERT_VERIFICATION / OUTCOME_COLLECTION / INTERACTIVE_MCP /
-- EMERGENCY_BACKFILL continuity.

CREATE TABLE cost.forecast_reconciliations (        -- FR-COST-016, §62.9/62.11
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

CREATE TABLE cost.cost_attributions (               -- FR-COST-017, §62.9
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
-- cost composition is never a single scalar: rendered_classes always carries all seven
-- classes (schema-level pin, §62.12); total_cost = sum over classes is a test-pinned
-- identity, and zero-paid-data with any nonzero other class is unrepresentable as
-- "zero total cost" because total_cost > 0 whenever any class > 0 (CHECK via test +
-- composition renderer invariant).
```

## Module layout (inside writeScopes)

```text
packages/domain/src/
  capacity.ts             # NEW — BudgetDimension (6 members), ProviderMode
                          #   (STRICT_FREE | FREE_FIRST | PAID_ALLOWED), ReserveClass
                          #   (9 members = G0 4 + 5 new §62.4 classes, G0 spellings
                          #   kept), DegradationStep (11 members), ReserveBorrowPolicy,
                          #   AttributionUnitKind (5 members), RenderedSpendClass
                          #   (7 members), ContractResult (PASS | FAIL | UNVERIFIED),
                          #   ReconciliationDimension (OPERATION | WORKLOAD | CANDIDATE |
                          #   RUN | MODULE), ReconciliationBreachKind
                          #   (MATERIAL_UNDERESTIMATION | RESERVE_BREACH); fail-closed
                          #   parse() per vocabulary; stable ErrorCode additions
                          #   (BUDGET_DIMENSION_UNKNOWN, RESERVE_CLASS_UNKNOWN,
                          #   DEGRADATION_STEP_UNKNOWN, ATTRIBUTION_UNIT_UNKNOWN,
                          #   SPEND_CLASS_UNKNOWN, CONTRACT_RESULT_UNKNOWN,
                          #   RECONCILIATION_BREACH_UNKNOWN)
  capacity-contract.ts    # NEW — SustainableCapacityContract type mirroring §62.5
                          #   field-for-field; validateSustainableCapacityContract:
                          #   horizonDays >= 30 (FR-COST-012), reserve fractions
                          #   sum <= 1 (§62.4), minimumHeadroomFraction ∈ [0,1],
                          #   non-negative envelopes, stress >= expected sanity on
                          #   load rates; degradationPolicyVersion required
  degrade-order.ts        # NEW — §62.8 canonical order as the DEFAULT_POLICY_V1
                          #   constant (ordered DegradationStep array, exact migration
                          #   literals); resolveDegradation(steps, exhaustedClass):
                          #   pure, deterministic, versioned; PROTECTED_STEPS =
                          #   [PRESERVE_CRITICAL_OBLIGATIONS, RETURN_PARTIAL_INSUFFICIENT_DATA]
  index.ts                # extend exports

packages/shared-schemas/src/
  capacity.ts             # NEW — Zod mirrors: BudgetPolicySchema,
                          #   SustainableCapacityContractSchema (§62.5 exact incl.
                          #   candidateLoad 7 fields, providerEnvelope item shape,
                          #   systemEnvelope 13 fields, minimumHeadroomFraction,
                          #   degradationPolicyVersion, verifiedAt/expiresAt, result
                          #   enum), DegradationPolicyRowSchema,
                          #   ForecastReconciliationSchema, CostAttributionSchema,
                          #   BudgetConsumptionTotalsSchema (renderedClasses pinned to
                          #   the 7 RenderedSpendClass keys), BorrowedReserveSchema;
                          #   imports domain vocabularies, never restates them;
                          #   COST_SCHEMA_REGISTRY_VERSION 1→2 in cost.ts (additive
                          #   members only; COST_SCHEMAS registry extended)
  index.ts                # export capacity.ts

packages/cost-router/src/
  budget-policy.ts        # NEW — per-dimension policy resolution
                          #   (resolveActiveBudgetPolicies(engine, at)), free-in-one-
                          #   dimension-never-implies-zero-total predicate helper,
                          #   DATA_PROVIDER-mode gating integration with the G0
                          #   CostModePolicy/strict-free-guard seam (STRICT_FREE only
                          #   admits FREE_UNMETERED + policy-approved FREE_QUOTA —
                          #   delegated to the proven guard, not duplicated)
  composition.ts          # NEW — §62.12 renderer: composeCostTotals(classes) →
                          #   {totalCost, renderedClasses}; refuses (throws) any
                          #   composition missing one of the 7 classes; refuses
                          #   total-cost claims inconsistent with the class sum;
                          #   marginalCostAttribution(...) per unit kind (FR-COST-017)
  cost-audit.ts           # EXTEND — budget-dimension denials recorded with
                          #   dimension + rendered classes (audit law continuity)

packages/capacity-planner/src/
  admission.ts            # NEW — admitConfiguration(contract, resolvedConfig, usage):
                          #   whole-configuration forecast BEFORE activation; returns
                          #   ADMIT | REDUCE(nextStep) | REJECT with a reason from the
                          #   six §62.6 conditions (STRESS_LIMIT_EXCEEDED,
                          #   HEADROOM_NOT_PRESERVED, PROTECTED_RESERVE_EXHAUSTIBLE,
                          #   PLAN_EXPIRES_WITHIN_HORIZON, STORAGE_EGRESS_RETENTION_
                          #   EXCEEDED, CRITICAL_STARVED); consults the proven
                          #   run30DayCapacityReplay + PlanVerifier; never activates a
                          #   schedule/profile lacking an active PASS contract
                          #   (FR-COST-014, FR-COST-012)
  degrade-order.ts        # NEW — persistence-backed order resolution
                          #   (loadDegradationOrder(engine, version)), seed-parity
                          #   assertion against domain DEFAULT_POLICY_V1, and the
                          #   admission-control integration: on quota exhaustion the
                          #   resolver returns the next REDUCE step; protected steps
                          #   are terminal and never skippable; no paid-operation
                          #   escape exists in the resolver (FR-COST-015, §62.8)
  degrade-policy.ts       # EXTEND — G0 LOW_PRIORITY_DEGRADE_ORDER kept; gains mapping
                          #   into the full versioned order (family → step index)

packages/quota-forecast/src/
  reconciliation.ts       # NEW — reconcileForecast(contract, dimension, subject,
                          #   forecast, actual, toleranceFraction): writes
                          #   cost.forecast_reconciliations; raises an incident id via
                          #   the G0 tolerance-breach seam (forecast.ts
                          #   onToleranceBreach / ForecastSnapshot flows) for
                          #   MATERIAL_UNDERESTIMATION or RESERVE_BREACH; recomputed
                          #   admission limits returned to callers (FR-COST-016,
                          #   AC-229); attribution writer for cost.cost_attributions
                          #   (FR-COST-017) with per-operation/workload/candidate/run/
                          #   module granularity
  usage-ledger.ts         # EXTEND — read-side aggregates by the five reconciliation
                          #   dimensions (operation/workload/candidate/run/module)
                          #   from cost.cost_usage_counters (G0 rows), feeding
                          #   reconciliation

tests/fixtures/cost/      # (tests/fixtures/cost/** is in writeScopes)
  capacity-contracts.ts   # NEW — §62.5 contract fixtures: PASS/FAIL/UNVERIFIED
                          #   contracts, horizon-30 law vectors, reserve-fraction
                          #   vectors (sum ≤ 1, borrowing pairs, protected-class
                          #   exhaustion), stress-vs-expected envelopes
  budget-policies.ts      # NEW — six-dimension policy fixtures incl. HUMAN_ATTENTION
                          #   as render-only, STRICT_FREE/FREE_FIRST/PAID_ALLOWED
                          #   vectors, zero-overclaim composition vectors
  degradation.ts          # NEW — §62.8 order vectors: degradation sequencing,
                          #   protected-class preservation, never-pay-silently
                          #   refusals, versioned-order resolution
  index.ts                # extend exports

tests/acceptance/  — shared AC files extended IN PLACE (facet convention):
  AC-101 + negative: G1 case — broad-discovery exhaustion under the six-dimension
                     budget plane cannot consume protected risk/alert reserve classes
                     (reserve-router + degrade-order integration)
  AC-104 + negative: G1 case — low-priority budget exhaustion resolves through the
                     versioned §62.8 order; frozen evidence untouched; critical
                     monitoring preserved (degrade-order resolver)
  AC-105 + negative: G1 case — BYOK MODEL dimension budget nonzero with DATA_PROVIDER
                     STRICT_FREE: composition renders model spend ≠ 0 and paid data
                     spend = 0 (never "zero total cost")
  AC-227 + negative: G1 case — 30-day replay driven FROM a persisted Sustainable
                     Capacity Contract (expected + stress), activation blocked when any
                     verified ceiling exceeded (admission.ts end-to-end)
  AC-228 + negative: G1 case — simulated quota exhaustion degrades
                     social/analog/wallet-history/exploration/broad-scan BEFORE
                     collector continuity, risk monitoring, alert verification, mature
                     outcome collection, protected interactive reserve (order + seed
                     parity proof)
  AC-229 + negative: G1 case — actual > forecast tolerance creates an incident row,
                     recomputes admission limits, refuses silent paid overage or
                     protected-reserve consumption (reconciliation.ts)
tests/negative/    — matching negative additions in the same files' negative twins
                     (per the G0 facet convention: AC-101/104/105/227/228/229
                     negative extensions; unknown dimension, expired contract,
                     reserve-fraction sum > 1, horizon < 30, unverified-plan activation
                     refusals)

telemetry/
  cost.catalog.json       # EXTEND — new events:
                          #   cost.budget_policy_activated (FR-COST-011),
                          #   cost.capacity_contract_verified (FR-COST-012/013),
                          #   cost.admission_blocked (FR-COST-014),
                          #   cost.degradation_step_resolved (FR-COST-015),
                          #   cost.reserve_borrowed (§62.4),
                          #   cost.forecast_reconciled (FR-COST-016),
                          #   cost.attribution_composed (FR-COST-017);
                          #   requirementsCovered += FR-COST-011…017; fields mirror
                          #   the authoritative schemas exactly; contractStatus stays
                          #   DECLARATIVE_CONTRACT_ONLY
tests/telemetry-catalog.spec.ts — extended in place (plan-sanctioned exception,
                     milestone plan-level decision 4) pinning the extended catalog
packages/persistence/test/migrator.spec.ts — extended in place (plan-sanctioned
                     exception, ADR-0019/0022 duty) with the three g1_cost_* registry
                     entries (the `cost` family is already in the filename pattern —
                     NO migrator source change)
packages/domain/test/capacity.spec.ts       # NEW — vocabulary fail-closed + order tests
packages/domain/test/capacity-contract.spec.ts  # NEW — §62.5 validation law tests
packages/cost-router/test/budget-policy.spec.ts # NEW
packages/cost-router/test/composition.spec.ts   # NEW
packages/cost-router/test/migrations.spec.ts    # EXTEND (g1_cost_0001 tables)
packages/capacity-planner/test/admission.spec.ts # NEW
packages/capacity-planner/test/degrade-order.spec.ts # NEW
packages/capacity-planner/test/migrations.spec.ts # EXTEND (g1_cost_0002/0003 tables)
packages/quota-forecast/test/reconciliation.spec.ts # NEW
packages/quota-forecast/test/usage-ledger.spec.ts   # EXTEND (dimension aggregates)
packages/shared-schemas/test/capacity.spec.ts   # NEW — schema mirrors + registry v2
evidence/bun-migration/bun-migration-manifest.json — regenerated after new suites
                     exist (mechanical, coordinator-owned; g0-first-party-observation
                     T063 precedent)
```

## Verification strategy per acceptance criterion

| AC     | Surface                   | Positive proof                                                                                                                                      | Negative proof                                                                                      |
| ------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| AC-100 | strict-free guard         | existing suite green (G0 behavior unchanged; budget-policy integration delegates to the proven guard)                                               | existing negatives stay green; no new paid-admission path exists                                    |
| AC-101 | reserves × dimensions     | G1 case: broad-discovery exhaustion under six-dimension policies reduces breadth/returns cache; reserve-router refuses protected risk/alert classes | G1 negative: protected-class consumption attempt under broad discovery is refused and audited       |
| AC-102 | batch coalescer           | existing suite green (untouched G0 behavior)                                                                                                        | existing negatives stay green                                                                       |
| AC-103 | plan verification         | existing suite green; admission.ts refuses activations whose plan metadata expires within the 30-day horizon (§62.6 condition 4)                    | G1 negative: horizon-expiring plan without safe fallback blocks activation                          |
| AC-104 | degradation policy        | G1 case: low-priority scheduler/storage/model budget exhaustion → resolver returns REDUCE steps in §62.8 order; frozen evidence untouched           | G1 negative: jumping to RETURN_PARTIAL / skipping protected steps refused; paid escape refused      |
| AC-105 | BYOK + STRICT_FREE        | G1 case: MODEL dimension budget nonzero, DATA_PROVIDER STRICT_FREE; composition renders MODEL_SPEND > 0, PAID_DATA_SPEND = 0                        | G1 negative: rendering "zero total cost" while any class > 0 is refused by composeCostTotals        |
| AC-224 | collector continuity      | G1 case (cost facet): collector reconnect/backfill workload holds FIRST_PARTY_COLLECTOR/EMERGENCY_BACKFILL reserve class through degradation        | G1 negative: degrade-order cannot drop collector continuity below protected steps                   |
| AC-225 | backfill availability     | existing suite green (data-plane law, not this package); reserve accounting of backfill calls attributed via usage-ledger aggregates                | existing negatives stay green                                                                       |
| AC-226 | latency decomposition     | existing suite green (latency facet owned elsewhere); per-run cost attribution rows carry run dimension (FR-COST-016 granularity)                   | existing negatives stay green                                                                       |
| AC-227 | 30-day replay × contract  | G1 case: persisted contract → admission forecast (expected + stress) across all nine G0 dimension families; activation blocked on any ceiling       | G1 negative: activation with an exceeded ceiling, missing PASS contract, or horizon < 30 is refused |
| AC-228 | degradation vs protection | G1 case: quota exhaustion sequences social → analog → wallet-history → exploration → broad-scan depth reductions before ANY protected class         | G1 negative: any ordering that degrades protected classes first fails seed-parity + resolver tests  |
| AC-229 | reconciliation incidents  | G1 case: actual > tolerance → MATERIAL_UNDERESTIMATION/RESERVE_BREACH incident row + recomputed admission limits; no silent overage                 | G1 negative: silent paid overage or protected-reserve consumption on breach is refused              |

## Material decisions (proposed ADR texts — bind future packages)

### ADR-1 — Budget-dimension vocabulary and the human-attention boundary

**Decision**: FR-COST-011's six dimension literals are THE machine vocabulary. §62.2's
seven prose policies map member-for-member onto them, with `HUMAN_ATTENTION_POLICY`
deliberately unassigned: human attention has no deterministic consumption unit, so it is
carried as the `HUMAN_REVIEW_EFFORT` class in every cost composition (§62.12) and never
as an enforceable budget row. `ProviderMode` (STRICT_FREE | FREE_FIRST | PAID_ALLOWED)
lives ONLY on the DATA_PROVIDER dimension (SQL CHECK + schema refine); the G0 two-value
`CostMode` schema is untouched and G0 guards keep their proven semantics (§62.2
STRICT_FREE law is enforced by the existing strict-free-guard; this package adds
per-dimension rendering, never a second guard).

**Why binding**: later packages (signal registry probes, execution simulation,
objective governance) consume budget state through `resolveActiveBudgetPolicies` and
composition through `composeCostTotals` only; no private dimension list may appear.

### ADR-2 — Reserve-class vocabulary extension (member-additive, guarded)

**Decision**: the G0 four-member `ReserveId`/`reserve_id` vocabulary extends to the nine
§62.4 classes: the four G0 members keep exact spellings and semantics; five members join —
`OUTCOME_COLLECTION`, `SCHEDULED_CANDIDATE_VERIFICATION`, `DEEP_RESEARCH`,
`FIRST_PARTY_COLLECTOR`, `EXPLORATION_PROBES`. The `cost.cost_reserve_buckets` CHECK is
rebuilt member-additively behind a pre-migration guard that aborts if any existing row
holds a reserve_id outside the four G0 members (none can, but the guard makes the
migration safe on any state). `randomized_exploration_and_evidence_probes` (§62.4 prose)
is carried as the literal `EXPLORATION_PROBES` (single-token CHECK law). Default §62.4
fractions are seeded as policy data (0.20/0.15/0.10/0.10/0.10/0.15/0.10/0.05/0.05,
sum ≤ 1) — configurable, never hardcoded in code paths. Borrowing is recorded in
`cost.contract_reserves_borrowed` and only ever equal/higher-priority under a versioned
policy; broad discovery, optional enrichment, and Alpha Lab can never consume protected
risk, alert, gap-recovery, or outcome capacity (enforced in admission + reserve-router
integration, proven by AC-101 negative).

**Why binding**: every later package touching reserves must use the nine-member domain
vocabulary; the G0 four members are frozen API.

### ADR-3 — SustainableCapacityContract persistence shape (envelope JSONB, law in schema)

**Decision**: the §62.5 interface is persisted with the three envelope groups as JSONB
(`candidate_load_json`, `provider_envelope_json`, `system_envelope_json`) whose exact
field sets are pinned by the Zod schema (strict, no unknown keys) and by tests; scalar
columns carry the fields SQL law must guard (horizon_days ≥ 30, headroom/safety ∈ [0,1],
retry_allowance ≥ 0, result ∈ PASS|FAIL|UNVERIFIED, expires_at > verified_at, one active
contract per (schedule_ref, profile_ref)). The concurrency declaration lives inside
`system_envelope_json` as `concurrency` (FR-COST-013 lists it among declared quantities;
§62.5's interface gained it through the package objective's "concurrency" term — the
schema makes it required and non-negative). A schedule/profile combination with no
active PASS contract is structurally unactivatable (FR-COST-012).

**Why binding**: FR-COST-013's declared-quantity list is test-pinned against the schema
so no quantity can silently vanish from contracts.

### ADR-4 — Degradation order as versioned data, seeded from §62.8

**Decision**: the §62.8 eleven-step canonical order is stored as rows
(`cost.degradation_policies` + `cost.degradation_order_steps`), seeded by migration
under `policy_version 'v1'` with the exact step literals listed in the data model, and
mirrored as the domain constant `DEFAULT_POLICY_V1`; a seed-parity test refuses drift
between SQL truth and the domain constant. Resolution is a pure, deterministic,
versioned function; `PRESERVE_CRITICAL_OBLIGATIONS` and
`RETURN_PARTIAL_INSUFFICIENT_DATA` are terminal and never skippable; no resolver path
can select a paid operation or silently drop protected work (§62.8 closing law). The G0
`LOW_PRIORITY_DEGRADE_ORDER` (SOCIAL/ANALOG/WALLET_HISTORY/EXPLORATION/BROAD_SCAN) is
retained as the low-priority family helper and mapped into the full order's indices.

**Why binding**: FR-COST-015's "deterministic, versioned" law and AC-228's ordering
proof both read from this data; a second private ordering anywhere is a violation.

### ADR-5 — No Drizzle mirror for the `cost` schema; zero `packages/persistence/**` writes

**Decision**: all G1 cost tables live in the `cost` schema and are accessed via
`DatabaseEngine.query` (G0 `usage-ledger.ts` precedent); the Drizzle mirror parity test
enumerates `public` tables only, so `cost.*` stays outside the mirror (G0 precedent,
unchanged). Consequently this package needs NO `packages/persistence/**` write; the
central migration registry (`packages/persistence/test/migrator.spec.ts`) is the single
plan-sanctioned persistence-tree exception (ADR-0019/0022 duty). The `cost` family is
already in the migrator filename pattern, so no migrator source change occurs — only
registry entries for `g1_cost_0001..0003` are added.

**Why binding**: keeps the mirror-parity invariant meaningful and the package surface
exactly on writeScopes.

### ADR-6 — Reconciliation granularity and incident creation

**Decision**: FR-COST-016's five attribution dimensions (operation/workload/candidate/
run/module) are the `ReconciliationDimension` vocabulary; reconciliation rows are keyed
by (contract, dimension, subject, reconciled_at). An incident id is created when the
breach kind is `MATERIAL_UNDERESTIMATION` (actual > forecast·(1+tolerance) on any
dimension) or `RESERVE_BREACH` (protected floor crossed), wired through the G0
tolerance-breach seam (`forecast.ts` `onToleranceBreach` / snapshot flows) so incidents
flow into the existing incident machinery rather than a parallel one; admission limits
are recomputed from the reconciliation before any further admission (AC-229). Silent
paid overage and silent protected-reserve consumption are refused fail-closed.

**Why binding**: g1-objective-governance consumes these incident rows for §62.11
capacity regression; the seam must not fork.

## Risks and mitigations (planning-level)

| Risk                                                        | Likelihood | Impact | Mitigation                                                                                                                                                                                                                          |
| ----------------------------------------------------------- | ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reserve CHECK rebuild breaks G0 suites                      | Low        | HIGH   | member-additive extension only; pre-migration guard; G0 spellings frozen; AC-101/104 regression locks                                                                                                                               |
| §62.5 interface drift between schema, SQL, and tests        | Medium     | HIGH   | ADR-3 pins field sets in Zod (strict) with a test enumerating all 13 systemEnvelope fields; CHECK literals transcribed verbatim from this plan into tasks (vocabulary law)                                                          |
| Dual degradation orders (domain constant vs SQL seed) drift | Medium     | MEDIUM | seed-parity test refuses drift; ADR-4 single consumption path                                                                                                                                                                       |
| Admission gate accidentally blocks G0-proven flows          | Medium     | HIGH   | admission.ts is additive: existing G0 planner path stays default when no contract row exists for the caller's schedule/profile — only NEW activations require contracts (FR-COST-012 scope: _active schedule/profile combinations_) |
| JSONB envelopes smuggle unknown fields                      | Medium     | MEDIUM | strict Zod (no unknown keys) + parity test vs fixture vectors                                                                                                                                                                       |
| Cost composition scalar-collapse (zero-cost overclaim)      | Low        | HIGH   | composeCostTotals refuses 6-class compositions; identity tests pin total = Σ classes; AC-105 negative                                                                                                                               |
| Telemetry parity drift for the extended catalog             | Medium     | LOW    | catalogs mirror authoritative schemas; parity test extended in same package                                                                                                                                                         |

## Non-goals reaffirmed (must not creep into tasks.md)

No trading/custody/signing/transaction-submission surfaces (permanent, INV-001); no
data-truth/replay/acquisition work (g1-data-truth-extensions, PROVEN); no Solana
security analysis (g1-solana-security, RUNNING); no discovery coverage measurement
(g1-discovery-coverage — only its protected ceilings live here); no execution
simulators (g1-execution-simulation); no signal/feature formulas (g1-signal-registry —
the §62.7 information-value heuristic is implemented ONLY as an allocation-aid input
to call decisions, never as ranking); no outcome maturity statistics (g1-outcome-
evaluation); no objective constraints (g1-objective-governance — it consumes our
incident rows); no telemetry emitter wiring (G2); no `docs/generated/**` regeneration
(`cost-surfaces.json` already maps FR-COST-001…017); no Drizzle mirror entries for
`cost.*` (ADR-5); no migrator source change (the `cost` family already matches the
filename pattern).

## Validation

```bash
node scripts/automation/package-plan-complete.mjs \
  --package g1-capacity-contracts --artifacts-dir <run artifacts dir>

# Package gates at the pushed HEAD (milestone verificationCommands):
test -d packages/cost-router && pnpm --filter @foresift/cost-router test
test -d packages/capacity-planner && pnpm --filter @foresift/capacity-planner test
test -d packages/quota-forecast && pnpm --filter @foresift/quota-forecast test

# Overall gates at the pushed HEAD (not planning-only):
pnpm verify
pnpm spec:verify
```
