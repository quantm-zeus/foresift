# g1-solana-security — scoped specification

> This file is a SUBORDINATE DERIVATIVE of the authoritative product contract
> `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md`. It was seeded mechanically from
> the requirement manifest by `scripts/automation/bootstrap-package-spec.mjs` (builder v1). The PRD
> always wins over any wording below.

## Authority binding

- Milestone: `G1` (ACTIVE)
- Objective: Deliver deterministic Solana program and pool security analysis independent of external
  security providers: versioned SPL/Token-2022 program, authority and extension analysis with mint,
  freeze, permanent-delegate, transfer-fee, transfer-hook, close, metadata/update, default-state and
  non-transferable controls recorded as versioned evidence where applicable; pool/LP control,
  migration, withdrawal-authority and liquidity-removal risk assessment; fail-closed blocking of
  profiles requiring complete execution modeling when transfer semantics are unknown; external
  security provider reports consumed strictly as independent evidence that can never override
  deterministic known risk; and a versioned system-address registry preventing infrastructure
  accounts from becoming false wallet-owner/funder evidence. Strictly read-only: no trading,
  custody, wallet-signing, private-key, or transaction-submission capability.
- Risk: HIGH · writeScopes: `packages/solana-security/**`, `packages/shared-schemas/**`,
  `packages/domain/**`, `migrations/g1_solsec_*.sql`, `tests/fixtures/solsec/**`,
  `tests/acceptance/**`, `tests/negative/**`, `telemetry/solsec.*`
- Dependencies: `g1-data-truth-extensions` PROVEN
- Bound inputs at seed time: main `31e05345dbfc`, manifest `e0f9f1284473`, PRD `baa521d9c67e`

## Assigned requirements (normative text quoted verbatim)

### FR-SOLSEC-001 — 38. Functional requirements catalogue (PRD line 6181)

> Deterministic SPL/Token-2022 program, authority, and extension analysis is independent of external
> security providers.

Normative level: MUST. Acceptance criteria: all 17 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/solsec.ts`
- Fixture refs: `tests/fixtures/solsec/`
- Telemetry refs: `telemetry/solsec.*`

### FR-SOLSEC-002 — 38. Functional requirements catalogue (PRD line 6182)

> Mint, freeze, permanent-delegate, transfer-fee, transfer-hook, close, metadata/update,
> default-state, and non-transferable controls are versioned evidence where applicable.

Normative level: MUST. Acceptance criteria: all 17 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/solsec.ts`
- Fixture refs: `tests/fixtures/solsec/`
- Telemetry refs: `telemetry/solsec.*`

### FR-SOLSEC-003 — 38. Functional requirements catalogue (PRD line 6183)

> Pool/LP control, migration, withdrawal authority, and liquidity-removal risk are assessed.

Normative level: MUST. Acceptance criteria: all 17 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/solsec.ts`
- Fixture refs: `tests/fixtures/solsec/`
- Telemetry refs: `telemetry/solsec.*`

### FR-SOLSEC-004 — 38. Functional requirements catalogue (PRD line 6184)

> Unknown transfer semantics block profiles requiring complete execution modeling.

Normative level: MUST. Acceptance criteria: all 17 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/solsec.ts`
- Fixture refs: `tests/fixtures/solsec/`
- Telemetry refs: `telemetry/solsec.*`

### FR-SOLSEC-005 — 38. Functional requirements catalogue (PRD line 6185)

> External security providers are independent evidence and cannot override deterministic known risk.

Normative level: MUST. Acceptance criteria: all 17 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/solsec.ts`
- Fixture refs: `tests/fixtures/solsec/`
- Telemetry refs: `telemetry/solsec.*`

### FR-SOLSEC-006 — 38. Functional requirements catalogue (PRD line 6186)

> A versioned system-address registry prevents infrastructure accounts from becoming false
> wallet-owner/funder evidence.

Normative level: MUST. Acceptance criteria: all 17 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/solsec.ts`
- Fixture refs: `tests/fixtures/solsec/`
- Telemetry refs: `telemetry/solsec.*`

## Shared acceptance criteria

Attached to more than one requirement of this package — implement once, satisfy everywhere:

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
- **AC-230** · positive: `tests/acceptance/AC-230.spec.ts` · negative/failure:
  `tests/negative/AC-230.negative.spec.ts` — attached to 6 requirements
- **AC-231** · positive: `tests/acceptance/AC-231.spec.ts` · negative/failure:
  `tests/negative/AC-231.negative.spec.ts` — attached to 6 requirements
- **AC-232** · positive: `tests/acceptance/AC-232.spec.ts` · negative/failure:
  `tests/negative/AC-232.negative.spec.ts` — attached to 6 requirements
- **AC-233** · positive: `tests/acceptance/AC-233.spec.ts` · negative/failure:
  `tests/negative/AC-233.negative.spec.ts` — attached to 6 requirements
- **AC-234** · positive: `tests/acceptance/AC-234.spec.ts` · negative/failure:
  `tests/negative/AC-234.negative.spec.ts` — attached to 6 requirements
- **AC-235** · positive: `tests/acceptance/AC-235.spec.ts` · negative/failure:
  `tests/negative/AC-235.negative.spec.ts` — attached to 6 requirements
- **AC-236** · positive: `tests/acceptance/AC-236.spec.ts` · negative/failure:
  `tests/negative/AC-236.negative.spec.ts` — attached to 6 requirements
- **AC-237** · positive: `tests/acceptance/AC-237.spec.ts` · negative/failure:
  `tests/negative/AC-237.negative.spec.ts` — attached to 6 requirements
- **AC-238** · positive: `tests/acceptance/AC-238.spec.ts` · negative/failure:
  `tests/negative/AC-238.negative.spec.ts` — attached to 6 requirements
- **AC-239** · positive: `tests/acceptance/AC-239.spec.ts` · negative/failure:
  `tests/negative/AC-239.negative.spec.ts` — attached to 6 requirements

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
PRD (§35.12, §64.9, §65.2–65.7, §37.3, §19.3, §45 invariants, Appendix Q) and the
milestone decomposition record. They never override the seeded normative content
above.

### I1. Relationship to the proven substrate

This package ADDS a deterministic security-analysis plane on top of the proven
G0/G1 substrate; it never rewrites proven behavior:

- Pool/LP state is decoded ONLY through the proven allowlisted program/version
  decoder registry (`packages/program-decoders`, FR-COL-002) — a pool whose
  design/layout resolves to no active decoder yields an explicit
  unsupported/degraded assessment state, never generic constant-product output
  (§35.12; the same resolution law AC-230 already pins for protocol decoders).
- Token/extension parsing is a NEW deterministic surface in
  `packages/solana-security` keyed by program (SPL Token vs Token-2022) and
  program/layout version — the same versioned-resolution law, applied to the
  §65.2 token assessment list.
- Actor attribution is owned by `packages/economic-trade-normalizer`; the
  system-address registry (FR-SOLSEC-006) supplies authoritative exclusion rows
  through the existing `EconomicTradeContext.knownRouterAccounts` seam plus a
  role/confidence-scoped exclusion query. No normalizer rewrite is planned;
  any change the normalizer would need is recorded as a plan-sanctioned scope
  exception instead of silent drift.
- New closed vocabularies (§65.2 assessment states, Appendix Q.1 severity,
  Appendix Q.2 roles, provider verdict classes) are declared in
  `packages/domain` and imported — never restated — by
  `packages/shared-schemas` (milestone plan-level decision 5, ADR-0018
  precedent; compile-parity law already proven).
- Existing §13.9 quality codes carry the degradation vocabulary
  (`TOKEN_EXTENSION_UNKNOWN`, `SYSTEM_ADDRESS_UNCERTAIN`,
  `UNSUPPORTED_PROGRAM_VERSION`) — no new quality-code axis is introduced.

### I2. Cross-package acceptance-criteria file ownership

The manifest attaches family-level ACs to multiple packages. This package
AUTHORS the acceptance/negative files for **AC-130, AC-131, AC-132** (the
§39.12 Solana-security family content) scoped strictly to its FR-SOLSEC
obligations, and EXTENDS the existing AC-230/AC-231 suites additively with a
solsec-scoped describe block (pool-security assessment resolves only through
the allowlisted versioned adapter; unsupported design returns explicit
degraded state). AC-133…136 (economic events/supply) were authored by
`g1-data-truth-extensions` and stay regression-locked here; AC-233/AC-237
were authored by earlier packages and stay regression-locked. The
**AC-232/234/235/236/238/239** files are the FR-EXEC family — authored by
`g1-execution-simulation` when that package lands; this package does not
create them (gaps recorded in the run's out-of-scope notes). The solsec-side
obligation FR-SOLSEC-004 carries its executable proof in the AC-130 block
(unknown required semantics block) plus the package-level blocking predicate,
with profile/tradability integration landing in the execution-simulation
package.

### I3. Package seams consumed by later G1 packages

- `g1-execution-simulation` consumes: the transfer-semantics support verdict
  and blocking predicate (FR-SOLSEC-004), the parsed transfer-fee/transfer-hook
  evidence (fee modeling inputs for §64.9), pool-security state (liquidity
  withdrawal risk), and severity constraints.
- `g1-objective-governance` consumes: security severity as hard-constraint
  input — no weighted score may compensate for a critical security finding
  (its §38.20 law).
- `g1-signal-registry` / wallet features consume: system-address exclusions
  (§19.3 infrastructure/system-address exclusion coverage) and severity.
- `g1-discovery-coverage` consumes: unsupported-program exclusions
  (`TOKEN_EXTENSION_UNKNOWN` constrained population claims).
- `packages/economic-trade-normalizer` consumes: registry-backed exclusion
  sets (FR-SOLSEC-006 → AC-132) through its existing context inputs.

### I4. Wallet-cluster boundary (AC-132 proof surface)

Wallet/cluster tables (`wallets`, `wallet_entities`, `wallet_clusters`,
§30.1) belong to the Deployer–Funder DNA capability (FR-DFD), a later
milestone. AC-132 is proven here at the actor-attribution seam it actually
governs: with registry-backed exclusions applied, known router/exchange/
launchpad/fee-collector/program accounts do not create false common-funder or
insider edges in emitted economic events and actor attribution, raw flows
remain auditable, and uncertain labels reduce quality instead of silently
removing evidence. No wallet-cluster machinery is built by this package.

## Binding invariants (package-level cross-cut)

Every task operates under the PRD §45 invariants, with these carrying the main
load in this package:

- **INV-001** — permanently read-only: authority/pool analysis, the registry,
  and provider-evidence handling never construct, sign, or submit anything;
  "withdrawal authority" here is a decoded program authority (evidence), never
  a capability (scan-prohibited-capabilities stays green).
- **INV-002** — deterministic security analysis is a control plane no model
  output can replace: severity and blocking are pure deterministic functions.
- **INV-004** — every retained security assessment is reconstructable from
  persisted evidence: assessment/analyzer/program/policy versions, source
  references, and timestamps are recorded with every finding.
- **INV-005/INV-006** — token and pool controls are point-in-time evidence
  (§35.12): assessments resolve at their availability time; registry revisions
  never retroactively rewrite historical attribution inputs.
- **INV-008** — provider count is not independence: external security reports
  form one independent evidence group; optimism cannot override deterministic
  known risk; missing provider data cannot reduce risk as if evidence were
  negative (§35.12, §65.7).

## Package success criteria

1. All six assigned requirements have executable positive AND
   negative/failure-path verification at the manifest-declared test paths —
   AC-130/131/132 files authored here, AC-230/231 suites extended additively,
   everything else regression-locked green.
2. Migrations `g1_solsec_*.sql` apply cleanly to empty databases, are
   discovered by the fail-closed migrator (family pattern extended with
   `solsec`), and the central expected-script registry
   (`packages/persistence/test/migrator.spec.ts`) is extended in the same
   package — the plan-sanctioned scope exception (ADR-0019/0022 duty).
3. Telemetry catalog `telemetry/solsec.catalog.json` stays
   DECLARATIVE_CONTRACT_ONLY (emitter wiring is G2) and the central parity
   suite `tests/telemetry-catalog.spec.ts` is extended in the same package —
   the plan-sanctioned scope exception (milestone plan-level decision 4).
4. The versioned system-address registry carries chain, address, role,
   valid-from/to, source, confidence and review state per record (Appendix
   Q.2), and exclusion from actor features requires an accepted role AND
   minimum confidence — structurally enforced, not convention.
5. `pnpm verify` and `pnpm spec:verify` pass at the pushed HEAD; the milestone
   verification command (`test -d packages/solana-security && pnpm --filter
@foresift/solana-security test`) is green.

## Assumptions

- PGlite remains the deterministic DB test engine (ADR-0014); the new package
  follows the G0/G1 scaffold pattern (package-local `bun test`, workspace `*`
  dependencies, tsconfig extending `tsconfig.base.json`).
- Telemetry stays DECLARATIVE_CONTRACT_ONLY until the G2 observability
  milestone wires emitters.
- Golden fixtures use synthetic addresses/values constructed in this
  repository; no third-party dataset ingestion and no live-chain dependency
  for the deterministic suites.
- All G1 packages are serialized (`parallelizable: false`), so shared-file
  extensions (AC suites, central migration registry, central telemetry parity
  suite) never race a concurrent package.
