# Tasks: g1-capacity-contracts

**Input**: `specs/g1-capacity-contracts/spec.md`, `specs/g1-capacity-contracts/plan.md`
**Traceability rule**: every task cites at least one assigned requirement
(FR-COST-011…017) or an acceptance criterion of those requirements. Requirement IDs not
assigned to this package never appear here.

Format: `- [ ] T### [P?]` — **[P]** = parallelizable with its neighbors (disjoint files).
Tests are mandatory per PRD evidence rules: positive AND negative/failure-path
coverage for every acceptance criterion this package extends (AC-100…105, AC-224…229
extended in place — AC-100/102/103/224/225/226 get regression-lock extensions or
recorded substrate boundaries per spec I4).
Plan-sanctioned scope exceptions recorded per ADR-0019/0022 duty and milestone
plan-level decision 4 precedent: `packages/persistence/test/migrator.spec.ts` (central
migration registry) and `tests/telemetry-catalog.spec.ts` (central telemetry parity
suite) are extended by this package even though they sit outside the listed writeScopes.
No other out-of-scope write exists (ADR-5: zero `packages/persistence/**` source writes;
no `docs/generated/**` regen).

**Vocabulary law (binding)**: the SQL CHECK literal lists in plan.md's data model are
THE vocabulary authority. Every task below transcribes them verbatim; no writer or
test author may invent, rename, or omit members:

- BudgetDimension (6): `DATA_PROVIDER`, `MODEL`, `COMPUTE_WORKFLOW`, `DATABASE_STORAGE`, `OBJECT_STORAGE_EGRESS`, `NOTIFICATION`
- ProviderMode (3, DATA_PROVIDER only): `STRICT_FREE`, `FREE_FIRST`, `PAID_ALLOWED`
- ReserveClass (9): `RISK_MONITORING`, `ALERT_VERIFICATION`, `INTERACTIVE_MCP`, `EMERGENCY_BACKFILL`, `OUTCOME_COLLECTION`, `SCHEDULED_CANDIDATE_VERIFICATION`, `DEEP_RESEARCH`, `FIRST_PARTY_COLLECTOR`, `EXPLORATION_PROBES`
- DegradationStep (11): `SKIP_ENRICHMENT_NOTEBOOK_ANALOG_COUNTERFACTUAL`, `REDUCE_SOCIAL_NARRATIVE_DEPTH`, `REDUCE_WALLET_HISTORY_DEPTH`, `REDUCE_DEEP_RESEARCH_CANDIDATE_COUNT`, `EXTEND_LOW_PRIORITY_RECHECK_INTERVAL`, `REDUCE_CHEAP_MONITOR_BREADTH`, `PAUSE_EXPLORATION_ABOVE_PROTECTED_FLOOR`, `USE_ACCEPTABLE_CACHE_FOR_MANUAL_NON_ALERT`, `STOP_NEW_OPPORTUNITY_RESEARCH`, `PRESERVE_CRITICAL_OBLIGATIONS`, `RETURN_PARTIAL_INSUFFICIENT_DATA`
- ContractResult (3): `PASS`, `FAIL`, `UNVERIFIED`
- ReconciliationDimension (5): `OPERATION`, `WORKLOAD`, `CANDIDATE`, `RUN`, `MODULE`
- ReconciliationBreachKind (2): `MATERIAL_UNDERESTIMATION`, `RESERVE_BREACH`
- AttributionUnitKind (5): `RESEARCHED_CANDIDATE`, `MATURE_OUTCOME`, `USEFUL_ALERT`, `PREVENTED_RISK_EVENT`, `PORTFOLIO_UTILITY_UNIT`
- RenderedSpendClass (7): `PAID_DATA_SPEND`, `FREE_QUOTA_CONSUMPTION`, `MODEL_SPEND`, `INFRASTRUCTURE_SPEND`, `STORAGE_EGRESS_SPEND`, `NOTIFICATION_SPEND`, `HUMAN_REVIEW_EFFORT`

## Phase 1 — Domain vocabularies and shared schemas (blocks later phases)

- [ ] T001 Create `packages/domain/src/capacity.ts`: `BudgetDimension` = DATA_PROVIDER |
      MODEL | COMPUTE_WORKFLOW | DATABASE_STORAGE | OBJECT_STORAGE_EGRESS | NOTIFICATION
      (6 members, plan vocabulary law); `ProviderMode` = STRICT_FREE | FREE_FIRST |
      PAID_ALLOWED (3 members); `ReserveClass` = RISK_MONITORING | ALERT_VERIFICATION |
      INTERACTIVE_MCP | EMERGENCY_BACKFILL | OUTCOME_COLLECTION |
      SCHEDULED_CANDIDATE_VERIFICATION | DEEP_RESEARCH | FIRST_PARTY_COLLECTOR |
      EXPLORATION_PROBES (9 members — the four G0 `ReserveId` spellings kept exact, plan
      ADR-2); `DegradationStep` = SKIP_ENRICHMENT_NOTEBOOK_ANALOG_COUNTERFACTUAL |
      REDUCE_SOCIAL_NARRATIVE_DEPTH | REDUCE_WALLET_HISTORY_DEPTH |
      REDUCE_DEEP_RESEARCH_CANDIDATE_COUNT | EXTEND_LOW_PRIORITY_RECHECK_INTERVAL |
      REDUCE_CHEAP_MONITOR_BREADTH | PAUSE_EXPLORATION_ABOVE_PROTECTED_FLOOR |
      USE_ACCEPTABLE_CACHE_FOR_MANUAL_NON_ALERT | STOP_NEW_OPPORTUNITY_RESEARCH |
      PRESERVE_CRITICAL_OBLIGATIONS | RETURN_PARTIAL_INSUFFICIENT_DATA (11 members);
      `ContractResult` = PASS | FAIL | UNVERIFIED; `ReconciliationDimension` = OPERATION |
      WORKLOAD | CANDIDATE | RUN | MODULE; `ReconciliationBreachKind` =
      MATERIAL_UNDERESTIMATION | RESERVE_BREACH; `AttributionUnitKind` =
      RESEARCHED_CANDIDATE | MATURE_OUTCOME | USEFUL_ALERT | PREVENTED_RISK_EVENT |
      PORTFOLIO_UTILITY_UNIT; `RenderedSpendClass` = PAID_DATA_SPEND |
      FREE_QUOTA_CONSUMPTION | MODEL_SPEND | INFRASTRUCTURE_SPEND | STORAGE_EGRESS_SPEND |
      NOTIFICATION_SPEND | HUMAN_REVIEW_EFFORT — each with fail-closed parse and stable
      ErrorCode additions (BUDGET_DIMENSION_UNKNOWN, RESERVE_CLASS_UNKNOWN,
      DEGRADATION_STEP_UNKNOWN, CONTRACT_RESULT_UNKNOWN, RECONCILIATION_BREACH_UNKNOWN,
      ATTRIBUTION_UNIT_UNKNOWN, SPEND_CLASS_UNKNOWN). Add colocated fail-closed tests in
      `packages/domain/test/capacity.spec.ts` (every unknown member throws; G0
      `ReserveId` interop: the four legacy members parse identically through both
      vocabularies). Traces: FR-COST-011, FR-COST-013, FR-COST-015, FR-COST-016,
      FR-COST-017, AC-101, AC-105, AC-228.
- [ ] T002 Create `packages/domain/src/capacity-contract.ts`: the
      `SustainableCapacityContract` type mirroring PRD §62.5 field-for-field
      (contractId, version, horizonDays ≥ 30, candidateLoad with the 7 rate fields
      newAssetsPerDayExpected / newAssetsPerDayStress / cheapMonitorRowsPerDay /
      promotedCandidatesPerDay / activeRiskCandidatesPerDay /
      highResolutionOutcomeCasesPerDay / interactiveInvestigationsPerDay,
      providerEnvelope items {operationId, callsExpected, callsStress,
      quotaUnitsExpected, quotaUnitsStress, streamedBytesExpected?, streamedBytesStress?,
      retryAllowance, reserveClass?}, systemEnvelope with the 13 fields modelInputTokens /
      modelOutputTokens / modelSpendUsd / workflowSteps / schedulerMessages /
      databaseReads / databaseWrites / databaseStorageBytes / objectOperations /
      objectStorageBytes / egressBytes / notificationSends / concurrency,
      minimumHeadroomFraction, degradationPolicyVersion, verifiedAt, expiresAt, result)
      plus `validateSustainableCapacityContract`: horizon ≥ 30 (FR-COST-012), protected
      reserve fractions sum ≤ 1 (§62.4), headroom/safety ∈ [0,1], non-negative
      envelopes, stress ≥ expected load sanity, expiresAt > verifiedAt; reserveClass
      values parse against the nine-member ReserveClass. Tests in
      `packages/domain/test/capacity-contract.spec.ts` (30-day law, sum-≤-1 law,
      stress-≥-expected law, unknown reserveClass refusal, FAIL/UNVERIFIED contracts
      accepted as data but never activatable). Traces: FR-COST-012, FR-COST-013,
      AC-227.
- [ ] T003 Create `packages/domain/src/degrade-order.ts`: `DEFAULT_POLICY_V1` — the
      §62.8 canonical order as an ordered array of the 11 DegradationStep literals
      EXACTLY as listed in plan.md's data model (SKIP_ENRICHMENT… first →
      RETURN_PARTIAL_INSUFFICIENT_DATA last, PRD §62.8 sequence), `PROTECTED_STEPS` =
      [PRESERVE_CRITICAL_OBLIGATIONS, RETURN_PARTIAL_INSUFFICIENT_DATA], and the pure
      deterministic `resolveDegradation(order, state)` returning the next REDUCE step or
      a terminal protected step — never a paid-operation escape, never skipping protected
      steps (plan ADR-4). Tests in `packages/domain/test/degrade-order.spec.ts`
      (determinism, order integrity vs PRD sequence, protected-terminal law, versioned
      re-resolution). Extend `packages/domain/src/index.ts` exports. Traces: FR-COST-015,
      AC-228.
- [ ] T004 Extend `packages/shared-schemas/src/capacity.ts` (NEW): Zod mirrors —
      `BudgetPolicySchema` (dimension enum from domain; providerMode nullable and
      refine-gated to dimension === 'DATA_PROVIDER', plan ADR-1),
      `SustainableCapacityContractSchema` (§62.5 exact, strict, importing domain
      vocabularies — never restated), `DegradationPolicyRowSchema`,
      `DegradationOrderStepSchema`, `ForecastReconciliationSchema` (breach_kind ⇔
      incident_id symmetry refine), `CostAttributionSchema` (renderedClasses pinned to
      all 7 RenderedSpendClass keys — refine refuses a 6-class composition),
      `BudgetConsumptionTotalsSchema` (same 7-class pin), `BorrowedReserveSchema`
      (borrowed_by_class ≠ reserve_class refine); extend
      `packages/shared-schemas/src/cost.ts` registry: add the new schemas to
      COST_SCHEMAS and bump COST_SCHEMA_REGISTRY_VERSION 1→2 (additive members only —
      every G0 schema shape unchanged); extend `packages/shared-schemas/src/index.ts`.
      Tests in `packages/shared-schemas/test/capacity.spec.ts` (strict unknown-key
      refusal on all three envelopes; registry v2 at both assertions; G0 schemas still
      parse — regression lock). Traces: FR-COST-011, FR-COST-012, FR-COST-013,
      FR-COST-016, FR-COST-017, AC-105, AC-229.

## Phase 2 — Persistence: migrations and central registry (blocks Phase 3–4 verification)

- [ ] T005 Author `migrations/g1_cost_0001_budget_dimensions.sql` exactly per plan
      data model: `cost.budget_policies` (dimension CHECK with the 6 budget-dimension
      literals; provider_mode CHECK with STRICT_FREE/FREE_FIRST/PAID_ALLOWED and
      `provider_mode IS NULL OR dimension = 'DATA_PROVIDER'`; one-active-per-dimension
      partial unique index; active ⇒ activated_at) and
      `cost.budget_consumption_totals` (6-dimension CHECK, rendered_classes JSON with
      the 7 RenderedSpendClass keys pinned by test). Apply/rollback as one transaction;
      rollback = DROP the two tables. Traces: FR-COST-011, AC-105.
- [ ] T006 Author `migrations/g1_cost_0002_capacity_contracts.sql` exactly per plan
      data model: the member-additive `cost.cost_reserve_buckets` reserve_id CHECK
      rebuild to the nine ReserveClass literals BEHIND a pre-migration guard that
      aborts if any existing reserve_id is outside the four G0 members (plan ADR-2) —
      G0 spellings byte-identical; `cost.capacity_contracts` (horizon_days ≥ 30, result
      CHECK PASS/FAIL/UNVERIFIED, headroom/safety ∈ [0,1] CHECKs, expires_at >
      verified_at, UNIQUE (schedule_ref, profile_ref, version), one-active partial
      index, degradation_policy_version FK); `cost.contract_reserves_borrowed`
      (9-member CHECKs on both class columns, borrowed_by_class ≠ reserve_class).
      Rollback = DROP new tables + restore the four-member CHECK (guard makes this safe
      on any state). Traces: FR-COST-012, FR-COST-013, AC-227.
- [ ] T007 Author `migrations/g1_cost_0003_degradation_reconciliation.sql` exactly per
      plan data model: `cost.degradation_policies` + `cost.degradation_order_steps`
      (11-member step_name CHECK with the exact DegradationStep literals; PK
      (policy_version, step_index); UNIQUE (policy_version, step_name); protected_class
      CHECK with the 9 ReserveClass literals) SEEDED at migration time with
      policy_version 'v1' rows step_index 1..11 in the exact §62.8 PRD order;
      `cost.forecast_reconciliations` (5-member dimension CHECK OPERATION/WORKLOAD/
      CANDIDATE/RUN/MODULE; breach_kind CHECK MATERIAL_UNDERESTIMATION/RESERVE_BREACH;
      `(breach_kind IS NULL) = (incident_id IS NULL)`); `cost.cost_attributions`
      (5-member unit_kind CHECK RESEARCHED_CANDIDATE/MATURE_OUTCOME/USEFUL_ALERT/
      PREVENTED_RISK_EVENT/PORTFOLIO_UTILITY_UNIT; rendered_classes 7-class pin).
      Rollback = DROP the four tables. Traces: FR-COST-015, FR-COST-016, FR-COST-017,
      AC-228, AC-229.
- [ ] T008 Extend `packages/persistence/test/migrator.spec.ts` — the plan-sanctioned
      central-registry exception (ADR-0019/0022 duty, g1-data-truth-extensions
      precedent) — adding `g1_cost_0001_budget_dimensions`,
      `g1_cost_0002_capacity_contracts`, `g1_cost_0003_degradation_reconciliation` to
      the expected-script registry lists (apply-order and checksum assertions). NO
      migrator source change: the `cost` family is already in MIGRATION_FILE_PATTERN
      (plan ADR-5). Traces: FR-COST-011…017 (migration substrate for every assigned
      requirement).

## Phase 3 — Cost-router: budget dimensions and composition (blocks Phase 4)

- [ ] T009 Create `packages/cost-router/src/budget-policy.ts`:
      `resolveActiveBudgetPolicies(engine, at)` reading `cost.budget_policies` (one
      active row per dimension), per-dimension consumption read from
      `cost.budget_consumption_totals`, and the free-in-one-dimension-never-implies-
      zero-total predicate: DATA_PROVIDER mode (STRICT_FREE | FREE_FIRST | PAID_ALLOWED)
      gates ONLY the DATA_PROVIDER dimension via the proven G0 strict-free-guard /
      CostModePolicy seam (delegated, never duplicated — plan ADR-1). Unknown
      dimensions/modes fail closed. Traces: FR-COST-011, AC-100, AC-105.
- [ ] T010 Create `packages/cost-router/src/composition.ts`: `composeCostTotals` —
      refuses (typed throw) any input missing one of the 7 RenderedSpendClass keys,
      computes total = Σ classes, refuses total claims inconsistent with the class sum;
      `marginalCostAttribution` per AttributionUnitKind writing through the quota-
      forecast attribution seam (FR-COST-017, §62.12 zero-overclaim law: zero
      PAID_DATA_SPEND with any other class > 0 renders total > 0 — test-pinned
      identity). Extend `packages/cost-router/src/cost-audit.ts` to record
      budget-dimension denials with dimension + rendered classes. Tests
      `packages/cost-router/test/composition.spec.ts`. Traces: FR-COST-011, FR-COST-017,
      AC-105.
- [ ] T011 Extend `packages/cost-router/test/budget-policy.spec.ts` (NEW) and
      `packages/cost-router/test/migrations.spec.ts`: six-dimension resolution vectors
      incl. HUMAN_ATTENTION render-only boundary (spec I2), provider-mode gating on
      DATA_PROVIDER only, STRICT_FREE delegation regression (AC-100 stays green), one-
      active-per-dimension enforcement, and g1_cost_0001 table law (CHECK violations
      refused by PGlite). Traces: FR-COST-011, AC-100, AC-105.

## Phase 4 — Capacity-planner: admission control and degradation (blocks Phase 5)

- [ ] T012 Create `packages/capacity-planner/src/admission.ts`:
      `admitConfiguration(contract, resolvedConfig, usage)` — whole-configuration
      forecast BEFORE activation returning ADMIT | REDUCE(nextStep) | REJECT(reason):
      the six §62.6 block conditions as typed reasons (STRESS_LIMIT_EXCEEDED,
      HEADROOM_NOT_PRESERVED, PROTECTED_RESERVE_EXHAUSTIBLE,
      PLAN_EXPIRES_WITHIN_HORIZON, STORAGE_EGRESS_RETENTION_EXCEEDED, CRITICAL_STARVED)
      — consulting the proven `run30DayCapacityReplay` (expected + stress) and
      `PlanVerifier`, and REFUSING activation of any schedule/profile without an active
      PASS contract (FR-COST-012/014). Additive law: callers with no contract row keep
      the G0 planner path unchanged (only NEW activations require contracts — plan risk
      table). Tests `packages/capacity-planner/test/admission.spec.ts`. Traces:
      FR-COST-012, FR-COST-014, AC-227, AC-103.
- [ ] T013 Create `packages/capacity-planner/src/degrade-order.ts`:
      `loadDegradationOrder(engine, version)` reading `cost.degradation_order_steps`,
      seed-parity assertion against domain DEFAULT_POLICY_V1 (drift refuses), and the
      admission-integration resolver: on quota exhaustion return the next REDUCE step;
      protected steps terminal, never skippable; no paid escape. Extend
      `packages/capacity-planner/src/degrade-policy.ts` mapping the G0
      LOW_PRIORITY_DEGRADE_ORDER families (SOCIAL/ANALOG/WALLET_HISTORY/EXPLORATION/
      BROAD_SCAN) into the full order's step indices (plan ADR-4). Tests
      `packages/capacity-planner/test/degrade-order.spec.ts`. Traces: FR-COST-015,
      AC-104, AC-228.
- [ ] T014 Extend `packages/capacity-planner/test/migrations.spec.ts`: g1_cost_0002
      contract-table law (horizon < 30 refused, result CHECK, one-active, reserve
      nine-member CHECK live with G0 rows intact) and g1_cost_0003 seed law (11 rows,
      exact order, protected_class rows on the two terminal steps). Traces: FR-COST-012,
      FR-COST-015, AC-228.

## Phase 5 — Quota-forecast: reconciliation and attribution (blocks Phase 6)

- [ ] T015 Create `packages/quota-forecast/src/reconciliation.ts`:
      `reconcileForecast(contract, dimension, subject, forecast, actual,
toleranceFraction)` writing `cost.forecast_reconciliations`; raises
      MATERIAL_UNDERESTIMATION (actual > forecast·(1+tolerance)) or RESERVE_BREACH
      (protected floor crossed) incident ids through the G0 tolerance-breach seam
      (`forecast.ts` onToleranceBreach / snapshot flows — no parallel incident
      machinery, plan ADR-6); returns recomputed admission limits; refuses silent paid
      overage or protected-reserve consumption on breach (fail-closed).
      `writeCostAttribution` for `cost.cost_attributions` per
      operation/workload/candidate/run/module granularity (FR-COST-016/017). Tests
      `packages/quota-forecast/test/reconciliation.spec.ts`. Traces: FR-COST-016,
      FR-COST-017, AC-229.
- [ ] T016 Extend `packages/quota-forecast/src/usage-ledger.ts` with read-side
      aggregates by the five ReconciliationDimension values from
      `cost.cost_usage_counters` (G0 rows), feeding reconciliation; extend
      `packages/quota-forecast/test/usage-ledger.spec.ts` and
      `packages/quota-forecast/test/migrations.spec.ts` (reconciliation/attribution
      table law: breach⇔incident symmetry CHECK, dimension/unit CHECKs). Traces:
      FR-COST-016, AC-226 (RUN-dimension granularity), AC-229.

## Phase 6 — Fixtures, acceptance and negative suites (blocks Phase 7)

- [ ] T017 Author `tests/fixtures/cost/capacity-contracts.ts`: §62.5 contract fixtures
      (PASS/FAIL/UNVERIFIED; horizon-30 boundary vectors; reserve-fraction vectors sum
      ≤ 1 and the §62.4 defaults 0.20/0.15/0.10/0.10/0.10/0.15/0.10/0.05/0.05; borrowing
      pairs equal/higher-priority; protected-class exhaustion vectors; stress ≥
      expected envelopes; all 13 systemEnvelope fields populated). Extend
      `tests/fixtures/cost/budget-policies.ts` (six-dimension policies incl.
      HUMAN_ATTENTION render-only; STRICT_FREE/FREE_FIRST/PAID_ALLOWED vectors;
      zero-overclaim composition vectors) and `tests/fixtures/cost/degradation.ts` (§62.8
      sequencing vectors, protected-preservation vectors, never-pay-silently refusals);
      extend `tests/fixtures/cost/index.ts`. Traces: FR-COST-011, FR-COST-012,
      FR-COST-013, FR-COST-015, AC-227, AC-228.
- [ ] T018 Extend shared acceptance suites IN PLACE (facet convention, spec I4 — never
      delete or weaken a G0 case): `tests/acceptance/AC-101.spec.ts` (broad-discovery
      exhaustion under six-dimension policies cannot consume protected
      RISK_MONITORING/ALERT_VERIFICATION reserve classes — reserve-router +
      degrade-order integration), `tests/acceptance/AC-104.spec.ts` (low-priority
      scheduler/storage/model exhaustion resolves through versioned §62.8 order; frozen
      evidence untouched; critical monitoring preserved), `tests/acceptance/AC-105.spec.ts`
      (nonzero MODEL dimension budget with DATA_PROVIDER STRICT_FREE: MODEL_SPEND > 0,
      PAID_DATA_SPEND = 0, total > 0), `tests/acceptance/AC-227.spec.ts` (30-day
      expected+stress replay driven FROM a persisted Sustainable Capacity Contract via
      admission.ts; activation blocked on any verified ceiling), `tests/acceptance/AC-228.spec.ts`
      (social → analog → wallet-history → exploration → broad-scan degrade BEFORE any
      protected class; seed-parity proof), `tests/acceptance/AC-229.spec.ts` (actual >
      tolerance → incident row + recomputed admission limits; no silent overage).
      Regression-lock extensions (existing suites stay green, one G1 case each):
      AC-100 (budget-policy integration delegates to the proven guard),
      AC-103 (admission refuses horizon-expiring plan without safe fallback),
      AC-224 (cost facet: collector reconnect/backfill holds
      FIRST_PARTY_COLLECTOR/EMERGENCY_BACKFILL reserve class through degradation),
      AC-225/AC-226 (recorded substrate boundary: data-plane/latency laws owned
      elsewhere; RUN-dimension cost attribution exercised as the cost facet). Traces:
      FR-COST-011…017, AC-100…105, AC-224…229.
- [ ] T019 Author the matching negative extensions in the negative twins:
      `tests/negative/AC-101.negative.spec.ts` (protected-class consumption under broad
      discovery refused + audited), `tests/negative/AC-104.negative.spec.ts` (skipping
      protected steps / paid escape refused), `tests/negative/AC-105.negative.spec.ts`
      ("zero total cost" rendering with any class > 0 refused by composeCostTotals),
      `tests/negative/AC-227.negative.spec.ts` (activation with exceeded ceiling,
      missing PASS contract, or horizon < 30 refused), `tests/negative/AC-228.negative.spec.ts`
      (any ordering degrading protected classes first fails), `tests/negative/AC-229.negative.spec.ts`
      (silent paid overage or protected-reserve consumption on breach refused);
      `tests/negative/AC-103.negative.spec.ts` extension (unverified-plan activation
      refused); SQL-law negatives in the per-package migration specs (unknown dimension,
      unknown reserve class, reserve-fraction sum > 1, breach without incident refused
      by CHECK). Traces: FR-COST-011…017, AC-103, AC-101, AC-104, AC-105, AC-227,
      AC-228, AC-229.

## Phase 7 — Telemetry catalogs, manifest regen, full verification

- [ ] T020 Extend `telemetry/cost.catalog.json`: events
      cost.budget_policy_activated (FR-COST-011), cost.capacity_contract_verified
      (FR-COST-012/013), cost.admission_blocked (FR-COST-014),
      cost.degradation_step_resolved (FR-COST-015), cost.reserve_borrowed (§62.4),
      cost.forecast_reconciled (FR-COST-016), cost.attribution_composed (FR-COST-017);
      requirementsCovered += FR-COST-011…017; fields mirror the authoritative schemas
      exactly; contractStatus stays DECLARATIVE_CONTRACT_ONLY (G2 wiring). Extend
      `tests/telemetry-catalog.spec.ts` — the plan-sanctioned central-parity exception
      (milestone plan-level decision 4 precedent) — pinning the extended catalog.
      Traces: FR-COST-011, FR-COST-012, FR-COST-013, FR-COST-014, FR-COST-015,
      FR-COST-016, FR-COST-017.
- [ ] T021 [executor: COORDINATOR] [evidence: VERIFICATION_ONLY] Run the three
      milestone verification commands on the canonical tree: `test -d
packages/cost-router && pnpm --filter @foresift/cost-router test`, `test -d
packages/capacity-planner && pnpm --filter @foresift/capacity-planner test`,
      `test -d packages/quota-forecast && pnpm --filter @foresift/quota-forecast test`.
      All green required. Traces: FR-COST-011…017 (package-gate proof of every assigned
      requirement's substrate).
- [ ] T022 [executor: COORDINATOR] Regenerate the coordinator test manifest
      (run `node scripts/automation/bun-migration-manifest.mjs --out
evidence/bun-migration/bun-migration-manifest.json`) after all new test files
      exist so `pnpm test`/`test:all` collect and classify them (PGlite-backed suites →
      DATABASE_PGLITE; OOM-safe per the test runtime contract). Mechanical bookkeeping
      (ADR-0020: coordinator-owned, zero-AI; a writer touching
      `evidence/bun-migration/` is an ownership violation by law). Traces:
      FR-COST-011…017 (verification substrate for every assigned requirement).
- [ ] T023 [executor: COORDINATOR] [evidence: VERIFICATION_ONLY] Run the full aggregate
      gate `pnpm verify` and the integrity gate `pnpm spec:verify` at the pushed HEAD;
      require green (the complete Bun suite runs ONLY through the coordinator — never a
      bare `bun test` over the tree). If anything turns red outside writeScopes,
      classify per governance, fix only in-scope failures, and record the rest in the
      run's out-of-scope notes. Traces: FR-COST-011…017 (full suite + manifest
      integrity proof).

## Traceability matrix

| Task | Requirements traced         | Acceptance criteria traced                             | Primary files (inside writeScopes unless noted)                                     |
| ---- | --------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| T001 | FR-COST-011,013,015,016,017 | AC-101, AC-105, AC-228                                 | packages/domain/src/capacity.ts (+test)                                             |
| T002 | FR-COST-012, FR-COST-013    | AC-227                                                 | packages/domain/src/capacity-contract.ts (+test)                                    |
| T003 | FR-COST-015                 | AC-228                                                 | packages/domain/src/degrade-order.ts (+test), index.ts                              |
| T004 | FR-COST-011,012,013,016,017 | AC-105, AC-229                                         | packages/shared-schemas/src/capacity.ts, cost.ts, index.ts (+test)                  |
| T005 | FR-COST-011                 | AC-105                                                 | migrations/g1_cost_0001_budget_dimensions.sql                                       |
| T006 | FR-COST-012, FR-COST-013    | AC-227                                                 | migrations/g1_cost_0002_capacity_contracts.sql                                      |
| T007 | FR-COST-015,016,017         | AC-228, AC-229                                         | migrations/g1_cost_0003_degradation_reconciliation.sql                              |
| T008 | FR-COST-011…017 (substrate) | — (registry duty)                                      | packages/persistence/test/migrator.spec.ts (sanctioned exception)                   |
| T009 | FR-COST-011                 | AC-100, AC-105                                         | packages/cost-router/src/budget-policy.ts                                           |
| T010 | FR-COST-011, FR-COST-017    | AC-105                                                 | packages/cost-router/src/composition.ts, cost-audit.ts (+test)                      |
| T011 | FR-COST-011                 | AC-100, AC-105                                         | packages/cost-router/test/*.spec.ts                                                 |
| T012 | FR-COST-012, FR-COST-014    | AC-227, AC-103                                         | packages/capacity-planner/src/admission.ts (+test)                                  |
| T013 | FR-COST-015                 | AC-104, AC-228                                         | packages/capacity-planner/src/degrade-order.ts, degrade-policy.ts (+test)           |
| T014 | FR-COST-012, FR-COST-015    | AC-228                                                 | packages/capacity-planner/test/migrations.spec.ts                                   |
| T015 | FR-COST-016, FR-COST-017    | AC-229                                                 | packages/quota-forecast/src/reconciliation.ts (+test)                               |
| T016 | FR-COST-016                 | AC-226, AC-229                                         | packages/quota-forecast/src/usage-ledger.ts (+test)                                 |
| T017 | FR-COST-011,012,013,015     | AC-227, AC-228                                         | tests/fixtures/cost/*.ts                                                            |
| T018 | FR-COST-011…017             | AC-100…105, AC-224…229                                 | tests/acceptance/AC-*.spec.ts (in-place extensions)                                 |
| T019 | FR-COST-011…017             | AC-103, AC-101, AC-104, AC-105, AC-227, AC-228, AC-229 | tests/negative/AC-*.negative.spec.ts (in-place extensions)                          |
| T020 | FR-COST-011…017             | — (telemetry contract)                                 | telemetry/cost.catalog.json, tests/telemetry-catalog.spec.ts (sanctioned exception) |
| T021 | FR-COST-011…017             | — (package gates)                                      | coordinator verification (no writes)                                                |
| T022 | FR-COST-011…017             | — (manifest regen)                                     | evidence/bun-migration/bun-migration-manifest.json (coordinator-owned)              |
| T023 | FR-COST-011…017             | — (full gates)                                         | coordinator verification (no writes)                                                |

## Cross-artifact consistency analysis (speckit-analyze, completed at planning)

- **Coverage**: 7/7 assigned requirements traced; all 12 shared ACs
  (AC-100…105, AC-224…229) have explicit owners (T018 positive extensions, T019
  negative extensions) or recorded substrate boundaries (AC-225/226 non-cost facets per
  spec I4, with cost-facet cases still exercised); no assigned AC is unowned.
- **Traceability**: no task cites a requirement outside the package's assignment
  (FR-COST-011…017 only); every task cites ≥1 FR or AC (matrix above).
- **Scope**: every predicted write lands inside writeScopes except the two
  plan-sanctioned exceptions (T008 central migration registry, ADR-0019/0022 duty;
  T020 central telemetry parity suite, milestone plan-level decision 4 precedent),
  recorded here and matching the g1-data-truth-extensions precedent; T022's
  `evidence/bun-migration/` regen is mechanical coordinator bookkeeping (T063
  precedent); zero `packages/persistence/**` source writes (ADR-5); zero
  `docs/generated/**` writes.
- **Ordering**: Phase 1 (domain+schemas) → 2 (migrations+registry) → 3 (cost-router) →
  4 (capacity-planner) → 5 (quota-forecast) → 6 (fixtures+AC suites) → 7 (telemetry,
  manifest, gates), flowing through explicit phase-block statements; the vocabulary law
  block pins plan.md CHECK literals as the single authority (three-way-drift lesson).
- **Read-only law**: no task introduces trading/custody/signing/transaction-submission
  capability; admission control only admits/reduces/rejects computation (INV-001).
- **No placeholders**: no template markers, no unresolved clarification blocks.
