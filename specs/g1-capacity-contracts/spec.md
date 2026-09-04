# g1-capacity-contracts — scoped specification

> This file is a SUBORDINATE DERIVATIVE of the authoritative product contract
> `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md`. It was authored as a
> maintainer preplan for the package record in `specs/implementation/current-milestone.json`
> (bootstrap-pattern derivative, builder v1 conventions). The PRD always wins over any
> wording below.

## Authority binding

- Milestone: `G1` (ACTIVE)
- Objective: Operate the G1 capacity governance layer over the proven free-first cost plane:
  budget policy split into DATA_PROVIDER, MODEL, COMPUTE_WORKFLOW, DATABASE_STORAGE,
  OBJECT_STORAGE_EGRESS and NOTIFICATION dimensions where free in one dimension never implies
  zero total cost; every active schedule/profile combination referencing a versioned Sustainable
  Capacity Contract covering at least 30 days of expected, peak and failure-retry workload and
  declaring candidate/event rates, operation calls and credits, streamed bytes, model tokens,
  workflow steps, database writes/rows, object bytes, egress, notifications, concurrency, retry
  allowance, protected reserves and safety margin; admission control forecasting the entire
  resolved configuration before activation and rejecting or reducing workload when expected or
  stress consumption exceeds verified plan, rate, storage, egress or monetary caps; the
  deterministic versioned degradation order preserving critical risk monitoring, alert
  verification, outcome observation, collector continuity and the interactive emergency reserve
  before social, analog, wallet-history, exploration or broad-scan depth; capacity forecasts
  reconciled against actual consumption by operation/workload/candidate/run/module with
  automatic incidents on material underestimation or reserve breach; and total and marginal
  resource cost reported per researched candidate, mature outcome, useful alert, prevented risk
  event and portfolio-utility unit without hiding owner-supplied model or infrastructure spend.
  Strictly read-only: no trading, custody, wallet-signing, private-key, or transaction-submission
  capability.
- Risk: HIGH · writeScopes: `packages/cost-router/**`, `packages/capacity-planner/**`,
  `packages/quota-forecast/**`, `packages/shared-schemas/**`, `packages/domain/**`,
  `migrations/g1_cost_*.sql`, `tests/fixtures/cost/**`, `tests/acceptance/**`,
  `tests/negative/**`, `telemetry/cost.*`
- Dependencies: none
- Verification commands: `test -d packages/cost-router && pnpm --filter @foresift/cost-router
test`; `test -d packages/capacity-planner && pnpm --filter @foresift/capacity-planner test`;
  `test -d packages/quota-forecast && pnpm --filter @foresift/quota-forecast test`
- Bound inputs at preplan time: main `9bfca5cd0147`, manifest `e0f9f1284473`, PRD `baa521d9c67e`

## Assigned requirements (normative text quoted verbatim)

### FR-COST-011 — 38. Functional requirements catalogue (PRD line 6432)

> Budget policy is split into `DATA_PROVIDER`, `MODEL`, `COMPUTE_WORKFLOW`,
> `DATABASE_STORAGE`, `OBJECT_STORAGE_EGRESS`, and `NOTIFICATION` dimensions; “free” in one
> dimension cannot imply zero total cost.

Normative level: MUST. Acceptance criteria: all 12 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37

### FR-COST-012 — 38. Functional requirements catalogue (PRD line 6433)

> Every active schedule/profile combination references a versioned Sustainable Capacity Contract
> covering expected, peak, and failure-retry workloads for at least 30 days.

### FR-COST-013 — 38. Functional requirements catalogue (PRD line 6434)

> The capacity contract declares candidate/event rates, operation calls and credits, streamed
> bytes, model tokens, workflow steps, database writes/rows, object bytes, egress, notifications,
> concurrency, retry allowance, protected reserves, and safety margin.

### FR-COST-014 — 38. Functional requirements catalogue (PRD line 6435)

> Admission control forecasts the entire resolved configuration before activation and rejects or
> reduces workload when expected or stress consumption exceeds verified plan, rate, storage,
> egress, or monetary caps.

### FR-COST-015 — 38. Functional requirements catalogue (PRD line 6436)

> Degradation order is deterministic, versioned, and preserves critical risk monitoring, alert
> verification, outcome observation, collector continuity, and interactive emergency reserve
> before social, analog, wallet-history, exploration, or broad-scan depth.

### FR-COST-016 — 38. Functional requirements catalogue (PRD line 6437)

> Capacity forecasts are reconciled against actual consumption by
> operation/workload/candidate/run/module and automatically create incidents for material
> underestimation or reserve breach.

### FR-COST-017 — 38. Functional requirements catalogue (PRD line 6438)

> The system reports total resource cost and marginal cost per researched candidate, mature
> outcome, useful alert, prevented risk event, and portfolio-utility unit without hiding
> owner-supplied model or infrastructure spend.

Normative sources beyond §38: PRD §62 (Free-First Cost, Quota, and Sustainable Capacity
Intelligence) in full — 62.2 independent budget policies + data-provider modes (STRICT_FREE /
FREE_FIRST / PAID_ALLOWED), 62.3 OperationCostPolicy (observed usage updates estimates, never
cost class), 62.4 protected reserves (nine default classes; borrowing only by equal/higher
priority; broad discovery/optional enrichment/Alpha Lab can never consume protected risk, alert,
gap-recovery, or outcome capacity), 62.5 SustainableCapacityContract interface (§ exact), 62.6
capacity enforcement (six activation block conditions), 62.7 call decision order + information
value heuristic, 62.8 default degradation order (eleven steps), 62.9 forecasting/attribution
dimensions, 62.10 provider-plan verification, 62.11 capacity regression, 62.12 no zero-cost
overclaim (seven rendering classes).

## Shared acceptance criteria

All 12 ACs attached to this package's requirements already have positive AND negative files
authored by the G0 cost-capacity package (facet-scoped headers, `tests/acceptance/helpers.ts`
conventions). This package EXTENDS those suites in place with G1 cases — never rewrites them
(I4). Quoted from the manifest:

- **AC-100**: In `STRICT_FREE`, attempted paid, unknown-cost, overage, auto-upgrade, or
  paid-fallback calls are blocked before network execution and audited.
- **AC-101**: Broad discovery quota exhaustion reduces scan breadth or returns cache; it cannot
  consume protected risk/alert reserves.
- **AC-102**: A compatible batch of token market requests produces the configured maximum safe
  batch utilization and one quota reservation per provider call.
- **AC-103**: Provider plan metadata becoming unverified transitions affected operations to
  `UNVERIFIED`/blocked rather than assuming old free limits.
- **AC-104**: Exhausting low-priority scheduler/storage/model budgets degrades enrichment or
  retention according to policy without deleting frozen evidence or stopping critical risk
  monitoring.
- **AC-105**: A nonzero approved BYOK model budget can run the headless agent while
  data-provider mode remains `STRICT_FREE` with zero paid data calls.
- **AC-224**: The supported-program collector reconnects from a killed connection, resumes from
  its durable checkpoint, detects the induced slot gap, backfills or marks it unresolved, and
  produces no duplicate canonical event.
- **AC-225**: A backfilled event retains its original chain time but receives no `available_at`
  earlier than the real retrieval time; historical replay before retrieval cannot see it.
- **AC-226**: First-seen latency is decomposed into event-to-collector, collector-to-feature,
  feature-to-decision, decision-to-delivery, and provider comparison spans for the verified
  collector scope.
- **AC-227**: A 30-day expected and stress capacity replay includes provider credits/rates,
  streamed bytes, model tokens, workflow steps, database/object growth, egress, retries,
  notifications, and reserves; activation is blocked when any verified ceiling is exceeded.
- **AC-228**: Under simulated quota exhaustion, social, analog, wallet-history, exploration, and
  broad-scan depth degrade before collector continuity, risk monitoring, alert verification,
  mature outcome collection, or protected interactive reserve.
- **AC-229**: Actual usage exceeding the capacity forecast tolerance creates an incident,
  recomputes admission limits, and does not silently consume paid overage or protected reserve.

## Non-goals

Everything below is OUT OF SCOPE for this package:

- `g1-data-truth-extensions` (PROVEN): decision-time truth, replay modes, acquisition states,
  dependence/conflict truth, economic trade normalization, supply confidence — consumed as data,
  never re-implemented here.
- `g1-solana-security` (RUNNING): Solana program/pool security analysis, system-address
  registry — no security-vocabulary surface belongs to this package.
- `g1-discovery-coverage`: discovery honesty, coverage populations, recall claims — this package
  only guarantees those workloads' protected-capacity ceilings and degradation ordering, not
  their measurement.
- `g1-execution-simulation`: execution simulation/adapters. The product stays permanently
  read-only: no trading execution, custody, wallet signing, private-key handling, or transaction
  submission anywhere in the cost/capacity plane (INV-001).
- `g1-signal-registry`: feature/signal formulas and ranking machinery — this package's
  information-value heuristic is an allocation aid only (§62.7), never a ranking input owner.
- `g1-outcome-evaluation` / `g1-objective-governance`: outcome maturity statistics and objective
  constraints — portfolio-utility-unit denominators here are attribution labels, not evaluation
  logic.
- Telemetry emitter wiring (G2 observability milestone): catalogs stay
  DECLARATIVE_CONTRACT_ONLY.
- `docs/generated/**` regeneration: `docs/generated/cost-surfaces.json` already maps
  FR-COST-001…017 implementation refs; no regeneration duty in this package (milestone
  plan-level precedent, g1-data-truth-extensions plan decision 2).
- Provider-plan verification machinery beyond what FR-COST-014 needs: `packages/quota-forecast/
src/plan-verifier.ts` is G0-proven and is consumed, not reworked (§62.10 obligations stay
  where they are).

## Planner-owned integration notes

### I1. Relationship to the G0-proven cost plane (extend, never rewrite)

The G0 surface is PROVEN and stays behaviorally intact:

- `packages/shared-schemas/src/cost.ts` (registry version 1) — extended in place, version → 2;
  existing schema shapes unchanged (additive members only).
- `packages/cost-router/src/{strict-free-guard,paid-policy,quota-adapter,reserve-router,
batch-coalescer,cost-declaration,cost-mode,cost-audit}.ts` — consumed as-is. The G0
  `ReserveId` vocabulary (4 members) is EXTENDED to the nine §62.4 classes (ADR-2); the four G0
  members keep their exact spellings and semantics.
- `packages/capacity-planner/src/{planner,resource-budgets,degrade-policy,backpressure-mapper}.ts`
  — the G0 `LOW_PRIORITY_DEGRADE_ORDER` (SOCIAL/ANALOG/WALLET_HISTORY/EXPLORATION/BROAD_SCAN)
  becomes an index into the full versioned §62.8 order (ADR-4); the G0 predicate stays as the
  low-priority-family helper it is.
- `packages/quota-forecast/src/{forecast,capacity-replay,plan-verifier,usage-ledger}.ts` — the
  30-day replay and tolerance machinery are consumed; G1 adds contract-scoped reconciliation on
  top (FR-COST-016), not a second replay engine.
- Migrations `g0_cost_0001..0004` are immutable truth; G1 lands `g1_cost_0001..0003` additively.
  The single G0 mutation is the `cost.cost_reserve_buckets.reserve_id` CHECK extension to the
  nine-member vocabulary (member-ADDITIVE only, behind a pre-migration guard, ADR-2).

### I2. Budget-dimension vocabulary reconciliation (mandated decision)

FR-COST-011's six dimension names are THE machine vocabulary. §62.2's seven policy names are
prose labels of independent budget policies; the mapping is fixed and total: `DATA_PROVIDER_
BUDGET_POLICY` ≡ DATA_PROVIDER; `MODEL_BUDGET_POLICY` ≡ MODEL; `INFRASTRUCTURE_COMPUTE_POLICY`
≡ COMPUTE_WORKFLOW; `DATABASE_STORAGE_POLICY` ≡ DATABASE_STORAGE; `OBJECT_STORAGE_EGRESS_
POLICY` ≡ OBJECT_STORAGE_EGRESS; `NOTIFICATION_POLICY` ≡ NOTIFICATION; `HUMAN_ATTENTION_POLICY`
is NOT a machine-enforced budget dimension (no deterministic consumption unit) — it survives as
the HUMAN_REVIEW_EFFORT class of cost composition (FR-COST-017, §62.12) and is always rendered,
never zero-collapsed. The data-provider mode vocabulary on the DATA_PROVIDER dimension is
§62.2's STRICT_FREE | FREE_FIRST | PAID_ALLOWED; the G0 two-value `CostMode` schema stays
untouched (plan ADR-1).

### I3. Seams this package owes later G1 packages

- Admission control (`packages/capacity-planner/src/admission.ts`) is the single activation gate
  later schedule/collector/model-route owners call before enabling anything (§62.6).
- Degradation resolution (`packages/capacity-planner/src/degrade-order.ts`) is the single
  consumer-facing order; quota-pressure paths (signal registry, execution simulation) resolve
  through it, never by private orderings.
- Reconciliation incidents (`packages/quota-forecast/src/reconciliation.ts`) are the input
  g1-objective-governance consumes for capacity regressions (§62.11).
- Cost composition (`packages/cost-router/src/composition.ts`) is the only rendering-path source
  for total/marginal cost; admin surfaces must not compute cost elsewhere.

### I4. Cross-package acceptance-criteria file ownership

AC-100…105 and AC-224…229 files are shared with other FR-COST-001…010 (G0) and FR-DISC/FR-COL
(G1) owners. This package only ADDS cases to the existing files and only under the facet-scope
convention already in their headers. No case may weaken or delete a G0 case. AC-224…226 G1
additions are strictly the cost-capacity facet (protected collector continuity, reserve floors
under degradation, backfill within budget policy) — the collector-machinery facet stays with the
collector owners.

## Binding invariants (package-level cross-cut)

1. Read-only law (INV-001): no task introduces trading/custody/signing/transaction-submission
   capability. Capacity enforcement only ADMITS, REDUCES, or REJECTS workload.
2. Never conceal exhaustion (§62.8): no paid operation is auto-selected as a degradation escape,
   and protected work is never silently dropped — the degradation order's terminal steps are
   PRESERVE_CRITICAL_OBLIGATIONS and RETURN_PARTIAL_INSUFFICIENT_DATA, never "pay silently".
3. Estimates vs classes (§62.3): observed actual usage updates estimates only; it never mutates
   a cost class automatically.
4. Zero-overclaim (§62.12): every cost composition carries all seven rendering classes; a
   zero-paid-data configuration renders nonzero total whenever any other class is nonzero.
5. Fail-closed vocabulary: every closed vocabulary below is declared once in `packages/domain`,
   imported (never restated) by `packages/shared-schemas`, and pinned by SQL CHECK literals that
   transcribe the plan data model verbatim. Unknown values throw stable ErrorCodes.
6. Protected-capacity law (§62.4): broad discovery, optional enrichment, and Alpha Lab can never
   consume protected risk, alert, gap-recovery, or outcome capacity; borrowing is
   equal/higher-priority only, under a versioned policy.

## Package success criteria

1. All seven assigned requirements (FR-COST-011…017) have executable positive AND
   negative/failure-path verification at the manifest-declared test paths — the shared
   AC-100…105 / AC-224…229 suites extended in place with G1 cases, green on this branch.
2. Migrations `g1_cost_0001..0003` apply cleanly to empty databases, are discovered by the
   fail-closed migrator (the `cost` family is already in its filename pattern — no migrator
   source change), and the central expected-script registry
   (`packages/persistence/test/migrator.spec.ts`) is extended in the same package — the
   plan-sanctioned scope exception (ADR-0019/0022 duty, g1-data-truth-extensions precedent).
3. The nine-member protected-reserve vocabulary is live in `cost.cost_reserve_buckets` (member-
   additive CHECK rebuild behind a pre-migration guard) and in domain/schema code without
   breaking any G0 suite (the four G0 members keep their spellings).
4. The versioned degradation order is queryable as data (policy rows + ordered steps) and the
   §62.8 canonical order is seeded deterministically by migration.
5. Telemetry catalog `telemetry/cost.catalog.json` is extended with the G1 events and the
   central parity suite `tests/telemetry-catalog.spec.ts` is extended in the same package — the
   plan-sanctioned scope exception (milestone plan-level decision 4).
6. `pnpm verify` and `pnpm spec:verify` pass at the pushed HEAD; the three milestone
   verification commands (cost-router, capacity-planner, quota-forecast package filters) are
   green.
7. No template placeholders remain in any scoped artifact; every task traces to an assigned
   requirement or its acceptance criteria.

## Assumptions

- PGlite remains the deterministic DB test engine (ADR-0014); cost-schema tables are accessed
  through `DatabaseEngine.query` (G0 `usage-ledger.ts` precedent) — no Drizzle mirror entries
  for `cost.*` (plan ADR-5) and therefore no `packages/persistence/**` writes at all.
- Telemetry stays DECLARATIVE_CONTRACT_ONLY until the G2 observability milestone wires emitters.
- Fixtures stay synthetic (no third-party datasets), following the G0 `tests/fixtures/cost/*.ts`
  module convention.
- All G1 packages are serialized (`parallelizable: false`), so central-suite extensions never
  race a concurrent package.
