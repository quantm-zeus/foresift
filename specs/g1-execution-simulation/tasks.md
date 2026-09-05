# Tasks: g1-execution-simulation

**Input**: `specs/g1-execution-simulation/spec.md`, `specs/g1-execution-simulation/plan.md`
**Traceability rule**: every task cites at least one assigned requirement
(FR-EXEC-001…022) or an acceptance criterion of those requirements.
Requirement IDs not assigned to this package never appear here.

Format: `- [ ] T### [P?]` — **[P]** = parallelizable with its neighbors (disjoint files).
Tests are mandatory per PRD evidence rules: positive AND negative/failure-path
specs for every acceptance criterion this package authors (AC-120…128, AC-232,
AC-234, AC-235, AC-236, AC-238, AC-239) plus additive extends of AC-230/231/237.
Plan-sanctioned scope exceptions recorded per the milestone plan-level decisions
and ADR-0019/0022 duty: `packages/persistence/src/migrator.ts` +
`packages/persistence/test/migrator.spec.ts` (central migration registry) and
`tests/telemetry-catalog.spec.ts` (central telemetry parity suite) are extended
by this package even though they sit outside the listed writeScopes.

Staging order is the PRD-mandated internal shard order: shared-schemas/domain
vocabularies first, then adapters, then the simulator core, then replay
manifests, then parity gates, then stress scenarios and degradation.

## Phase 1 — Foundations: domain vocabularies and shared schemas (blocks later phases)

- [ ] T001 Create `packages/domain/src/exec.ts`: `OutcomeClass` (SIGNAL_SUCCESS,
      SIGNAL_FAILURE, TRADABLE_SUCCESS, TRADABLE_FAILURE, TRADABLE_NEUTRAL,
      NEUTRAL, PENDING, CENSORED, INVALID_DATA — §64.12), `OutcomeMaturity`
      (PENDING, PARTIALLY_MATURED, FULLY_MATURED, CENSORED, INVALID_DATA —
      §8.1), `AdapterFamily` (CONSTANT_PRODUCT_AMM, CONCENTRATED_LIQUIDITY_AMM,
      DISCRETE_LIQUIDITY_BIN_AMM, BONDING_CURVE, STABLE_CURVE, DYNAMIC_FEE_AMM,
      VIRTUAL_RESERVE, AGGREGATED_MULTI_ROUTE_READ_ONLY, UNKNOWN — §64.3 +
      FR-EXEC-015), `AdapterSupportState` (AVAILABLE, DEGRADED, UNAVAILABLE),
      `ExecutionStatus` (EXECUTED_FULL, EXECUTION_PARTIAL,
      EXECUTION_UNAVAILABLE, POOL_MATH_UNSUPPORTED, INSUFFICIENT_DATA),
      `StressScenarioKind` (BASE_CASE, P50_DELAY, P90_DELAY,
      CONSERVATIVE_LATENCY_ADVERSE_SELECTION, LIQUIDITY_DRAWDOWN,
      FEE_VOLATILITY, ROUTE_DEGRADATION, FAILED_PARTIAL_FILL — FR-EXEC-017),
      `ExitPolicyKind` (FIXED_HORIZON, TAKE_PROFIT_STOP_LOSS, TRAILING_EXIT,
      STAGED_EXIT, LIQUIDITY_RISK_DETERIORATION, THESIS_INVALIDATION — §64.7),
      `PrimaryOrdering` (ADVERSE_FEASIBLE, UNAMBIGUOUS),
      `TradabilityVerdict`, `ObservationPlanTriggerClass` (DEEP_RESEARCH,
      EARLY_WATCH, CONFIRMED_OPPORTUNITY, CONTROL_SAMPLE, SHADOW_PORTFOLIO —
      §64.14) — each with fail-closed parse throwing typed errors with stable
      `ExecErrorCode`s; plus the pure laws `outcomeLabelPrecedence` (§8.2
      order: INVALID_DATA → CENSORED → PENDING/PARTIALLY_MATURED →
      TRADABLE_FAILURE_SECURITY_OR_LIQUIDITY → TRADABLE_SUCCESS →
      TRADABLE_FAILURE → TRADABLE_NEUTRAL, signal labels on a separate axis),
      `signalCannotRenderProfit` (FR-EXEC-006/INV-011),
      `tradabilityBlocksConfirmedOpportunity` preserving diagnostic signal
      labels (FR-EXEC-007), `executableTargetSatisfied` (§64.13: executable
      volume or configured target duration; isolated wick never sufficient —
      FR-EXEC-004), `uncertaintyBlocksTradability` (FR-EXEC-020),
      `robustDelayGate` (§64.8 p50/p90/conservative), and
      `adverseOrderingRequired` (§64.7). Add colocated
      `packages/domain/test/` fail-closed vocabulary + law truth-table tests.
      Traces: FR-EXEC-001, FR-EXEC-004, FR-EXEC-006, FR-EXEC-007, FR-EXEC-013,
      FR-EXEC-015, FR-EXEC-017, FR-EXEC-020, AC-120, AC-122.
- [ ] T002 Extend `packages/domain/src/index.ts` exports for the new exec
      module. Traces: FR-EXEC-001…022.
- [ ] T003 Create `packages/shared-schemas/src/exec.ts`: Zod schemas for
      `ExecutionScenario` (§64.2 exact field set), `ExitPolicyExperiment`,
      `ExecutionSimulation`, `NetReturnBreakdown` (pool fees, aggregator fees,
      token transfer fees, priority/network fees, execution impact, failed
      attempts, partial fills, residual inventory, adverse-selection/MEV
      buffer, quote conversion/depeg, account creation/rent — FR-EXEC-003/018),
      `EntryFillResult`, `ExitFillResult`, `ReplayManifest`, `UncertaintyBound`,
      `OutcomeObservationPlan` (inclusion probability/stratum/population
      limits/resolution floor — §64.14), `AdapterRegistryEntry`,
      `ExecutionStateSnapshot` (§64.4 record), `QuoteEvidence`,
      `StressScenarioResult`, `ScenarioPassMatrix`, `AlertExecutionContent`
      (configured notional, delay, modeled impact, assumptions, expiry —
      FR-EXEC-008), `ConcurrentShadowAggregate` — importing domain enums
      (never restating), `.strict()`, decimal-string quantity rules, ISO-8601
      Z timestamps, `sha256:<hex>` hashes, `EXEC_SCHEMA_REGISTRY_VERSION = 1`;
      unknown class/state values fail closed; schema refinement enforces
      signal-cannot-render-profit and incomplete-state-cannot-confirm-tradable
      at the payload layer. Extend `packages/shared-schemas/src/index.ts`
      exports. Add colocated schema tests (unknown enum rejection, refinement
      boundaries). Traces: FR-EXEC-001, FR-EXEC-002, FR-EXEC-003, FR-EXEC-006,
      FR-EXEC-008, FR-EXEC-010, FR-EXEC-011, FR-EXEC-014, FR-EXEC-018.

## Phase 2 — Persistence: migration family + migrator extension (blocks repos and PGlite suites)

- [ ] T004 Create `migrations/g1_exec_0001_scenarios_simulations.sql`:
      `execution_scenarios` (§64.2 field set, pre-registration law CHECK),
      `exit_policy_experiments` (FR-EXEC-009 single pre-registered primary per
      scenario), `execution_simulations` (§8.2 outcome classes + maturity +
      censor reasons, `signal_success_never_profit` CHECK,
      `incomplete_state_cannot_confirm_tradable` CHECK, availability-order
      CHECK); append-only triggers (G0 pattern). Traces: FR-EXEC-001,
      FR-EXEC-002, FR-EXEC-004, FR-EXEC-006, FR-EXEC-007, FR-EXEC-009.
- [ ] T005 Create `migrations/g1_exec_0002_replay_observation.sql`:
      `replay_manifests` (frozen assumptions hash, scenario JSON, adapter +
      code versions, policy versions — FR-EXEC-010) and
      `outcome_observation_plans` (trigger classes, cadence, quota ceiling,
      inclusion probability/stratum/population limits, resolution floor —
      FR-EXEC-011); append-only triggers. Traces: FR-EXEC-010, FR-EXEC-011.
- [ ] T006 Create `migrations/g1_exec_0003_adapter_registry_state.sql`:
      `pool_math_adapter_registry` (family-keyed UNIQUE, support states, the
      cp_only_for_cp CHECK implementing FR-EXEC-015 at the persistence layer),
      `execution_state_snapshots` (§64.4 record per simulation —
      FR-EXEC-014), `adapter_incidents` (parity drift/upgrade/deprecation/
      unknown-extension causes — FR-EXEC-016/021); append-only triggers.
      Traces: FR-EXEC-013, FR-EXEC-014, FR-EXEC-015, FR-EXEC-016, FR-EXEC-021.
- [ ] T007 Create `migrations/g1_exec_0004_quotes_gates.sql`:
      `quote_evidence` (evidence-not-truth payloads with uncertainty bounds +
      transaction_construction_refused — FR-EXEC-020/005),
      `tradability_gate_decisions` (scenario matrix vs required pass matrix,
      conservative default, uncertainty blocking, preserved signal labels —
      FR-EXEC-007/012/017), `concurrent_shadow_positions` (sharing keys,
      aggregate impact/capacity, deterministic competition resolution —
      FR-EXEC-019); append-only triggers on gate decisions. Traces:
      FR-EXEC-005, FR-EXEC-007, FR-EXEC-012, FR-EXEC-017, FR-EXEC-019,
      FR-EXEC-020.
- [ ] T008 Extend `packages/persistence/src/migrator.ts`
      MIGRATION_FAMILIES with the `exec` family AND extend the central
      expected-script registry `packages/persistence/test/migrator.spec.ts`
      with `g1_exec_0001_scenarios_simulations`,
      `g1_exec_0002_replay_observation`, `g1_exec_0003_adapter_registry_state`,
      `g1_exec_0004_quotes_gates` (lexicographic, checksum-pinned) — the
      plan-sanctioned central-registry scope exception (ADR-0019/0022 duty;
      the registry suite must be updated in the same package or the
      task-graph guard refuses the build). Traces: FR-EXEC-001…022.

## Phase 3 — Adapter plane: pool-math and transfer-semantics packages (blocks simulator core)

- [ ] T009 Scaffold `packages/pool-math` and `packages/transfer-semantics`
      and `packages/execution-simulator` (package.json
      `@foresift/pool-math`, `@foresift/transfer-semantics`,
      `@foresift/execution-simulator` with workspace `*` deps on
      domain/persistence/shared-schemas — pool-math and transfer-semantics
      additionally on program-decoders and solana-security as read-only
      consumers, `bun test` scripts, tsconfig extending tsconfig.base.json,
      no per-package runner config — G0/G1 scaffold pattern). Traces:
      FR-EXEC-001…022.
- [ ] T010 Implement `packages/pool-math/src/adapter-contract.ts` +
      `src/registry.ts`: the §64.3 `PoolMathAdapter` contract
      (decodeState, validateStateCompleteness, quoteExactIn, quoteExactOut,
      modelLiquidityMutation, requiredAccounts) and the fail-closed resolution
      keyed by (chain, program, program version, curve type, account-layout
      version) over the signed program-support manifests consumed from
      `@foresift/program-decoders` (read-only; no decoder changes) —
      unknown/mismatched design → `EXECUTION_UNAVAILABLE` with
      POOL_MATH_UNSUPPORTED/UNSUPPORTED_PROGRAM_VERSION quality codes, never
      generic constant-product (FR-EXEC-013, FR-EXEC-015). Colocated tests:
      family-key resolution truth table, unknown-design refusal, version
      mismatch refusal, deprecated/unverified manifest refusal. Traces:
      FR-EXEC-013, FR-EXEC-015, AC-230, AC-231.
- [ ] T011 Implement `packages/pool-math/src/constant-product.ts`: exact
      deterministic constant-product math on BigInt raw amounts with a fixed
      rounding-direction law (conservative for output), fee application per
      pool configuration, minimum output, boundary/overflow guards, and
      `modelLiquidityMutation` — usable ONLY for a verified constant-product
      pool (registry enforcement; FR-EXEC-015). Colocated tests: golden
      vectors, monotonicity + conservation property tests, zero/tiny/huge
      amount boundaries, overflow refusals, fee-tier fixtures. Traces:
      FR-EXEC-002, FR-EXEC-013, FR-EXEC-015, FR-EXEC-016, AC-230, AC-231.
- [ ] T012 Implement `packages/pool-math/src/state-completeness.ts` +
      `src/route-aggregation.ts`: §64.4 coverage assessment — missing
      tick/bin/curve/account state that can materially affect a fill marks
      state incomplete and blocks confirmed tradability rather than assuming
      uniform liquidity (AC-232, FR-EXEC-020); read-only aggregate-route
      evaluation with per-leg fees and impact, shared-vault de-dup, loop
      detection, route count caps, quote conversion + stablecoin depeg state,
      and rejection of transaction-construction payloads from quote providers
      (§64.5). Colocated tests: incomplete-state blocking matrix, shared-vault
      double-count fixtures, route-loop/cap refusals, payload refusal.
      Traces: FR-EXEC-002, FR-EXEC-005, FR-EXEC-014, FR-EXEC-020, AC-232.
- [ ] T013 Implement `packages/transfer-semantics/src/adapter.ts` +
      `src/fee-model.ts`: the versioned `TransferSemanticsAdapter` keyed by
      chain/program/program-version/layout-version consuming the PROVEN
      `@foresift/solana-security` verdict substrate (KNOWN_MODELED /
      KNOWN_UNMODELED / UNKNOWN_REQUIRED / NOT_PRESENT + transfer-fee/hook
      evidence — read-only, never restated); transfer-fee modeling at the
      applicable epoch/configuration, transfer-hook effects, account
      creation/rent; UNKNOWN_REQUIRED → `INSUFFICIENT_DATA`, zero cost never
      assumed (§64.9, FR-EXEC-013, FR-EXEC-018). Colocated tests: verdict
      consumption truth table, fee/hook/rent golden vectors, unknown-required
      blocking, entry+exit symmetric application. Traces: FR-EXEC-003,
      FR-EXEC-013, FR-EXEC-018, AC-121, AC-233 (regression alignment).

## Phase 4 — Simulator core (blocks replay manifests, parity, stress, degradation)

- [ ] T014 Implement `packages/execution-simulator/src/scenario.ts` +
      `src/delays.ts`: §64.2 scenario identity resolution with
      pre-registration enforcement, §64.8 action-delay distribution
      (deterministic reference, p50, p90, maximum supported; measurement
      source + sample size; conservative configured values labeled) and the
      robust-delay gate substrate (a candidate valid only at an unrealistically
      short delay cannot pass a p90-requiring profile). Colocated tests:
      delay distribution resolution, conservative labeling, gate truth table.
      Traces: FR-EXEC-001, FR-EXEC-002, FR-EXEC-017, AC-235.
- [ ] T015 Implement `packages/execution-simulator/src/entry.ts` +
      `src/exit.ts`: §64.6 entry modeling (requested/filled quantity,
      average execution price, marginal + average impact, pool/aggregator/
      token/network fees, failed/rejected amounts, start + completion time,
      state/route uncertainty, partial-fill policy and unfilled-capital
      treatment) and §64.7 exit modeling (versioned exit policies:
      fixed horizon, take-profit/stop-loss, trailing, staged,
      liquidity/risk deterioration, thesis invalidation; contemporaneous
      executable state; trigger vs completion time separate; adverse feasible
      ordering primary + path-ambiguity flag when coarse intervals allow both
      orderings; optimistic ordering secondary only). Colocated tests:
      entry fill fixtures, exit-policy fixtures, adverse-ordering vectors.
      Traces: FR-EXEC-002, FR-EXEC-003, FR-EXEC-018, AC-121, AC-238.
- [ ] T016 Implement `packages/execution-simulator/src/net-return.ts` +
      `src/outcome.ts`: §64.9 net return assembly (pool fees, dynamic fee
      state, Token-2022 transfer fee + withheld behavior, transfer hooks,
      priority/network fees + volatility, stablecoin/quote conversion +
      depeg, impact, partial fills, failed entry/exit, adverse-selection/MEV
      buffer, quote latency, liquidity deterioration, residual inventory,
      minimum output — FR-EXEC-003, FR-EXEC-018) and §64.12/§8.2 outcome
      classification under the single precedence law with explicit censor/
      invalid reasons, `UNTRADABLE_SIGNAL_WIN` handling, and denominator
      disclosure counts (FR-EXEC-006, INV-011/012). Colocated tests: net-
      return fixture law (AC-121 vectors), precedence truth table, censor/
      invalid reason enforcement, subjective-input isolation. Traces:
      FR-EXEC-003, FR-EXEC-006, FR-EXEC-018, AC-121, AC-124, AC-125.
- [ ] T017 Implement `packages/execution-simulator/src/target-touch.ts` +
      `src/tradability.ts` + `src/uncertainty.ts`: §64.13/FR-EXEC-004
      executable-target law (modeled exit must execute within impact, fill,
      duration, state-completeness and survival limits; profiles MAY require
      multiple slots, target duration, or sufficient economic volume;
      isolated wick insufficient — AC-122; low-resolution snapshots support
      signal labels only — AC-126); the tradability gate (FR-EXEC-007/
      FR-EXEC-012/FR-EXEC-017): every scenario result recorded, profile-
      declared pass matrix enforced, conservative default for
      CONFIRMED_OPPORTUNITY, blocking preserves diagnostic signal labels;
      §64.15/FR-EXEC-020 uncertainty rendering (state coverage, adapter
      versions, notional/delays, base+stress outcomes, fill fraction +
      duration, fees + impact, uncertainty/quality codes, unsupported
      assumptions, valid_until) with policy-limit blocking. Colocated tests:
      wick-refusal vectors, resolution-floor vectors, pass-matrix enforcement,
      uncertainty-bound blocking, label preservation. Traces: FR-EXEC-004,
      FR-EXEC-007, FR-EXEC-012, FR-EXEC-017, FR-EXEC-020, AC-122, AC-126,
      AC-127, AC-235.
- [ ] T018 Implement `packages/execution-simulator/src/concurrency.ts` +
      `src/routes.ts`: FR-EXEC-019 concurrent shadow-position aggregation
      over sharing keys (pool, route, quote asset, liquidity source,
      deployer cluster, correlated exit window) with deterministic fill
      competition (lexicographic registration-id ordering — isolated fills
      cannot each consume the same depth); FR-EXEC-022 point-in-time route
      selection (no route/pool created after T_user_action; migration routing
      follows only `migration_edges` transitions known and executable at
      action time). Colocated tests: shared-depth competition vectors,
      order-permutation determinism, retrospective-route refusal, migration
      transition timing. Traces: FR-EXEC-019, FR-EXEC-022, AC-236, AC-234.

## Phase 5 — Replay manifests, parity gates, stress scenarios, degradation (final PRD staging order)

- [ ] T019 Implement `packages/execution-simulator/src/replay-manifest.ts` +
      `src/experiments.ts` + `src/observation-plans.ts`: FR-EXEC-010 replay
      manifests freezing execution assumptions and code versions (assumption
      hash, exact scenario payload, adapter versions, code versions, policy
      versions) such that frozen replay reproduces stress outcomes (AC-127);
      FR-EXEC-009 exit-policy experiment registry (pre-registered separate
      experiments, single pre-registered primary, retrospective best-pick
      structurally refused); §64.14/FR-EXEC-011 finite selective
      outcome-observation plans for promoted/alerted/control-sample/shadow
      candidates (cadence, fields, accounts, sources, duration, quota
      ceiling, degradation, inclusion probability/stratum, population
      limits, resolution floor — insufficient temporal/liquidity resolution
      cannot prove tradable success). Colocated tests: manifest freeze +
      reproduction, experiment plurality refusal, plan finiteness +
      resolution-floor blocking. Traces: FR-EXEC-009, FR-EXEC-010,
      FR-EXEC-011, AC-127, AC-128.
- [ ] T020 Implement `packages/pool-math/src/parity.ts`: the §64.11/
      FR-EXEC-016 gate suite over the proven `@foresift/program-decoders`
      parity seam — deterministic vectors, historical observed-trade parity
      (fixture-encoded economic events), current reference-quote parity when
      available (fixture-switched, never network-dependent), edge-state
      fixtures, boundary/overflow tests, version-specific tolerance gates —
      with failure transitioning the adapter to DEGRADED/UNAVAILABLE and
      opening an incident. Colocated tests: parity pass/fail transitions,
      tolerance-gate bands, incident emission, degraded adapter refuses new
      confirmed quotes. Traces: FR-EXEC-016, FR-EXEC-021, AC-231.
- [ ] T021 Implement `packages/execution-simulator/src/stress.ts` + fixtures
      wiring for the §64.10/FR-EXEC-012/FR-EXEC-017 scenario matrix: BASE,
      p50-delay, p90-delay, conservative latency/adverse-selection,
      liquidity-drawdown, fee-volatility, route-degradation, failed/
      partial-fill — each under versioned conservative stress assumptions
      (quote latency, adverse selection/MEV, fee volatility, liquidity
      deterioration), every production scenario computing BASE_CASE +
      CONSERVATIVE_STRESS_CASE, the profile declaring which must pass, and
      CONFIRMED_OPPORTUNITY defaulting to conservative pass. Colocated
      tests: full matrix recording, optimistic-only candidate refusal,
      conservative default enforcement. Traces: FR-EXEC-012, FR-EXEC-017,
      AC-127, AC-235.
- [ ] T022 Implement `packages/execution-simulator/src/degradation.ts`:
      FR-EXEC-021 automatic tradability degradation on adapter deprecation,
      program upgrade, parity drift, or unknown extension — degrade ONLY
      affected scope, trigger re-evaluation of active alerts/watchlists,
      preserve historical simulations (append-only), and prevent new
      confirmed alerts until revalidated; consuming
      `@foresift/program-decoders` `detectUpgradeChange` (read-only).
      Colocated tests: scope isolation, forward re-evaluation, history
      immutability, revalidation gate. Traces: FR-EXEC-021, AC-237.
- [ ] T023 Implement `packages/execution-simulator/src/alert-content.ts` +
      `src/read-only-guard.ts` + `src/index.ts`: FR-EXEC-008 alert
      execution content exposing configured notional, delay, modeled impact,
      assumptions, and expiry (§64.15 rendering set + valid_until); the
      §64.16/FR-EXEC-005 structural read-only guard — no
      build/sign/broadcast/submit/recommend surface exists, quote-provider
      transaction-construction payloads refused (§64.5), no provider swap
      route transaction/serialized message/signature request/wallet
      requirement exposed; run the prohibited-capability scanner
      (`node scripts/scan-prohibited-capabilities/cli.mjs`) to confirm the
      boundary holds across all three new packages. Traces: FR-EXEC-005,
      FR-EXEC-008, FR-EXEC-015, AC-120, AC-230.

## Phase 6 — Fixtures and acceptance/negative suites (blocks gates)

- [ ] T024 Author `tests/fixtures/exec/scenarios.json` +
      `tests/fixtures/exec/pool-states.json`: §64.2 scenario vectors with
      delay policies and pass matrices; decoded verified-CP pools plus
      concentrated-liquidity, discrete-bin, stable-swap, dynamic-fee,
      bonding-curve, virtual-reserve, and unknown design states, and
      incomplete-state cases (missing tick/bin/curve/account data).
      Traces: FR-EXEC-001, FR-EXEC-002, FR-EXEC-013, FR-EXEC-015, FR-EXEC-017,
      AC-230, AC-232, AC-235.
- [ ] T025 Author `tests/fixtures/exec/net-return.json` +
      `tests/fixtures/exec/target-touch.json` + `tests/fixtures/exec/coarse-candles.json`:
      AC-121 fee/impact/partial-fill/exit-liquidity vectors with exact
      expected net outcomes; AC-122/AC-126 executable-volume, target-duration,
      isolated-wick, and resolution-floor vectors; AC-238 coarse-candle
      target/invalidation-reachable vectors. Traces: FR-EXEC-003, FR-EXEC-004,
      FR-EXEC-011, FR-EXEC-018, AC-121, AC-122, AC-126, AC-238.
- [ ] T026 Author `tests/fixtures/exec/observed-trades.json` +
      `tests/fixtures/exec/transfer-fees.json`: historical observed-trade
      parity vectors (fixture-encoded economic trades) + reference-quote
      vectors with tolerances; transfer-fee/hook/rent modeling vectors
      including the unknown-required case. Traces: FR-EXEC-016, FR-EXEC-018,
      AC-231.
- [ ] T027 Author `tests/fixtures/exec/concurrent-exits.json` +
      `tests/fixtures/exec/routes-timeline.json` + `tests/fixtures/exec/stress-cases.json`:
      shared-depth competition vectors (two simultaneous exits on one pool);
      route/pool creation vs T_user_action and migration-transition timing
      vectors; the full stress matrix with optimistic-only candidates and
      conservative-default cases. Traces: FR-EXEC-012, FR-EXEC-017,
      FR-EXEC-019, FR-EXEC-022, AC-127, AC-234, AC-235, AC-236.
- [ ] T028 Author `tests/acceptance/AC-120.spec.ts` +
      `tests/negative/AC-120.negative.spec.ts`: positive — a token rising
      above target that cannot fill/exit the configured notional is
      SIGNAL_SUCCESS but cannot be TRADABLE_SUCCESS (UNTRADABLE_SIGNAL_WIN,
      §64.12); negative — any rendering of profit from signal success without
      tradable completion is structurally refused (SQL CHECK + pure law).
      Traces: FR-EXEC-001, FR-EXEC-006, FR-EXEC-007, AC-120.
- [ ] T029 Author `tests/acceptance/AC-121.spec.ts` +
      `tests/negative/AC-121.negative.spec.ts`: positive — entry delay, price
      impact, pool/token/network fees, partial fills, and exit liquidity each
      change net outcome exactly as the fixtures define (§64.6/64.7/64.9);
      negative — omitting any modeled leg diverges from the fixture and
      fails; assumed-zero costs refused. Traces: FR-EXEC-002, FR-EXEC-003,
      FR-EXEC-018, AC-121.
- [ ] T030 Author `tests/acceptance/AC-122.spec.ts` +
      `tests/negative/AC-122.negative.spec.ts`: positive — a one-slot target
      wick without executable volume or duration does not satisfy tradable
      success (§64.13); negative — an isolated wick classified
      TRADABLE_SUCCESS is refused. Traces: FR-EXEC-004, AC-122.
- [ ] T031 Author `tests/acceptance/AC-123.spec.ts` +
      `tests/negative/AC-123.negative.spec.ts`: positive —
      PENDING/PARTIALLY_MATURED outcomes are excluded from final
      precision/failure/calibration denominator INPUTS at the classification
      seam and disclosed separately (§8.2, INV-012; full statistics are
      g1-outcome-evaluation); negative — a denominator composition including
      pending/partial rows is refused. Traces: FR-EXEC-001, FR-EXEC-011,
      AC-123.
- [ ] T032 Author `tests/acceptance/AC-124.spec.ts` +
      `tests/negative/AC-124.negative.spec.ts`: positive — censored and
      invalid outcomes retain explicit reasons and never silently become
      failures (§8.2); negative — CENSORED/INVALID_DATA without a recorded
      reason is schema-refused; silent mapping to TRADABLE_FAILURE refused.
      Traces: FR-EXEC-006, FR-EXEC-011, AC-124.
- [ ] T033 Author `tests/acceptance/AC-125.spec.ts` +
      `tests/negative/AC-125.negative.spec.ts`: positive — owner-subjective
      usefulness is schema-separate and the objective outcome label is a pure
      function that ignores it (§64.12); negative — a path where subjective
      input mutates an objective label is structurally refused. Traces:
      FR-EXEC-001, FR-EXEC-006, AC-125.
- [ ] T034 Author `tests/acceptance/AC-126.spec.ts` +
      `tests/negative/AC-126.negative.spec.ts`: positive — a low-resolution
      price snapshot supports a signal label but cannot establish a
      short-lived executable target or tradable success without the required
      observation plan (§64.14/FR-EXEC-011); negative — tradable success from
      a below-floor-resolution snapshot is refused. Traces: FR-EXEC-004,
      FR-EXEC-011, AC-126.
- [ ] T035 Author `tests/acceptance/AC-127.spec.ts` +
      `tests/negative/AC-127.negative.spec.ts`: positive — a candidate
      profitable only under the optimistic case fails a profile requiring the
      conservative stress scenario, and stress assumptions reproduce in
      frozen replay (FR-EXEC-010/012); negative — optimistic-only passing is
      refused; replay with mutated assumptions fails reproduction. Traces:
      FR-EXEC-010, FR-EXEC-012, FR-EXEC-017, AC-127.
- [ ] T036 Author `tests/acceptance/AC-128.spec.ts` +
      `tests/negative/AC-128.negative.spec.ts`: positive — observation plans
      store inclusion probability/stratum/population limits and selected-only
      samples carry explicit population limits (§64.14; weighted estimators
      are g1-outcome-evaluation); negative — out-of-range inclusion
      probability or missing population limits refused; universe-wide claims
      from selected-only samples blocked at the plan seam. Traces:
      FR-EXEC-011, AC-128.
- [ ] T037 Author `tests/acceptance/AC-232.spec.ts` +
      `tests/negative/AC-232.negative.spec.ts`: positive — missing tick/bin/
      curve/account state that can materially affect a fill marks state
      incomplete and blocks confirmed tradability rather than assuming
      uniform liquidity (§64.4, FR-EXEC-020); negative — an
      INCOMPLETE_BLOCKING simulation confirming tradability is refused
      (SQL CHECK + pure law). Traces: FR-EXEC-013, FR-EXEC-014, FR-EXEC-020,
      AC-232.
- [ ] T038 Author `tests/acceptance/AC-234.spec.ts` +
      `tests/negative/AC-234.negative.spec.ts`: positive — a route or pool
      created after T_user_action cannot be selected by historical execution,
      and migration routing uses only transitions and state available at the
      action time (FR-EXEC-022); negative — retrospective route selection and
      post-action migration transitions are structurally refused. Traces:
      FR-EXEC-022, AC-234.
- [ ] T039 Author `tests/acceptance/AC-235.spec.ts` +
      `tests/negative/AC-235.negative.spec.ts`: positive — base, p50, p90,
      conservative latency/adverse-selection, liquidity drawdown, fee
      volatility, and route-degradation scenarios are all recorded and the
      active policy enforces its declared pass matrix (FR-EXEC-017); negative
      — passing an undeclared/incomplete matrix or a silently weakened
      matrix is refused. Traces: FR-EXEC-012, FR-EXEC-017, AC-235.
- [ ] T040 Author `tests/acceptance/AC-236.spec.ts` +
      `tests/negative/AC-236.negative.spec.ts`: positive — two simultaneous
      shadow exits sharing one pool cannot each consume the full pre-exit
      depth; aggregate impact and fill competition reduce or reject fills
      deterministically (FR-EXEC-019); negative — isolated fills each
      consuming the same depth are refused; order-permutation non-
      determinism fails. Traces: FR-EXEC-019, AC-236.
- [ ] T041 Author `tests/acceptance/AC-238.spec.ts` +
      `tests/negative/AC-238.negative.spec.ts`: positive — a coarse price
      candle whose target and invalidation are both reachable yields the
      adverse feasible primary ordering and a path-ambiguity flag, with the
      optimistic ordering secondary only (§64.7); negative — optimistic
      primary ordering under coarse-interval ambiguity is refused; missing
      flag fails. Traces: FR-EXEC-002, FR-EXEC-018, AC-238.
- [ ] T042 Author `tests/acceptance/AC-239.spec.ts` +
      `tests/negative/AC-239.negative.spec.ts`: positive — the TRADABLE_SUCCESS
      denominator disclosure excludes and separately reports signal-only,
      low-resolution, partial, censored, invalid, and scenario-mismatched
      outcomes (INV-012); negative — silent folding of excluded classes into
      the TRADABLE_SUCCESS denominator is refused. Traces: FR-EXEC-001,
      FR-EXEC-006, FR-EXEC-011, AC-239.
- [ ] T043 Extend `tests/acceptance/AC-230.spec.ts` +
      `tests/negative/AC-230.negative.spec.ts` ADDITIVELY with an exec-scoped
      describe block: each fixture pool design resolves ONLY to its matching
      versioned pool-math adapter + signed manifest; unknown/mismatched
      design returns explicit EXECUTION_UNAVAILABLE — never generic
      constant-product output (existing content untouched, header trace list
      updated). Traces: FR-EXEC-013, FR-EXEC-015, AC-230.
- [ ] T044 Extend `tests/acceptance/AC-231.spec.ts` +
      `tests/negative/AC-231.negative.spec.ts` ADDITIVELY with an exec-scoped
      describe block: the active constant-product adapter passes deterministic
      vectors, property/boundary tests, historical observed-trade parity,
      current reference-quote parity when available, and version-specific
      tolerance gates; Jupiter route observation is reconciled to underlying
      venue adapters rather than treated as pool-math authority; unverified/
      deprecated manifests refuse resolution (existing content untouched,
      header trace list updated). Traces: FR-EXEC-016, AC-231.
- [ ] T045 Extend `tests/acceptance/AC-237.spec.ts` +
      `tests/negative/AC-237.negative.spec.ts` ADDITIVELY with an exec-scoped
      describe block: adapter parity drift or a program upgrade degrades only
      affected exec scope, triggers re-evaluation of active candidates,
      preserves historical simulation results, and prevents new confirmed
      alerts until revalidated (existing content untouched, header trace list
      updated). Traces: FR-EXEC-021, AC-237.

## Phase 7 — Telemetry contract, manifest regen, and gates

- [ ] T046 Create `telemetry/exec.catalog.json` (DECLARATIVE_CONTRACT_ONLY
      header, fields mirroring `packages/shared-schemas/src/exec.ts` exactly,
      requirementRefs per event): `exec.scenario_resolved`,
      `exec.simulation_recorded`, `exec.net_return_composed`,
      `exec.outcome_classified`, `exec.tradability_decided`,
      `exec.observation_plan_issued`, `exec.replay_manifest_frozen`,
      `exec.adapter_resolved`, `exec.adapter_parity_evaluated`,
      `exec.adapter_degraded`, `exec.shadow_positions_aggregated`,
      `exec.route_selected`, `exec.quote_evidence_recorded`. Extend
      `tests/telemetry-catalog.spec.ts` — the plan-sanctioned central-parity
      scope exception (milestone plan-level decision 4) — pinning the new
      catalog to the authoritative schemas. Traces: FR-EXEC-001, FR-EXEC-002,
      FR-EXEC-003, FR-EXEC-006, FR-EXEC-007, FR-EXEC-010, FR-EXEC-011,
      FR-EXEC-013, FR-EXEC-016, FR-EXEC-019, FR-EXEC-020, FR-EXEC-021,
      FR-EXEC-022.
- [ ] T047 [executor: COORDINATOR] [evidence: VERIFICATION_ONLY] Run the
      milestone verification commands on the canonical tree: `test -d
packages/execution-simulator && pnpm --filter
@foresift/execution-simulator test`; `test -d packages/pool-math && pnpm
--filter @foresift/pool-math test`; `test -d packages/transfer-semantics &&
pnpm --filter @foresift/transfer-semantics test`; plus the extended central
      suites (`pnpm --filter @foresift/persistence test`;
      `tests/telemetry-catalog.spec.ts`) and the authored AC files
      (AC-120…128, AC-232, AC-234…236, AC-238, AC-239). All green required.
      Traces: FR-EXEC-001…022 (package-gate proof of every assigned
      requirement's substrate).
- [ ] T048 [executor: COORDINATOR] Regenerate the coordinator test manifest
      (`node scripts/automation/bun-migration-manifest.mjs --out
evidence/bun-migration/bun-migration-manifest.json`) after all new test
      files exist so `pnpm test`/`test:all` collect and classify them
      (PGlite-backed suites → DATABASE_PGLITE; OOM-safe per the test runtime
      contract). Mechanical bookkeeping (ADR-0020: coordinator-owned,
      zero-AI). Traces: FR-EXEC-001…022 (verification substrate for every
      assigned requirement).
- [ ] T049 [executor: COORDINATOR] [evidence: VERIFICATION_ONLY] Run the full
      aggregate gate `pnpm verify` and the integrity gate `pnpm spec:verify`
      at the pushed HEAD; require green (the complete Bun suite runs ONLY
      through the coordinator — never a bare `bun test` over the tree). If
      anything turns red outside writeScopes, classify per governance, fix
      only in-scope failures, and record the rest in the run's out-of-scope
      notes. Traces: FR-EXEC-001…022 (full suite + manifest integrity
      proof).

## Cross-artifact consistency analysis (speckit-analyze, completed at planning)

- **Coverage**: 22/22 assigned requirements traced (FR-EXEC-001…022); every
  assigned AC has an explicit owner: AC-120…128, AC-232, AC-234, AC-235,
  AC-236, AC-238, AC-239 authored here (T028–T036, T037–T042), AC-230/231/237
  extended additively here (T043–T045; AC-231's harness core was authored by
  g0-first-party-observation and stays), AC-233 regression-locked (authored by
  g1-data-truth-extensions), and the FR-MAT-facing statistical extensions of
  AC-123/124/125/128/239 recorded for g1-outcome-evaluation in out-of-scope
  notes.
- **Traceability**: no task cites a requirement outside the package's
  assignment (validator-enforced); every task cites ≥1 FR-EXEC-* or its AC.
- **Scope**: every predicted write lands inside writeScopes except the two
  plan-sanctioned exceptions (T008 central migration registry + migrator
  family extension; T046 central telemetry parity suite) recorded here, in
  plan.md, and consistent with the live g1-data-truth/g1-solana-security
  precedent; `evidence/bun-migration/bun-migration-manifest.json` regen
  (T048) is mechanical bookkeeping per repo precedent (g0-first-party-
  observation T063, g1-solana-security T027).
- **Ordering**: the PRD-mandated internal staging order is enforced by phase
  structure and explicit T-id references: Phase 1 schemas/vocabularies →
  Phase 2 persistence → Phase 3 adapters → Phase 4 simulator core → Phase 5
  replay manifests + parity gates + stress + degradation → Phase 6 fixtures/
  suites → Phase 7 telemetry + gates. `(blocks` headings add the
  blocking-phase dependency edges the task-graph builder requires.
- **Read-only law**: no task introduces trading/custody/signing/transaction-
  submission capability; T023 runs the prohibited-capability scanner as an
  explicit gate; §64.16 wording kept capability-free ("route evaluation" is
  read-only aggregation, never transaction construction).
- **No placeholders**: no template markers, no unresolved clarification
  blocks anywhere in the scoped artifacts.
