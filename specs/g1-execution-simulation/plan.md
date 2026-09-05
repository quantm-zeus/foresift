# Implementation Plan: g1-execution-simulation

**Package**: `g1-execution-simulation` | **Date**: 2026-09-05 | **Spec**: `specs/g1-execution-simulation/spec.md` (scoped derivative of PRD §8.1–8.3, §64.1–64.16, §35.12, §45, Appendix D.21 + manifest FR-EXEC-001…022)
**Authority**: PRD wins over every word below; material decisions are recorded as proposed ADR texts in this file.

## Summary

Deliver the read-only execution-simulation foundation — the PRD §64
"Execution-Aware Outcome, Pool Math, and Tradability Engine" — as THREE new
packages plus additive extensions, consuming only the proven substrate and the
mandated internal staging order (schemas/vocabularies → adapters → simulator
core → replay manifests → parity gates → stress scenarios and degradation):

1. **Versioned adapter plane** — `packages/pool-math` (FR-EXEC-013/015/016):
   the §64.3 `PoolMathAdapter` contract and a fail-closed registry keyed by
   (chain, program, program version, curve type, account-layout version);
   exact deterministic constant-product math ONLY for verified
   constant-product pools; concentrated-liquidity, discrete-bin, stable-swap,
   dynamic-fee, bonding-curve, virtual-reserve and unknown designs require
   their own adapter or return `EXECUTION_UNAVAILABLE`; §64.4 state
   completeness (`validateStateCompleteness`); the §64.11 parity-gate suite
   (observed-trade + reference-quote parity, versioned tolerance) whose
   failure degrades the adapter.
2. **Transfer-semantics execution modeling** — `packages/transfer-semantics`
   (FR-EXEC-013/018): a versioned `TransferSemanticsAdapter` that consumes the
   PROVEN `g1-solana-security` verdict substrate (KNOWN_MODELED /
   KNOWN_UNMODELED / UNKNOWN_REQUIRED / NOT_PRESENT, transfer-fee/hook
   evidence) and models transfer fees, hooks, account creation/rent, and
   unknown-required semantics (`INSUFFICIENT_DATA` — zero cost is never
   assumed, §64.9) inside entry/exit net flows.
3. **Simulator core** — `packages/execution-simulator` (FR-EXEC-001…012,
   014, 017–022): scenario identity (§64.2), action-delay distributions
   (§64.8: p50/p90/conservative, robust-delay gate substrate), entry modeling
   (§64.6), exit modeling (§64.7 with adverse-feasible primary ordering and
   path-ambiguity flags), net return assembly (§64.9/FR-EXEC-003), the §64.10
   stress scenario matrix with profile-declared pass matrices
   (FR-EXEC-012/017), outcome classification under the §8.2 precedence law
   (signal and tradable labels never collapse; `SIGNAL_SUCCESS` never renders
   profit when `TRADABLE_SUCCESS` is absent or failed), the §64.13 executable
   target law (executable volume or configured target-duration — an isolated
   wick cannot count), tradability gating of `CONFIRMED_OPPORTUNITY` with
   preserved diagnostic signal labels (FR-EXEC-007), quote/reference sources
   as evidence-not-truth with exposed uncertainty that blocks confirmed
   tradability at policy limits (FR-EXEC-020), concurrent shadow-position
   impact/capacity aggregation (FR-EXEC-019), point-in-time route selection
   and migration routing (FR-EXEC-022), pre-registered-exit-policy-experiments
   only (FR-EXEC-009), replay manifests freezing assumptions and code versions
   (FR-EXEC-010), finite selective outcome-observation plans (FR-EXEC-011),
   alert execution content (FR-EXEC-008), degradation re-evaluation on
   deprecation/upgrade/parity drift/unknown extension without rewriting
   history (FR-EXEC-021), and the §64.16 read-only guard (FR-EXEC-005).

Plus additive extensions: `packages/domain/src/exec.ts` + `packages/shared-schemas/src/exec.ts`
vocabularies/schemas, migration family `exec` (`migrations/g1_exec_*.sql`),
fixtures `tests/fixtures/exec/`, telemetry `telemetry/exec.catalog.json`, and
the manifest-owned AC suites.

Strictly read-only (INV-001, §64.16): no trading, custody, wallet-signing,
private-key, or transaction-submission capability anywhere in the simulator.

## Technical Context

- **Language/runtime**: TypeScript (ESM, strict, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`) in the existing pnpm workspace; Bun Test is
  the repository test authority; decimal/quantity discipline per
  `packages/domain/src/quantity.ts` (BigInt raw amounts + decimal-string
  prices — never floating point for money math).
- **Storage**: PostgreSQL schema via `@foresift/persistence` (`DatabaseEngine`
  seam); tests run on PGlite per ADR-0014 (`tests/acceptance/helpers.ts`
  applies the full migration set, so AC suites see `g1_exec_*` tables). New
  migration family `exec` — `g1_exec_*.sql`, additive only; the fail-closed
  migrator's `MIGRATION_FAMILIES` is extended with `exec` and the central
  expected-script registry (`packages/persistence/test/migrator.spec.ts`) is
  extended in the same package (ADR-0019/0022 duty, plan-sanctioned scope
  exception).
- **Validation**: Zod schemas authoritative in `packages/shared-schemas` as a
  NEW `exec.ts` module (ADR-0013); closed vocabularies declared in
  `packages/domain` (new `exec.ts`) and imported — never restated; unknown
  values fail closed with stable `ExecErrorCode`s.
- **Consumed read-only**: `@foresift/program-decoders` (`resolveDecoder`,
  `runParityHarness`, `detectUpgradeChange`, signed support manifests),
  `@foresift/solana-security` (transfer-semantics verdicts, transfer-fee/hook
  evidence, `StateCompleteness`), `@foresift/persistence` (`migration_edges`
  for point-in-time migration routing, economic trade events for observed-trade
  parity), `@foresift/domain` (pool identity, replay modes, quality codes).
- **Test stack**: Bun Test; colocated suites in
  `packages/{pool-math,transfer-semantics,execution-simulator}/test/` plus root
  `tests/acceptance`/`tests/negative` files; `evidence/bun-migration/bun-migration-manifest.json`
  regenerated after new suites exist (mechanical, coordinator duty).
- **Telemetry**: declarative catalog only (`telemetry/exec.catalog.json`) —
  emitter wiring is G2, never in this package's verification.

## Constitution Check

- **I. Product-Contract Authority**: scope limited to the 22 assigned
  requirements; `docs/spec/**` untouched; spec.md marked subordinate; seeded
  normative content preserved verbatim.
- **II. Greenfield**: designed from §64.1–64.16, §8.1–8.3, §35.12 and
  Appendix D.21 directly; the predecessor repository is not consulted.
- **III. Modular-monolith-first**: exactly three new focused packages plus
  additive extensions (domain vocabulary, shared schema, migration family,
  telemetry catalog, fixtures) — no brokers, no service splits; every
  simulator step is a pure deterministic function over frozen inputs.
- **IV. Read-only boundary (NON-NEGOTIABLE)**: §64.16 is implemented as a
  structural guard — the simulator exposes no build/sign/broadcast/submit
  surface, rejects transaction-construction payloads from quote providers
  (§64.5), and `scripts/scan-prohibited-capabilities/cli.mjs` stays green;
  wording avoids capability-implying verbs everywhere.
- **V. Point-in-time correctness**: every simulation resolves state, adapters,
  routes and migration transitions at its `T_actionable`/`T_action_reference`
  (FR-EXEC-022, INV-005); nothing created after the action time can be
  selected.
- **VI. Event-time/earliest-availability**: parity observations and quote
  evidence store `available_at` distinct from event time; degraded/late data
  degrades uncertainty instead of silently substituting (FR-EXEC-020).
- **VII. Provenance & evidence**: every simulation persists the §64.4 record
  plus adapter/schema/policy versions and evidence ids (INV-004; FR-EXEC-014).
- **VIII. Fail-closed**: unknown designs, incomplete state, unknown transfer
  semantics, parity failure, and uncertainty beyond policy limits refuse with
  typed errors or explicit degraded/blocking states — never guessed, never
  silently approximated (Constitution VIII; §64.3/64.4/64.9).
- **IX. Provider abstraction**: quote/reference sources are consumed as
  evidence through declared source identities with uncertainty bounds
  (FR-EXEC-020); no vendor SDK enters the new packages.
- **X. Traceability**: tasks cite only FR-EXEC-001…022 and their ACs; the
  validator rejects out-of-scope requirement IDs.
- **XI/XII. Deterministic + dual-path verification**: all 15 authored ACs get
  positive AND negative specs at manifest-declared paths; AC-230/231/237
  extended additively; `pnpm verify` + `pnpm spec:verify` at the pushed HEAD.
- **XIII. Replay/Recovery/Idempotency**: historical simulations are append-only
  (never rewritten, FR-EXEC-021); replay manifests reproduce stress outcomes
  deterministically (FR-EXEC-010, AC-127); persistence is idempotent under
  re-run via deterministic content identity.
- **XIV. Durable operations**: planning artifacts persisted to the run
  directory; simulation state in SQL, never process-local.
- **XV. Security & least privilege**: no secrets; quote payloads stored as
  evidence references with uncertainty, never as execution truth.
- **XVI–XVIII. Agent governance**: completion decided by
  `package-plan-complete.mjs`, package gates, and CI; commits additive.

## Data model (SQL truth under `migrations/`)

### `g1_exec_0001_scenarios_simulations.sql` (family `exec`)

```text
CREATE TABLE execution_scenarios (            -- §64.2, FR-EXEC-001/002/017
    scenario_id            text NOT NULL,
    scenario_version       text NOT NULL,
    profile_id             text NOT NULL,
    notional_usd           text NOT NULL,     -- decimal string (§13 quantity law)
    deterministic_action_delay_seconds integer NOT NULL CHECK (deterministic_action_delay_seconds >= 0),
    empirical_action_delay_policy_id text,
    entry_policy_version_id  text NOT NULL,
    exit_policy_version_id   text NOT NULL,
    maximum_entry_impact   double precision NOT NULL CHECK (maximum_entry_impact >= 0),
    maximum_exit_impact    double precision NOT NULL CHECK (maximum_exit_impact >= 0),
    allow_partial_fill     boolean NOT NULL,
    minimum_fill_fraction  double precision NOT NULL CHECK (minimum_fill_fraction BETWEEN 0 AND 1),
    maximum_fill_duration_seconds integer NOT NULL CHECK (maximum_fill_duration_seconds > 0),
    fee_policy_version_id  text NOT NULL,
    conservative_stress_policy_id text NOT NULL,
    required_pool_adapter_coverage text NOT NULL CHECK (required_pool_adapter_coverage IN
        ('COMPLETE','BOUNDED_APPROXIMATION')),
    pre_registered         boolean NOT NULL DEFAULT true,
    registered_at          timestamptz NOT NULL,
    PRIMARY KEY (scenario_id, scenario_version),
    CONSTRAINT scenarios_pre_registration_law CHECK (pre_registered) -- §64.2: hindsight selection forbidden
);

CREATE TABLE exit_policy_experiments (        -- FR-EXEC-009: plurality = pre-registered experiments only
    experiment_id          text PRIMARY KEY,
    scenario_id            text NOT NULL,
    scenario_version       text NOT NULL,
    exit_policy_version_id text NOT NULL,
    is_primary             boolean NOT NULL,
    registered_at          timestamptz NOT NULL,
    UNIQUE (scenario_id, scenario_version, exit_policy_version_id),
    CONSTRAINT one_primary_per_scenario UNIQUE (scenario_id, scenario_version, is_primary)
        DEFERRABLE INITIALLY DEFERRED  -- partial unique; primary count enforced via trigger
);

CREATE TABLE execution_simulations (          -- FR-EXEC-002/003/006/007, append-only
    simulation_id          text PRIMARY KEY,  -- deterministic content id
    candidate_id           text NOT NULL,
    scenario_id            text NOT NULL,
    scenario_version       text NOT NULL,
    experiment_id          text,              -- NULL = the primary result
    pool_id                text NOT NULL,     -- composePoolId form
    chain_id               text NOT NULL,
    t_actionable           timestamptz NOT NULL,
    t_action_reference     timestamptz NOT NULL,
    requested_notional_usd text NOT NULL,
    filled_fraction        double precision CHECK (filled_fraction BETWEEN 0 AND 1),
    execution_status       text NOT NULL CHECK (execution_status IN (
        'EXECUTED_FULL','EXECUTION_PARTIAL','EXECUTION_UNAVAILABLE',
        'POOL_MATH_UNSUPPORTED','INSUFFICIENT_DATA')),
    signal_outcome_class   text NOT NULL CHECK (signal_outcome_class IN (
        'SIGNAL_SUCCESS','SIGNAL_FAILURE','NEUTRAL','PENDING','CENSORED','INVALID_DATA')),
    tradable_outcome_class text CHECK (tradable_outcome_class IN (
        'TRADABLE_SUCCESS','TRADABLE_FAILURE','TRADABLE_NEUTRAL','PENDING','CENSORED','INVALID_DATA')),
    outcome_maturity       text NOT NULL CHECK (outcome_maturity IN (
        'PENDING','PARTIALLY_MATURED','FULLY_MATURED','CENSORED','INVALID_DATA')),
    censor_or_invalid_reason text,            -- AC-124: explicit, never silent
    net_return_usd         text,              -- decimal string; NULL unless tradable completed
    uncertainty_bound_usd  text,
    uncertainty_policy_version text NOT NULL,
    tradability_blocks_confirmed boolean,     -- FR-EXEC-007 gate result
    signal_label_preserved boolean,           -- diagnostic labels survive blocking
    path_ambiguity_flag    boolean NOT NULL DEFAULT false,  -- §64.7 coarse-interval ambiguity
    primary_ordering       text CHECK (primary_ordering IN ('ADVERSE_FEASIBLE','UNAMBIGUOUS')),
    adapter_id             text NOT NULL,
    adapter_version        text NOT NULL,
    replay_manifest_id     text NOT NULL,
    valid_until            timestamptz,       -- §64.15 expiry
    as_of                  timestamptz NOT NULL,
    available_at           timestamptz NOT NULL,
    quality_codes          text[] NOT NULL CHECK (cardinality(quality_codes) > 0),
    created_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT simulations_availability_order CHECK (available_at >= as_of),
    -- §8.2/INV-011: profit can only ride a completed tradable outcome
    CONSTRAINT signal_success_never_profit CHECK (
        signal_outcome_class <> 'SIGNAL_SUCCESS' OR tradable_outcome_class IS NOT NULL),
    CONSTRAINT incomplete_state_cannot_confirm_tradable CHECK (
        execution_status IN ('EXECUTION_UNAVAILABLE','POOL_MATH_UNSUPPORTED','INSUFFICIENT_DATA')
            OR tradable_outcome_class IS NULL OR tradable_outcome_class <> 'TRADABLE_SUCCESS'
        OR execution_status = 'EXECUTED_FULL')
);
```

### `g1_exec_0002_replay_observation.sql`

```text
CREATE TABLE replay_manifests (               -- FR-EXEC-010: frozen assumptions + code versions
    manifest_id            text PRIMARY KEY,
    scenario_id            text NOT NULL,
    scenario_version       text NOT NULL,
    assumptions_hash       text NOT NULL,     -- sha256 of the frozen assumption set
    scenario_json          jsonb NOT NULL,    -- the exact §64.2 scenario payload
    adapter_versions       jsonb NOT NULL,    -- adapter id+version per resolved family
    code_versions          jsonb NOT NULL,    -- simulator/schema/policy package versions
    transfer_semantics_policy_version text NOT NULL,
    stress_policy_version  text NOT NULL,
    delay_policy_version   text NOT NULL,
    frozen_at              timestamptz NOT NULL,
    created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outcome_observation_plans (      -- §64.14, FR-EXEC-011: finite selective plans
    plan_id                text PRIMARY KEY,
    candidate_id           text NOT NULL,
    trigger_class          text NOT NULL CHECK (trigger_class IN (
        'DEEP_RESEARCH','EARLY_WATCH','CONFIRMED_OPPORTUNITY','CONTROL_SAMPLE','SHADOW_PORTFOLIO')),
    cadence                jsonb NOT NULL,    -- versioned cadence spec
    observed_fields        text[] NOT NULL CHECK (cardinality(observed_fields) > 0),
    observed_accounts      text[],
    provider_source_ids    text[] NOT NULL,
    duration               interval NOT NULL,
    quota_ceiling          jsonb NOT NULL,    -- capacity/quota bounds (consumed by g1-capacity-contracts)
    degradation_policy_version text NOT NULL,
    inclusion_probability  double precision CHECK (inclusion_probability IS NULL OR inclusion_probability BETWEEN 0 AND 1),
    stratum                text,              -- AC-128 seam: stored for weighted estimators
    population_limits      jsonb NOT NULL,
    min_resolution_confirmed_tradable jsonb NOT NULL,  -- temporal/liquidity resolution floor
    plan_version           text NOT NULL,
    available_at           timestamptz NOT NULL,
    created_at             timestamptz NOT NULL DEFAULT now()
);
-- append-only triggers on both tables (G0 pattern): history is never rewritten
```

### `g1_exec_0003_adapter_registry_state.sql`

```text
CREATE TABLE pool_math_adapter_registry (     -- FR-EXEC-013/015/016, §64.3
    adapter_key_id         text PRIMARY KEY,  -- deterministic content id
    chain_id               text NOT NULL,
    program_id             text NOT NULL,
    program_version        text NOT NULL,
    curve_type             text NOT NULL CHECK (curve_type IN (
        'CONSTANT_PRODUCT_AMM','CONCENTRATED_LIQUIDITY_AMM','DISCRETE_LIQUIDITY_BIN_AMM',
        'BONDING_CURVE','STABLE_CURVE','DYNAMIC_FEE_AMM','VIRTUAL_RESERVE',
        'AGGREGATED_MULTI_ROUTE_READ_ONLY','UNKNOWN')),
    account_layout_version text NOT NULL,
    adapter_id             text NOT NULL,
    adapter_version        text NOT NULL,
    support_state          text NOT NULL CHECK (support_state IN (
        'AVAILABLE','DEGRADED','UNAVAILABLE')),
    parity_policy_version  text NOT NULL,
    tolerance_policy_version text NOT NULL,
    available_at           timestamptz NOT NULL,
    UNIQUE (chain_id, program_id, program_version, curve_type, account_layout_version, adapter_version),
    -- FR-EXEC-015 law at the persistence layer
    CONSTRAINT cp_only_for_cp CHECK (curve_type = 'CONSTANT_PRODUCT_AMM' OR adapter_id <> 'GENERIC_CP'),
    CONSTRAINT degraded_requires_incident CHECK (support_state <> 'DEGRADED' OR true) -- incident row required
);

CREATE TABLE execution_state_snapshots (      -- §64.4, FR-EXEC-014: one per simulation, append-only
    snapshot_id            text PRIMARY KEY,
    simulation_id          text NOT NULL REFERENCES execution_simulations(simulation_id),
    program_id             text NOT NULL,
    program_version        text NOT NULL,
    pool_math_adapter_id   text NOT NULL,
    pool_math_adapter_version text NOT NULL,
    slot_or_block          text NOT NULL,     -- exact slot/block + finality
    raw_account_state_hashes text[] NOT NULL, -- sha256 per raw account state
    reserves_json          jsonb NOT NULL,    -- reserve/vault state
    ticks_bins_curve_state_json jsonb,        -- as applicable to the design family
    fee_configuration_json jsonb NOT NULL,
    oracle_quote_inputs_json jsonb,
    token_extensions_json  jsonb NOT NULL,
    route_legs_json        jsonb NOT NULL,    -- route legs + shared-liquidity identifiers
    quote_conversion_source text,             -- quote asset conversion source + timestamp
    state_completeness     text NOT NULL CHECK (state_completeness IN ('COMPLETE','INCOMPLETE_BLOCKING')),
    uncertainty_bound_json jsonb NOT NULL,
    as_of                  timestamptz NOT NULL,
    available_at           timestamptz NOT NULL,
    created_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT snapshots_availability_order CHECK (available_at >= as_of)
);

CREATE TABLE adapter_incidents (              -- FR-EXEC-016/021: parity failure, deprecation, upgrades
    incident_id            text PRIMARY KEY,
    adapter_key_id         text NOT NULL REFERENCES pool_math_adapter_registry(adapter_key_id),
    cause                  text NOT NULL CHECK (cause IN (
        'PARITY_DRIFT','PROGRAM_UPGRADE','ADAPTER_DEPRECATION','UNKNOWN_EXTENSION',
        'STATE_INCOMPLETE','TOLERANCE_BREACH')),
    affected_scope         jsonb NOT NULL,    -- degraded scopes only (AC-237 law)
    detected_at            timestamptz NOT NULL,
    available_at           timestamptz NOT NULL,
    reevaluation_required  boolean NOT NULL DEFAULT true,
    created_at             timestamptz NOT NULL DEFAULT now()
);
-- append-only trigger on snapshots + registry revisions
```

### `g1_exec_0004_quotes_gates.sql`

```text
CREATE TABLE quote_evidence (                 -- FR-EXEC-020: evidence, never execution truth
    quote_evidence_id      text PRIMARY KEY,
    simulation_id          text NOT NULL REFERENCES execution_simulations(simulation_id),
    source_id              text NOT NULL,
    quote_payload_json     jsonb NOT NULL,    -- stored as evidence, never executed
    uncertainty_bound_json jsonb NOT NULL,    -- exposed uncertainty (§64.15)
    retrieved_at           timestamptz NOT NULL,
    available_at           timestamptz NOT NULL,
    quality_codes          text[] NOT NULL,
    transaction_construction_refused boolean NOT NULL DEFAULT false, -- §64.5 guard result
    created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tradability_gate_decisions (     -- FR-EXEC-007/012/017, append-only
    gate_decision_id       text PRIMARY KEY,
    simulation_id          text NOT NULL REFERENCES execution_simulations(simulation_id),
    profile_id             text NOT NULL,
    scenario_matrix        jsonb NOT NULL,    -- every scenario × result (AC-235)
    required_pass_matrix   jsonb NOT NULL,    -- profile-declared which must pass
    matrix_verdict         text NOT NULL CHECK (matrix_verdict IN ('PASS','FAIL','INSUFFICIENT_DATA')),
    conservative_default_applied boolean NOT NULL DEFAULT true, -- §64.10: CONFIRMED_OPPORTUNITY defaults conservative
    uncertainty_blocked    boolean NOT NULL,  -- FR-EXEC-020 bound crossed policy limits
    confirmed_opportunity_allowed boolean NOT NULL,
    signal_labels_preserved jsonb NOT NULL,   -- diagnostic labels recorded verbatim
    delay_policy_version   text NOT NULL,     -- §64.8 p50/p90/conservative gate substrate
    policy_version         text NOT NULL,
    as_of                  timestamptz NOT NULL,
    available_at           timestamptz NOT NULL,
    created_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT gate_decision_availability_order CHECK (available_at >= as_of)
);

CREATE TABLE concurrent_shadow_positions (    -- FR-EXEC-019: aggregate impact/capacity, append-only
    aggregation_id         text PRIMARY KEY,
    simulation_ids         text[] NOT NULL CHECK (cardinality(simulation_ids) >= 2),
    sharing_keys           jsonb NOT NULL,    -- pool/route/quote asset/liquidity source/deployer cluster/correlated exit window
    aggregate_impact_json  jsonb NOT NULL,
    aggregate_capacity_json jsonb NOT NULL,
    competition_resolution text NOT NULL CHECK (competition_resolution IN (
        'AGGREGATED_FILLS','PARTIAL_REDUCTION','REJECTED')),
    as_of                  timestamptz NOT NULL,
    available_at           timestamptz NOT NULL,
    created_at             timestamptz NOT NULL DEFAULT now()
);
-- append-only trigger on gate decisions
```

## Module layout (inside writeScopes)

```text
packages/domain/src/
  exec.ts                # NEW — OutcomeClass (§64.12 eight classes incl. TRADABLE_NEUTRAL),
                         #   OutcomeMaturity (§8.1 PENDING/PARTIALLY_MATURED/FULLY_MATURED/
                         #   CENSORED/INVALID_DATA), AdapterFamily (§64.3 registry families +
                         #   VIRTUAL_RESERVE per FR-EXEC-015), AdapterSupportState
                         #   (AVAILABLE/DEGRADED/UNAVAILABLE), ExecutionStatus (EXECUTED_FULL/
                         #   EXECUTION_PARTIAL/EXECUTION_UNAVAILABLE/POOL_MATH_UNSUPPORTED/
                         #   INSUFFICIENT_DATA), StressScenarioKind (BASE_CASE, P50_DELAY,
                         #   P90_DELAY, CONSERVATIVE_LATENCY_ADVERSE_SELECTION,
                         #   LIQUIDITY_DRAWDOWN, FEE_VOLATILITY, ROUTE_DEGRADATION,
                         #   FAILED_PARTIAL_FILL — FR-EXEC-017), ExitPolicyKind (§64.7:
                         #   FIXED_HORIZON, TAKE_PROFIT_STOP_LOSS, TRAILING_EXIT, STAGED_EXIT,
                         #   LIQUIDITY_RISK_DETERIORATION, THESIS_INVALIDATION),
                         #   PrimaryOrdering, TradabilityVerdict; fail-closed parse; pure laws:
                         #   outcomeLabelPrecedence (§8.2 order), signalCannotRenderProfit
                         #   (FR-EXEC-006/INV-011), tradabilityBlocksConfirmedOpportunity
                         #   preserving diagnostic labels (FR-EXEC-007),
                         #   executableTargetSatisfied (§64.13/FR-EXEC-004),
                         #   adverseOrderingRequired (§64.7), uncertaintyBlocksTradability
                         #   (FR-EXEC-020), robustDelayGate (§64.8)
  index.ts               # extend exports

packages/shared-schemas/src/
  exec.ts                # NEW — ExecutionScenario, ExitPolicyExperiment, ExecutionSimulation,
                         #   NetReturnBreakdown (pool/aggregator fees, token transfer fees,
                         #   priority/network fees, execution impact, failed attempts, partial
                         #   fills, residual inventory, adverse-selection buffer, quote
                         #   conversion/depeg, rent/account creation), EntryFillResult,
                         #   ExitFillResult, ReplayManifest, OutcomeObservationPlan,
                         #   AdapterRegistryEntry, ExecutionStateSnapshot, QuoteEvidence,
                         #   UncertaintyBound, StressScenarioResult, ScenarioPassMatrix,
                         #   AlertExecutionContent (FR-EXEC-008), ConcurrentShadowAggregate
                         #   schemas; imports domain enums (never restates);
                         #   EXEC_SCHEMA_REGISTRY_VERSION = 1
  index.ts               # export exec.ts

packages/pool-math/                        # NEW package (@foresift/pool-math)
  src/
    index.ts
    adapter-contract.ts   # PoolMathAdapter interface per §64.3 (decodeState,
                          # validateStateCompleteness, quoteExactIn/quoteExactOut,
                          # modelLiquidityMutation, requiredAccounts) + CoverageAssessment
    registry.ts           # fail-closed resolution keyed by (chainId, programId,
                          # programVersion, curveType, accountLayoutVersion) over signed
                          # support manifests (@foresift/program-decoders consumed
                          # read-only); unknown/mismatched → UNSUPPORTED/EXECUTION_UNAVAILABLE,
                          # never generic constant-product (FR-EXEC-015)
    constant-product.ts   # exact deterministic CP math (BigInt, fixed rounding-direction
                          # law, fee application, minimum output, boundary/overflow guards)
                          # — only for verified constant-product pools
    route-aggregation.ts  # AGGREGATED_MULTI_ROUTE_READ_ONLY: per-leg fees + impact,
                          # shared-vault de-dup, loop detection, route count caps, quote
                          # conversion + depeg state (§64.5); observation only
    state-completeness.ts # §64.4 validateStateCompleteness → CoverageAssessment; missing
                          # tick/bin/curve/account state that can materially affect a fill →
                          # INCOMPLETE_BLOCKING (AC-232), never assumed uniform liquidity
    parity.ts             # §64.11 gate suite over the proven @foresift/program-decoders
                          # parity seam: historical observed-trade parity (economic events),
                          # current reference-quote parity when available, edge-state
                          # fixtures, version-specific tolerance gates; failure →
                          # DEGRADED/UNAVAILABLE + incident (FR-EXEC-016/021)
  test/                   # colocated suites: golden vectors, property/boundary tests

packages/transfer-semantics/               # NEW package (@foresift/transfer-semantics)
  src/
    index.ts
    adapter.ts            # TransferSemanticsAdapter keyed by chain/program/programVersion/
                          # layoutVersion; consumes the PROVEN @foresift/solana-security
                          # verdict surface (never restates it); models transfer-fee
                          # (epoch/config-applicable), transfer-hook effects, account
                          # creation/rent; UNKNOWN_REQUIRED → INSUFFICIENT_DATA (§64.9,
                          # zero cost never assumed)
    fee-model.ts          # versioned fee/hook/rent computation entering net return (both
                          # entry and exit legs — FR-EXEC-018)
  test/

packages/execution-simulator/              # NEW package (@foresift/execution-simulator)
  src/
    index.ts
    scenario.ts           # §64.2 identity resolution + pre-registration enforcement
    delays.ts             # §64.8 action-delay distribution (p50/p90/maximum_supported,
                          # measurement source + sample size; conservative configured values
                          # labeled) → robust-delay gate substrate
    entry.ts              # §64.6 entry modeling: requested/filled, average price, marginal
                          # + average impact, fees, failed/rejected amounts, start/completion
                          # time, state/route uncertainty, partial-fill policy
    exit.ts               # §64.7 exit modeling: versioned exit policies, contemporaneous
                          # executable state, trigger vs completion time, adverse feasible
                          # ordering primary + path-ambiguity flag, optimistic secondary
    net-return.ts         # §64.9 assembly: pool fees, token transfer fees, priority/network
                          # fees + volatility, stablecoin/quote conversion + depeg, impact,
                          # partial fills, failed attempts, adverse-selection/MEV buffer,
                          # quote latency, liquidity deterioration, residual inventory,
                          # minimum output (FR-EXEC-003/018)
    outcome.ts            # §64.12 + §8.2 classification: label precedence, UNTRADABLE_
                          # SIGNAL_WIN, explicit censor/invalid reasons, maturity states,
                          # denominator disclosure counts (INV-011/012)
    tradability.ts        # FR-EXEC-007/012/017: scenario pass matrix vs profile-declared
                          # required matrix, conservative default, CONFIRMED_OPPORTUNITY
                          # gating with preserved signal labels
    target-touch.ts       # §64.13/FR-EXEC-004: executable volume or configured target-
                          # duration; isolated wick never sufficient (AC-122); low-
                          # resolution snapshots support signal labels only (AC-126)
    uncertainty.ts        # FR-EXEC-020/§64.15: quotes as evidence-not-truth, exposed
                          # uncertainty, blocking at policy limits; §64.15 rendering set
    concurrency.ts        # FR-EXEC-019: deterministic aggregation over sharing keys
                          # (pool, route, quote asset, liquidity source, deployer cluster,
                          # correlated exit window); fill competition reduces/rejects
    routes.ts             # FR-EXEC-022: point-in-time route/pool selection (nothing after
                          # T_user_action); migration routing from migration_edges
                          # transitions known + executable at action time
    degradation.ts        # FR-EXEC-021: deprecation/upgrade/parity-drift/unknown-extension
                          # → degrade affected scope, re-evaluate active alerts/watchlists,
                          # history never rewritten, no new confirmed alerts until
                          # revalidated
    replay-manifest.ts    # FR-EXEC-010: freeze assumptions + code versions; frozen replay
                          # reproduces stress outcomes (AC-127)
    observation-plans.ts  # §64.14/FR-EXEC-011: finite versioned plans (cadence, fields,
                          # sources, duration, quota ceiling, degradation, inclusion
                          # probability/stratum, population limits, resolution floor)
    alert-content.ts      # FR-EXEC-008: configured notional, delay, modeled impact,
                          # assumptions, expiry (valid_until) projection
    experiments.ts        # FR-EXEC-009: exit-policy experiment registry; primary result is
                          # pre-registered; retrospective best-pick structurally refused
    read-only-guard.ts    # FR-EXEC-005/§64.16: structural refusal of transaction
                          # construction/signing/submission surfaces; quote-provider
                          # transaction-construction payload rejection (§64.5)
  test/

tests/fixtures/exec/                       # NEW dir
  scenarios.json         # §64.2 scenario vectors + delay policies + pass matrices
  pool-states.json       # decoded CP pools (verified) + CL/bin/stable/dynamic-fee/bonding-
                         # curve/virtual-reserve/unknown designs + incomplete-state cases
  net-return.json        # AC-121 fee/impact/partial-fill fixtures
  target-touch.json      # executable volume / target duration / isolated wick vectors
  observed-trades.json   # historical observed-trade parity vectors + reference quotes
  transfer-fees.json     # transfer-fee/hook/rent modeling vectors incl. unknown-required
  concurrent-exits.json  # shared-depth competition vectors (AC-236)
  routes-timeline.json   # route/pool creation vs T_user_action + migration transitions
  stress-cases.json      # base/p50/p90/conservative matrix + optimistic-only candidates
  coarse-candles.json    # AC-238 adverse-feasible ordering vectors

tests/acceptance/  — AC-120…128, AC-232, AC-234, AC-235, AC-236, AC-238, AC-239
                     .spec.ts AUTHORED here; AC-230/231/237 extended additively
tests/negative/    — the same 15 .negative.spec.ts authored here; AC-230/231/237
                     negatives extended additively
telemetry/exec.catalog.json — NEW: exec.scenario_resolved, exec.simulation_recorded,
                     exec.net_return_composed, exec.outcome_classified,
                     exec.tradability_decided, exec.observation_plan_issued,
                     exec.replay_manifest_frozen, exec.adapter_resolved,
                     exec.adapter_parity_evaluated, exec.adapter_degraded,
                     exec.shadow_positions_aggregated, exec.route_selected,
                     exec.quote_evidence_recorded (DECLARATIVE_CONTRACT_ONLY)
tests/telemetry-catalog.spec.ts — extended in place (plan-sanctioned scope
                     exception, milestone plan-level decision 4)
packages/persistence/src/migrator.ts — MIGRATION_FAMILIES extended with `exec`
packages/persistence/test/migrator.spec.ts — central expected-script registry
                     extended in place (plan-sanctioned scope exception, ADR-0019/0022
                     duty)
evidence/bun-migration/bun-migration-manifest.json — regenerated after new
                     suites exist (mechanical, coordinator duty)
```

## Verification strategy per acceptance criterion

| AC         | Surface                                     | Positive proof                                                                                                                                                                                                                                                                                                                   | Negative proof                                                                                                                                                                              |
| ---------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-120     | signal vs tradable separation               | fixture `pool-states.json` + `net-return.json`: a token rising above target that cannot fill/exit the configured notional classifies `SIGNAL_SUCCESS` but NOT `TRADABLE_SUCCESS` (§64.12/§8.2 law, `UNTRADABLE_SIGNAL_WIN`)                                                                                                      | negative: any path rendering profit from a signal success without a tradable outcome is structurally refused (SQL CHECK + pure law); signal labels cannot overwrite tradable classes        |
| AC-121     | net-outcome fixture law                     | fixture `net-return.json`: entry delay, price impact, pool/token/network fees, partial fills, exit liquidity each change net outcome exactly as the fixture defines (§64.6/64.7/64.9)                                                                                                                                            | negative: omitting any fee/impact leg (transfer fee, priority fee, impact, partial fill) diverges from the fixture and fails; assumed-zero costs refused                                    |
| AC-122     | wick law                                    | fixture `target-touch.json`: a one-slot wick without executable volume or configured duration does not satisfy tradable success (§64.13)                                                                                                                                                                                         | negative: an isolated wick classified TRADABLE_SUCCESS is refused; executable-volume/duration gate is structural                                                                            |
| AC-123     | maturity-denominator discipline (exec seam) | outcome classification keeps PENDING/PARTIALLY_MATURED outcomes out of final denominator inputs and reports them separately (§8.2 precedence; INV-012); g1-outcome-evaluation extends with full statistics                                                                                                                       | negative: a denominator composition including pending/partial rows is refused; silent inclusion fails                                                                                       |
| AC-124     | censoring honesty                           | censored/invalid outcomes retain explicit reasons (censor_or_invalid_reason) and never silently become failures (§8.2 steps 1–2)                                                                                                                                                                                                 | negative: a CENSORED/INVALID_DATA outcome without a recorded reason is refused by schema; mapping to TRADABLE_FAILURE is refused                                                            |
| AC-125     | objective-label separation                  | owner-subjective usefulness inputs are schema-separate; the objective market outcome label is a pure function that ignores them (§64.12)                                                                                                                                                                                         | negative: an input path where subjective usefulness mutates an objective outcome class is structurally refused                                                                              |
| AC-126     | resolution floor                            | fixture `target-touch.json`: a low-resolution price snapshot supports a signal label but cannot establish a short-lived executable target or tradable success without the required observation plan (§64.14/FR-EXEC-011)                                                                                                         | negative: tradable success proven from a below-floor-resolution snapshot is refused; observation-plan requirement is structural                                                             |
| AC-127     | conservative stress + frozen replay         | fixture `stress-cases.json`: a candidate profitable only under the optimistic case FAILS a profile requiring the conservative stress scenario; the same stress assumptions reproduce in frozen replay (FR-EXEC-010/012)                                                                                                          | negative: an optimistic-only candidate passing a conservative gate is refused; replay with mutated assumptions fails the reproduction check                                                 |
| AC-128     | sampling honesty (exec seam)                | observation plans store inclusion probability/stratum/population limits (§64.14); selected-only samples carry explicit population limits — g1-outcome-evaluation extends with weighted estimators                                                                                                                                | negative: an observation plan with out-of-range inclusion probability or missing population limits is refused; universe-wide claims from selected-only samples are blocked at the plan seam |
| AC-232     | state-completeness blocking                 | fixture `pool-states.json`: missing tick/bin/curve/account state that can materially affect a fill marks state incomplete and blocks confirmed tradability rather than assuming uniform liquidity (§64.4, FR-EXEC-020)                                                                                                           | negative: an INCOMPLETE_BLOCKING simulation confirming tradability is refused (SQL CHECK + pure law); assumed uniform liquidity fails                                                       |
| AC-233     | (owned by g1-data-truth-extensions)         | regression-locked: existing suite stays green; simulator fee legs align with the proven economic-event fee decomposition                                                                                                                                                                                                         | existing negatives stay green                                                                                                                                                               |
| AC-234     | point-in-time routing                       | fixture `routes-timeline.json`: a route/pool created after `T_user_action` cannot be selected by historical execution; migration routing uses only transitions + state available at action time (FR-EXEC-022)                                                                                                                    | negative: retrospective route selection is structurally refused (selection keyed at action time); post-action migration transition applied fails                                            |
| AC-235     | scenario pass matrix                        | fixture `stress-cases.json`: base, p50, p90, conservative latency/adverse-selection, liquidity drawdown, fee volatility, route degradation, failed/partial-fill scenarios are all recorded; the active policy enforces its declared pass matrix (FR-EXEC-017)                                                                    | negative: a candidate passing an undeclared/incomplete matrix, or a policy silently weakening its declared matrix, is refused                                                               |
| AC-236     | shared-depth competition                    | fixture `concurrent-exits.json`: two simultaneous shadow exits sharing one pool cannot each consume the full pre-exit depth; aggregate impact + fill competition reduce or reject fills deterministically (FR-EXEC-019)                                                                                                          | negative: isolated fills each consuming the same depth are refused; non-deterministic competition ordering fails the determinism check                                                      |
| AC-237     | (extended additively)                       | exec describe block: adapter parity drift / program upgrade / deprecation degrades only affected scope, triggers re-evaluation of active alerts/watchlists, preserves historical results, prevents new confirmed alerts until revalidated (FR-EXEC-021)                                                                          | negative: degrading unaffected scope, rewriting historical simulations, or permitting new confirmed alerts pre-revalidation is refused                                                      |
| AC-238     | adverse-feasible ordering                   | fixture `coarse-candles.json`: a coarse candle whose target and invalidation are both reachable yields the adverse feasible primary ordering + a path-ambiguity flag; the optimistic ordering is secondary only (§64.7)                                                                                                          | negative: an optimistic primary ordering under coarse-interval ambiguity is refused; missing path-ambiguity flag fails                                                                      |
| AC-239     | promotion-denominator disclosure            | simulation results + outcome labels expose the excluded classes (signal-only, low-resolution, partial, censored, invalid, scenario-mismatched) separately from the TRADABLE_SUCCESS denominator (INV-012)                                                                                                                        | negative: a denominator composition silently folding excluded classes into TRADABLE_SUCCESS is refused                                                                                      |
| AC-230/231 | (extended additively)                       | exec describe blocks: pool-math adapter resolution resolves ONLY via matching versioned adapter + signed manifest; unknown/mismatched design → explicit unsupported state; the active CP adapter passes deterministic vectors, property/boundary tests, observed-trade parity, reference-quote parity, versioned tolerance gates | negative: generic CP output for a non-CP design refused; unverified/deprecated manifest refuses resolution; parity failure leaves the adapter ACTIVE is refused                             |

Package-level unit suites (`packages/*/test/**`): vocabulary fail-closed
parses; §8.2 precedence truth table; CP math property tests (monotonicity,
no-free-lunch, overflow boundaries); state-completeness coverage assessment;
delay-gate truth table; net-return leg-by-leg decomposition; concurrent
competition determinism (same input → same reduction, any order); route
point-in-time selection; degradation scope isolation; replay-manifest
reproduction; read-only guard refusals.

## Material decisions (proposed ADR texts — bind future packages)

### ADR-1 — Outcome-label precedence is a single deterministic law

**Decision**: outcome classification applies the §8.2 order (INVALID_DATA →
CENSORED → PENDING/PARTIALLY_MATURED → TRADABLE_FAILURE_SECURITY_OR_LIQUIDITY →
TRADABLE_SUCCESS → TRADABLE_FAILURE → TRADABLE_NEUTRAL) as ONE pure function
imported by every consumer. Signal labels are computed on a separate axis and
can never overwrite tradable labels; a large-MFE token with failed/partial/
unavailable execution is `UNTRADABLE_SIGNAL_WIN` (signal success, tradable
failure/neutral). `SIGNAL_SUCCESS` never renders profit when
`TRADABLE_SUCCESS` is absent or failed — the rendering law is structural
(SQL CHECK + pure predicate), not a display convention. Maturity, censoring,
and invalid-data states carry explicit reasons and are excluded from final
denominators with separate reporting (INV-011/012).

**Why binding**: g1-outcome-evaluation builds promotion statistics and g1-objective-governance builds
utility on these labels; both must consume one precedence law, never per-package reinterpretations.

### ADR-2 — Adapter support is fail-closed, family-keyed, and parity-gated

**Decision**: pool math resolves through a versioned registry keyed by (chain,
program, program version, curve type, account-layout version) over signed
support manifests shared with the decoder registry. Generic constant-product
math is admissible ONLY for a verified constant-product pool;
concentrated-liquidity, discrete-bin, stable-swap, dynamic-fee, bonding-curve,
virtual-reserve, and unknown designs require their own adapter or return
`EXECUTION_UNAVAILABLE` — never a bounded-approximation shortcut without a
specifically validated contract with conservative uncertainty covering observed
error (§64.3). An adapter family is `AVAILABLE` only when its versioned
parity suite (deterministic vectors, property/boundary tests, historical
observed-trade parity, reference-quote parity where available, version-specific
tolerance gates) passes; parity failure transitions it to `DEGRADED`/
`UNAVAILABLE`, opens an incident, and invalidates affected live tradability
claims until repaired (§64.11). `AGGREGATED_MULTI_ROUTE_READ_ONLY` is route-
level read-only aggregation reconciled to underlying venue adapters — never
pool-math authority (AC-231).

**Why binding**: every later G1 package consuming tradability (signal registry,
outcome evaluation, objective governance) must trust that a non-EXECUTED
status means genuinely-unavailable math, not an approximation of unknown error.

### ADR-3 — Historical simulations are append-only and point-in-time

**Decision**: every simulation persists the §64.4 state record and is
immutable after write (append-only triggers); route, pool, adapter, and
migration-transition resolution is keyed strictly at `T_actionable`/
`T_action_reference` (FR-EXEC-022) — nothing created or transitioned after the
action time can be selected. Degradation events (parity drift, program
upgrade, deprecation, unknown extension) re-evaluate ACTIVE alerts/watchlists
forward from their `available_at` and never rewrite historical simulations
(FR-EXEC-021, INV-005/006). Replay manifests freeze the exact scenario payload,
assumption hash, adapter versions, and code versions (FR-EXEC-010); frozen
replay reproduces stress outcomes bit-for-bit (AC-127).

**Why binding**: g1-outcome-evaluation's time-based frozen replay and
g1-objective-governance's incomparability rules both assume immutable,
point-in-time simulation records.

### ADR-4 — Quotes and references are evidence, never execution truth

**Decision**: quote/reference sources are persisted as evidence payloads with
exposed uncertainty bounds and provenance (source, retrieval time, quality
codes). Simulation never treats an external quote as executable truth: when
state is incomplete or parity is weak, uncertainty is exposed (§64.15); when
the uncertainty bound crosses the policy limit, confirmed tradability is
blocked (FR-EXEC-020). Transaction-construction payloads from quote providers
are refused (§64.5). An aggregate/route quote (e.g. Jupiter observation) is
reconciled to underlying venue adapters rather than consumed as math authority
(AC-231).

**Why binding**: the tradability gate and every downstream consumer must share
one uncertainty-blocking law; optimism leaks otherwise.

### ADR-5 — Concurrent shadow positions aggregate deterministically

**Decision**: simulations that share a pool, route, quote asset, liquidity
source, deployer cluster, or correlated exit window are aggregated before
isolated evaluation (FR-EXEC-019): impact and capacity are computed on the
aggregate, and fill competition reduces or rejects fills by a deterministic
ordering (registration id lexicographic tie-break — no wall-clock dependence),
so isolated fills can never each consume the same depth (AC-236). The
aggregation record stores the sharing keys and the resolved competition class.

**Why binding**: g1-objective-governance's shared-liquidity-impact
decomposition and capacity-limited-opportunity reporting consume these records.

### ADR-6 — New migration family `exec`

**Decision**: FR-EXEC persistence uses `g1_exec_*.sql` per the milestone
writeScopes; the migrator's fail-closed family list is extended with `exec`
in the same package that introduces it (ADR-0019/0022 central-registry duty:
`packages/persistence/test/migrator.spec.ts` extended here, plan-sanctioned
scope exception). Migration files stay additive — no G0/G1 table owned by
another family is altered.

### ADR-7 — Exit-policy plurality is pre-registration-bounded

**Decision**: evaluating multiple exit policies is allowed only as
pre-registered separate experiments (exit_policy_experiments with a single
pre-registered primary per scenario); the primary result is fixed at
registration, and any retrospective best-pick (choosing the historically best
policy, route, delay, or scenario after observing outcomes) is structurally
refused (FR-EXEC-009, §64.2 pre-registration law, Appendix D.21 hindsight ban).

**Why binding**: g1-outcome-evaluation's multiple-testing control and
g1-objective-governance's scenario cherry-picking detection both assume this
registry shape.

## Risks and mitigations (planning-level)

| Risk                                                                               | Likelihood | Impact   | Mitigation                                                                                                                                                                     |
| ---------------------------------------------------------------------------------- | ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `**` write-scope globs require all three packages to exist before shard validation | High       | MEDIUM   | packages scaffolded in the first tasks so predicted writes resolve inside scopes                                                                                               |
| Constant-product math subtly wrong (rounding, overflow, fee placement)             | Medium     | HIGH     | BigInt-only math with a fixed rounding-direction law; property tests (monotonicity, conservation), boundary/overflow suites, parity vectors (FR-EXEC-016)                      |
| Scope creep into outcome-evaluation statistics (denominators, estimators)          | Medium     | HIGH     | hard boundary at the classification/plan seams (spec I2/I4); FR-MAT-facing obligations recorded for `g1-outcome-evaluation` in out-of-scope notes; tasks cite only FR-EXEC IDs |
| Shared AC files (AC-120…128) later double-authored by g1-outcome-evaluation        | Medium     | MEDIUM   | ownership law fixed in spec I2 (this package authors, later packages extend additively); recorded in out-of-scope notes                                                        |
| Parity harness over-coupled to live data (non-deterministic tests)                 | Low        | HIGH     | parity exercised against fixture-encoded observed trades and reference quotes only; "where available" gates are fixture-switched, never network-dependent                      |
| Concurrent-exit competition non-deterministic                                      | Low        | HIGH     | total deterministic ordering (lexicographic registration id); determinism unit test permutes input order                                                                       |
| Migration family regex extension breaks migrator tests                             | Low        | LOW      | central registry suite extended in the same PR (ADR-0019/0022 duty, live-proven pattern from g1-data-truth/g1-solana-security)                                                 |
| Read-only boundary eroded through route/quote payloads                             | Low        | CRITICAL | `read-only-guard.ts` refuses transaction-construction payloads (§64.5); prohibited-capability scanner run as an explicit gate task                                             |

## Non-goals reaffirmed (must not creep into tasks.md)

No trading/custody/signing surfaces (permanent; §64.16); no outcome-maturity
statistics, promotion pipelines, precision/recall, negative-control or
champion–challenger machinery (g1-outcome-evaluation owns FR-MAT); no objective
utility/constraint surfaces (g1-objective-governance); no feature registry or
ranking (g1-signal-registry); no capacity admission control or budget policy
(g1-capacity-contracts); no discovery coverage claims (g1-discovery-coverage);
no new program decoders or decoder-registry changes (`packages/program-decoders`
is a read-only consumer; its manifest family is proven); no transfer-semantics
verdict substrate (`packages/solana-security` is read-only consumed); no alert
delivery/notification channels (G1 has no product surfaces; FR-EXEC-008 is a
structured content projection); no telemetry emitter wiring (G2); no
`docs/generated/**` regeneration (milestone plan-level decision 2).

## Validation

```bash
node scripts/automation/package-plan-complete.mjs \
  --package g1-execution-simulation \
  --artifacts-dir /home/minhquan_eth/.archon/workspaces/quantm-zeus/foresift/artifacts/runs/3b1a4c53ce8c5b52deac6168eccea290

# Task-graph build + shard planning (must stay green, all writes in scope):
node scripts/automation/build-implementation-task-graph.mjs --package g1-execution-simulation

# Package gates (milestone verificationCommands):
test -d packages/execution-simulator && pnpm --filter @foresift/execution-simulator test
test -d packages/pool-math && pnpm --filter @foresift/pool-math test
test -d packages/transfer-semantics && pnpm --filter @foresift/transfer-semantics test

# Extended central suites (plan-sanctioned scope exceptions):
pnpm --filter @foresift/persistence test
bun test tests/telemetry-catalog.spec.ts tests/acceptance/AC-120.spec.ts tests/acceptance/AC-232.spec.ts

# Read-only boundary gate:
node scripts/scan-prohibited-capabilities/cli.mjs

# Overall gates at the pushed HEAD (not planning-only):
pnpm verify
pnpm spec:verify
```
