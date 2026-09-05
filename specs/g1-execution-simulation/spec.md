# g1-execution-simulation — scoped specification

> This file is a SUBORDINATE DERIVATIVE of the authoritative product contract
> `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md`. It was seeded mechanically from
> the requirement manifest by `scripts/automation/bootstrap-package-spec.mjs` (builder v1). The PRD
> always wins over any wording below.

## Authority binding

- Milestone: `G1` (ACTIVE)
- Objective: Build the read-only execution simulation foundation: opportunity profiles defining
  signal and tradable outcome semantics; simulation over versioned notionals, action delays,
  entry/exit policies, price impact, partial fills and available liquidity; net return including
  pool fees, token transfer fees, priority/network fees and execution impact; target touch requiring
  executable volume or configured target-duration support so an isolated wick cannot automatically
  count as tradable success; permanent read-only enforcement with no transaction construction or
  submission anywhere in the simulator; SIGNAL_SUCCESS never rendered as profit when
  TRADABLE_SUCCESS is absent or failed; tradability blocking CONFIRMED_OPPORTUNITY while preserving
  diagnostic signal labels; alert content exposing configured notional, delay, modeled impact,
  assumptions and expiry; multiple exit policies evaluated only as pre-registered separate
  experiments and never retrospectively best-picked for the primary result; replay manifests
  freezing execution assumptions and code versions; finite selective outcome-observation plans for
  promoted/alerted/control-sample candidates where insufficient temporal/liquidity resolution cannot
  prove tradable success; production tradability under versioned conservative stress assumptions for
  quote latency, adverse selection/MEV, fee volatility and liquidity deterioration; versioned
  PoolMathAdapter/TransferSemanticsAdapter resolution keyed by chain, program, program version,
  curve type and account-layout version with historical execution storing the exact slot/block, raw
  account-state hashes, reserves, ticks/bin arrays/curve state, fee configuration, oracle/quote
  inputs, token extensions, route, adapter version and state-completeness assessment per simulation;
  generic constant-product math only for verified constant-product pools with
  concentrated-liquidity, discrete-bin, stable-swap, dynamic-fee, bonding-curve, virtual-reserve and
  unknown designs requiring their own adapter or returning EXECUTION_UNAVAILABLE; every active
  adapter passing deterministic unit/property tests, protocol fixtures, historical observed-trade
  parity, current reference-quote parity when available, boundary/overflow tests and
  version-specific tolerance gates; required base, p50-delay, p90-delay and conservative
  latency/adverse-selection/liquidity-drawdown/fee-volatility/route-degradation/failed-partial-fill
  scenarios declared per active profile; entry/exit modeling of token transfer fees/hooks, account
  creation/rent, network/priority fees, aggregator and pool fees, minimum output, failed attempts,
  partial fills, retry latency, route capacity and unexecutable residual inventory; concurrent
  shadow positions sharing pool, route, quote asset, liquidity source, deployer cluster or
  correlated exit window aggregating impact and capacity so isolated fills cannot each consume the
  same depth; quote/reference sources as evidence-not-truth with exposed uncertainty that blocks
  confirmed tradability when the bound crosses policy limits; automatic tradability degradation on
  adapter deprecation, program upgrade, parity drift or unknown extension re-evaluating active
  alerts/watchlists without rewriting historical simulations; and route selection never
  retrospectively choosing a route or pool unavailable at action time with migration routing
  following only transitions known and executable at that time. Internal staging order for
  deterministic task sharding: shared-schemas/domain vocabularies first, then adapters, then the
  simulator core, then replay manifests, then parity gates, then stress scenarios and degradation.
  Strictly read-only: no trading, custody, wallet-signing, private-key, or transaction-submission
  capability.
- Risk: HIGH · writeScopes: `packages/execution-simulator/**`, `packages/pool-math/**`,
  `packages/transfer-semantics/**`, `packages/shared-schemas/**`, `packages/domain/**`,
  `migrations/g1_exec_*.sql`, `tests/fixtures/exec/**`, `tests/acceptance/**`, `tests/negative/**`,
  `telemetry/exec.*`
- Dependencies: `g1-data-truth-extensions` PROVEN, `g1-solana-security` PROVEN
- Bound inputs at seed time: main `aed5b1badd46`, manifest `e0f9f1284473`, PRD `baa521d9c67e`

## Assigned requirements (normative text quoted verbatim)

### FR-EXEC-001 — 38. Functional requirements catalogue (PRD line 6156)

> Every opportunity profile defines signal and tradable outcome semantics.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/exec.ts`
- Fixture refs: `tests/fixtures/exec/`
- Telemetry refs: `telemetry/exec.*`

### FR-EXEC-002 — 38. Functional requirements catalogue (PRD line 6157)

> Execution simulation supports versioned notionals, action delays, entry/exit policies, price
> impact, partial fills, and available liquidity.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/exec.ts`
- Fixture refs: `tests/fixtures/exec/`
- Telemetry refs: `telemetry/exec.*`

### FR-EXEC-003 — 38. Functional requirements catalogue (PRD line 6158)

> Net return includes pool fees, token transfer fees, priority/network fees, and execution impact.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/exec.ts`
- Fixture refs: `tests/fixtures/exec/`
- Telemetry refs: `telemetry/exec.*`

### FR-EXEC-004 — 38. Functional requirements catalogue (PRD line 6159)

> Target touch requires executable volume or configured target-duration support; an isolated wick
> cannot automatically count as tradable success.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/exec.ts`
- Fixture refs: `tests/fixtures/exec/`
- Telemetry refs: `telemetry/exec.*`

### FR-EXEC-005 — 38. Functional requirements catalogue (PRD line 6160)

> Execution simulation is read-only and cannot construct or submit transactions.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/exec.ts`
- Fixture refs: `tests/fixtures/exec/`
- Telemetry refs: `telemetry/exec.*`

### FR-EXEC-006 — 38. Functional requirements catalogue (PRD line 6161)

> `SIGNAL_SUCCESS` cannot be rendered as profit when `TRADABLE_SUCCESS` is absent or failed.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/exec.ts`
- Fixture refs: `tests/fixtures/exec/`
- Telemetry refs: `telemetry/exec.*`

### FR-EXEC-007 — 38. Functional requirements catalogue (PRD line 6162)

> Tradability can block `CONFIRMED_OPPORTUNITY` while preserving diagnostic signal labels.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/exec.ts`
- Fixture refs: `tests/fixtures/exec/`
- Telemetry refs: `telemetry/exec.*`

### FR-EXEC-008 — 38. Functional requirements catalogue (PRD line 6163)

> Alert content exposes configured notional, delay, modeled impact, assumptions, and expiry.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/exec.ts`
- Fixture refs: `tests/fixtures/exec/`
- Telemetry refs: `telemetry/exec.*`

### FR-EXEC-009 — 38. Functional requirements catalogue (PRD line 6164)

> Multiple exit policies are evaluated only as pre-registered separate experiments; the system never
> chooses the best policy retrospectively for the primary result.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/exec.ts`
- Fixture refs: `tests/fixtures/exec/`
- Telemetry refs: `telemetry/exec.*`

### FR-EXEC-010 — 38. Functional requirements catalogue (PRD line 6165)

> Execution assumptions and code versions are frozen in replay manifests.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/exec.ts`
- Fixture refs: `tests/fixtures/exec/`
- Telemetry refs: `telemetry/exec.*`

### FR-EXEC-011 — 38. Functional requirements catalogue (PRD line 6166)

> Promoted/alerted/control-sample candidates receive a finite selective outcome-observation plan;
> insufficient temporal/liquidity resolution cannot prove tradable success.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/exec.ts`
- Fixture refs: `tests/fixtures/exec/`
- Telemetry refs: `telemetry/exec.*`

### FR-EXEC-012 — 38. Functional requirements catalogue (PRD line 6167)

> Production tradability uses versioned conservative stress assumptions for quote latency, adverse
> selection/MEV, fee volatility and liquidity deterioration.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/exec.ts`
- Fixture refs: `tests/fixtures/exec/`
- Telemetry refs: `telemetry/exec.*`

### FR-EXEC-013 — 38. Functional requirements catalogue (PRD line 6445)

> Each supported pool, launch curve, migration route, and token transfer path resolves to a
> versioned `PoolMathAdapter`/`TransferSemanticsAdapter` keyed by chain, program, program version,
> curve type, and account-layout version.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/exec.ts`
- Fixture refs: `tests/fixtures/exec/`
- Telemetry refs: `telemetry/exec.*`

### FR-EXEC-014 — 38. Functional requirements catalogue (PRD line 6446)

> Historical execution stores the exact slot/block, raw account-state hashes, reserves, ticks/bin
> arrays/curve state, fee configuration, oracle/quote inputs, token extensions, route, adapter
> version, and state-completeness assessment used for each simulation.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/exec.ts`
- Fixture refs: `tests/fixtures/exec/`
- Telemetry refs: `telemetry/exec.*`

### FR-EXEC-015 — 38. Functional requirements catalogue (PRD line 6447)

> Generic constant-product math is allowed only for a verified constant-product pool;
> concentrated-liquidity, discrete-bin, stable-swap, dynamic-fee, bonding-curve, virtual-reserve,
> and unknown designs require their own adapter or return `EXECUTION_UNAVAILABLE`.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/exec.ts`
- Fixture refs: `tests/fixtures/exec/`
- Telemetry refs: `telemetry/exec.*`

### FR-EXEC-016 — 38. Functional requirements catalogue (PRD line 6448)

> Every active adapter passes deterministic unit/property tests, protocol fixtures, historical
> observed-trade parity, current reference-quote parity when available, boundary/overflow tests, and
> version-specific tolerance gates.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/exec.ts`
- Fixture refs: `tests/fixtures/exec/`
- Telemetry refs: `telemetry/exec.*`

### FR-EXEC-017 — 38. Functional requirements catalogue (PRD line 6449)

> Production tradability evaluates base, p50-delay, p90-delay, conservative
> latency/adverse-selection, liquidity-drawdown, fee-volatility, route-degradation, and
> failed/partial-fill scenarios; the active profile declares which must pass.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/exec.ts`
- Fixture refs: `tests/fixtures/exec/`
- Telemetry refs: `telemetry/exec.*`

### FR-EXEC-018 — 38. Functional requirements catalogue (PRD line 6450)

> Entry and exit simulation model token transfer fees/hooks, account creation/rent when relevant,
> network/priority fees, aggregator and pool fees, minimum output, failed attempts, partial fills,
> retry latency, route capacity, and unexecutable residual inventory.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/exec.ts`
- Fixture refs: `tests/fixtures/exec/`
- Telemetry refs: `telemetry/exec.*`

### FR-EXEC-019 — 38. Functional requirements catalogue (PRD line 6451)

> Concurrent shadow positions sharing a pool, route, quote asset, liquidity source, deployer
> cluster, or correlated exit window aggregate impact and capacity; isolated fills cannot each
> consume the same depth.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/exec.ts`
- Fixture refs: `tests/fixtures/exec/`
- Telemetry refs: `telemetry/exec.*`

### FR-EXEC-020 — 38. Functional requirements catalogue (PRD line 6452)

> Quote/reference sources are evidence, not execution truth; simulation exposes uncertainty when
> state is incomplete or parity is weak and blocks confirmed tradability when the uncertainty bound
> crosses policy limits.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/exec.ts`
- Fixture refs: `tests/fixtures/exec/`
- Telemetry refs: `telemetry/exec.*`

### FR-EXEC-021 — 38. Functional requirements catalogue (PRD line 6453)

> Adapter deprecation, program upgrade, parity drift, or unknown extension automatically degrades
> affected tradability and re-evaluates active alerts/watchlists without rewriting historical
> simulations.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/exec.ts`
- Fixture refs: `tests/fixtures/exec/`
- Telemetry refs: `telemetry/exec.*`

### FR-EXEC-022 — 38. Functional requirements catalogue (PRD line 6454)

> Route selection cannot retrospectively choose a route or pool unavailable at action time, and
> migration routing follows only transitions known and executable at that time.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/exec.ts`
- Fixture refs: `tests/fixtures/exec/`
- Telemetry refs: `telemetry/exec.*`

## Shared acceptance criteria

Attached to more than one requirement of this package — implement once, satisfy everywhere:

- **AC-120** · positive: `tests/acceptance/AC-120.spec.ts` · negative/failure:
  `tests/negative/AC-120.negative.spec.ts` — attached to 22 requirements
- **AC-121** · positive: `tests/acceptance/AC-121.spec.ts` · negative/failure:
  `tests/negative/AC-121.negative.spec.ts` — attached to 22 requirements
- **AC-122** · positive: `tests/acceptance/AC-122.spec.ts` · negative/failure:
  `tests/negative/AC-122.negative.spec.ts` — attached to 22 requirements
- **AC-123** · positive: `tests/acceptance/AC-123.spec.ts` · negative/failure:
  `tests/negative/AC-123.negative.spec.ts` — attached to 22 requirements
- **AC-124** · positive: `tests/acceptance/AC-124.spec.ts` · negative/failure:
  `tests/negative/AC-124.negative.spec.ts` — attached to 22 requirements
- **AC-125** · positive: `tests/acceptance/AC-125.spec.ts` · negative/failure:
  `tests/negative/AC-125.negative.spec.ts` — attached to 22 requirements
- **AC-126** · positive: `tests/acceptance/AC-126.spec.ts` · negative/failure:
  `tests/negative/AC-126.negative.spec.ts` — attached to 22 requirements
- **AC-127** · positive: `tests/acceptance/AC-127.spec.ts` · negative/failure:
  `tests/negative/AC-127.negative.spec.ts` — attached to 22 requirements
- **AC-128** · positive: `tests/acceptance/AC-128.spec.ts` · negative/failure:
  `tests/negative/AC-128.negative.spec.ts` — attached to 22 requirements
- **AC-230** · positive: `tests/acceptance/AC-230.spec.ts` · negative/failure:
  `tests/negative/AC-230.negative.spec.ts` — attached to 22 requirements
- **AC-231** · positive: `tests/acceptance/AC-231.spec.ts` · negative/failure:
  `tests/negative/AC-231.negative.spec.ts` — attached to 22 requirements
- **AC-232** · positive: `tests/acceptance/AC-232.spec.ts` · negative/failure:
  `tests/negative/AC-232.negative.spec.ts` — attached to 22 requirements
- **AC-233** · positive: `tests/acceptance/AC-233.spec.ts` · negative/failure:
  `tests/negative/AC-233.negative.spec.ts` — attached to 22 requirements
- **AC-234** · positive: `tests/acceptance/AC-234.spec.ts` · negative/failure:
  `tests/negative/AC-234.negative.spec.ts` — attached to 22 requirements
- **AC-235** · positive: `tests/acceptance/AC-235.spec.ts` · negative/failure:
  `tests/negative/AC-235.negative.spec.ts` — attached to 22 requirements
- **AC-236** · positive: `tests/acceptance/AC-236.spec.ts` · negative/failure:
  `tests/negative/AC-236.negative.spec.ts` — attached to 22 requirements
- **AC-237** · positive: `tests/acceptance/AC-237.spec.ts` · negative/failure:
  `tests/negative/AC-237.negative.spec.ts` — attached to 22 requirements
- **AC-238** · positive: `tests/acceptance/AC-238.spec.ts` · negative/failure:
  `tests/negative/AC-238.negative.spec.ts` — attached to 22 requirements
- **AC-239** · positive: `tests/acceptance/AC-239.spec.ts` · negative/failure:
  `tests/negative/AC-239.negative.spec.ts` — attached to 22 requirements

## Non-goals

Everything below is OUT OF SCOPE for this package:

- `g1-data-truth-extensions`: Extend the proven data-truth foundation with G1 decision-time
  semantics and market-event truth: backfilled observations storing retrieved_as_backfill, original
  event coordinates, actual fetched_at/available_at and the reason the record was unavailable
  earlier with event time never substituting for availability time; historical simulations excluding
  retrospective-only data before actual availability and separately labeling oracle, hindsight,
  cross-fitted and realizable replay modes; full candidate decision timelines (decision_ready_at,
  policy_decided_at, workflow_completed_at, delivery_eligible_at, delivered_at, versioned
  counterfactual_delivery_at); field-level availability from the latest valid
  authorized-and-obtainable revision with separate explicit current-view and historical-replay query
  semantics; the ten distinct evidence-acquisition states kept apart from substantive negative
  evidence with acquisition records storing policy version, candidate state, requested fields,
  expected value of information, estimated/actual cost, assignment probability/seed, timestamps,
  result state, evidence IDs and decision influence; declared and empirically estimated
  source-dependence edges with validity interval, method, evidence, confidence and effect on
  effective independent-evidence count, empirical evaluation of correlated values/errors,
  update/first-seen timing, outages, schema/rounding fingerprints, common missingness and known
  upstream relationships, point-in-time independence that never uses future provider behavior to
  change historical evidence counts outside explicitly labeled retrospective diagnostics, and
  provider-conflict preservation distinguishing benign latency/rounding variance, common-upstream
  duplication, material disagreement and unresolved decision-critical conflict; normalization of raw
  swaps, transfer routes and aggregator hops into economic trade events built on net actor deltas
  that avoid route/hop double counting, separating arbitrage, round trips and inventory-neutral
  activity from organic demand and reducing feature quality and ranking contribution under
  economic-actor uncertainty; and circulating supply and market cap exposing source, method,
  excluded supply and confidence so low-confidence market cap can never be the sole hard-rejection
  reason when approved liquidity/activity fallbacks exist. Strictly read-only: no trading, custody,
  wallet-signing, private-key, or transaction-submission capability.
- `g1-capacity-contracts`: Operate the G1 capacity governance layer over the proven free-first cost
  plane: budget policy split into DATA_PROVIDER, MODEL, COMPUTE_WORKFLOW, DATABASE_STORAGE,
  OBJECT_STORAGE_EGRESS and NOTIFICATION dimensions where free in one dimension never implies zero
  total cost; every active schedule/profile combination referencing a versioned Sustainable Capacity
  Contract covering at least 30 days of expected, peak and failure-retry workload and declaring
  candidate/event rates, operation calls and credits, streamed bytes, model tokens, workflow steps,
  database writes/rows, object bytes, egress, notifications, concurrency, retry allowance, protected
  reserves and safety margin; admission control forecasting the entire resolved configuration before
  activation and rejecting or reducing workload when expected or stress consumption exceeds verified
  plan, rate, storage, egress or monetary caps; the deterministic versioned degradation order
  preserving critical risk monitoring, alert verification, outcome observation, collector continuity
  and the interactive emergency reserve before social, analog, wallet-history, exploration or
  broad-scan depth; capacity forecasts reconciled against actual consumption by
  operation/workload/candidate/run/module with automatic incidents on material underestimation or
  reserve breach; and total and marginal resource cost reported per researched candidate, mature
  outcome, useful alert, prevented risk event and portfolio-utility unit without hiding
  owner-supplied model or infrastructure spend. Strictly read-only: no trading, custody,
  wallet-signing, private-key, or transaction-submission capability.
- `g1-solana-security`: Deliver deterministic Solana program and pool security analysis independent
  of external security providers: versioned SPL/Token-2022 program, authority and extension analysis
  with mint, freeze, permanent-delegate, transfer-fee, transfer-hook, close, metadata/update,
  default-state and non-transferable controls recorded as versioned evidence where applicable;
  pool/LP control, migration, withdrawal-authority and liquidity-removal risk assessment;
  fail-closed blocking of profiles requiring complete execution modeling when transfer semantics are
  unknown; external security provider reports consumed strictly as independent evidence that can
  never override deterministic known risk; and a versioned system-address registry preventing
  infrastructure accounts from becoming false wallet-owner/funder evidence. Strictly read-only: no
  trading, custody, wallet-signing, private-key, or transaction-submission capability.
- `g1-discovery-coverage`: Close the discovery honesty loop over the proven first-party observation
  foundation: discovery coverage reported only for named populations such as
  SUPPORTED_PROGRAM_UNIVERSE, PROSPECTIVELY_OBSERVED_UNIVERSE, AGGREGATE_PROVIDER_UNIVERSE or
  probability-sampled retrospective universes; recall and missed-gem claims requiring independent
  first-party observation, independent provider lineage or valid known inclusion probabilities with
  no universe generated by the evaluated source establishing its own recall; every discovery source
  storing source-specific first-seen, normalized identity, upstream dependence, query/filter
  version, coverage scope, rights and the reason an asset entered the universe; measurement of
  unique discovery yield, overlap, lead/lag, stale/late discovery, identity failures,
  unsupported-program exclusions and price extension at first system availability per source;
  retrospective or prospective independent-universe enumeration estimating discovery recall without
  relying only on the same upstream lineage as live aggregate discovery; measurable provider
  lateness, source coverage loss and extended-at-first-seen rates; direct-chain/indexer access as
  selective verification/backfill by default that cannot silently become broad paid ingestion; and
  collector gaps, decoder outages, unverified program versions and provider unavailability
  constraining population claims rather than being silently counted as negative outcomes, with
  full-market, all-Solana and universal-recall language prohibited unless the exact coverage and
  sampling contract establishes it. Strictly read-only: no trading, custody, wallet-signing,
  private-key, or transaction-submission capability.
- `g1-signal-registry`: Stand up the versioned Feature Registry and the deterministic signal
  baseline that Appendix I requires before any learned ranking: the versioned Feature Registry with
  candidate funnel and independent
  Opportunity/Risk/DataQuality/Urgency/Novelty/Tradability/SourceIndependence vectors; reproducible
  research-priority ranking; diversity and exploration sampling; candidate lifecycle with risk
  separation so tradability can block confirmed opportunities while preserving diagnostic signal
  labels; adaptive rechecks operating with finite budget, information-value selection, starvation
  limits and explicit expiry; and every numeric feature defining minimum denominator/sample,
  stability transform, outlier/null policy, shrinkage, capped contribution and cohort fallback —
  with the Appendix H baseline formulas (volume acceleration, volume persistence, price extension,
  unique-buyer growth with economic-actor deduplication, buy/sell imbalance) computed over event
  time with no LLM anywhere in the deterministic path. Strictly read-only: no trading, custody,
  wallet-signing, private-key, or transaction-submission capability.
- `g1-outcome-evaluation`: Deliver honest outcome maturity and the deterministic evaluation baseline
  that lets the system measure signal, tradable and portfolio outcomes without a model: explicit
  maturity state for every profile/horizon/scenario outcome with pending and partially matured
  outcomes excluded from final denominators; explicit censoring and invalid-data reasons that cannot
  be silently mapped to failure; negative-control tests detecting leakage and spurious lift;
  clustered/block confidence intervals for correlated token groups reporting effective independent
  sample size; subjective user utility stored separately from objective signal and tradable market
  outcomes; sampled high-resolution outcomes storing inclusion probability/stratum with valid
  weighted estimators or explicitly limited population claims; TRADABLE_SUCCESS used for production
  promotion requiring fully matured high-resolution execution evidence for the exact notional, delay
  policy, adapter, route and exit policy so coarse signal data cannot substitute; the adverse
  feasible order reported when target and invalidation/stop are both feasible within a coarse
  interval with optimistic sensitivity only as secondary analysis; outcome denominators disclosing
  invalid, censored, partial, low-resolution, rights-blocked and unobserved cases so policies cannot
  improve measured performance by reducing outcome collection; alert expiry/cancellation and thesis
  invalidation as time-stamped shadow-model side effects with post-expiry gains never counting as
  actionable success; capacity-limited opportunities reporting maximum executable notional and total
  deployable portfolio capacity so small-notional success cannot be generalized to larger capital
  without simulation; plus versioned outcome profiles, time-based frozen replay,
  precision/recall/ranking/lead-time/risk/cost metrics, baseline comparison, the Missed Opportunity
  Analyzer, exploration/control samples, champion–challenger evaluation, drift and calibration
  controls, and multiple-testing control with experiment registry and selection-bias diagnostics.
  Strictly read-only: no trading, custody, wallet-signing, private-key, or transaction-submission
  capability.
- `g1-objective-governance`: Govern the primary production objective and every performance claim:
  the conservative lower confidence bound of net shadow-portfolio utility per capital-day under
  fixed capital, concurrency, execution, latency, liquidity, risk and opportunity-cost assumptions
  as the governing objective; objective comparison only across identical candidate universes,
  population claims, capital, time windows, execution scenarios, delay policies, data cutoffs and
  correlated-exposure constraints with incomparable runs labeled exploratory and barred from
  promoting a policy; critical security, execution, rights, leakage, public-claim, capacity and
  tail-risk constraints applied as hard constraints before utility optimization that no weighted
  score may compensate for; objective reports decomposing gross return, execution costs,
  failed/partial fills, drawdown, CVaR, capital utilization, turnover, opportunity cost,
  concentration, shared-liquidity impact, provider/model/infrastructure cost and uncertainty;
  per-alert precision, tradable-success rate, recall and alerts-per-researched-candidate retained
  strictly as diagnostics that never replace portfolio utility, discovery coverage or
  false-rejection measurement; objective-integrity detection of denominator gaming,
  selective-universe changes, reduced exploration, delayed outcome omission, horizon switching,
  scenario cherry-picking and repeated holdout inspection with any detected failure blocking
  promotion; every objective or performance claim identifying the exact supported population,
  profile, policy, execution scenario, delay distribution, calendar interval, market regimes,
  capability state, sample size, cluster effective sample size and uncertainty method; a
  configurable action-delay distribution with at least p50, p90 and conservative-tail scenarios
  where the active opportunity policy must pass its declared robust-delay gate rather than a single
  favorable fixed delay; utility sensitivity to capital, notional, concurrency, route capacity,
  alert latency, exit policy and risk-aversion coefficients without rewriting the frozen primary
  experiment; and guaranteed-profit language prohibited across product, agent, UI, API, exports and
  notifications with opportunity outputs always stated as evidence-backed research signals whose
  realized outcome remains uncertain. G1 delivers this requirement's objective/agent-output
  vocabulary, constraint data, and acceptance/negative tests over the G1-owned surfaces (per
  plan-level decision 6); the product/UI/API/export/notification enforcement surfaces do not exist
  in G1, so full cross-surface proof lands with the milestones that own those surfaces. Strictly
  read-only: no trading, custody, wallet-signing, private-key, or transaction-submission capability.

<!-- Seeded normative content ends here. Planner-owned sections (integration notes,
     invariants, open points resolved from authoritative sources) go below this line. -->

## Planner-owned integration notes

The sections below are planner-owned elaborations resolved from the authoritative
PRD (§8.1–8.3, §64.1–64.16, §35.12, §45 invariants, Appendix D.21, Appendix I
outcome-label examples) and the milestone decomposition record. They never
override the seeded normative content above.

### I1. Relationship to the proven substrate

This package BUILDS ON, never rewrites, the proven G0+G1 substrate:

- **g1-solana-security (PROVEN)** is consumed as the transfer-semantics verdict
  substrate: the `TransferSemanticsSupport` vocabulary (KNOWN_MODELED /
  KNOWN_UNMODELED / UNKNOWN_REQUIRED / NOT_PRESENT), the blocking predicate for
  profiles requiring complete execution modeling (FR-SOLSEC-004 — solsec ADR-2
  assigns the consuming blocking DECISION to this package), and the parsed
  transfer-fee/transfer-hook evidence that feeds §64.9 fee modeling. The
  verdict substrate is never restated here; `packages/transfer-semantics` is a
  read-only consumer that turns verdicts into execution-model adapters.
- **g1-data-truth-extensions (PROVEN)** supplies the trade substrate:
  economic-event net actor deltas (FR-TRD provenance) are the historical
  observed-trade input for adapter parity (§64.11, AC-231), and decision
  timeline action-reference inputs (FR-DATA-009 provenance) anchor
  `T_action_reference`/`T_actionable` point-in-time semantics (§8.1).
- **G0 pool identity** (`composePoolId`, `PoolKey`) and the decoder registry
  (`@foresift/program-decoders` `resolveDecoder`, `runParityHarness`,
  `detectUpgradeChange`) are consumed read-only. This package adds NO decoder
  and NO second adapter-resolution law: pool-math adapter resolution keys off
  the same signed program-support manifests (§35.12, AC-230).
- `StateCompleteness`, `QualityCode` (incl. EXECUTION_UNAVAILABLE,
  EXECUTION_PARTIAL, POOL_MATH_UNSUPPORTED, QUOTE_PARITY_FAILED,
  TOKEN_EXTENSION_UNKNOWN), and `ReplayMode` vocabularies already exist in
  `packages/domain` and are imported — never restated (milestone plan-level
  decision 5, ADR-0018 precedent).
- New G1 closed vocabularies live in `packages/domain/src/exec.ts` and are
  imported by `packages/shared-schemas/src/exec.ts` — the compile-parity law.

### I2. Cross-package acceptance-criteria file ownership

The manifest attaches all 19 shared ACs (AC-120…128, AC-230…239) to every
FR-EXEC requirement. This package AUTHORS the positive+negative files that do
not yet exist — **AC-120, AC-121, AC-122, AC-123, AC-124, AC-125, AC-126,
AC-127, AC-128, AC-232, AC-234, AC-235, AC-236, AC-238, AC-239** (30 files) —
and EXTENDS the existing **AC-230, AC-231, AC-237** suites additively with
exec-scoped describe blocks (adapter resolution/parity/degradation), exactly
the g1-solana-security precedent. AC-233 stays regression-locked (authored by
`g1-data-truth-extensions`). Authorship is scoped strictly to the FR-EXEC
obligations provable at the seams this package owns:

- AC-123/124/125/128 contain FR-MAT-facing statistical obligations (maturity
  denominators, censoring bookkeeping, subjective-utility separation, stratified
  estimators) that `g1-outcome-evaluation` will EXTEND additively with its
  machinery. The exec-side obligations proven here are: outcome-class
  precedence keeps PENDING/PARTIALLY_MATURED/CENSORED/INVALID_DATA out of
  denominator inputs at the classification seam (§8.2), censoring/invalid
  reasons are explicit and never silently failures, owner-subjective inputs are
  schema-separate from objective labels, and sampled observation plans store
  inclusion probability/stratum/population limits (§64.14).
- AC-239's promotion-denominator DISCLOSURE is proven here from simulation
  results and outcome labels; the promotion pipeline itself is
  `g1-outcome-evaluation`.

Gaps observed outside this boundary are recorded in the run's out-of-scope
notes.

### I3. Package seams consumed by later G1 packages (interface obligations)

- `g1-signal-registry` consumes: the TradabilityVerdict + diagnostic-signal
  preservation law (FR-EXEC-007) as the Tradability vector input, and the
  `CONFIRMED_OPPORTUNITY` blocking gate.
- `g1-outcome-evaluation` consumes: outcome classes and maturity states per
  profile/horizon/scenario (§64.12, §8.1), simulation results with full net
  return decomposition, replay manifests for time-based frozen replay, the
  observation-plan inclusion-probability/stratum records, the adverse-feasible
  primary ordering + path-ambiguity flag (§64.7), and
  maximum-executable-notional/capacity reporting (FR-EXEC-019 aggregation
  outputs).
- `g1-objective-governance` consumes: the stress-scenario pass matrix
  (FR-EXEC-017), conservative stress assumptions (FR-EXEC-012), the robust-delay
  gate substrate (p50/p90/conservative delay distribution, §64.8), and shared
  liquidity aggregation for utility decomposition.
- `g1-capacity-contracts` consumes: observation-plan quota/capacity ceilings
  (§64.14) as capacity-plan inputs.

### I4. Simulation-vs-evaluation boundary (G1 scope)

The engine determines whether a candidate COULD produce realizable net return
for a predefined notional and delay scenario (§64.1) and gates
`CONFIRMED_OPPORTUNITY` accordingly (INV-043). It does NOT run shadow
portfolios, compute promotion statistics, or measure precision/recall — those
are `g1-outcome-evaluation`/`g1-objective-governance`. Alert CONTENT (FR-EXEC-008)
is a structured projection this package defines; delivery/notification surfaces
do not exist in G1. `CONFIRMED_OPPORTUNITY` defaults to conservative stress pass
(§64.10) and tradability can block it while diagnostic signal labels are
preserved (FR-EXEC-007).

## Binding invariants (package-level cross-cut)

Every task operates under the PRD §45 invariants, with these carrying the main
load in this package:

- **INV-001** — permanently read-only: the simulator cannot construct, sign,
  broadcast, submit, or recommend a transaction; it cannot expose a provider's
  swap-route transaction, serialized message, signature request, or wallet
  requirement (§64.16, FR-EXEC-005; scan-prohibited-capabilities stays green).
  Quote providers that return transaction-construction payloads are rejected
  (§64.5).
- **INV-002/INV-015** — deterministic execution math is a control plane no
  model output can replace: adapter math is program/version-specific or
  explicitly unavailable (§64.3); generic constant-product never substitutes
  for another family (FR-EXEC-015).
- **INV-004** — every simulation is reconstructable: the §64.4 record
  (slot/block, account-state hashes, reserves, ticks/bins/curve state, fee
  configuration, oracle/quote inputs, token extensions, route, adapter version,
  state-completeness assessment) plus the replay manifest (FR-EXEC-010) freeze
  execution assumptions and code versions.
- **INV-005/INV-006** — historical replay uses only data available at the
  simulated time (FR-EXEC-022: no route/pool created after `T_user_action`;
  migration routing only transitions known and executable then); degradation
  re-evaluates forward without rewriting historical simulations (FR-EXEC-021).
- **INV-011** — signal success is not tradable success (FR-EXEC-006,
  `UNTRADABLE_SIGNAL_WIN`); **INV-012** — unmatured/censored/invalid outcomes
  never enter final denominators without explicit separate reporting
  (AC-123/239); **INV-016** — base AND conservative stress cases are mandatory
  for confirmed-opportunity decisions (FR-EXEC-012/017).
- **INV-034** — shared-liquidity competition is aggregated, never double-spent
  (FR-EXEC-019); **INV-044** — no guaranteed-profit language; every assessment
  exposes §64.15 uncertainty fields with `valid_until`.

## Package success criteria

1. All 22 assigned requirements have executable positive AND negative/failure
   verification at the manifest-declared paths — 30 new AC files authored here
   (AC-120…128, AC-232, AC-234, AC-235, AC-236, AC-238, AC-239), AC-230/231/237
   extended additively, AC-233 regression-locked green.
2. Migrations `g1_exec_*.sql` apply cleanly to empty databases, are discovered
   by the fail-closed migrator (family pattern extended with `exec`), and the
   central expected-script registry (`packages/persistence/test/migrator.spec.ts`)
   is extended in the same package — the plan-sanctioned scope exception
   (ADR-0019/0022 duty).
3. Telemetry catalog `telemetry/exec.catalog.json` stays DECLARATIVE_CONTRACT_ONLY
   (emitter wiring is G2) and the central parity suite
   (`tests/telemetry-catalog.spec.ts`) is extended in the same package — the
   plan-sanctioned scope exception (milestone plan-level decision 4).
4. Every active adapter (constant-product + route aggregation at G1) passes the
   full §64.11/FR-EXEC-016 gate suite — deterministic vectors, property and
   boundary tests, historical observed-trade parity, reference-quote parity
   where available, version-specific tolerance gates — proven on real suites,
   not stubs; every non-CP design deterministically returns
   `EXECUTION_UNAVAILABLE` rather than generic math.
5. `pnpm verify` and `pnpm spec:verify` pass at the pushed HEAD; all three
   milestone verification commands (`execution-simulator`, `pool-math`,
   `transfer-semantics` package filters) are green.
6. No template placeholders remain in any scoped artifact; every task traces to
   an assigned requirement or its acceptance criteria.

## Assumptions

- PGlite remains the deterministic DB test engine (ADR-0014); the three new
  packages follow the G0/G1 scaffold pattern (package-local `bun test`,
  workspace `*` dependencies, tsconfig extending `tsconfig.base.json`).
- Telemetry stays DECLARATIVE_CONTRACT_ONLY until the G2 observability
  milestone wires emitters.
- Golden fixtures use synthetic addresses/values constructed in this
  repository; parity "where available" is exercised against fixture-encoded
  observed trades and reference quotes — no live-chain dependency for the
  deterministic suites.
- All G1 packages are serialized (`parallelizable: false`), so shared-file
  extensions (AC suites, central migration registry, central telemetry parity
  suite) never race a concurrent package.
