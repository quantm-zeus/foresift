# g1-objective-governance — scoped specification

> This file is a SUBORDINATE DERIVATIVE of the authoritative product contract
> `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md`. It was seeded mechanically from
> the requirement manifest by `scripts/automation/bootstrap-package-spec.mjs` (builder v1). The PRD
> always wins over any wording below.

## Authority binding

- Milestone: `G1` (ACTIVE)
- Objective: Govern the primary production objective and every performance claim: the conservative
  lower confidence bound of net shadow-portfolio utility per capital-day under fixed capital,
  concurrency, execution, latency, liquidity, risk and opportunity-cost assumptions as the governing
  objective; objective comparison only across identical candidate universes, population claims,
  capital, time windows, execution scenarios, delay policies, data cutoffs and correlated-exposure
  constraints with incomparable runs labeled exploratory and barred from promoting a policy;
  critical security, execution, rights, leakage, public-claim, capacity and tail-risk constraints
  applied as hard constraints before utility optimization that no weighted score may compensate for;
  objective reports decomposing gross return, execution costs, failed/partial fills, drawdown, CVaR,
  capital utilization, turnover, opportunity cost, concentration, shared-liquidity impact,
  provider/model/infrastructure cost and uncertainty; per-alert precision, tradable-success rate,
  recall and alerts-per-researched-candidate retained strictly as diagnostics that never replace
  portfolio utility, discovery coverage or false-rejection measurement; objective-integrity
  detection of denominator gaming, selective-universe changes, reduced exploration, delayed outcome
  omission, horizon switching, scenario cherry-picking and repeated holdout inspection with any
  detected failure blocking promotion; every objective or performance claim identifying the exact
  supported population, profile, policy, execution scenario, delay distribution, calendar interval,
  market regimes, capability state, sample size, cluster effective sample size and uncertainty
  method; a configurable action-delay distribution with at least p50, p90 and conservative-tail
  scenarios where the active opportunity policy must pass its declared robust-delay gate rather than
  a single favorable fixed delay; utility sensitivity to capital, notional, concurrency, route
  capacity, alert latency, exit policy and risk-aversion coefficients without rewriting the frozen
  primary experiment; and guaranteed-profit language prohibited across product, agent, UI, API,
  exports and notifications with opportunity outputs always stated as evidence-backed research
  signals whose realized outcome remains uncertain. G1 delivers this requirement's
  objective/agent-output vocabulary, constraint data, and acceptance/negative tests over the
  G1-owned surfaces (per plan-level decision 6); the product/UI/API/export/notification enforcement
  surfaces do not exist in G1, so full cross-surface proof lands with the milestones that own those
  surfaces. Strictly read-only: no trading, custody, wallet-signing, private-key, or
  transaction-submission capability.
- Risk: HIGH · writeScopes: `packages/objective-governance/**`, `packages/shadow-portfolio/**`,
  `packages/shared-schemas/**`, `packages/domain/**`, `migrations/g1_obj_*.sql`,
  `tests/fixtures/obj/**`, `tests/acceptance/**`, `tests/negative/**`, `telemetry/obj.*`
- Dependencies: `g1-capacity-contracts` PROVEN, `g1-execution-simulation` PROVEN,
  `g1-outcome-evaluation` PROVEN
- Bound inputs at seed time: main `f768636f72c9`, manifest `e0f9f1284473`, PRD `baa521d9c67e`

## Assigned requirements (normative text quoted verbatim)

### FR-OBJ-001 — 38. Functional requirements catalogue (PRD line 6374)

> The primary production objective is the conservative lower confidence bound of net
> shadow-portfolio utility per capital-day under fixed capital, concurrency, execution, latency,
> liquidity, risk, and opportunity-cost assumptions.

Normative level: MUST. Acceptance criteria: all 9 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/obj.ts`
- Fixture refs: `tests/fixtures/obj/`
- Telemetry refs: `telemetry/obj.*`

### FR-OBJ-002 — 38. Functional requirements catalogue (PRD line 6375)

> Objective comparison uses identical candidate universes, population claims, capital, time windows,
> execution scenarios, delay policies, data cutoffs, and correlated-exposure constraints;
> incomparable runs are labeled exploratory and cannot promote a policy.

Normative level: MUST. Acceptance criteria: all 9 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/obj.ts`
- Fixture refs: `tests/fixtures/obj/`
- Telemetry refs: `telemetry/obj.*`

### FR-OBJ-003 — 38. Functional requirements catalogue (PRD line 6376)

> Critical security, execution, rights, leakage, public-claim, capacity, and tail-risk constraints
> are hard constraints applied before utility optimization; no weighted score may compensate for a
> failed hard constraint.

Normative level: MUST. Acceptance criteria: all 9 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/obj.ts`
- Fixture refs: `tests/fixtures/obj/`
- Telemetry refs: `telemetry/obj.*`

### FR-OBJ-004 — 38. Functional requirements catalogue (PRD line 6377)

> Objective reports decompose gross return, execution costs, failed/partial fills, drawdown, CVaR,
> capital utilization, turnover, opportunity cost, concentration, shared-liquidity impact,
> provider/model/infrastructure cost, and uncertainty.

Normative level: MUST. Acceptance criteria: all 9 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/obj.ts`
- Fixture refs: `tests/fixtures/obj/`
- Telemetry refs: `telemetry/obj.*`

### FR-OBJ-005 — 38. Functional requirements catalogue (PRD line 6378)

> Per-alert precision, tradable-success rate, recall, and alerts per researched candidate remain
> diagnostics; none may replace portfolio utility, discovery coverage, or false-rejection
> measurement as the governing objective.

Normative level: MUST. Acceptance criteria: all 9 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/obj.ts`
- Fixture refs: `tests/fixtures/obj/`
- Telemetry refs: `telemetry/obj.*`

### FR-OBJ-006 — 38. Functional requirements catalogue (PRD line 6379)

> The objective service detects denominator gaming, selective-universe changes, reduced exploration,
> delayed outcome omission, horizon switching, scenario cherry-picking, and repeated holdout
> inspection; a detected objective-integrity failure blocks promotion.

Normative level: MUST. Acceptance criteria: all 9 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/obj.ts`
- Fixture refs: `tests/fixtures/obj/`
- Telemetry refs: `telemetry/obj.*`

### FR-OBJ-007 — 38. Functional requirements catalogue (PRD line 6380)

> Every objective or performance claim identifies the exact supported population, profile, policy,
> execution scenario, delay distribution, calendar interval, market regimes, capability state,
> sample size, cluster effective sample size, and uncertainty method.

Normative level: MUST. Acceptance criteria: all 9 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/obj.ts`
- Fixture refs: `tests/fixtures/obj/`
- Telemetry refs: `telemetry/obj.*`

### FR-OBJ-008 — 38. Functional requirements catalogue (PRD line 6381)

> A configurable action-delay distribution includes at least p50, p90, and conservative-tail
> scenarios; active opportunity policy must pass its declared robust-delay gate rather than only a
> single favorable fixed delay.

Normative level: MUST. Acceptance criteria: all 9 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/obj.ts`
- Fixture refs: `tests/fixtures/obj/`
- Telemetry refs: `telemetry/obj.*`

### FR-OBJ-009 — 38. Functional requirements catalogue (PRD line 6382)

> The system supports utility sensitivity to capital, notional, concurrency, route capacity, alert
> latency, exit policy, and risk-aversion coefficients without rewriting the frozen primary
> experiment.

Normative level: MUST. Acceptance criteria: all 9 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/obj.ts`
- Fixture refs: `tests/fixtures/obj/`
- Telemetry refs: `telemetry/obj.*`

### FR-OBJ-010 — 38. Functional requirements catalogue (PRD line 6383)

> The product, agent, UI, API, exports, and notifications prohibit guaranteed-profit language and
> must state that opportunity outputs are evidence-backed research signals whose realized outcome
> remains uncertain.

Normative level: MUST. Acceptance criteria: all 9 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/obj.ts`
- Fixture refs: `tests/fixtures/obj/`
- Telemetry refs: `telemetry/obj.*`

## Shared acceptance criteria

Attached to more than one requirement of this package — implement once, satisfy everywhere:

- **AC-220** · positive: `tests/acceptance/AC-220.spec.ts` · negative/failure:
  `tests/negative/AC-220.negative.spec.ts` — attached to 10 requirements
- **AC-221** · positive: `tests/acceptance/AC-221.spec.ts` · negative/failure:
  `tests/negative/AC-221.negative.spec.ts` — attached to 10 requirements
- **AC-222** · positive: `tests/acceptance/AC-222.spec.ts` · negative/failure:
  `tests/negative/AC-222.negative.spec.ts` — attached to 10 requirements
- **AC-223** · positive: `tests/acceptance/AC-223.spec.ts` · negative/failure:
  `tests/negative/AC-223.negative.spec.ts` — attached to 10 requirements
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

<!-- Seeded normative content ends here. Planner-owned sections (integration notes,
     invariants, open points resolved from authoritative sources) go below this line. -->

## Planner-owned integration notes (subordinate, non-normative)

### Dependency consumption map (all dependencies PROVEN)

This package computes over evidence produced by three PROVEN packages. It
consumes their outputs as frozen inputs and never recomputes their semantics:

- `g1-capacity-contracts` → `HardConstraintKind.CAPACITY` evidence: versioned
  Sustainable Capacity Contract coverage and admission-control verdicts are
  consumed as pass/fail constraint inputs. The objective layer never
  recomputes capacity forecasts or reserves.
- `g1-execution-simulation` → net-return components (pool fees, token
  transfer fees, priority/network fees, execution impact, partial fills,
  failed attempts), the adverse feasible primary ordering, shared-liquidity
  impact aggregation, and per-delay-scenario execution evidence. The
  shadow-portfolio utility ledger aggregates these outputs; it never
  re-simulates execution and never constructs, signs, or submits transactions.
- `g1-outcome-evaluation` → maturity-gated denominators (fully matured valid
  outcomes only), explicit censor/invalid reasons, cluster effective sample
  size and interval methods, negative-control outcomes, and experiment /
  holdout-registry states. Integrity detectors and promotion minimums consume
  these; this package restates none of their vocabularies.
- Closed vocabularies owned elsewhere are imported, never restated, per the
  compile-parity precedent: the claim-scope uncertainty method reuses the
  eval-proven interval methods, and horizon/maturity states reuse the
  mat/exec-proven vocabularies.

### Invariants applicability (INV-001…INV-010, all binding)

- INV-001 (permanent read-only): structural proof via `read-only-guard.ts`
  scanner modules in both new packages, mirroring the outcome-maturity /
  evaluation precedent, plus the untouched G0-owned prohibited-capability
  scanner.
- INV-002: agent or model output never overrides a gate verdict; the
  prohibited-language screen constrains agent-facing outputs, never gate
  inputs.
- INV-003: no external side effect follows from any objective computation;
  promotion verdicts are records, not actions.
- INV-004: every promotion decision is reconstructable from the frozen
  objective-run record, availability coordinates, acquisition state,
  configuration, code, adapter, and artifact versions.
- INV-005 / INV-006: comparison and replay consume only data actually
  available at the simulated time; backfilled records never backdate
  `available_at` (consumed from the proven availability law).
- INV-007: denominators span alerted, watched, ignored, rejected,
  below-cutoff, exploration/control, and missed-opportunity arms under the
  proven symmetric action-time semantics; the integrity detectors fail any
  promotion whose denominator silently narrows this set.
- INV-008: lineage-collapse sensitivity is a required sensitivity axis;
  duplicated-evidence confirmation can never support independent-confirmation
  claims.
- INV-009: ledger inserts are idempotent under retry (natural-key
  upsert semantics); promotion decisions are append-only records.
- INV-010: this invariant is the package's reason for being — conservative
  net shadow-portfolio utility under finite capital and hard constraints
  governs; price appreciation and alert win rate never do.

### FR-OBJ-010 G1 partial-claim boundary (milestone plan-level decision 6)

G1 delivers the objective/agent-output vocabulary, constraint data, and
acceptance/negative tests over the G1-owned surfaces
(`packages/objective-governance/**`, `packages/shadow-portfolio/**`,
`packages/shared-schemas/**`): the `ProhibitedClaimKind` vocabulary, the
deterministic prohibited-language screen, the mandatory uncertainty
disclosure on opportunity outputs, and AC-223 public-claim hard-constraint
coverage with positive and negative suites. The product, UI, API, export,
and notification enforcement surfaces do not exist in G1, and the
machine-enforcement scanner `scripts/scan-prohibited-capabilities/**` is
G0-owned and untouched by this package. Full cross-surface proof lands with
the milestones that own those surfaces; FR-OBJ-010 is claimed within this
recorded boundary, not beyond it.

### G7 shadow-portfolio engine boundary (non-goal guard)

`packages/shadow-portfolio` in G1 is the utility-accounting substrate only:
versioned fills aggregate deterministically into per-capital-day net utility
with the twelve decomposition lines. Allocation policies, top-K /
all-confirmed / pattern-only / baseline / control portfolio comparison, and
portfolio-metric breadth beyond the objective decomposition belong to the
later milestone that owns the shadow-portfolio engine requirements. No G1
table, type, fixture, or test claims those engine semantics, and no G1
artifact performs transaction construction or submission.

### Resolved interpretation points (safest coherent reading, fail-closed)

No open clarification points remain; genuine ambiguities in
the contract are resolved below under the safest coherent interpretation,
with material rulings proposed as ADR texts in `plan.md`:

1. Comparability equality (FR-OBJ-002) means exact pairwise equality on all
   eight dimensions, including the data-cutoff timestamp and the
   correlated-exposure constraint set. A missing dimension record refuses
   comparison with an error; it never defaults to comparable.
2. The conservative lower confidence bound (FR-OBJ-001) uses a pinned
   one-sided-95% z constant with integer micro-unit arithmetic end to end.
   No binary floating point appears anywhere in the objective path, so the
   bound is bit-deterministic across runtimes.
3. Hard-constraint evaluation (FR-OBJ-003) is total over all seven kinds: an
   unevaluated constraint blocks activation exactly as a failed one does.
4. Diagnostic metrics (FR-OBJ-005) are excluded from the promotion verdict by
   construction: the verdict function's input type carries no diagnostic
   fields, so no implementation can silently wire win rate into promotion.
5. Claim scope (FR-OBJ-007) is eleven-for-eleven completeness: any
   performance view missing one field is refused, not rendered with a gap.
6. Robust-delay evidence (FR-OBJ-008) must exist for all three scenarios and
   pass the declared gate set; single fixed-delay evidence is refused even
   when favorable.
7. Sensitivity analysis (FR-OBJ-009) reads the frozen primary experiment
   record and emits derived records referencing its content hash; the frozen
   record itself is immutable.
