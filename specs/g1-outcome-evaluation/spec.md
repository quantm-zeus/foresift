# g1-outcome-evaluation — scoped specification

> This file is a SUBORDINATE DERIVATIVE of the authoritative product contract
> `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md`. It was seeded mechanically from
> the requirement manifest by `scripts/automation/bootstrap-package-spec.mjs` (builder v1). The PRD
> always wins over any wording below.

## Authority binding

- Milestone: `G1` (ACTIVE)
- Objective: Deliver honest outcome maturity and the deterministic evaluation baseline that lets the
  system measure signal, tradable and portfolio outcomes without a model: explicit maturity state
  for every profile/horizon/scenario outcome with pending and partially matured outcomes excluded
  from final denominators; explicit censoring and invalid-data reasons that cannot be silently
  mapped to failure; negative-control tests detecting leakage and spurious lift; clustered/block
  confidence intervals for correlated token groups reporting effective independent sample size;
  subjective user utility stored separately from objective signal and tradable market outcomes;
  sampled high-resolution outcomes storing inclusion probability/stratum with valid weighted
  estimators or explicitly limited population claims; TRADABLE_SUCCESS used for production promotion
  requiring fully matured high-resolution execution evidence for the exact notional, delay policy,
  adapter, route and exit policy so coarse signal data cannot substitute; the adverse feasible order
  reported when target and invalidation/stop are both feasible within a coarse interval with
  optimistic sensitivity only as secondary analysis; outcome denominators disclosing invalid,
  censored, partial, low-resolution, rights-blocked and unobserved cases so policies cannot improve
  measured performance by reducing outcome collection; alert expiry/cancellation and thesis
  invalidation as time-stamped shadow-model side effects with post-expiry gains never counting as
  actionable success; capacity-limited opportunities reporting maximum executable notional and total
  deployable portfolio capacity so small-notional success cannot be generalized to larger capital
  without simulation; plus versioned outcome profiles, time-based frozen replay,
  precision/recall/ranking/lead-time/risk/cost metrics, baseline comparison, the Missed Opportunity
  Analyzer, exploration/control samples, champion–challenger evaluation, drift and calibration
  controls, and multiple-testing control with experiment registry and selection-bias diagnostics.
  Strictly read-only: no trading, custody, wallet-signing, private-key, or transaction-submission
  capability.
- Risk: HIGH · writeScopes: `packages/outcome-maturity/**`, `packages/evaluation/**`,
  `packages/eval-cli/**`, `packages/shared-schemas/**`, `packages/domain/**`,
  `migrations/g1_mat_*.sql`, `migrations/g1_eval_*.sql`, `tests/fixtures/mat/**`,
  `tests/fixtures/eval/**`, `tests/acceptance/**`, `tests/negative/**`, `telemetry/mat.*`,
  `telemetry/eval.*`
- Dependencies: `g1-signal-registry` PROVEN, `g1-execution-simulation` PROVEN
- Bound inputs at seed time: main `d8258a7dd790`, manifest `e0f9f1284473`, PRD `baa521d9c67e`

## Assigned requirements (normative text quoted verbatim)

### FR-MAT-001 — 38. Functional requirements catalogue (PRD line 6171)

> Every profile/horizon/scenario outcome has an explicit maturity state.

Normative level: MUST. Acceptance criteria: all 29 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/mat.ts`
- Fixture refs: `tests/fixtures/mat/`
- Telemetry refs: `telemetry/mat.*`

### FR-MAT-002 — 38. Functional requirements catalogue (PRD line 6172)

> Pending and partially matured outcomes are excluded from final denominators.

Normative level: MUST. Acceptance criteria: all 29 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/mat.ts`
- Fixture refs: `tests/fixtures/mat/`
- Telemetry refs: `telemetry/mat.*`

### FR-MAT-003 — 38. Functional requirements catalogue (PRD line 6173)

> Censoring and invalid-data reasons are explicit and cannot be silently mapped to failure.

Normative level: MUST. Acceptance criteria: all 29 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/mat.ts`
- Fixture refs: `tests/fixtures/mat/`
- Telemetry refs: `telemetry/mat.*`

### FR-MAT-004 — 38. Functional requirements catalogue (PRD line 6174)

> Negative-control tests detect leakage and spurious lift.

Normative level: MUST. Acceptance criteria: all 29 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/mat.ts`
- Fixture refs: `tests/fixtures/mat/`
- Telemetry refs: `telemetry/mat.*`

### FR-MAT-005 — 38. Functional requirements catalogue (PRD line 6175)

> Confidence intervals use clustered/block methods for correlated token groups and report effective
> independent sample size.

Normative level: MUST. Acceptance criteria: all 29 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/mat.ts`
- Fixture refs: `tests/fixtures/mat/`
- Telemetry refs: `telemetry/mat.*`

### FR-MAT-006 — 38. Functional requirements catalogue (PRD line 6176)

> Subjective user utility is stored separately from objective signal and tradable market outcomes.

Normative level: MUST. Acceptance criteria: all 29 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/mat.ts`
- Fixture refs: `tests/fixtures/mat/`
- Telemetry refs: `telemetry/mat.*`

### FR-MAT-007 — 38. Functional requirements catalogue (PRD line 6177)

> When high-resolution outcomes are sampled, every case stores inclusion probability/stratum and
> evaluation uses valid weighted estimators or explicitly limits its population claim.

Normative level: MUST. Acceptance criteria: all 29 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/mat.ts`
- Fixture refs: `tests/fixtures/mat/`
- Telemetry refs: `telemetry/mat.*`

### FR-MAT-008 — 38. Functional requirements catalogue (PRD line 6455)

> A `TRADABLE_SUCCESS` used for production promotion requires fully matured high-resolution
> execution evidence for the exact notional, delay policy, adapter, route, and exit policy; coarse
> signal data cannot substitute.

Normative level: MUST. Acceptance criteria: all 29 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/mat.ts`
- Fixture refs: `tests/fixtures/mat/`
- Telemetry refs: `telemetry/mat.*`

### FR-MAT-009 — 38. Functional requirements catalogue (PRD line 6456)

> When target and invalidation/stop are both feasible within a coarse interval and ordering is
> unknown, the primary result uses the adverse feasible order, reports path ambiguity, and may
> expose optimistic sensitivity only as secondary analysis.

Normative level: MUST. Acceptance criteria: all 29 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/mat.ts`
- Fixture refs: `tests/fixtures/mat/`
- Telemetry refs: `telemetry/mat.*`

### FR-MAT-010 — 38. Functional requirements catalogue (PRD line 6457)

> Outcome denominators disclose invalid, censored, partial, low-resolution, rights-blocked, and
> unobserved cases; policies cannot improve measured performance by reducing outcome collection.

Normative level: MUST. Acceptance criteria: all 29 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/mat.ts`
- Fixture refs: `tests/fixtures/mat/`
- Telemetry refs: `telemetry/mat.*`

### FR-MAT-011 — 38. Functional requirements catalogue (PRD line 6458)

> Alert expiry/cancellation and thesis invalidation are time-stamped side effects in the shadow
> model; post-expiry gains do not count as actionable success.

Normative level: MUST. Acceptance criteria: all 29 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/mat.ts`
- Fixture refs: `tests/fixtures/mat/`
- Telemetry refs: `telemetry/mat.*`

### FR-MAT-012 — 38. Functional requirements catalogue (PRD line 6459)

> Capacity-limited opportunities report maximum executable notional and total deployable portfolio
> capacity; a small-notional success cannot be generalized to larger capital without simulation.

Normative level: MUST. Acceptance criteria: all 29 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/mat.ts`
- Fixture refs: `tests/fixtures/mat/`
- Telemetry refs: `telemetry/mat.*`

### FR-EVAL-001 — 38. Functional requirements catalogue (PRD line 6060)

> Versioned outcome profiles.

Normative level: MUST. Acceptance criteria: all 20 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/eval.ts`
- Fixture refs: `tests/fixtures/eval/`
- Telemetry refs: `telemetry/eval.*`

### FR-EVAL-002 — 38. Functional requirements catalogue (PRD line 6061)

> Time-based frozen replay.

Normative level: MUST. Acceptance criteria: all 20 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/eval.ts`
- Fixture refs: `tests/fixtures/eval/`
- Telemetry refs: `telemetry/eval.*`

### FR-EVAL-003 — 38. Functional requirements catalogue (PRD line 6062)

> Precision, recall, ranking, lead-time, risk, and cost metrics.

Normative level: MUST. Acceptance criteria: all 20 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/eval.ts`
- Fixture refs: `tests/fixtures/eval/`
- Telemetry refs: `telemetry/eval.*`

### FR-EVAL-004 — 38. Functional requirements catalogue (PRD line 6063)

> Baseline comparison.

Normative level: MUST. Acceptance criteria: all 20 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/eval.ts`
- Fixture refs: `tests/fixtures/eval/`
- Telemetry refs: `telemetry/eval.*`

### FR-EVAL-005 — 38. Functional requirements catalogue (PRD line 6064)

> Missed Opportunity Analyzer.

Normative level: MUST. Acceptance criteria: all 20 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/eval.ts`
- Fixture refs: `tests/fixtures/eval/`
- Telemetry refs: `telemetry/eval.*`

### FR-EVAL-006 — 38. Functional requirements catalogue (PRD line 6065)

> Exploration/control sample.

Normative level: MUST. Acceptance criteria: all 20 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/eval.ts`
- Fixture refs: `tests/fixtures/eval/`
- Telemetry refs: `telemetry/eval.*`

### FR-EVAL-007 — 38. Functional requirements catalogue (PRD line 6066)

> Champion–challenger.

Normative level: MUST. Acceptance criteria: all 20 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/eval.ts`
- Fixture refs: `tests/fixtures/eval/`
- Telemetry refs: `telemetry/eval.*`

### FR-EVAL-008 — 38. Functional requirements catalogue (PRD line 6067)

> Drift and calibration controls.

Normative level: MUST. Acceptance criteria: all 20 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/eval.ts`
- Fixture refs: `tests/fixtures/eval/`
- Telemetry refs: `telemetry/eval.*`

### FR-EVAL-009 — 38. Functional requirements catalogue (PRD line 6068)

> Multiple-testing control, experiment registry, and selection-bias diagnostics.

Normative level: MUST. Acceptance criteria: all 20 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/eval.ts`
- Fixture refs: `tests/fixtures/eval/`
- Telemetry refs: `telemetry/eval.*`

## Shared acceptance criteria

Attached to more than one requirement of this package — implement once, satisfy everywhere:

- **AC-040** · positive: `tests/acceptance/AC-040.spec.ts` · negative/failure:
  `tests/negative/AC-040.negative.spec.ts` — attached to 21 requirements
- **AC-041** · positive: `tests/acceptance/AC-041.spec.ts` · negative/failure:
  `tests/negative/AC-041.negative.spec.ts` — attached to 21 requirements
- **AC-042** · positive: `tests/acceptance/AC-042.spec.ts` · negative/failure:
  `tests/negative/AC-042.negative.spec.ts` — attached to 21 requirements
- **AC-043** · positive: `tests/acceptance/AC-043.spec.ts` · negative/failure:
  `tests/negative/AC-043.negative.spec.ts` — attached to 21 requirements
- **AC-044** · positive: `tests/acceptance/AC-044.spec.ts` · negative/failure:
  `tests/negative/AC-044.negative.spec.ts` — attached to 21 requirements
- **AC-120** · positive: `tests/acceptance/AC-120.spec.ts` · negative/failure:
  `tests/negative/AC-120.negative.spec.ts` — attached to 12 requirements
- **AC-121** · positive: `tests/acceptance/AC-121.spec.ts` · negative/failure:
  `tests/negative/AC-121.negative.spec.ts` — attached to 12 requirements
- **AC-122** · positive: `tests/acceptance/AC-122.spec.ts` · negative/failure:
  `tests/negative/AC-122.negative.spec.ts` — attached to 12 requirements
- **AC-123** · positive: `tests/acceptance/AC-123.spec.ts` · negative/failure:
  `tests/negative/AC-123.negative.spec.ts` — attached to 12 requirements
- **AC-124** · positive: `tests/acceptance/AC-124.spec.ts` · negative/failure:
  `tests/negative/AC-124.negative.spec.ts` — attached to 12 requirements
- **AC-125** · positive: `tests/acceptance/AC-125.spec.ts` · negative/failure:
  `tests/negative/AC-125.negative.spec.ts` — attached to 12 requirements
- **AC-126** · positive: `tests/acceptance/AC-126.spec.ts` · negative/failure:
  `tests/negative/AC-126.negative.spec.ts` — attached to 12 requirements
- **AC-127** · positive: `tests/acceptance/AC-127.spec.ts` · negative/failure:
  `tests/negative/AC-127.negative.spec.ts` — attached to 12 requirements
- **AC-128** · positive: `tests/acceptance/AC-128.spec.ts` · negative/failure:
  `tests/negative/AC-128.negative.spec.ts` — attached to 12 requirements
- **AC-150** · positive: `tests/acceptance/AC-150.spec.ts` · negative/failure:
  `tests/negative/AC-150.negative.spec.ts` — attached to 21 requirements
- **AC-151** · positive: `tests/acceptance/AC-151.spec.ts` · negative/failure:
  `tests/negative/AC-151.negative.spec.ts` — attached to 21 requirements
- **AC-152** · positive: `tests/acceptance/AC-152.spec.ts` · negative/failure:
  `tests/negative/AC-152.negative.spec.ts` — attached to 21 requirements
- **AC-153** · positive: `tests/acceptance/AC-153.spec.ts` · negative/failure:
  `tests/negative/AC-153.negative.spec.ts` — attached to 21 requirements
- **AC-154** · positive: `tests/acceptance/AC-154.spec.ts` · negative/failure:
  `tests/negative/AC-154.negative.spec.ts` — attached to 21 requirements
- **AC-240** · positive: `tests/acceptance/AC-240.spec.ts` · negative/failure:
  `tests/negative/AC-240.negative.spec.ts` — attached to 21 requirements
- **AC-241** · positive: `tests/acceptance/AC-241.spec.ts` · negative/failure:
  `tests/negative/AC-241.negative.spec.ts` — attached to 21 requirements
- **AC-242** · positive: `tests/acceptance/AC-242.spec.ts` · negative/failure:
  `tests/negative/AC-242.negative.spec.ts` — attached to 21 requirements
- **AC-243** · positive: `tests/acceptance/AC-243.spec.ts` · negative/failure:
  `tests/negative/AC-243.negative.spec.ts` — attached to 21 requirements
- **AC-244** · positive: `tests/acceptance/AC-244.spec.ts` · negative/failure:
  `tests/negative/AC-244.negative.spec.ts` — attached to 21 requirements
- **AC-245** · positive: `tests/acceptance/AC-245.spec.ts` · negative/failure:
  `tests/negative/AC-245.negative.spec.ts` — attached to 21 requirements
- **AC-246** · positive: `tests/acceptance/AC-246.spec.ts` · negative/failure:
  `tests/negative/AC-246.negative.spec.ts` — attached to 21 requirements
- **AC-247** · positive: `tests/acceptance/AC-247.spec.ts` · negative/failure:
  `tests/negative/AC-247.negative.spec.ts` — attached to 21 requirements
- **AC-248** · positive: `tests/acceptance/AC-248.spec.ts` · negative/failure:
  `tests/negative/AC-248.negative.spec.ts` — attached to 21 requirements
- **AC-249** · positive: `tests/acceptance/AC-249.spec.ts` · negative/failure:
  `tests/negative/AC-249.negative.spec.ts` — attached to 21 requirements

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

## Normative sources beyond §38 (quoted surfaces this package implements)

The assigned requirements FR-MAT-001…012 and FR-EVAL-001…009 bind these PRD
sections; the seeded quotes above are their catalogue heads, the sections below
are the normative bodies this package implements:

- **§8.2 Common outcome-label precedence** — the seven-step evaluator label
  order (INVALID_DATA → CENSORED → PENDING/PARTIALLY_MATURED →
  TRADABLE_FAILURE_SECURITY_OR_LIQUIDITY → TRADABLE_SUCCESS →
  TRADABLE_FAILURE → TRADABLE_NEUTRAL), signal labels on a separate axis that
  never overwrite tradable labels, and `UNTRADABLE_SIGNAL_WIN`. The
  classification seam is proven in `g1-execution-simulation`; this package
  consumes it and owns the evaluation-side application of the same law.
- **§12.8 / §68.1 Outcome maturity state** — PENDING, PARTIALLY_MATURED,
  FULLY_MATURED, CENSORED, INVALID_DATA stored per profile × horizon ×
  execution scenario; "Maturity depends on horizon completion and required
  outcome/security/liquidity/pool-state observations. Deployment, retry,
  provider outage, or policy changes do not reset maturity." Lifecycle or
  alert state can never overwrite it.
- **§68.2 Denominator policy** — "Final precision, failure, calibration, net
  expectancy, utility, and promotion metrics use only fully matured valid
  outcomes. Provisional dashboards may show pending progress but must label
  denominator, maturity, and uncertainty separately."
- **§68.3 Censoring and invalidity** — censoring reasons (rights-driven
  deletion, permanent identity ambiguity, unrecoverable observation gap,
  unsupported historical pool state, chain/archive unavailability); "A
  profile-defined rug, pool disappearance, liquidity collapse, failed fill, or
  security event is an outcome—not censoring"; INVALID_DATA includes corrupted
  sampling assignments, impossible time order, failed pool parity,
  unresolvable decimals, or evidence whose availability cannot be established.
- **§68.4 Population claim** — each result declares one §7.8 population
  (SUPPORTED_PROGRAM_UNIVERSE, PROSPECTIVELY_OBSERVED_UNIVERSE,
  AGGREGATE_PROVIDER_UNIVERSE, AUTHORIZED_LAUNCH_UNIVERSE,
  STRATIFIED_SAMPLED_UNIVERSE, CURRENTLY_OBSERVED_SUBSET_ONLY); "Claims beyond
  that population are prohibited."
- **§68.5 Negative controls** (FR-MAT-004) — outcome-label permutation,
  feature timestamp shift, delayed-provider placebo, backfilled-availability
  placebo, synthetic null features, forbidden future/outcome-column scan,
  same-asset/entity/overlapping-window leakage scan, provider/source-ID-only
  predictor, randomized model-output/tool-selection control; "Unexpected
  material lift blocks promotion and creates an evaluation incident."
- **§68.6 Correlated uncertainty** (FR-MAT-005) — final intervals use
  block/cluster methods; reports include naive sample size, cluster count,
  effective independent sample size, cluster definition, interval method, and
  sensitivity to alternate clusters; "A low effective sample size blocks
  calibrated/proven claims even when token count is high."
- **§68.9 Objective versus subjective labels** (FR-MAT-006) —
  OBJECTIVE_SIGNAL_OUTCOME, OBJECTIVE_TRADABLE_OUTCOME,
  OBJECTIVE_PORTFOLIO_UTILITY, SUBJECTIVE_USER_UTILITY, HUMAN_EXPERT_JUDGMENT
  "remain separate in storage, evaluation, training, and rendering."
- **§68.10 Selective observation and acquisition** (FR-MAT-007) — sampled
  cases store eligibility, stratum, assignment probability, selection time;
  "Weighting is used only with valid positivity, overlap, weight stability,
  and model diagnostics. Otherwise claims are restricted."
- **§68.12 Statistical incident triggers** — leakage/negative-control
  failure, exhausted holdout used as untouched, invalid sampling propensity,
  multiple-testing registry mismatch, cluster ESS below gate, action-time
  asymmetry, pool-adapter parity invalidating outcomes, population claim
  exceeding universe support, material unexplained champion/challenger
  divergence each create an incident and pause affected influence.
- **§31.1–31.3 Evaluation principles, dataset partitions, experiment
  registry** — time-based splits only; record all experiments; the six
  partitions (TRAIN, CALIBRATION, VALIDATION, FINAL_HOLDOUT, LIVE_SHADOW,
  FORWARD_CONFIRMATION) with purge/embargo and the five holdout-exposure
  states (UNEXPOSED … EXHAUSTED); the §31.3 experiment-registry field set
  recorded before results are computed.
- **§31.4 Universal actionable-time outcomes** — `T_delivery(d)` /
  `T_actionable(d, scenario)`; "A policy cannot receive a price from before it
  could have decided and delivered. Rejected, ignored, below-cutoff,
  challenger, and control candidates use the same semantics."
- **§31.5 Frozen replay manifest** — the replay manifest field set this
  package freezes per evaluation run (extending the proven exec
  `replay_manifests` with datasetVersion, populationClaim,
  holdoutExposureSnapshotId); "Evaluation runtime denies live network access
  unless a registered experiment explicitly evaluates provider/collector
  availability rather than decision quality."
- **§31.6 Required metrics** (FR-EVAL-003) — LCB95 net shadow-portfolio
  utility per capital-day, net PnL/expectancy/profit factor/drawdown/CVaR,
  capital utilization/turnover/concentration/opportunity cost, Precision@K /
  Recall@eligible-gems / NDCG@K, false discovery and false rejection rates,
  median rank, median actionable lead time, MFE/MAE/target duration/
  liquidity-security survival, tradable success by notional and delay
  scenario, fill/exit survival and partial-fill rate, signal-to-tradable
  divergence, outcome maturity/censoring/invalid-data rates, executable-target
  false-positive rate, discovery coverage metrics, cost per researched and
  useful candidate, sample coverage/ESS/weight stability.
- **§31.7 Baselines** (FR-EVAL-004) — the baseline list; "The strongest
  eligible simple baseline is the promotion comparator. A weak baseline cannot
  be selected merely because it is easier to beat."
- **§31.8 Complete outcome and discovery labeling / §31.9 Evidence-acquisition
  selection bias** — stratified randomized high-resolution sampling with
  stored inclusion probability/stratum/selection time/reason; valid
  design/propensity-weighted estimators or explicitly restricted claims;
  "Selected-only tradable outcomes MUST NOT be presented as universe-wide
  recall or profitability."
- **§31.10 Missed Opportunity Analyzer** (FR-EVAL-005) — the eight-step
  analysis (coverage existence, first source/availability, funnel/evidence
  exit, miss classification, delay calculation, symmetric counterfactual
  action time, frozen evidence/versions/population boundary, next eligible
  evaluation dataset) and the §31.11 error taxonomy it classifies into.
- **§31.12 Champion–challenger** (FR-EVAL-007) — champion controls behavior;
  challengers receive the same candidate stream and frozen availability
  boundary; no external opportunity side effects; budgets equalized or
  explicitly modeled; model-assisted challengers compared against the
  deterministic stack with the model removed.
- **§31.13 Multiple-testing and selection control / §31.14 Statistical
  activation and power** (FR-EVAL-009) — declared corrections, adjusted
  p-values/false-discovery control, winner's-curse diagnostics, holdout
  exposure status, cluster bootstrap, sensitivity to alternate clusterings;
  versioned power/precision plans (minimum mature cases, successes, failures,
  rugs, cluster ESS, calendar blocks, regime coverage, interval width,
  minimum detectable utility); "Fixed global sample counts are prohibited as
  the sole gate"; sequential monitoring only with a registered rule.
- **§7.10 Alpha/opportunity activation gate** — the thirteen-condition gate
  whose statistical half (conditions 2, 3, 5, 6, 7, 8, 9) is computed by this
  package's machinery; "The power analysis MUST be conservative and
  cluster-aware."
- **Appendix G.11 / G.12** — the outcome-maturity configuration block
  (`final_metrics_require_fully_matured: true`, `censored_as_failure: false`,
  `require_population_claim: true`, stratified control fraction, randomized
  evidence probe fraction, `maximum_sampling_weight: 20`,
  `sampling_seed_policy: DAILY_VERSIONED`) and the statistical-activation
  gate (`require_registered_power_plan`, `require_cluster_effective_sample_size`,
  `require_multiple_testing_control`, `require_negative_controls`,
  `require_forward_shadow`, `sequential_peeking_allowed_only_with_registered_rule`).
- **Inline ADR-022 (Appendix D.22)** — "Outcomes are independently matured
  per profile/horizon/scenario; pending/censored/invalid/low-resolution
  outcomes are separate. Promotion requires negative controls, multiple-
  testing control, clustered/block uncertainty, registered stopping, and
  symmetric action-time semantics."

### I1. Scope resolution from the objective (authoritative decomposition)

The package objective binds two packages of machinery over the proven G1
substrate. Resolved against the PRD:

- **Outcome maturity (FR-MAT-001, FR-MAT-002, FR-MAT-003)** = §12.8/§68.1
  independent maturity per outcome profile/horizon/execution scenario with the
  no-reset law (deployment, retry, provider outage, policy changes never reset
  maturity; lifecycle/alert state never overwrites it), §68.2 denominator
  policy (final denominators use only fully matured valid outcomes; provisional
  reporting discloses denominator, maturity, and uncertainty separately), and
  §68.3 explicit censor/invalid reason vocabularies that can never be silently
  mapped to failure (rug/liquidity-collapse/failed-fill are OUTCOMES, not
  censoring). The §8.2 classification seam itself is exec-proven; this package
  owns the maturity ledger, the denominator disclosures (FR-MAT-010's
  invalid/censored/partial/low-resolution/rights-blocked/unobserved classes),
  and the evaluation-side application.
- **Statistical integrity (FR-MAT-004, FR-MAT-005)** = §68.5 negative-control
  harness (every control computed and compared against registered material-lift
  thresholds; unexpected lift blocks promotion and opens an evaluation
  incident per §68.12) and §68.6 clustered/block confidence intervals with
  effective independent sample size, cluster definitions, interval method, and
  sensitivity to alternate clusterings; low ESS blocks calibrated/proven
  claims.
- **Label-family separation and sampling (FR-MAT-006, FR-MAT-007)** = §68.9
  five-family label separation in storage/evaluation/training/rendering
  (subjective owner utility can never change objective labels — AC-125's
  evaluation facet) and §31.8/§68.10 stratified high-resolution sampling with
  stored inclusion probability/stratum/selection time/reason, valid
  design-weighted estimators (Horvitz–Thompson with positivity, overlap, weight
  stability, and weight-diagnostics checks, `maximum_sampling_weight: 20`
  from G.11), or explicitly restricted population claims.
- **Promotion-grade evidence honesty (FR-MAT-008, FR-MAT-009, FR-MAT-010,
  FR-MAT-011, FR-MAT-012)** = the promotion-evidence gate (TRADABLE_SUCCESS
  used for production promotion requires fully matured high-resolution
  execution evidence for the exact notional, delay policy, adapter, route, and
  exit policy — coarse signal data never substitutes), adverse-feasible-order
  primacy with path ambiguity disclosure and optimistic-only secondary
  analysis (consuming the exec-proven `primary_ordering`/`path_ambiguous`
  fields), denominator disclosure of every excluded class so policies cannot
  improve measured performance by reducing outcome collection, time-stamped
  alert-expiry/cancellation/thesis-invalidation side effects with post-expiry
  gains never counting as actionable success, and capacity disclosures
  (maximum executable notional + total deployable portfolio capacity consumed
  read-only from the proven execution-simulator aggregation outputs) so
  small-notional success cannot generalize to larger capital without
  simulation.
- **Evaluation baseline (FR-EVAL-001, FR-EVAL-002)** = versioned outcome
  profiles (the §8.3 profile shape — eligibility, signal_success, tradable_success,
  tradable_failure, neutral clauses — registered as immutable versions) and
  time-based frozen replay over the §31.5 manifest field set, denying live
  network access for decision-quality evaluations.
- **Universal action time (FR-EVAL-002 substrate, §31.4)** = the universal
  decision/action-time function T_delivery/T_actionable applied identically to
  alerted, watched, ignored, rejected, challenger, control, and
  missed-opportunity candidates (AC-240: "a non-delivered arm never receives
  an earlier entry than its counterfactual delivery time"); consumes the
  proven `candidate_decision_timelines` records and the exec-proven delay
  distributions.
- **Metrics, baselines, and comparison (FR-EVAL-003, FR-EVAL-004)** = the
  §31.6 required metric set computed from matured outcomes + simulation
  results, and §31.7 baseline comparison where the strongest eligible simple
  baseline is the promotion comparator, all compared on identical frozen
  universes/cutoffs/action-time semantics (AC-042).
- **Missed Opportunity Analyzer (FR-EVAL-005)** = §31.10 steps 1–8 producing
  §31.11-taxonomy miss classifications from discovery-universe entries, funnel
  stages, evidence-acquisition states, and decision timelines — all consumed
  read-only from the proven seams.
- **Exploration/control, champion–challenger, drift/calibration (FR-EVAL-006,
  FR-EVAL-007, FR-EVAL-008)** = retention and outcome analysis of the
  exploration/control sample (consuming `sig.ranking_audits` selection arms —
  AC-043), §31.12 champion–challenger comparison with equalized budgets and no
  challenger external side effects, and drift/calibration controls including
  the calibration machinery behind AC-154's automatic degradation on
  calibration/regime drift (the challenger seam itself is sig-proven DISABLED
  until a proven challenger exists).
- **Experiment governance (FR-EVAL-009)** = the §31.3 experiment registry
  (pre-registration before results), §31.13 multiple-testing/selection
  control, §31.14 versioned power/precision plans, §68.7 registered sequential
  rules, and selection-bias diagnostics (evidence-acquisition probes from the
  proven `probe_assignments`, selective-observation propensity models —
  AC-244's evaluation facet).

### I2. Relationship to the proven substrate (extend, never rewrite)

- **g1-execution-simulation (PROVEN)** supplies: `execution_simulations` rows
  (§8.2 outcome classes, §12.8 maturity, censor reasons, `primary_ordering`,
  `path_ambiguous`, full net-return decomposition), `replay_manifests`
  (frozen execution assumptions + code versions), `outcome_observation_plans`
  (inclusion probability/stratum/population limits — FR-MAT-007's plan-side
  records), `execution_scenarios` (notional/delay/exit-policy identity —
  FR-MAT-008's exact-configuration matching keys), `tradability_gate_decisions`,
  and concurrent-shadow aggregation outputs (maximum executable notional —
  FR-MAT-012 inputs). All consumed read-only; no second simulator, no second
  label-precedence law.
- **g1-signal-registry (PROVEN)** supplies: `sig.ranking_audits` (rank
  context, selection arm + selection probability + cutoff reason — the
  exploration/control denominators and weighting strata), `sig.candidate_funnel_stages`
  (funnel exits for the Missed Opportunity Analyzer), `sig.candidate_lifecycle`
  (thesis-invalidation side effects — FR-MAT-011 inputs), `sig.recheck_budgets`/
  `sig.recheck_decisions`, and the challenger seam (DISABLED state — FR-EVAL-007
  consumes it and AC-154's calibration machinery extends it).
- **g1-data-truth-extensions (PROVEN)** supplies: `candidate_decision_timelines`
  (decision_ready_at, policy_decided_at, delivery_eligible_at, delivered_at,
  counterfactual_delivery_at, valid_until, expired_at — the §31.4 action-time
  inputs), `probe_assignments` (randomized evidence probes with assignment
  probability/seed provenance — AC-243's write-before-outcome precedent and
  FR-EVAL-009 selection-bias diagnostics), `evidence_acquisition_decisions`
  (acquisition states for §31.9), dependence edges +
  `empirical_dependence_observations` (cluster-definition inputs for
  FR-MAT-005), and provider-conflict preservation. Consumed read-only.
- **g1-discovery-coverage (PROVEN)** supplies: `disc.discovery_universe_entries`
  + coverage populations + `disc.coverage_population_manifests` (Missed
  Opportunity Analyzer step 1/2 inputs and population-claim support), and the
  constraint/claim-basis honesty vocabulary this package's reports must cite.
- **G0 substrate**: `visibleAt` (THE replay visibility predicate — INV-005/006),
  `feature_definitions`/`feature_values`, economic observations and trade
  events, `QualityCode` vocabulary (OUTCOME_PENDING, OUTCOME_CENSORED, LOW_SAMPLE),
  cost ledgers (cost-per-researched/useful-candidate metrics — read-only), and
  the protected-reserve plane (outcome observation is a protected reserve
  class — FR-MAT-010's cannot-reduce-collection law aligns with the proven
  degradation order).
- New closed vocabularies live in `packages/domain/src/mat.ts` and
  `packages/domain/src/eval.ts`, imported — never restated — by
  `packages/shared-schemas/src/mat.ts` / `packages/shared-schemas/src/eval.ts`
  (milestone plan-level decision 5, ADR-0018 precedent). Existing exec/sig
  vocabularies (OutcomeMaturity, OutcomeClass, TradabilityVerdict,
  SelectionArm, CutoffReason, StressScenarioKind, ReplayMode, QualityCode) are
  imported from domain, never duplicated.

### I3. Cross-package acceptance-criteria file ownership

The manifest attaches all 29 shared ACs (AC-040…044, AC-120…128, AC-150…154,
AC-240…249) to every assigned requirement. File status at planning time:

- **AUTHORED here (files do not exist)** — 9 ACs / 18 files: **AC-040,
  AC-041, AC-042, AC-043, AC-044, AC-150, AC-151, AC-152, AC-153**. Authorship
  is scoped to the obligations provable at the seams this package owns:
  - AC-040 (separate signal/tradable labels from delivery time, canonical
    pool, notional/delay, impact, fees, fill constraints, exit policy, and
    maturity state): proven at the versioned-profile + metrics seam consuming
    exec simulation records.
  - AC-041 (dashboard reports both precision and recall/missed gems): proven
    at the metrics/report seam — precision cannot be reported without the
    missed-gem/recall complement from the Missed Opportunity Analyzer.
  - AC-042 (baseline and champion use the same frozen candidate universe and
    data cutoff): proven at the baseline-comparison seam (§31.7 + §31.1
    identical-semantics law).
  - AC-043 (exploration sample retained for outcome analysis): proven at the
    exploration seam consuming `sig.ranking_audits` exploration arms.
  - AC-044 (all experiment versions and attempted configurations recorded):
    proven at the §31.3 experiment-registry seam.
  - AC-150 (label permutation, feature-time shift, synthetic-null feature,
    delayed-provider controls show no unexplained material lift): proven at
    the negative-control harness seam (§68.5 four-control subset this package
    computes; the availability-backdating placebo facet of AC-249 stays with
    the data-truth owner).
  - AC-151 (cluster/block bootstrap intervals differ appropriately from naive
    independent-token intervals on correlated fixtures): proven at the
    clustered-interval seam (§68.6).
  - AC-152 (a module can be IMPLEMENTED while unavailable/shadow and cannot
    support alert claims until AVAILABLE; production promotion additionally
    requires PROVEN when specified): proven at the evaluation-evidence seam —
    this package's promotion-evidence gate refuses claims from modules whose
    state does not support them (§69.2 independent state dimensions).
  - AC-153 (best-effort free-tier degradation preserves data integrity, audit,
    duplicate prevention, and critical risk monitoring): proven at this
    package's seam — outcome observation is a protected reserve class, so
    free-tier degradation must not corrupt or drop maturity ledgers,
    denominator disclosures, or critical-risk outcome recording; duplicates
    stay prevented under retry (INV-009).
- **EXTENDED additively here (files exist, this package adds scoped describe
  blocks — existing content untouched, header trace lists updated)** — 20 ACs:
  - AC-120…128 (authored by g1-execution-simulation): the FR-MAT-facing
    statistical facets they reserved — maturity-denominator composition
    (AC-123), censor/invalid reason retention in evaluation datasets
    (AC-124), subjective-utility evaluation isolation (AC-125), weighted
    estimators over observation plans (AC-128), plus evaluation-side
    label/replay facets for AC-120/121/122/126/127 where this package's
    machinery is the proving surface.
  - AC-154 (authored by g1-signal-registry): the calibration machinery facet —
    expected-net-utility ranking's automatic degradation on calibration/regime
    drift is computed here (FR-EVAL-008) and the disabled-challenger law is
    regression-locked.
  - AC-240…249 (authored by g1-data-truth-extensions): the evaluation facets
    reserved for this package — the universal action-time function (AC-240),
    challenger replay comparison (AC-241), NOT_REQUESTED_BY_POLICY evidence
    honesty in evaluation datasets (AC-242), probe-probability-before-outcome
    (AC-243), selection-adjusted lift claims (AC-244), correlated-source
    independence credit (AC-245), lineage-collapse sensitivity (AC-246),
    frozen historical evidence counts (AC-247), promotion threshold gates
    (AC-248), and the extended negative-control set (AC-249).

No AC file is rewritten or weakened; extensions follow the facet-scope header
convention proven across g1-discovery-coverage/g1-execution-simulation.
Gaps outside this boundary are recorded in the run's out-of-scope notes.

### I4. Seams consumed by later G1 packages (interface obligations)

- `g1-objective-governance` consumes: the §31.6 metric suite, the
  clustered-interval/ESS outputs, the §31.3 experiment-registry records, the
  holdout-exposure states, the §31.4 universal action-time function, the
  denominator-disclosure records, and the negative-control harness verdicts —
  its shadow-portfolio utility objective and hard-constraint promotion gates
  build directly on them.
- `g1-signal-registry`'s AC-154 calibration obligation is completed here: when
  this package's calibration machinery proves a calibrated challenger, the
  sig-proven seam admits it; until then the DISABLED state stays regression-locked.
- G2 observability consumes the declarative `telemetry/mat.*` and
  `telemetry/eval.*` catalogs authored here.

### I5. Evaluation-honesty boundaries (package-level laws)

- **No live network in decision-quality evaluation** (§31.5): the frozen-replay
  runner denies network access; only registered availability experiments may
  touch providers.
- **No retrospective promotion evidence** (§31.3, §68.7): exploratory results
  can never be upgraded into confirmatory evidence without a new untouched
  evaluation; in-sample best configuration cannot be reported as untouched.
- **No denominator gaming** (FR-MAT-010, §68.12): reducing outcome collection
  cannot improve measured performance — every excluded class is disclosed;
  sampling-propensity invalidity creates an incident.
- **No silent censoring-to-failure mapping** (FR-MAT-003): `censored_as_failure:
  false` (G.11) is a structural SQL CHECK + pure law, never a rendering choice.
- **Population claims are manifest-backed** (§68.4, §7.8): every report
  declares exactly one population with inclusion mechanism, known exclusions,
  and source-dependence assessment; aggregate/selected samples are never
  market-wide.
- **No model anywhere in the deterministic evaluation path**: metrics,
  intervals, controls, and comparisons are pure deterministic functions of
  persisted inputs + versioned configuration; the evaluation runtime contains
  no model-provider surface (structural test + prohibited-capability scanner).

## Binding invariants (package-level cross-cut)

Every task operates under the PRD §45 invariants, with these carrying the main
load in this package:

- **INV-001** — permanently read-only: the maturity ledger, evaluation engine,
  and CLI compute, persist, and report; they construct, sign, broadcast,
  submit, or recommend nothing (scan-prohibited-capabilities stays green).
- **INV-002/INV-010** — agent/model intelligence never replaces the
  deterministic maturity, denominator, metric, interval, or control machinery;
  the primary objective remains conservative net shadow-portfolio utility, so
  per-alert precision stays a diagnostic, never a promotion substitute.
- **INV-004** — every retained evaluation decision is reconstructable:
  experiment registry records, replay manifests, denominator disclosures,
  interval parameters, and control verdicts persist versions and inputs.
- **INV-005/INV-006** — evaluation is replay-honest: frozen replay resolves
  only data with `available_at ≤ T` through the proven `visibleAt` predicate;
  backfilled history is never backdated into production replay (AC-247/249
  facets).
- **INV-007** — alerts, watches, ignores, rejects, below-cutoff cases,
  exploration/control cases, and missed opportunities enter evaluation under
  symmetric action-time semantics (§31.4).
- **INV-008** — provider count is not source independence: clustered intervals
  and ESS use declared lineage + empirical dependence (the proven dependence
  substrate), never raw source counts.
- **INV-009** — the evaluation runtime may retry; every maturity transition,
  sampling assignment, and experiment registration stays idempotent and fenced.
- **INV-011/INV-012 (exec-proven, consumed here)** — signal success is not
  tradable success; unmatured/censored/invalid outcomes never enter final
  denominators without explicit separate reporting.

## Package success criteria

1. All 21 assigned requirements (FR-MAT-001…012, FR-EVAL-001…009) have
   executable positive AND negative/failure verification at the
   manifest-declared paths: 18 new AC files authored here (AC-040…044,
   AC-150…153) and 20 existing AC files (AC-120…128, AC-154, AC-240…249)
   extended additively with mat/eval facet cases, green on this branch.
2. Migrations `g1_mat_*.sql` and `g1_eval_*.sql` apply cleanly to empty
   databases, are discovered by the fail-closed migrator after the
   `mat|eval` family extension (`packages/persistence/src/migrator.ts`,
   plan-sanctioned scope exception per ADR-0019/0022 duty), the central
   expected-script registry (`packages/persistence/test/migrator.spec.ts`,
   test-owned, sanctioned) is extended in the same package, and the ADR-001
   Drizzle mirror (`packages/persistence/src/generated/schema.ts`) catches up
   to SQL truth in the same package (schema-parity gate enumerates `public`,
   where these tables live — same g1-execution-simulation #208 precedent).
3. Every new closed vocabulary lives in `packages/domain/src/mat.ts` /
   `packages/domain/src/eval.ts`, is imported by
   `packages/shared-schemas/src/mat.ts` / `packages/shared-schemas/src/eval.ts`,
   and is pinned by SQL CHECK literals; unknown values refuse with stable
   error codes.
4. Final metrics refuse to compute over denominators containing
   pending/partially-matured/censored/invalid outcomes without disclosure;
   censoring can never map to failure; subjective utility cannot alter
   objective labels; sampled populations without valid weighting diagnostics
   yield restricted claims only.
5. The Missed Opportunity Analyzer produces §31.11-taxonomy classifications
   over the proven discovery/funnel/timeline seams; champion–challenger
   comparisons enforce identical universes/cutoffs/action-time semantics and
   no challenger external side effects.
6. Telemetry catalogs `telemetry/mat.catalog.json` and
   `telemetry/eval.catalog.json` are DECLARATIVE_CONTRACT_ONLY and the central
   parity suite (`tests/telemetry-catalog.spec.ts`, test-owned sanctioned
   exception) is extended in the same package.
7. `pnpm verify` and `pnpm spec:verify` pass at the pushed HEAD; the three
   milestone verification commands (outcome-maturity, evaluation, eval-cli
   package filters) are green.
8. No template placeholders remain in any scoped artifact; every task traces
   to an assigned requirement (FR-MAT-*/FR-EVAL-* only) or its acceptance
   criteria.

## Assumptions

- PGlite remains the deterministic DB test engine (ADR-0014); mat/eval tables
  live in the `public` schema under the §30.7 names, so the Drizzle mirror
  catch-up is required in-package (mirror parity enumerates `public` + `sig`).
- The `mat` and `eval` migration families are NEW to the fail-closed migrator
  filename pattern; both the migrator family list and the central
  expected-script registry suite are extended in this package (the live
  g1-execution-simulation precedent, which added `exec` the same way).
- Telemetry stays DECLARATIVE_CONTRACT_ONLY until the G2 observability
  milestone wires emitters.
- Fixtures stay synthetic deterministic chains over the proven seam shapes
  (`tests/fixtures/mat/*.ts`, `tests/fixtures/eval/*.ts` module convention);
  no live-chain or live-provider dependency.
- The LCB95 shadow-portfolio utility metric itself is computed by
  `g1-objective-governance` (its governing objective); this package delivers
  the metric framework, denominator honesty, and the deterministic components
  (expectancy, drawdown, CVaR, capital utilization) it consumes — the
  FR-MAT-facing statistical substrate, not the objective definition.
- All G1 packages are serialized (`parallelizable: false`), so central-suite
  extensions never race a concurrent package.
