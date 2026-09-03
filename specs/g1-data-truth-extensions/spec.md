# g1-data-truth-extensions — scoped specification

> This file is a SUBORDINATE DERIVATIVE of the authoritative product contract
> `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md`. It was seeded mechanically from
> the requirement manifest by `scripts/automation/bootstrap-package-spec.mjs` (builder v1). The PRD
> always wins over any wording below.

## Authority binding

- Milestone: `G1` (ACTIVE)
- Objective: Extend the proven data-truth foundation with G1 decision-time semantics and
  market-event truth: backfilled observations storing retrieved_as_backfill, original event
  coordinates, actual fetched_at/available_at and the reason the record was unavailable earlier with
  event time never substituting for availability time; historical simulations excluding
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
- Risk: HIGH · writeScopes: `packages/persistence/**`, `packages/evidence/**`,
  `packages/economic-trade-normalizer/**`, `packages/supply-confidence/**`,
  `packages/shared-schemas/**`, `packages/domain/**`, `migrations/g1_data_*.sql`,
  `migrations/g1_trd_*.sql`, `migrations/g1_sup_*.sql`, `tests/fixtures/data/**`,
  `tests/fixtures/trd/**`, `tests/fixtures/sup/**`, `tests/acceptance/**`, `tests/negative/**`,
  `telemetry/data.*`, `telemetry/trd.*`, `telemetry/sup.*`
- Dependencies: none
- Bound inputs at seed time: main `c8d75f2941b7`, manifest `e0f9f1284473`, PRD `baa521d9c67e`

## Assigned requirements (normative text quoted verbatim)

### FR-DATA-007 — 38. Functional requirements catalogue (PRD line 6415)

> Backfilled or retrospectively fetched observations store `retrieved_as_backfill`, original event
> coordinates, actual `fetched_at`, actual earliest system `available_at`, and the reason the record
> was unavailable earlier; event time cannot substitute for availability time.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/data.ts`
- Fixture refs: `tests/fixtures/data/`
- Telemetry refs: `telemetry/data.*`

### FR-DATA-008 — 38. Functional requirements catalogue (PRD line 6416)

> Historical simulations exclude retrospective-only data from decisions before its actual
> availability and separately label oracle, hindsight, cross-fitted research, and realizable replay
> modes.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/data.ts`
- Fixture refs: `tests/fixtures/data/`
- Telemetry refs: `telemetry/data.*`

### FR-DATA-009 — 38. Functional requirements catalogue (PRD line 6417)

> Every candidate decision stores `decision_ready_at`, `policy_decided_at`, `workflow_completed_at`,
> `delivery_eligible_at`, `delivered_at` when applicable, and a versioned
> `counterfactual_delivery_at` for non-delivered comparison arms.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/data.ts`
- Fixture refs: `tests/fixtures/data/`
- Telemetry refs: `telemetry/data.*`

### FR-DATA-010 — 38. Functional requirements catalogue (PRD line 6418)

> Field-level availability derives from the latest valid revision that was both authorized and
> obtainable at the decision time; current views and historical replay use separate explicit query
> semantics.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/data.ts`
- Fixture refs: `tests/fixtures/data/`
- Telemetry refs: `telemetry/data.*`

### FR-DATA-011 — 38. Functional requirements catalogue (PRD line 6419)

> Evidence acquisition states are `NOT_REQUESTED_BY_POLICY`, `REQUESTED`, `COST_BLOCKED`,
> `QUOTA_BLOCKED`, `RIGHTS_BLOCKED`, `UNSUPPORTED`, `PROVIDER_UNAVAILABLE`, `FAILED`,
> `RETURNED_EMPTY`, or `RETURNED`, and remain distinct from substantive negative evidence.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/data.ts`
- Fixture refs: `tests/fixtures/data/`
- Telemetry refs: `telemetry/data.*`

### FR-DATA-012 — 38. Functional requirements catalogue (PRD line 6420)

> Acquisition records store policy version, candidate state, requested fields, expected value of
> information, estimated/actual cost, randomized assignment probability and seed when applicable,
> timestamps, result state, evidence IDs, and whether the evidence changed the final decision.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/data.ts`
- Fixture refs: `tests/fixtures/data/`
- Telemetry refs: `telemetry/data.*`

### FR-DATA-013 — 38. Functional requirements catalogue (PRD line 6421)

> The system maintains declared and empirically estimated source-dependence edges with validity
> interval, method, evidence, confidence, and effect on effective independent-evidence count.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/data.ts`
- Fixture refs: `tests/fixtures/data/`
- Telemetry refs: `telemetry/data.*`

### FR-DATA-014 — 38. Functional requirements catalogue (PRD line 6422)

> Empirical source dependence evaluates correlated values/errors, update timing, first-seen timing,
> outages, schema/rounding fingerprints, common missingness, and known upstream relationships;
> material dependence reduces independence credit automatically.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/data.ts`
- Fixture refs: `tests/fixtures/data/`
- Telemetry refs: `telemetry/data.*`

### FR-DATA-015 — 38. Functional requirements catalogue (PRD line 6423)

> Independence estimates are point-in-time and cannot use future provider behavior to change the
> evidence count of a historical decision unless the replay is explicitly labeled retrospective
> diagnostic.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/data.ts`
- Fixture refs: `tests/fixtures/data/`
- Telemetry refs: `telemetry/data.*`

### FR-DATA-016 — 38. Functional requirements catalogue (PRD line 6424)

> Provider conflicts preserve all raw observations and distinguish benign latency/rounding variance,
> common-upstream duplication, material disagreement, and unresolved decision-critical conflict.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/data.ts`
- Fixture refs: `tests/fixtures/data/`
- Telemetry refs: `telemetry/data.*`

### FR-TRD-001 — 38. Functional requirements catalogue (PRD line 6189)

> Raw swaps, transfer routes, and aggregator hops are normalized into economic trade events before
> market/wallet features.

Normative level: MUST. Acceptance criteria: all 8 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/trd.ts`
- Fixture refs: `tests/fixtures/trd/`
- Telemetry refs: `telemetry/trd.*`

### FR-TRD-002 — 38. Functional requirements catalogue (PRD line 6190)

> Economic trades use net actor deltas and avoid route/hop double counting.

Normative level: MUST. Acceptance criteria: all 8 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/trd.ts`
- Fixture refs: `tests/fixtures/trd/`
- Telemetry refs: `telemetry/trd.*`

### FR-TRD-003 — 38. Functional requirements catalogue (PRD line 6191)

> Arbitrage, round trips, and inventory-neutral activity are distinguished from organic demand.

Normative level: MUST. Acceptance criteria: all 8 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/trd.ts`
- Fixture refs: `tests/fixtures/trd/`
- Telemetry refs: `telemetry/trd.*`

### FR-TRD-004 — 38. Functional requirements catalogue (PRD line 6192)

> Economic-actor uncertainty reduces feature quality and ranking contribution.

Normative level: MUST. Acceptance criteria: all 8 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/trd.ts`
- Fixture refs: `tests/fixtures/trd/`
- Telemetry refs: `telemetry/trd.*`

### FR-SUP-001 — 38. Functional requirements catalogue (PRD line 6187)

> Circulating supply and market cap expose source, method, excluded supply, and confidence.

Normative level: MUST. Acceptance criteria: all 7 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/sup.ts`
- Fixture refs: `tests/fixtures/sup/`
- Telemetry refs: `telemetry/sup.*`

### FR-SUP-002 — 38. Functional requirements catalogue (PRD line 6188)

> Low-confidence market cap cannot be the sole hard-rejection reason when approved
> liquidity/activity fallbacks exist.

Normative level: MUST. Acceptance criteria: all 7 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/sup.ts`
- Fixture refs: `tests/fixtures/sup/`
- Telemetry refs: `telemetry/sup.*`

## Shared acceptance criteria

Attached to more than one requirement of this package — implement once, satisfy everywhere:

- **AC-020** · positive: `tests/acceptance/AC-020.spec.ts` · negative/failure:
  `tests/negative/AC-020.negative.spec.ts` — attached to 10 requirements
- **AC-021** · positive: `tests/acceptance/AC-021.spec.ts` · negative/failure:
  `tests/negative/AC-021.negative.spec.ts` — attached to 10 requirements
- **AC-022** · positive: `tests/acceptance/AC-022.spec.ts` · negative/failure:
  `tests/negative/AC-022.negative.spec.ts` — attached to 10 requirements
- **AC-023** · positive: `tests/acceptance/AC-023.spec.ts` · negative/failure:
  `tests/negative/AC-023.negative.spec.ts` — attached to 10 requirements
- **AC-130** · positive: `tests/acceptance/AC-130.spec.ts` · negative/failure:
  `tests/negative/AC-130.negative.spec.ts` — attached to 6 requirements
- **AC-131** · positive: `tests/acceptance/AC-131.spec.ts` · negative/failure:
  `tests/negative/AC-131.negative.spec.ts` — attached to 6 requirements
- **AC-132** · positive: `tests/acceptance/AC-132.spec.ts` · negative/failure:
  `tests/negative/AC-132.negative.spec.ts` — attached to 6 requirements
- **AC-133** · positive: `tests/acceptance/AC-133.spec.ts` · negative/failure:
  `tests/negative/AC-133.negative.spec.ts` — attached to 6 requirements
- **AC-134** · positive: `tests/acceptance/AC-134.spec.ts` · negative/failure:
  `tests/negative/AC-134.negative.spec.ts` — attached to 6 requirements
- **AC-135** · positive: `tests/acceptance/AC-135.spec.ts` · negative/failure:
  `tests/negative/AC-135.negative.spec.ts` — attached to 6 requirements
- **AC-136** · positive: `tests/acceptance/AC-136.spec.ts` · negative/failure:
  `tests/negative/AC-136.negative.spec.ts` — attached to 6 requirements
- **AC-233** · positive: `tests/acceptance/AC-233.spec.ts` · negative/failure:
  `tests/negative/AC-233.negative.spec.ts` — attached to 4 requirements
- **AC-240** · positive: `tests/acceptance/AC-240.spec.ts` · negative/failure:
  `tests/negative/AC-240.negative.spec.ts` — attached to 10 requirements
- **AC-241** · positive: `tests/acceptance/AC-241.spec.ts` · negative/failure:
  `tests/negative/AC-241.negative.spec.ts` — attached to 10 requirements
- **AC-242** · positive: `tests/acceptance/AC-242.spec.ts` · negative/failure:
  `tests/negative/AC-242.negative.spec.ts` — attached to 10 requirements
- **AC-243** · positive: `tests/acceptance/AC-243.spec.ts` · negative/failure:
  `tests/negative/AC-243.negative.spec.ts` — attached to 10 requirements
- **AC-244** · positive: `tests/acceptance/AC-244.spec.ts` · negative/failure:
  `tests/negative/AC-244.negative.spec.ts` — attached to 10 requirements
- **AC-245** · positive: `tests/acceptance/AC-245.spec.ts` · negative/failure:
  `tests/negative/AC-245.negative.spec.ts` — attached to 10 requirements
- **AC-246** · positive: `tests/acceptance/AC-246.spec.ts` · negative/failure:
  `tests/negative/AC-246.negative.spec.ts` — attached to 10 requirements
- **AC-247** · positive: `tests/acceptance/AC-247.spec.ts` · negative/failure:
  `tests/negative/AC-247.negative.spec.ts` — attached to 10 requirements
- **AC-248** · positive: `tests/acceptance/AC-248.spec.ts` · negative/failure:
  `tests/negative/AC-248.negative.spec.ts` — attached to 10 requirements
- **AC-249** · positive: `tests/acceptance/AC-249.spec.ts` · negative/failure:
  `tests/negative/AC-249.negative.spec.ts` — attached to 10 requirements

## Non-goals

Everything below is OUT OF SCOPE for this package:

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
- `g1-execution-simulation`: Build the read-only execution simulation foundation: opportunity
  profiles defining signal and tradable outcome semantics; simulation over versioned notionals,
  action delays, entry/exit policies, price impact, partial fills and available liquidity; net
  return including pool fees, token transfer fees, priority/network fees and execution impact;
  target touch requiring executable volume or configured target-duration support so an isolated wick
  cannot automatically count as tradable success; permanent read-only enforcement with no
  transaction construction or submission anywhere in the simulator; SIGNAL_SUCCESS never rendered as
  profit when TRADABLE_SUCCESS is absent or failed; tradability blocking CONFIRMED_OPPORTUNITY while
  preserving diagnostic signal labels; alert content exposing configured notional, delay, modeled
  impact, assumptions and expiry; multiple exit policies evaluated only as pre-registered separate
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
PRD (§11.7, §13.6–13.10, §15.10, §37.2, §65.6, §66, Appendix O.8/O.9, Appendix P,
§45 invariants) and the milestone decomposition record. They never override the
seeded normative content above.

### I1. Relationship to the G0-proven data-truth foundation

This package EXTENDS, never rewrites, the G0-proven substrate in
`packages/persistence`, `packages/evidence`, `packages/domain`,
`packages/shared-schemas` (FR-DATA-001…006, AC-020…023, AC-240…249 substrate):

- Replay visibility stays THE single domain predicate `visibleAt` (available_at ≤
  T); every G1 query path reuses it — no second visibility definition.
- Observations remain immutable (trigger-enforced); G1 backfill semantics add
  columns and receipts, never mutate rows.
- Acquisition records remain write-before-retrieval ordered (AC-243) and
  completion remains one-way; G1 extends the record's field set (FR-DATA-012)
  and its state vocabulary (FR-DATA-011 — see I2), preserving every G0
  semantic guard.
- `DependenceLabel` (`AVAILABLE_AT_THE_TIME` / `DIAGNOSTIC_RETROSPECTIVE`)
  remains the point-in-time labeling mechanism G1's FR-DATA-015 proof rides on.
- New G1 closed vocabularies live in `packages/domain` and are imported (never
  restated) by `packages/shared-schemas` — the compile-parity law already
  proven there (milestone plan-level decision 5, ADR-0018 precedent).

### I2. Acquisition-state plane reconciliation (mandated decision)

FR-DATA-011's normative ten-state list (`NOT_REQUESTED_BY_POLICY`, `REQUESTED`,
`COST_BLOCKED`, `QUOTA_BLOCKED`, `RIGHTS_BLOCKED`, `UNSUPPORTED`,
`PROVIDER_UNAVAILABLE`, `FAILED`, `RETURNED_EMPTY`, `RETURNED`) differs by three
members from the §13.8 interface's ten (`CAPABILITY_UNAVAILABLE`, `TIMED_OUT`,
`INVALID_RESPONSE` instead of `UNSUPPORTED`, `FAILED`, `RETURNED_EMPTY`). Per
the milestone decomposition record (plan-level decision 5), FR-DATA-011 governs
the evidence-acquisition DECISION state vocabulary while the §13.8 record shape
is unchanged authority, and the member-level mapping is delivered by an ADR
recorded during THIS package's planning (plan.md, Material decisions — ADR-1):

- `CAPABILITY_UNAVAILABLE` ≡ `UNSUPPORTED` (the same pre-flight refusal:
  the capability/operation is not available to this system);
- `TIMED_OUT` → `FAILED` carrying failure kind `TIMED_OUT`;
- `INVALID_RESPONSE` → `FAILED` carrying failure kind `INVALID_RESPONSE`
  (on the ingestion plane this surfaces as §18.5 `SCHEMA_REJECTED`);
- `RETURNED_EMPTY` is a genuine provider result (§18.5 keeps it on the
  ingestion plane too) — distinct from `NOT_REQUESTED_BY_POLICY`, which
  remains a planner result that never enters ingestion as an empty
  observation.

The §18.5 ingestion-outcome vocabulary stays the separate ingestion
persistence plane; nothing restates it inside `packages/shared-schemas`. The
planes are bridged only by the recorded correspondence table in the ADR.

### I3. Package seams consumed by later G1 packages (interface obligations)

- `g1-signal-registry` consumes: economic trade events (FR-TRD-001…003) as the
  sole input to organic volume/unique-buyer/imbalance features (§66.4, INV-013),
  and the deterministic actor-uncertainty quality-reduction function
  (FR-TRD-004).
- `g1-execution-simulation` consumes: economic event net actor deltas as the
  trade substrate; decision timeline action-reference inputs (FR-DATA-009).
- `g1-outcome-evaluation` / `g1-objective-governance` consume: effective
  independent-evidence counts (FR-DATA-013…015), conflict classifications
  (FR-DATA-016), and the market-cap fallback decision (FR-SUP-002).
- `g1-discovery-coverage` consumes: point-in-time dependence-edge validity
  (FR-DATA-015) and replay-mode labels (FR-DATA-008).

### I4. Cross-package acceptance-criteria file ownership

The manifest attaches family-level ACs to multiple packages. This package
AUTHORS the acceptance/negative files for AC-133, AC-134, AC-135, AC-136,
AC-233 (positive + negative — 10 files) scoped strictly to its FR-TRD/FR-SUP
obligations, and EXTENDS the existing AC-020…023 and AC-240…249 suites with
G1 cases. The AC-130/131/132 files (Solana-security family content) are
authored by `g1-solana-security`; this package does not create them. Gaps
observed outside this boundary are recorded in the run's out-of-scope notes.

## Binding invariants (package-level cross-cut)

Every G1 task operates under the PRD §45 invariants, with these carrying the
main load in this package:

- **INV-001** — permanently read-only: no trading, custody, wallet signing,
  private-key handling, or transaction submission anywhere in the normalizer,
  supply, dependence, conflict, or timeline surfaces (scan-prohibited-
  capabilities stays green).
- **INV-004** — every retained decision reconstructable: decision timelines
  (FR-DATA-009), acquisition records (FR-DATA-012), and conflict records
  (FR-DATA-016) persist exactly the versions and fields reconstruction needs.
- **INV-005/INV-006** — replay uses only data available at the simulated time;
  backfilled data is never backdated (FR-DATA-007/008/010/015).
- **INV-008** — provider count is not source independence: effective
  independent-evidence credit comes from declared lineage + empirical
  dependence edges with validity, confidence, and automatic credit reduction
  (FR-DATA-013/014).
- **INV-013** — economic events, not raw route legs or provider transaction
  counts, drive actor, volume, and demand features (FR-TRD-001…003).

## Package success criteria

1. All sixteen assigned requirements have executable positive AND
   negative/failure-path verification at the manifest-declared test paths,
   green on this branch — the AC-133…136/AC-233 files authored here, the
   shared suites extended in place.
2. Migrations `g1_data_*`, `g1_trd_*`, `g1_sup_*` apply cleanly to empty
   databases, are discovered by the fail-closed migrator (family pattern
   extended to `trd`/`sup`), and the central expected-script registry
   (`packages/persistence/test/migrator.spec.ts`) is extended in the same
   package — the plan-sanctioned scope exception (milestone plan-level
   decision 1, ADR-0019/0022 duty).
3. Telemetry catalogs `telemetry/data.*` (extended), `telemetry/trd.*` and
   `telemetry/sup.*` (new) stay contract-only (emitter wiring is G2) and the
   central parity suite `tests/telemetry-catalog.spec.ts` is extended in the
   same package — the plan-sanctioned scope exception (milestone plan-level
   decision 4).
4. The ten-state acquisition vocabulary reconciliation (I2) is delivered as an
   accepted ADR with the member-level mapping table, and no divergent state
   list is restated in `packages/shared-schemas`.
5. `pnpm verify` and `pnpm spec:verify` pass at the pushed HEAD; the
   milestone verification commands (persistence, evidence,
   economic-trade-normalizer, supply-confidence package filters) are green.
6. No template placeholders remain in any scoped artifact; every task traces
   to an assigned requirement or its acceptance criteria.

## Assumptions

- PGlite remains the deterministic DB test engine (ADR-0014); new packages
  follow the G0 scaffold pattern (package-local `bun test`, no per-package
  runner config files needed).
- Telemetry stays DECLARATIVE_CONTRACT_ONLY until the G2 observability
  milestone wires emitters.
- Golden fixtures use synthetic addresses/values constructed in this
  repository; no third-party dataset ingestion.
- All G1 packages are serialized (`parallelizable: false`), so shared-file
  extensions (AC suites, central migration registry, central telemetry
  parity suite) never race a concurrent package.
