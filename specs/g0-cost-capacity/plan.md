# Implementation Plan: g0-cost-capacity

**Package**: `g0-cost-capacity` | **Date**: 2026-08-28 | **Spec**: `specs/g0-cost-capacity/spec.md` (scoped derivative of PRD §33–37, §9.5 + manifest FR-COST-001…010)
**Authority**: PRD wins over every word below; material decisions are recorded as proposed ADR texts in this file.

## Summary

Deliver the free-first cost, quota, and sustainable-capacity control plane as three new workspace packages (`@foresift/cost-router`, `@foresift/capacity-planner`, `@foresift/quota-forecast`) plus shared Zod schemas, SQL migrations, fixtures, and the full positive + negative acceptance suites for AC-100…105, 224…229 — without editing `packages/tool-core/**`. The core is three seams already proven there: `QuotaReservationAdapter` and `LicensePolicySource` dependency-injection interfaces plus the 24-stage pipeline's exact-cache/single-flight-before-quota ordering. Cost semantics plug into those seams; capacity budgets add an independent admission dimension; forecast owns plan-metadata freshness and the 30-day capacity replay.

## Technical Context

- **Language/runtime**: TypeScript (ESM) in the existing pnpm workspace; strict mode via `tsconfig.base.json`/`tsconfig.json` glob that already picks up `packages/**` — zero root-config edits (proven by g0-contracts-data-truth).
- **Storage**: PostgreSQL via `@foresift/persistence` (`DatabaseEngine` seam); tests run on PGlite per ADR-0014. New migration family `g0_cost_*` — additive only, never alters tables owned by other packages; quota reservation state machine in `core.core_quota_reservations` is reused through the guarded helpers already proven in `packages/tool-core/src/quota-contract.ts`.
- **Validation**: Zod schemas authoritative in `packages/shared-schemas/src/cost.ts` (ADR-0013); fail-closed on every validation failure. Every external string (cost class, quota model, period window, reserve name) is parsed through a strict enum/table; unknown values throw `ForesiftError` with a stable code, never a default.
- **Audit**: sole sink is `@foresift/security`'s hash-chained `AuditChain` (already PROVEN); cost denials are typed audit records appended at stage 23 by tool-core's audit stage — this package never builds its own chain, only shapes the blocked payload that stage 23 persists.
- **Provider operation truth**: `prov.prov_operations` (provider-lifecycle) is READ-ONLY here. Declared fields — `costClass`, `quotaModelId`, `estimatedQuotaUnits`, `quotaResetPolicyId`, `batchCapability`, `minimumCandidateStage`, `protectedReserveEligible`, `allowedInStrictFree`, `verificationExpiresAt` — are the operation registry's authoritative declarations (FR-COST-001). Verification TTL (`verificationExpiresAt`) is checked at estimate time; expiry transitions to `UNVERIFIED`/blocked (AC-103).
- **Test stack**: vitest; root config covers `tests/**`, colocated suites via local `vitest.config.ts` per package (proven arrangement in `packages/tool-core`, `packages/provider-lifecycle`).

## Constitution Check

- **I. Product-Contract Authority**: every task traces to FR-COST-* / AC-100…229 quoted in spec.md; no `docs/spec/**` edits; PRD invariants INV-001, INV-002, INV-004, INV-009, INV-010 respected (see spec.md cross-cut).
- **II. Greenfield**: designed from PRD §33–37/§9.5 directly; predecessor repo not consulted.
- **III. Modular-monolith-first**: exactly three focused packages plus schemas/migrations — no broker, no service split, no speculative abstraction beyond the two seams the PRD itself demands (adapter + source) and the forecast helper. Complexity is justified by the requirement manifest's `owner` mapping (three implementationRefs per FR-COST-*).
- **IV. Read-only boundary**: no tool defined by this package carries `PROHIBITED_FINANCIAL` action; cost routing never constructs trade/sign/submit surfaces; paid-provider activation is a data-plane policy row, not a trading capability. Re-check with `scripts/scan-prohibited-capabilities/cli.mjs`.
- **V/VI. PIT & event-time**: forecast uses verified plan metadata and observed usage at the queried point-in-time; stale/unverified metadata is blocked, not assumed. Capacity replay (§37) is event-time, not ingestion-time.
- **VII. Provenance/evidence**: every cost denial carries typed provenance (candidate, caller, reason, alternative — FR-COST-007 / AC-100) preserved through the audit chain; capacity admission decisions are reconstructable from frozen quota balances + plan snapshots.
- **VIII. Fail-closed**: unknown cost class → `UNKNOWN_COST` block; unverified plan metadata → `UNVERIFIED` block; unbound quota adapter is itself deny-closed (inherited from tool-core stage 12). No silent fallthrough to free.
- **IX. Provider abstraction**: cost decisions consume the operation registry abstraction; no vendor SDK enters cost-router/planner/forecast.
- **X. Traceability**: tasks.md cites only FR-COST-001…010 within this package's assignment; AC matrix in this plan and in spec/tasks.
- **XI/XII. Deterministic + dual-path verification**: `pnpm verify` + `pnpm spec:verify`; every AC gets positive AND negative specs at the manifest-declared paths `tests/acceptance/AC-*.spec.ts` / `tests/negative/AC-*.negative.spec.ts`.
- **XIII. Idempotency/fencing**: quota reservation retains the guarded-SQL idempotent replays; batch coalescing keys include deterministic canonical JSON; paid-policy activation is immutable once recorded (new row for changes, never in-place mutation of the active policy).
- **XIV. Durable ops**: planning artifacts persisted (this loop); migration runner is idempotent; capacity replay reconstructs from persisted balances/plan snapshots.
- **XV. Least privilege/secrets**: no secrets in code/tests/fixtures; BYOK model tokens live outside vaulted secrets per security-perimeter contracts; paid-policy budget is stored as a numeric cap, not a credential.
- **XVI–XVIII. Agent governance**: completion decided by `scripts/automation/package-plan-complete.mjs` + CI; commit discipline per git history contract.

## Project Structure

```text
packages/shared-schemas/src/cost.ts          # NEW — authoritative Zod schemas for
                                             # cost declarations, quota ledgers,
                                             # reserve buckets, batch descriptors,
                                             # capacity ceilings, forecast snapshot,
                                             # paid-policy record, cost-denial audit
                                             # payload; mirrors domain vocabularies
packages/shared-schemas/src/index.ts         # extend exports
packages/domain/src/cost.ts                  # NEW — pure domain vocabularies:
                                             # CostClass, QuotaModel,
                                             # ResetPolicyKind, ReserveId,
                                             # ResourceBudgetKind, CostMode
                                             # (STRICT_FREE / PAID_ENABLED),
                                             # plus fail-closed parse helpers
packages/domain/src/index.ts                 # extend exports

packages/cost-router/                        # PRIMARY owner per manifest
  package.json  tsconfig.json  vitest.config.ts
  src/
    index.ts                 # public surface re-exports
    cost-declaration.ts      # read view over prov_operations (OperationCostDeclaration);
                             # validates that every provider operation declares the 7
                             # FR-COST-001 fields; fail-closed on gaps
    cost-mode.ts             # CostMode policy: STRICT_FREE default vs PAID_ENABLED
                             # (paid policy required → see paid-policy.ts)
    quota-adapter.ts         # QuotaReservationAdapter implementation bound to the
                             # operation registry + quota ledgers + reserve routing;
                             # hosts estimate/admit/reserve/commit/release semantics
    reserve-router.ts        # Protected-reserve bucket routing: maps workloadClass ×
                             # operation → reserveId or general pool; enforces
                             # degrade-breadth/depth before protected consumption
    batch-coalescer.ts       # Compatible-request batching using batchCapability
                             # windows; maximum-safe-batch utilization; one reservation
                             # per provider call (FR-COST-005, AC-102)
    strict-free-guard.ts     # Pre-network blocking predicate: paid/unknown/overage/
                             # auto-upgrade/paid-fallback → COST_BLOCKED with typed
                             # denial (candidate, caller, reason, alternative)
    paid-policy.ts           # Immutable paid_provider_policies table access:
                             # separate policy, explicit budget, approver, activation,
                             # re-authentication gate (FR-COST-008)
    cost-audit.ts            # Shaping of FR-COST-007 denial payloads delivered to
                             # tool-core's stage-23 audit writer
  test/
    cost-declaration.spec.ts
    quota-adapter.spec.ts
    reserve-router.spec.ts
    batch-coalescer.spec.ts
    strict-free-guard.spec.ts
    paid-policy.spec.ts
    migrations.spec.ts       # migration ordering + idempotent replay

packages/capacity-planner/                   # implements degrade-before-protected + resource caps
  package.json  tsconfig.json  vitest.config.ts
  src/
    index.ts
    degrade-policy.ts        # Broad-scan degrade strategy: reduce breadth/depth
                             # before touching protected reserves (FR-COST-004)
                             # — ordered admission: general pool first, then degrade,
                             # then return-cache, then QUOTA_EXHAUSTED
    backpressure-mapper.ts   # Maps planner decisions to BackpressurePolicy verbs
                             # consumed by tool-core stage 12 (RETURN_CACHE,
                             # DOWNGRADE_DEPTH, SKIP_LOW_PRIORITY, QUOTA_EXHAUSTED)
    resource-budgets.ts      # Independently capped budgets for scheduler, workflow,
                             # database, object-store, notification, model
                             # (FR-COST-009) — each with cap, used, forecast,
                             # degrade behavior; BYOK model namespace isolated
    planner.ts               # Composes cost-router admission + resource budgets
                             # into the single QuotaAdmissionDecision seen by
                             # stage 12
  test/
    degrade-policy.spec.ts
    resource-budgets.spec.ts
    planner.spec.ts
    migrations.spec.ts

packages/quota-forecast/                     # owns forecast freshness + capacity replay
  package.json  tsconfig.json  vitest.config.ts
  src/
    index.ts
    plan-verifier.ts         # Verifies provider plan metadata freshness via
                             # verificationExpiresAt; unverified → UNVERIFIED block
                             # rather than assumption (FR-COST-006, AC-103)
    usage-ledger.ts          # Observed-usage counters per (provider, quotaModel,
                             # periodWindow) supporting 30-day replay inputs
    forecast.ts              # Cost forecast = current verified plan limits × observed
                             # usage; returns estimated vs actual, ceiling, tolerance
    capacity-replay.ts       # 30-day expected + stress replay: credits/rates,
                             # streamed bytes, model tokens, workflow steps, DB/object
                             # growth, egress, retries, notifications, reserves;
                             # activation blocked when any verified ceiling exceeded
                             # (AC-227); drift incident when actual exceeds forecast
                             # tolerance (AC-229)
  test/
    plan-verifier.spec.ts
    forecast.spec.ts
    capacity-replay.spec.ts
    migrations.spec.ts

migrations/
  g0_cost_0001_cost_ledgers.sql             # cost QuotaBalances + ReserveBuckets +
                                            # QuotaUsageCounters (periodWindow, caps,
                                            # remaining, consumedActual)
  g0_cost_0002_paid_policies.sql            # paid_provider_policies: immutable policy
                                            # rows (budget, approver, activationAt,
                                            # reAuthDueAt, active flag)
  g0_cost_0003_capacity_budgets.sql         # resource_budgets: six ceilings
                                            # (scheduler/workflow/db/object/
                                            # notification/model) + per-budget counters
  g0_cost_0004_resource_forecast_snapshots.sql
                                            # forecast snapshots + 30-day replay inputs

tests/fixtures/cost/                         # provider fixtures, operation registry
                                             # snapshots, batch inputs, forecast plan
                                             # fixtures, paid-policy fixtures
tests/acceptance/AC-100.spec.ts              # NEW (×12) + tests/negative/AC-*.negative.spec.ts
… AC-101…105, AC-224…229                     # shared across FR-COST-001…010 — each AC
                                             # exercised once, tagged in file headers
telemetry/cost.catalog.json                  # declarative cost event-contract catalog
                                             # (fields mirror schemas; emitter wiring
                                             # deferred to G2 observability — same pattern
                                             # as telemetry/core.catalog.json, prov, dr)
```

### Why three packages

The manifest assigns every FR-COST-* to all three `implementationRefs` (`cost-router/**`, `capacity-planner/**`, `quota-forecast/**`). The split mirrors vocabulary boundaries: **cost-router** owns the per-call quota decision (cost declarations, STRICT_FREE enforcement, reservation lifecycle, batch coalescing, paid-policy gating); **capacity-planner** owns the admission ordering that sits above it (degrade-breadth/depth-before-reserve, six independent resource ceilings, backpressure mapping); **quota-forecast** owns the time dimension (verified plan freshness, usage observation, forecast computation, 30-day capacity replay + incident). Each package is independently testable; together they bind to the two tool-core seams from a single composition root.

## Data Model

### OperationCostDeclaration (read view, FR-COST-001)

A validated projection of `prov.prov_operations` columns plus a completeness check. Fields: `costClass` (enum FREE_UNMETERED | FREE_QUOTA | PAID_EXPLICIT | UNKNOWN_COST | DISABLED), `quotaModelId`, `quotaUnitCost` (derived from `estimatedQuotaUnits`), `resetPolicyId`, `batchCapability` (nullable JSON — null means unbatchable), `minimumCandidateStage`, `protectedReserveEligible`, `allowedInStrictFree`. The reader refuses (`UNKNOWN_COST`) if any column is unexpectedly null or holds an unrecognized enum — never defaults.

### QuotaLedger (g0_cost_0001)

Rows keyed `(providerId, quotaModelId, periodWindowStart, reserveId?)`. Columns: `capLimit`, `remainingUnits`, `consumedReserved`, `consumedCommitted`, `periodResetAt`. General pool and each named reserve are distinct rows (reserveId = null vs `RISK_MONITORING` etc.). Reserved units decrement `remainingUnits` atomically with the guarded INSERT into `core.core_quota_reservations`; commit moves reservation units to `consumedCommitted`; release/expire restores `remainingUnits`. Period rollover is explicit: `periodResetAt` is derived from `quotaResetPolicyId` (daily/weekly/monthly/rolling-window).

### PaidProviderPolicy (g0_cost_0002, immutable — FR-COST-008)

Columns: `policyId` (sha/hash over canonical policy JSON), `providerId`, `budgetUnits`, `budgetCurrencyOrModel`, `approvedBy`, `approvedAt`, `activatedAt`, `reAuthDueAt`, `active` (bool), `supersededBy` nullable. Insertion requires `approvedBy` + `approvedAt` + `activatedAt` all present; activation is an explicit state transition (`active=true`) with prior policies superseded via `supersededBy` link — never in-place budget mutation. Expired `reAuthDueAt` renders the policy inactive → paid data calls block again until re-authenticated.

### ResourceBudgets (g0_cost_0003, FR-COST-009)

Six rows (one per `ResourceBudgetKind`: `SCHEDULER_SLOTS`, `WORKFLOW_STEPS`, `DATABASE_BYTES`, `OBJECT_STORE_BYTES`, `NOTIFICATION_RATE`, `MODEL_TOKENS_BYOK`). Columns: `kind`, `capLimit`, `used`, `forecastUsed`, `degradeBehavior` (enum), `ceilingExceededAt` nullable. Model budget namespace is disjoint: `MODEL_TOKENS_BYOK` has no FK to any data-provider quota row. BYOK increment never touches data-provider `QuotaLedger` remaining (verified by AC-105).

### ForecastSnapshots (g0_cost_0004, FR-COST-006)

Columns: `snapshotId`, `planVersionId`, `verifiedAt`, `expiresAt` (from provider plan verification TTL), `planLimitsJson` (canonical), `observedUsageJson`, `estimatedForecastJson`, `createdAt`. A snapshot transitions operations governed by that `planVersionId` to `UNVERIFIED` once `now > expiresAt` until a fresh verified snapshot arrives; forecast is always computed from the latest verified snapshot, never a stale one.

### Audit denial shape (FR-COST-007)

Typed failure record: `candidate` (operationId/provider), `caller` (actor profile + pipelineRunId), `reason` (machine code from strict-freeGuard or quota ledger), `alternative` (degrade description or `RETURN_CACHE`). Written via tool-core stage 23 as an `AuditChain` entry; never invents content — rejected before any egress.

## Component Behaviors

### cost-router: QuotaReservationAdapter implementation

Satisfies `packages/tool-core/src/quota-contract.ts`:

- `estimate(request)` — loads OperationCostDeclaration for `(provider, operation)`, validates costClass, checks plan verification freshness via quota-forecast's `plan-verifier` (if the governing snapshot is unverified, throws `UNKNOWN_COST`-family before ever touching ledgers), returns `{quotaModel, estimatedUnits}` derived from the declaration's quota cost.
- `admit(request + estimate)` — consults cost-mode + quota ledgers + reserve-router + capacity-planner in order: (1) STRICT_FREE guard, (2) capacity-planner's resource-budget admission (independent), (3) quota ledger admission (reserve-aware). Any refusal is `{allowed:false, reason}` with a stable machine prefix (`STRICT_FREE_BLOCKED:…`, `QUOTA_EXHAUSTED:…`, `UNVERIFIED_PLAN:…`). The reason maps 1:1 to a BackpressureAction in capacity-planner.
- `reserve/commit/release` — delegate to the guarded helpers in `quota-contract.ts` while maintaining the cost ledger balances (`remainingUnits` accounting) inside the same transaction; batch coalescing collapses compatible requests ahead of reserve (see below).
- Idempotency: `reserve` is keyed by `(pipelineRunId, stage)` unique as proven in g0-tool-core; replayed reserve with same key is a no-op rather than a second ledger debit.

### cost-router: STRICT_FREE guard (FR-COST-002, AC-100)

Deny-closed predicate evaluated before any network-adjacent work:

- paid costClass (`PAID_EXPLICIT`) → block `PAID_BLOCKED`.
- `UNKNOWN_COST` / disabled → block `UNKNOWN_COST`.
- estimated usage would exceed `remainingUnits` for the period → `QUOTA_EXHAUSTED` (overage).
- operation's `batchCapability` indicates an automatic tier/billing upgrade path → `AUTO_UPGRADE_BLOCKED`.
- operation would require falling back to a paid alternative to satisfy the request → `PAID_FALLBACK_BLOCKED`.
- Any block short-circuits the pipeline at stage 12 (stage block) with `COST_BLOCKED` and the denial is audited with candidate/caller/reason/alternative.

### cost-router: reserve-router / protected reserves (FR-COST-003/004)

Four named reserves: `RISK_MONITORING`, `ALERT_VERIFICATION`, `INTERACTIVE_MCP`, `EMERGENCY_BACKFILL`. Each has a dedicated `QuotaLedger` row and an eligibility rule (`protectedReserveEligible && workloadClass ∈ eligible set`). Broad scans (`BACKFILL_LOW`, `EVALUATION_LOW`, `SCHEDULED_NORMAL`) are never routed to reserves; when the general pool is exhausted they degrade (see planner) rather than consume a reserve. Conservation is enforced by never debiting a reserve row outside its eligible workload classes — tested by AC-101/AC-228.

### cost-router: batch coalescing (FR-COST-005, AC-102)

Controlled by `batchCapability` (e.g., `{maxBatchSize: N, safeMaxUtilization: 0.8, keyFields:[...]}`). Inputs queued within the provider's coalescing window are grouped by `(provider, operation, batch-key)` and emitted as one provider call up to `maxBatchSize`. The adapter charges exactly one reservation per provider call; batch utilization (actual/ max) is emitted in telemetry. Importantly, stages 6–11 (exact-cache + single-flight) run ahead of quota reservation per the frozen pipeline sequence, so a cache-hit or single-flight dedupe prevents any quota charge at all — no special ordering logic needed beyond honoring the sequence.

### cost-router: paid-policy lifecycle (FR-COST-008, FR-COST-010)

A paid data-provider call is permitted ONLY when an immutable policy row exists with `active=true`, `activatedAt <= now < reAuthDueAt`, `budgetUnits` sufficient, and verification still fresh. Activation requires an explicit `activate(policyId)` step that records `approver` and flips `active`; a separate `reAuthenticate(policyId)` step extends `reAuthDueAt`. No data-provider path reads the BYOK model budget. The BYOK budget lives entirely in capacity-planner's `MODEL_TOKENS_BYOK` resource budget and is exercised by AC-105 while data-provider calls stay STRICT_FREE.

### capacity-planner: degrade-policy & backpressure mapping

Degrade order for broad discovery / backfill exhaustion (FR-COST-004): (1) reduce scan breadth (fewer candidates / narrower universe), (2) reduce scan depth (fewer fields / shallower history), (3) then — and only then — would a reserve be considered, but planner never reaches that step for breadth/depth workloads because reserves are ineligible for them. The resulting `BackpressureAction` values fed to stage 12 are `DOWNGRADE_DEPTH` / `RETURN_CACHE` / `SKIP_LOW_PRIORITY` before `QUOTA_EXHAUSTED`; tool-core already implements `DOWNGRADE_DEPTH` as a one-time narrowed-projection retry, so planner only needs to choose the action.

### capacity-planner: resource budgets (FR-COST-009)

Six independently forecasted and capped dimensions — scheduler concurrency, workflow step count, DB growth, object-store bytes, notification rate, model tokens. Each has its own forecast model and counter; exhausting one degrades exactly its dependent workload (enrichment → thinner output; retention → older tier trimmed) without deleting frozen evidence or halting critical risk monitoring (AC-104). Failure mode is contained per budget; cross-budget leakage is a test failure. The forecast inputs for the six budgets come from quota-forecast's usage ledger + capacity replay; ceilings are verified ahead of activation (AC-227).

### quota-forecast: plan verifier, usage ledger, forecast & capacity replay

- **plan-verifier** — watches `verificationExpiresAt` on every operation's governing plan snapshot; when a snapshot is stale, dependent operations become `UNVERIFIED` and estimates throw rather than use stale limits (AC-103). Re-verification (fresh documentation/pricing/rights TTL from provider-lifecycle) clears the UNVERIFIED state.
- **forecast** — combines the current verified `planLimitsJson` with `observedUsageJson` to produce an expected usage + stress replay window (tool calls × per-call cost × period). Outputs `estimatedForecast`, `actualObserved`, `delta`, `withinTolerance` boolean. Tolerance breach raises an incident, recomputes admission caps, and never silently spends paid overage or reserve (AC-229).
- **capacity-replay** — 30-day expected and stress variant replay enumerating every budgeted dimension (credits/rates, bytes, tokens, steps, growth, egress, retries, notifications, reserves). If any verified ceiling is exceeded in replay, activation of the planned release is blocked. Low-priority degradation ordering is asserted against the simulated exhaustion replay (AC-227/AC-228). Collector/gap invariants from AC-224/225 (checkpoint resume without duplicates, available_at no earlier than retrieval) run within the cost package's suites as substrate — their collector substrate is owned elsewhere, but this package asserts that cost admission does not interfere with collector continuity.

## Verification Strategy (per acceptance criterion)

Every AC below carries a positive suite at `tests/acceptance/AC-*.spec.ts` and a negative/failure suite at `tests/negative/AC-*.negative.spec.ts` per the manifest's declared `testRefs`. Where an AC is already labeled `objective-collector-execution` but attached to this package (224/225/226/227/228/229), the scoped suites assert the **cost/capacity facet** of that objective — never the collector internals — and the file header comments explicitly delimit substrate scope to avoid orphan code claims.

| AC         | Text (short)                                                                                           | Positive coverage                                                                                                                                                                                                           | Negative/failure                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC-100** | STRICT_FREE blocks before egress + audit                                                               | Register paid/unknown/overage/auto-upgrade/paid-fallback operations; run pipeline in STRICT_FREE; assert `COST_BLOCKED` before stage 14 with no egress side effect; audit entry carries candidate/caller/reason/alternative | Mutation of one field (costClass→PAID, batchCapability upgrade flag, over-quota) must also block; replay of blocked call remains blocked; audit entry still written |
| **AC-101** | Protected reserves not consumed by broad discovery                                                     | Exhaust general pool; assert broad scan breadth reduction or cached return; assert reserve remaining unchanged (all four reserves)                                                                                          | Attempt to directly address a reserve-eligible operation via a broad-scan workload class → refused; second exhaustion wave still cannot touch reserves              |
| **AC-102** | Batch coalescing → max safe utilization + one reservation per provider call                            | Queue compatible token-market requests through coalescer; assert one reservation row, batch size = configured max, per-item cost reflects coalesced window                                                                  | Ungroupable requests produce separate reservations; malformed batchCapability never merges across providers                                                         |
| **AC-103** | Unverified plan metadata transitions to UNVERIFIED/blocked                                             | Expire verification of an operation's governing plan snapshot; assert `estimate` refuses with `UNVERIFIED` and does not assume old free limits; re-verification clears                                                      | Replay using a stale snapshot held in a closure still refuses; cross-provider expiry does not bleed                                                                 |
| **AC-104** | Scheduler/storage/model cap exhaustion degrades non-critically                                         | Exhaust each of the six budgets individually; assert enrichment/retention degrade per policy; frozen evidence rows untouched; risk monitor still runs                                                                       | Exhaustion that would delete frozen evidence is refused; simultaneous exhaustion of two budgets degrades both without double-counting                               |
| **AC-105** | BYOK model budget does not lift data-provider STRICT_FREE                                              | Activate nonzero BYOK model budget; run headless agent consuming model tokens; assert data-provider calls still STRICT_FREE (zero paid data reservations)                                                                   | Data-provider paid attempt with BYOK budget present still blocks; model-token exhaustion does not borrow from data quota                                            |
| **AC-224** | Collector reconnect + checkpoint resume — cost facet                                                   | Cost package suite runs a cost-admission-through-collector integration: kill/collector path, resume, assert cost admission does not invent duplicate charges/evidence                                                       | Cost ledger has no duplicate reservation after replayed collector window                                                                                            |
| **AC-225** | Backfill available_at no earlier than retrieval — cost facet                                           | Backfilled-event cost accounting uses retrieval time as available_at, not chain time                                                                                                                                        | Historical replay before retrieval sees no cost impact from backfilled window                                                                                       |
| **AC-226** | First-seen latency decomposition — cost facet                                                          | Headless latency spans computed through the cost admission path; provider-comparison span includes cost-bounded alternative                                                                                                 | Cost-path latency not inflated by reserve routing                                                                                                                   |
| **AC-227** | 30-day expected + stress capacity replay blocks on any ceiling                                         | Run `capacity-replay` in both modes (all dimensions including reserves); assert activation blocked when any verified ceiling exceeded                                                                                       | Mixed verifier: one ceiling exceeded out of N blocks overall activation                                                                                             |
| **AC-228** | Quota exhaustion degradation order: social/analog/wallet/exploration/broad-scan before protected paths | Simulated exhaustion replay degrades exactly the low-priority set; collector/risk/alert/mature-outcome/interactive reserve preserved                                                                                        | Reordered workload priority never elevates broad-scan over protected                                                                                                |
| **AC-229** | Forecast tolerance breach → incident + recomputed caps, no silent paid/reserve spend                   | Over-consume beyond tolerance; assert incident created, caps recomputed downward, neither paid overage nor reserve consumed                                                                                                 | Second over-consume within same period still incidents individually                                                                                                 |

### Unit + contract tests (colocated per package — not part of the 12 scoped ACs but required for gate)

- `packages/cost-router/test/**` — cost declaration completeness; STRICT_FREE predicate branches; quota-adapter state-machine congruence with tool-core helpers; batch grouping equivalence; paid-policy immutability invariant.
- `packages/capacity-planner/test/**` — degrade ordering deterministic; backpressure mapping injective; per-budget cap enforcement independent; BYOK namespace isolation.
- `packages/quota-forecast/test/**` — plan-verifier TTL edge (one-second before/after expiry); forecast arithmetic; tolerance-boundary incidents; 30-day replay determinism snapshot.
- `migrations.spec.ts` (each package) — migration filenames known, ordering enforced, checksum-pinned, apply-on-PGlite idempotent; failure uses `MIGRATION_APPLY_ALREADY_RUNNING`-family codes matching proven siblings.

## Migrations

Naming follows the proven pattern (`migrations/g0_core_*.sql`, `g0_prov_*.sql`, `g0_data_*.sql`): `g0_cost_0001`…`g0_cost_0004` in strict lexical order so `packages/persistence`'s ordered runner can merge across families without timestamp collisions. Each file is one transaction with `IF NOT EXISTS`-safe DDL and a `down` comment header noting rollback strategy (drop only when no data, otherwise documented manual step per FR-DR rollback guidance).

| File                                           | Tables / constraints                                                                                                                                                          | Invariant                                                                                                                                                                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `g0_cost_0001_cost_ledgers.sql`                | `cost_quota_balances` (pk: providerId, quotaModelId, periodWindow), `cost_reserve_buckets` (pk: reserveId, providerId, periodWindow), `cost_usage_counters` (observed counts) | `remainingUnits = capLimit − consumedReserved − consumedCommitted` check; reserve buckets FK to parent balance; no reserve row consumed outside eligible workload classes                                                            |
| `g0_cost_0002_paid_policies.sql`               | `paid_provider_policies` per schema above                                                                                                                                     | `active` uniqueness per provider (partial unique index on active=true); `reAuthDueAt > activatedAt` check; immutability: no UPDATE of budget/approver once active (enforced by trigger or revoked grants; tests assert UPDATE fails) |
| `g0_cost_0003_capacity_budgets.sql`            | `capacity_resource_budgets` (six kinds)                                                                                                                                       | `used ≤ capLimit` invariant; kind enum CHECK; BYOK kind never joined to data quota                                                                                                                                                   |
| `g0_cost_0004_resource_forecast_snapshots.sql` | `resource_forecast_snapshots`, `capacity_replay_runs`                                                                                                                         | Snapshot expiry check; replay blocking flag; incident FK on tolerance breach                                                                                                                                                         |

## Telemetry

One declarative catalog `telemetry/cost.catalog.json` (pattern from `telemetry/core.catalog.json` + prov + dr): events `cost.blocked`, `cost.quota_committed`, `cost.quota_released`, `cost.quota_expired`, `cost.reserve_consumed`, `cost.batch_coalesced`, `cost.forecast_computed`, `cost.plan_unverified`, `cost.paid_policy_activated`, `cost.capacity_replay_blocked`, `cost.resource_budget_exhausted`, `cost.forecast_tolerance_breached`. Fields mirror the authoritative Zod schemas in `packages/shared-schemas/src/cost.ts` exactly. Contract is declarative only — emitter wiring lands with G2 observability (dependency group G2) and is not part of this package's verification; required catalog shape is asserted by a unit test.

## Material decisions (proposed ADR texts — bind future packages)

### ADR — Cost-ledger accounting model

**Decision**: Quota consumption is accounted at two distinct moments — reservation (decrement `remainingUnits`) and settlement (commit moves units from `consumedReserved` → `consumedCommitted`; release/expire restores `remainingUnits`). Ledger and reservation rows are updated inside one transaction so the two never drift. Period rollover creates a new balance row; old rows are retained for audit/PIT replay.

### ADR — Reserve eligibility is declaration-bound

**Decision**: Whether an operation may debit a protected reserve is decided solely from the operation declaration's `protectedReserveEligible` + the call's `workloadClass`, never from ad-hoc caller flags. A broadcast broad-scan cannot smuggle its work into a risk-monitoring reserve by setting a header — the router refuses workload classes outside the eligible set for each reserve.

### ADR — Paid-provider isolation by namespace

**Decision**: Paid data-provider activation and BYOK model budget are disjoint namespaces with no shared counter, limit, or capability. A paid policy gates data-provider calls; a nonzero BYOK budget enables model-token consumption; neither enables the other. The composition root binds them through separate adapter instances that never share state.

## Risks and mitigations (planning-level)

| Risk                                                          | Likelihood | Impact | Mitigation                                                                                          |
| ------------------------------------------------------------- | ---------- | ------ | --------------------------------------------------------------------------------------------------- |
| Stale plan metadata keeps old free limits                     | Medium     | HIGH   | `plan-verifier` TTL block at estimate time (AC-103); forecast snapshots carry expiry                |
| Protected reserve invasion under scan pressure                | Medium     | HIGH   | Degrade logic before reserve lookup; eligibility tied to declaration + workloadClass; AC-228 replay |
| Paid/data BYOK budget confusion                               | Low        | HIGH   | Namespace isolation + AC-105 double-run                                                             |
| Batch coalescing hides overage                                | Low        | MEDIUM | Reservation 1:1 with provider calls; telemetry batch size observable                                |
| Migration merge-order drift with tool-core/provider-lifecycle | Low        | MEDIUM | `g0_cost_*` namespace + ordered runner; never alter foreign tables                                  |

## Non-goals reaffirmed (must not creep into tasks.md)

No trading/custody/signing surfaces, no provider adapter implementations (provider-lifecycle's job), no pipeline stage ordering or reservation SQL state-machine edits, no telemetry emitter wiring (G2), no Alpha Lab import logic, no MCP surface routing.

## Validation

```bash
node scripts/automation/package-plan-complete.mjs \
  --package g0-cost-capacity \
  --artifacts-dir /home/minhquan_eth/.archon/workspaces/quantm-zeus/foresift/artifacts/runs/c4cea00a12022bcdb65b06a1ab51f369

# Overall gates at the pushed HEAD (not planning-only):
pnpm verify
pnpm spec:verify
```
