# g1-signal-registry — scoped specification

> This file is a SUBORDINATE DERIVATIVE of the authoritative product contract
> `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md`. It was seeded mechanically from
> the requirement manifest by `scripts/automation/bootstrap-package-spec.mjs` (builder v1). The PRD
> always wins over any wording below.

## Authority binding

- Milestone: `G1` (ACTIVE)
- Objective: Stand up the versioned Feature Registry and the deterministic signal baseline that
  Appendix I requires before any learned ranking: the versioned Feature Registry with candidate
  funnel and independent Opportunity/Risk/DataQuality/Urgency/Novelty/Tradability/SourceIndependence
  vectors; reproducible research-priority ranking; diversity and exploration sampling; candidate
  lifecycle with risk separation so tradability can block confirmed opportunities while preserving
  diagnostic signal labels; adaptive rechecks operating with finite budget, information-value
  selection, starvation limits and explicit expiry; and every numeric feature defining minimum
  denominator/sample, stability transform, outlier/null policy, shrinkage, capped contribution and
  cohort fallback — with the Appendix H baseline formulas (volume acceleration, volume persistence,
  price extension, unique-buyer growth with economic-actor deduplication, buy/sell imbalance)
  computed over event time with no LLM anywhere in the deterministic path. Strictly read-only: no
  trading, custody, wallet-signing, private-key, or transaction-submission capability.
- Risk: HIGH · writeScopes: `packages/signal-intelligence/**`, `packages/shared-schemas/**`,
  `packages/domain/**`, `migrations/g1_sig_*.sql`, `tests/fixtures/sig/**`, `tests/acceptance/**`,
  `tests/negative/**`, `telemetry/sig.*`
- Dependencies: `g1-data-truth-extensions` PROVEN, `g1-execution-simulation` PROVEN
- Bound inputs at seed time: main `cd9d4d8a65fe`, manifest `e0f9f1284473`, PRD `baa521d9c67e`

## Assigned requirements (normative text quoted verbatim)

### FR-SIG-001 — 38. Functional requirements catalogue (PRD line 6004)

> Versioned Feature Registry.

Normative level: MUST. Acceptance criteria: all 10 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/sig.ts`
- Fixture refs: `tests/fixtures/sig/`
- Telemetry refs: `telemetry/sig.*`

### FR-SIG-002 — 38. Functional requirements catalogue (PRD line 6005)

> Candidate funnel and independent vectors.

Normative level: MUST. Acceptance criteria: all 10 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/sig.ts`
- Fixture refs: `tests/fixtures/sig/`
- Telemetry refs: `telemetry/sig.*`

### FR-SIG-003 — 38. Functional requirements catalogue (PRD line 6006)

> Reproducible research-priority ranking.

Normative level: MUST. Acceptance criteria: all 10 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/sig.ts`
- Fixture refs: `tests/fixtures/sig/`
- Telemetry refs: `telemetry/sig.*`

### FR-SIG-004 — 38. Functional requirements catalogue (PRD line 6007)

> Diversity and exploration sample.

Normative level: MUST. Acceptance criteria: all 10 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/sig.ts`
- Fixture refs: `tests/fixtures/sig/`
- Telemetry refs: `telemetry/sig.*`

### FR-SIG-005 — 38. Functional requirements catalogue (PRD line 6008)

> Candidate lifecycle/risk separation.

Normative level: MUST. Acceptance criteria: all 10 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/sig.ts`
- Fixture refs: `tests/fixtures/sig/`
- Telemetry refs: `telemetry/sig.*`

### FR-SIG-006 — 38. Functional requirements catalogue (PRD line 6009)

> Adaptive rechecks operate with finite budget, information-value selection, starvation limits, and
> explicit expiry.

Normative level: MUST. Acceptance criteria: all 10 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/sig.ts`
- Fixture refs: `tests/fixtures/sig/`
- Telemetry refs: `telemetry/sig.*`

### FR-SIG-009 — 38. Functional requirements catalogue (PRD line 6012)

> Every numeric feature defines minimum denominator/sample, stability transform, outlier/null
> policy, shrinkage, capped contribution, and cohort fallback.

Normative level: MUST. Acceptance criteria: all 10 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/sig.ts`
- Fixture refs: `tests/fixtures/sig/`
- Telemetry refs: `telemetry/sig.*`

## Shared acceptance criteria

Attached to more than one requirement of this package — implement once, satisfy everywhere:

- **AC-020** · positive: `tests/acceptance/AC-020.spec.ts` · negative/failure:
  `tests/negative/AC-020.negative.spec.ts` — attached to 7 requirements
- **AC-021** · positive: `tests/acceptance/AC-021.spec.ts` · negative/failure:
  `tests/negative/AC-021.negative.spec.ts` — attached to 7 requirements
- **AC-022** · positive: `tests/acceptance/AC-022.spec.ts` · negative/failure:
  `tests/negative/AC-022.negative.spec.ts` — attached to 7 requirements
- **AC-023** · positive: `tests/acceptance/AC-023.spec.ts` · negative/failure:
  `tests/negative/AC-023.negative.spec.ts` — attached to 7 requirements
- **AC-136** · positive: `tests/acceptance/AC-136.spec.ts` · negative/failure:
  `tests/negative/AC-136.negative.spec.ts` — attached to 7 requirements
- **AC-154** · positive: `tests/acceptance/AC-154.spec.ts` · negative/failure:
  `tests/negative/AC-154.negative.spec.ts` — attached to 7 requirements
- **AC-190** · positive: `tests/acceptance/AC-190.spec.ts` · negative/failure:
  `tests/negative/AC-190.negative.spec.ts` — attached to 7 requirements
- **AC-191** · positive: `tests/acceptance/AC-191.spec.ts` · negative/failure:
  `tests/negative/AC-191.negative.spec.ts` — attached to 7 requirements
- **AC-192** · positive: `tests/acceptance/AC-192.spec.ts` · negative/failure:
  `tests/negative/AC-192.negative.spec.ts` — attached to 7 requirements
- **AC-193** · positive: `tests/acceptance/AC-193.spec.ts` · negative/failure:
  `tests/negative/AC-193.negative.spec.ts` — attached to 7 requirements

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
PRD (§19 in full, §20 in full, §21 in full, Appendix H, Appendix I, §62.7, §45
invariants) and the milestone decomposition record. They never override the
seeded normative content above.

### I1. Scope resolution from the objective (authoritative decomposition)

The package objective binds a specific deterministic-baseline scope. Resolved
against the PRD:

- **Versioned Feature Registry (FR-SIG-001)** = §19.1 `FeatureDefinition`
  interface (featureId, version, description, formula, inputFields, unit,
  windows, minimumObservations, nullPolicy, outlierPolicy, updatePolicy,
  freshnessLimitSeconds, optional cohortDefinitionId, evidenceRequirements, and
  the FR-SIG-009 fields minimumDenominator / stabilityTransform / shrinkagePolicy
  / cohortFallbackPolicyId / economicEventRequired) + §19.10 derived-feature
  lineage (definition id and version, entity and profile, event/window bounds,
  input observation/evidence IDs, input hashes, calculation code version,
  calculated_at, quality codes). "Formula and semantics MUST be explicit enough
  for independent reimplementation" is a registration-time law.
- **Candidate funnel and independent vectors (FR-SIG-002)** = §20.1 funnel
  stages, §20.2 hard gates (profile-versioned, reason-coded), §20.3 independent
  vectors, and Appendix I step 3's seven-vector set (the five §20.3 vectors plus
  TradabilityVector and SourceIndependenceVector). "No single end-user buy
  score" is a structural law, not a rendering preference.
- **Reproducible research-priority ranking (FR-SIG-003)** = §20.4 (deterministic,
  versioned rank; Pareto/lexicographic before calibration) + §20.7 audit record
  - Appendix I steps 1–13 as the normative algorithm. The deterministic rank is
    a pure function of (frozen eligible universe, resolved inputs, versioned
    policy); identical inputs reproduce identical rank output byte-for-byte.
- **Diversity and exploration sample (FR-SIG-004)** = §20.5 diversity
  constraints + §20.6 exploration/control sample (≥5% of otherwise eligible
  low-ranked candidates, randomly selected, outcome-only tracking, never
  auto-alerted) + §20.8 selection arms/probabilities + §20.10 frontier
  interaction.
- **Candidate lifecycle/risk separation (FR-SIG-005)** = §21.1 lifecycle states,
  §21.3 transition hysteresis, §21.4 thesis invalidation conditions, and the
  risk-separation law consuming the proven execution-simulator tradability
  verdicts (the CONFIRMED_OPPORTUNITY blocking gate — Appendix I step 2 hard
  gates include supported execution).
- **Adaptive rechecks (FR-SIG-006)** = §21.2 recheck budget fields (max_rechecks,
  max_recheck_provider_calls, max_recheck_model_cost, next_check_at, expires_at,
  backoff_factor, minimum_expected_information_gain) with information-value
  selection, starvation limits, and explicit expiry. The §62.7
  information-value formula is the selection aid — allocation input only,
  never a ranking input.
- **Numeric feature stability (FR-SIG-009)** = §19.9 (minimum absolute activity
  and minimum denominator; zero/one/low-sample behavior; log1p-style stable
  transforms; winsorization/robust outlier policy; shrinkage toward a prior;
  maximum capped contribution to ranking; quality downgrade when economic
  actors cannot be resolved; deterministic cohort fallback hierarchy and
  effective sample size) + §19.11 cohort comparison + the Appendix H baseline
  formulas. §19.2–19.8 feature families land progressively: this package
  registers the definitions framework for all families and implements the
  Appendix H baseline formulas (H.1–H.12 are feature-registry-owned;
  H.13–H.16/H.17–H.18 are consumed cross-domain — see I3).

Appendix H.13–H.18 ownership split (binding for later consumers):

- **H.1–H.12** (volume acceleration/persistence, price extension, unique-buyer
  growth with economic-actor deduplication, buy/sell imbalance, liquidity
  growth, top-10 concentration slope, holder growth, trade-size entropy,
  manipulation indicators, robust activity/change-point baseline, data
  coverage) are implemented in this package as versioned baseline feature
  definitions computed over event time.
- **H.13** (effective source independence) consumes the PROVEN
  `packages/domain/src/dependence.ts` effective-independence multiplier and the
  point-in-time dependence edges (`g1_data_0002`) — never a second
  independence law. The SourceIndependenceVector aggregates it via
  `source_group_weight_g ∈ [0,1]` with SAME_UPSTREAM duplicates sharing one
  capped group credit.
- **H.14–H.16** (executable capacity ratio, remaining actionability, robust
  execution margin) are produced by the PROVEN `g1-execution-simulation`
  scenario/feasibility surfaces; the TradabilityVector consumes those outputs
  as inputs. This package implements no pool math and no second execution
  simulator.
- **H.17** (evidence-acquisition missingness is categorical, never imputed to
  zero) is enforced at this package's feature-input seam: acquisition states
  become explicit null policies + quality codes, never zero-filled numerics.
- **H.18** (conservative portfolio marginal utility) is explicitly NOT a
  user-facing buy score and its consumer is `g1-objective-governance`; nothing
  here computes it.

### I2. Relationship to the proven substrate (extend, never rewrite)

- **g1-data-truth-extensions (PROVEN)** supplies: economic trade events with
  actor resolution states and contribution factors (§66; the unique-buyer
  growth deduplication consumes `actor_entity_id` +
  `actor_resolution_confidence` — cluster-as-one-economic-actor dedup when
  confidence exceeds the configured threshold, H.4), candidate decision
  timelines (`decision_ready_at` anchoring T_decision_ready), source-dependence
  edges + empirical dependence observations (H.13 inputs),
  provider-conflict preservation, backfill provenance, and replay-mode
  labeling. All consumed read-only; never restated.
- **g1-execution-simulation (PROVEN)** supplies: TradabilityVerdict +
  diagnostic-signal preservation, scenario pass matrices, maximum executable
  notional, robust-execution margin, and replay manifests. The lifecycle's
  CONFIRMED transition and the ranking's feasibility key consume these
  read-only.
- **G0 substrate**: `feature_definitions`/`feature_values` tables (§14.3/14.4
  online/offline consistency, `supportsPopulationClaim` provenance law),
  `visibleAt` as THE replay visibility predicate, QualityCode vocabulary
  (LOW_SAMPLE included), identity tables (chains/assets/pools/migration_edges),
  `probe_assignments` (AC-243 write-before-outcome precedent), and the G1
  capacity reserve vocabulary (`ReserveClass` incl. RISK_MONITORING,
  ALERT_VERIFICATION, OUTCOME_COLLECTION, EXPLORATION_PROBES — the AC-190
  protected classes).
- New closed vocabularies live in `packages/domain/src/sig.ts` and are imported
  — never restated — by `packages/shared-schemas/src/sig.ts` (compile-parity
  law; milestone plan-level decision 5, ADR-0018 precedent).
- The G0 `feature_definitions`/`feature_values` tables (g0_data_0004) carry the
  FR-DATA-004 online/offline substrate. This package ADDS sig-family tables
  (g1_sig_*) for the signal-layer records (feature registry §19.1 semantics,
  lineage §19.10, vectors, funnel, ranking, selection, lifecycle, rechecks) —
  it does NOT alter the G0 feature tables; the registry links to them by
  definition/subject coordinates.

### I3. Cross-package acceptance-criteria file ownership

The manifest attaches all 10 shared ACs (AC-020…023, AC-136, AC-154,
AC-190…193) to every assigned FR-SIG requirement. This package AUTHORS the
positive+negative files that do not yet exist — **AC-154, AC-190, AC-191,
AC-192, AC-193** (10 files) — and EXTENDS the existing **AC-020, AC-021,
AC-022, AC-023, AC-136** suites additively with sig-scoped describe blocks
(existing content untouched, header trace lists updated), exactly the
g1-execution-simulation precedent. Authorship is scoped strictly to the
FR-SIG obligations provable at the seams this package owns:

- **AC-136**'s sig facet is the FR-SIG-009 core: low-denominator growth,
  one-bucket entropy, robust change-point, shrinkage, and cohort-fallback
  fixtures producing bounded deterministic features with correct quality codes
  (the existing file carries the actor-uncertainty facet authored by
  `g1-data-truth-extensions` — preserved).
- **AC-154**'s G1-provable half: expected-net-utility ranking REMAINS DISABLED
  before mature calibration — the deterministic path contains no learned
  probability (structural type-level and registry-level refusal), and when a
  calibrated challenger exists in a later milestone it cannot override hard
  gates (Appendix I closing law) and automatically degrades on
  calibration/regime drift. The challenger model itself is FR-SIG-010
  (dependency group G6, no G1 package) — its implementation lands with its own
  milestone; the calibration machinery is `g1-outcome-evaluation`. Both will
  EXTEND AC-154 additively.
- **AC-190/AC-191**: proven here at the adaptive-recheck seam (finite recheck
  budget, information-value selection, starvation limits, explicit expiry;
  static-cadence vs adaptive-scheduler replay over identical fixture
  universes with measured information gained per quota unit and
  missed-critical-event-rate parity before promotion). The full §38.30
  information-gain scheduler (FR-AIG-001…005) and §38.31 bandit (FR-EXP-001…006)
  are dependency-group-G7 obligations; their owners will extend these files
  additively.
- **AC-192/AC-193**: proven here for the §20.6/§20.8 exploration sample and
  budget partition (valid stratum, nonzero inclusion probability, corrupted
  assignments excluded from weighted claims; exploitation cannot reduce
  exploration below the configured floor without an audited emergency policy).
  The FR-EXP-002 field set (eligibility universe, stratum, policy version,
  assignment probability, seed/entropy provenance, inclusion timestamp) is
  implemented at the sig seam; the full §38.31 bandit lands G7.

Gaps outside this boundary are recorded in the run's out-of-scope notes.

### I4. Seams consumed by later G1 packages (interface obligations)

- `g1-outcome-evaluation` consumes: ranking audit records (§20.7) as
  evaluation denominators' rank context; selection decisions with arm +
  selection probability (§20.8) for weighted estimators; lifecycle states and
  thesis-invalidation conditions; the exploration/control sample membership;
  and every feature value's population provenance (population claims).
- `g1-objective-governance` consumes: the selection-arm budget partition,
  exploration floor records, cutoff reasons, and the deterministic rank as the
  baseline comparator its challenger must beat.
- Later G5/G7 milestones consume: the Feature Registry's definition format
  (§19.1) for wallet/social feature families (FR-SIG-007/008), and the
  challenger seam (FR-SIG-010, G6).

### I5. Deterministic-path purity (no LLM anywhere)

Appendix I step 14 and the objective's "no LLM anywhere in the deterministic
path" are structural, not aspirational:

- `packages/signal-intelligence` imports NO model-provider, agent, or prompt
  module; the package dependency graph is provably free of model surfaces
  (enforced by a colocated structural test asserting the absence of
  model-provider imports and by the repo prohibited-capability scanner).
- Every Appendix I step 1–13 function is a pure function of persisted inputs
  plus versioned configuration; no wall-clock reads inside the algorithm
  (timestamps are inputs), no ambient randomness (exploration sampling uses a
  seed with recorded provenance — the G0 probe-assignment pattern).
- The §62.7 information-value formula enters ONLY the recheck scheduler and
  research-budget allocation as an aid; a code-level guard refuses any path
  where an information-value/calibrated score reaches the deterministic rank
  ordering or hard-gate outcomes.

## Binding invariants (package-level cross-cut)

Every task operates under the PRD §45 invariants, with these carrying the main
load in this package:

- **INV-001** — permanently read-only: the registry, ranking, and scheduler
  construct, sign, or submit nothing; scan-prohibited-capabilities stays green.
- **INV-002** — agent/model intelligence never replaces the deterministic
  vectors, gates, rank, or recheck budgets: the deterministic path is closed
  to learned input before calibration proof (AC-154).
- **INV-004** — every retained decision is reconstructable: ranking audits,
  selection records, recheck decisions, and feature values persist the §19.10
  lineage + §20.7 audit fields with code/definition/profile versions.
- **INV-005/INV-006** — feature computation is replay-honest: values resolve
  only inputs with `available_at ≤ T` (THE proven `visibleAt` predicate);
  backfilled history is never backdated into production replay.
- **INV-007** — exploration/control cases and below-cutoff candidates are
  retained for evaluation with symmetric action-time semantics (§20.6, §20.7
  cutoff_reason).
- **INV-008** — provider count is not source independence: the
  SourceIndependenceVector reads the point-in-time dependence state (H.13),
  never raw source counts.
- **INV-010** — the deterministic vectors and rank are budget-allocation
  machinery, not a user-facing buy score (§20.3 law).

## Package success criteria

1. All 7 assigned requirements have executable positive AND negative/failure
   verification at the manifest-declared paths: AC-154, AC-190, AC-191, AC-192,
   AC-193 authored here (10 files); AC-020…023 and AC-136 extended additively
   with sig-scoped describe blocks.
2. Migrations `g1_sig_*.sql` apply cleanly to empty databases, are discovered
   by the fail-closed migrator (family list extended with `sig`), and the
   central expected-script registry (`packages/persistence/test/migrator.spec.ts`)
   is extended in the same package — the plan-sanctioned scope exception
   (plan-level decision 1; ADR-0019/0022 duty). The hand-maintained ADR-001
   Drizzle mirror (`packages/persistence/src/generated/schema.ts`) catches up
   to SQL truth in the same package (schema-parity gate requires it; same
   g1-data-truth/g1-execution precedent).
3. Telemetry catalog `telemetry/sig.catalog.json` stays
   DECLARATIVE_CONTRACT_ONLY (emitter wiring is G2) and the central parity
   suite (`tests/telemetry-catalog.spec.ts`) is extended in the same package —
   the plan-sanctioned scope exception (plan-level decision 4).
4. The deterministic selection algorithm (Appendix I steps 1–13) is proven
   reproducible and versioned: identical frozen inputs + versions → identical
   persisted ranking audit; any calibrated-model override of hard gates is
   structurally refused (AC-154).
5. `pnpm verify` and `pnpm spec:verify` pass at the pushed HEAD; the milestone
   verification command (`test -d packages/signal-intelligence && pnpm --filter
@foresift/signal-intelligence test`) is green.
6. No template placeholders remain in any scoped artifact; every task traces to
   an assigned requirement or its acceptance criteria.

## Assumptions

- PGlite remains the deterministic DB test engine (ADR-0014); the new package
  follows the G0/G1 scaffold pattern (package-local `bun test`, workspace `*`
  dependencies, tsconfig extending `tsconfig.base.json`).
- Telemetry stays DECLARATIVE_CONTRACT_ONLY until the G2 observability
  milestone wires emitters.
- Fixture inputs are synthetic deterministic chains of economic trade events,
  observations, and pool states constructed in this repository — no live-chain
  dependency for the deterministic suites.
- Diversity dimensions whose upstream data does not exist in G1 (narrative
  graph, wallet/developer/funding clusters) are enforced as explicit
  CONSTRAINT_DIMENSION_UNAVAILABLE degradations recorded in the diversity
  adjustment — never silently skipped, never fabricated from absent data.
- All G1 packages are serialized (`parallelizable: false`), so shared-file
  extensions (AC suites, central migration registry, central telemetry parity
  suite, Drizzle mirror) never race a concurrent package.
