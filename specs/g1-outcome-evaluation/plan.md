# Implementation Plan: g1-outcome-evaluation

**Package**: `g1-outcome-evaluation` | **Date**: 2026-09-09 | **Spec**: `specs/g1-outcome-evaluation/spec.md` (scoped derivative of PRD §8.2 in full, §12.8, §31.1–31.14 in full, §38.16, §38.42 obligations cited, §68 in full, §7.8/§7.10, §69.2, Appendix G.11/G.12, inline ADR-022 + manifest FR-MAT-001…012, FR-EVAL-001…009)
**Authority**: PRD wins over every word below; material decisions are recorded as proposed ADR texts in this file.

## Summary

Deliver honest outcome maturity and the deterministic evaluation baseline as TWO
new packages plus one CLI over the proven G1 substrate, with no model anywhere
in the deterministic path:

1. **Outcome maturity ledger (`packages/outcome-maturity`, FR-MAT-001…012)** —
   independent §12.8/§68.1 maturity per outcome profile/horizon/execution
   scenario with the no-reset law (deployment, retry, provider outage, policy
   changes never reset maturity; lifecycle/alert state never overwrites it);
   §68.2 denominator policy (final precision/failure/calibration/expectancy/
   utility/promotion metrics use only fully matured valid outcomes; provisional
   views label denominator, maturity, and uncertainty separately); §68.3
   explicit censor/invalid reason vocabularies that can never silently map to
   failure (rug/pool-disappearance/liquidity-collapse/failed-fill are OUTCOMES,
   not censoring — `censored_as_failure: false` as SQL CHECK + pure law);
   FR-MAT-010 denominator disclosure of invalid, censored, partial,
   low-resolution, rights-blocked, and unobserved cases so policies cannot
   improve measured performance by reducing outcome collection; FR-MAT-006
   five-family label separation (OBJECTIVE_SIGNAL_OUTCOME,
   OBJECTIVE_TRADABLE_OUTCOME, OBJECTIVE_PORTFOLIO_UTILITY,
   SUBJECTIVE_USER_UTILITY, HUMAN_EXPERT_JUDGMENT — subjective utility is
   schema-separate and can never alter objective labels); FR-MAT-007 sampled
   high-resolution outcomes with stored inclusion probability/stratum/selection
   time and valid design-weighted estimators or explicitly restricted claims
   (§31.8, §68.10, G.11 `maximum_sampling_weight: 20`); FR-MAT-008 promotion
   evidence requiring fully matured high-resolution execution evidence for the
   exact notional/delay/adapter/route/exit policy (coarse signal data never
   substitutes); FR-MAT-009 adverse-feasible primary ordering with
   path-ambiguity disclosure and optimistic-only secondary analysis (consuming
   exec-proven `primary_ordering`/`path_ambiguous`); FR-MAT-011 time-stamped
   alert expiry/cancellation/thesis-invalidation side effects with post-expiry
   gains never counting as actionable success; FR-MAT-012 capacity disclosures
   (maximum executable notional + deployable portfolio capacity from the
   proven shadow aggregation) so small-notional success cannot generalize
   without simulation.
2. **Statistical integrity and evaluation baseline (`packages/evaluation`,
   FR-MAT-004, FR-MAT-005, FR-EVAL-001…009)** — §68.5 negative-control harness
   (label permutation, feature-time shift, delayed-provider placebo, synthetic
   null features, forbidden future/outcome-column scan, leakage scans,
   provider-ID-only predictor) with registered material-lift thresholds where
   unexpected lift blocks promotion and opens a §68.12 incident; §68.6
   clustered/block bootstrap confidence intervals reporting naive sample size,
   cluster count, effective independent sample size, cluster definition,
   interval method, and alternate-clustering sensitivity (low ESS blocks
   calibrated/proven claims); versioned §8.3-shaped outcome profiles;
   §31.5-extended time-based frozen replay denying live network access for
   decision-quality evaluation; §31.4 universal decision/action-time function
   over the proven `candidate_decision_timelines` with identical semantics for
   alerted/watched/ignored/rejected/challenger/control/missed arms; the §31.6
   metric suite; §31.7 baseline comparison (strongest eligible simple baseline
   is the promotion comparator, identical frozen universe/cutoff per AC-042);
   the §31.10 Missed Opportunity Analyzer with §31.11 miss taxonomy; §20.6/31.8
   exploration-control retention (AC-043); §31.12 champion–challenger
   comparison (equalized budgets, no challenger external side effects);
   §31.13/§68.7 multiple-testing control + §31.3 experiment registry +
   §31.14 versioned power/precision plans; §31.9/§68.10 selection-bias
   diagnostics over the proven `probe_assignments`; and the AC-154 calibration
   machinery (automatic expected-net-utility degradation on calibration/regime
   drift) completing the sig-proven challenger seam.
3. **Evaluation CLI (`packages/eval-cli`)** — deterministic batch surface
   (maturity sweep, dataset build, replay run, metric report, baseline
   comparison, missed-opportunity scan, control harness) driving the two
   packages through exported APIs only; no network, no model, no interactive
   auth; the manifest's `@foresift/eval-cli` implementation surface for
   FR-EVAL-001…009.

Plus additive extensions: `packages/domain/src/mat.ts` + `eval.ts`
vocabularies/laws, `packages/shared-schemas/src/mat.ts` + `eval.ts` Zod
schemas, migration families `mat` + `eval` (`migrations/g1_mat_*.sql`,
`migrations/g1_eval_*.sql`), fixtures `tests/fixtures/mat/` + `tests/fixtures/eval/`,
telemetry `telemetry/mat.catalog.json` + `telemetry/eval.catalog.json`, and the
manifest-owned AC suites (18 files authored, 20 extended additively).

The AC-152 law is structural in the evidence gate: a module at IMPLEMENTED can
be evaluated but its results are labeled shadow/unavailable and cannot support
alert claims until AVAILABLE; production promotion additionally requires PROVEN
when the profile specifies it (§69.2 independent state dimensions, §68.12
population-claim trigger).

Strictly read-only (INV-001): no trading, custody, wallet-signing,
private-key, or transaction-submission capability anywhere in the ledger, the
evaluation engine, or the CLI.

## Technical Context

- **Language/runtime**: TypeScript (ESM, strict, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`) in the existing pnpm workspace; Bun Test is
  the repository test authority. New packages `packages/outcome-maturity`
  (`@foresift/outcome-maturity`), `packages/evaluation`
  (`@foresift/evaluation`), `packages/eval-cli` (`@foresift/eval-cli`)
  follow the G0/G1 scaffold pattern: workspace `*` dependencies, `bun test`
  script, tsconfig extending `tsconfig.base.json`, no per-package runner
  config.
- **Storage**: PostgreSQL schema via `@foresift/persistence` (`DatabaseEngine`
  seam); tests run on PGlite per ADR-0014. Migrations are the SQL source of
  truth. Two NEW migration families `mat` and `eval` (`g1_mat_*.sql`,
  `g1_eval_*.sql`), additive only; the fail-closed family list in
  `packages/persistence/src/migrator.ts` (`MIGRATION_FAMILIES` regex) is
  extended with `mat|eval` and the central expected-script registry
  (`packages/persistence/test/migrator.spec.ts`) is extended in the same
  package — the plan-sanctioned scope exception (plan-level decision 1;
  ADR-0019/0022 duty; the exact g1-execution-simulation precedent, which added
  `exec` to the same family list). Tables live in the `public` schema under
  the §30.7 names, so the hand-maintained ADR-001 Drizzle mirror
  (`packages/persistence/src/generated/schema.ts`) catches up to SQL truth in
  the same package — the schema-parity gate enumerates `public` (+ `sig`) and
  fails on any gap (same precedent as g1-data-truth-extensions #175,
  g1-execution-simulation #208, g1-signal-registry #245).
- **Validation**: Zod schemas authoritative in `packages/shared-schemas`
  (ADR-0013). New closed vocabularies (maturity ledger states are already
  exec-owned and imported; censor/invalid reason codes, denominator
  disclosure classes, label families, sampling strata/probability provenance,
  experiment states, holdout-exposure states, dataset partitions, control
  kinds, incident kinds, miss taxonomy, baseline kinds, comparison verdicts)
  are declared in `packages/domain/src/mat.ts` / `eval.ts` and imported —
  never restated — by `packages/shared-schemas/src/mat.ts` / `eval.ts`
  (milestone plan-level decision 5, ADR-0018 precedent). Unknown values fail
  closed with stable `MatErrorCode`/`EvalErrorCode`s. Existing vocabularies
  consumed from domain, never duplicated: `OutcomeMaturity`, `OutcomeClass`,
  `TradabilityVerdict`, `PrimaryOrdering`, `StressScenarioKind`,
  `ReplayMode`, `QualityCode`, `SelectionArm`, `CutoffReason`,
  `ObservationPlanTriggerClass`, `AcquisitionState`.
- **Replay law**: THE single domain predicate `visibleAt` (`available_at ≤ T`)
  stays the only visibility definition; every evaluation resolves inputs
  through it at the replay's asOf boundary (INV-005/006). The exec-proven
  `replay_manifests` are extended by reference (this package freezes
  evaluation manifests with the §31.5 fields the exec manifest lacks:
  datasetVersion, populationClaim, observationCutoff,
  collectorCoverageManifestId, holdoutExposureSnapshotId, featureVersion,
  rankingVersion, policyVersion, deliveryLatencyPolicyVersion,
  capacityContractVersion) — never by rewriting the exec table.
- **Determinism law**: metrics, intervals, controls, comparisons, and the
  universal action-time function are pure functions of persisted inputs +
  versioned configuration. No wall-clock reads inside algorithms (timestamps
  are inputs); no ambient randomness (control permutations and stratified
  sampling use a seeded deterministic PRNG with recorded seed provenance —
  G0 `probe_assignments` / G.11 `sampling_seed_policy: DAILY_VERSIONED`
  precedent); fixed decimal arithmetic on decimal-string quantities
  (`gross_return_usd`-style CHECK law) — never floats for money.
- **Test stack**: Bun Test; new suites colocated per package
  (`packages/outcome-maturity/test/*.spec.ts`,
  `packages/evaluation/test/*.spec.ts`, `packages/eval-cli/test/*.spec.ts`)
  plus in-place additive extensions of the shared `tests/acceptance` /
  `tests/negative` AC files; PGlite-backed suites classified DATABASE_PGLITE
  via the coordinator manifest (regenerated after new test files exist so
  `test:all` workloads stay OOM-safe per the test runtime contract).
- **Telemetry**: declarative catalogs only (`telemetry/mat.catalog.json`,
  `telemetry/eval.catalog.json` new) — emitter wiring is G2, never in this
  package's verification.
- **CLI**: `packages/eval-cli` is a thin deterministic driver over the two
  packages' exported APIs (`bun run` entry points, exit codes 0/1, JSON
  reports to stdout or `--out`); it owns no business law of its own — every
  law lives in `outcome-maturity`/`evaluation` so the CLI can never diverge
  from library behavior. No network client, no credentials, no model surface.

## Constitution Check

- **I. Product-Contract Authority**: scope limited to the 21 assigned
  requirements; §8.2, §12.8, §31, §68, §7.8/§7.10, G.11/G.12, inline ADR-022
  quoted surfaces are implemented as specified, no reinterpretation. §31.4's
  action-time formula and §31.5's manifest fields are transcribed verbatim.
- **II. Greenfield**: designed from the PRD alone; the proven G1 packages are
  consumed as seams, never forked.
- **III. Modular-monolith-first**: three in-workspace packages with one-way
  dependencies (eval-cli → evaluation/outcome-maturity → domain/
  shared-schemas/persistence); no new services, brokers, or frameworks.
- **IV. Read-only law**: the ledger/evaluation/CLI only compute, persist, and
  report; no execution, custody, signing, or submission surface (INV-001). A
  colocated structural test asserts the packages import no
  model-provider/agent surface, and the prohibited-capability scanner runs as
  an explicit gate.
- **V/VI. Point-in-time + event-time correctness**: all evaluation over event
  time through `visibleAt`; replay manifests freeze the asOf boundary;
  outcome maturity depends on horizon completion over event time, never
  ingestion time.
- **VII. Provenance and evidence**: every metric, interval, control verdict,
  and denominator disclosure carries its input hashes, versions, and
  population manifest reference; claims without a manifest-backed population
  are refused (§68.4).
- **VIII. Fail-closed**: unknown maturity/reason/state/control values refuse
  with typed errors; missing weight-diagnostics validity restricts claims
  rather than relaxing estimators (§68.10); an unevaluable control fails the
  harness rather than passing silently.
- **IX. Provider abstraction**: evaluation touches providers only through the
  frozen replay surface; live network is denied for decision-quality runs
  (§31.5).
- **X. Requirement traceability**: every task cites FR-MAT-*/FR-EVAL-* or
  their ACs; no invented IDs.
- **XI/XII. Deterministic + failure-path verification**: every AC gets
  positive AND negative proof at the manifest paths; determinism is proven by
  byte-identical rerun tests (no AI self-assessment).
- **XIII. Idempotency**: maturity transitions, sampling assignments,
  experiment registrations, and incident records are idempotent under retry,
  keyed by natural identity (candidate × profile × horizon × scenario ×
  policy version).
- **XIV. Durable operations**: evaluation runs are frozen manifests on
  disk/database; a fresh context resumes from persisted run state, never
  conversational memory.
- **XV/XVI/XVII/XVIII**: least privilege (CLI has no auth surfaces); agent
  decisions recorded as ADRs below; additive git history; completion is the
  deterministic gate + `pnpm verify`/`pnpm spec:verify`, never an AI claim.

## Data model (SQL truth under `migrations/`, families `mat` + `eval`)

### `g1_mat_0001_maturity_ledger.sql`

```text
CREATE TABLE outcome_maturity_states (            -- FR-MAT-001, §12.8/§68.1
  state_id              text PRIMARY KEY,
  candidate_id          text NOT NULL CHECK (length(candidate_id) > 0),
  outcome_profile_version text NOT NULL,           -- §8.3 profile id@version
  horizon               text NOT NULL CHECK (horizon IN (
                          '24H','7D','TARGET_EVENT','EXIT_POLICY')),
  execution_scenario_id text NOT NULL,            -- exec-owned scenario ref
  execution_scenario_version text NOT NULL,
  maturity              text NOT NULL CHECK (maturity IN (
                          'PENDING','PARTIALLY_MATURED','FULLY_MATURED',
                          'CENSORED','INVALID_DATA')),   -- domain OutcomeMaturity
  censor_reason         text CHECK (censor_reason IN (
                          'RIGHTS_DRIVEN_DELETION','PERMANENT_IDENTITY_AMBIGUITY',
                          'UNRECOVERABLE_OBSERVATION_GAP',
                          'UNSUPPORTED_HISTORICAL_POOL_STATE',
                          'CHAIN_ARCHIVE_UNAVAILABLE')),
  invalid_reason        text CHECK (invalid_reason IN (
                          'CORRUPTED_SAMPLING_ASSIGNMENT','IMPOSSIBLE_TIME_ORDER',
                          'FAILED_POOL_PARITY','UNRESOLVABLE_DECIMALS',
                          'UNESTABLISHABLE_AVAILABILITY')),
  maturity_basis        jsonb NOT NULL,           -- horizon completion + required
                          -- outcome/security/liquidity/pool-state observations
  last_evaluated_at     timestamptz NOT NULL,
  evaluation_run_id     text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, outcome_profile_version, horizon,
          execution_scenario_id, execution_scenario_version),
  -- §12.8 no-reset law: an append-only ledger; regressions are refused.
  CONSTRAINT mat_maturity_reason_required CHECK (
      maturity NOT IN ('CENSORED') OR censor_reason IS NOT NULL),
  CONSTRAINT mat_invalid_reason_required CHECK (
      maturity <> 'INVALID_DATA' OR invalid_reason IS NOT NULL),
  CONSTRAINT mat_censor_invalid_exclusive CHECK (
      NOT (censor_reason IS NOT NULL AND invalid_reason IS NOT NULL)),
  CONSTRAINT mat_pending_has_no_terminal_reason CHECK (
      maturity IN ('PENDING','PARTIALLY_MATURED')
      OR (censor_reason IS NULL AND invalid_reason IS NULL)
      OR maturity IN ('CENSORED','INVALID_DATA'))
);
-- append-only: BEFORE UPDATE OR DELETE → raise (§12.8: deployment/retry/
-- outage/policy changes never reset maturity; corrections are new rows
-- referencing the prior state via maturity_transitions).

CREATE TABLE maturity_transitions (               -- FR-MAT-001 audit chain
  transition_id         text PRIMARY KEY,
  state_id              text NOT NULL REFERENCES outcome_maturity_states(state_id),
  from_maturity         text,   -- NULL for the initial observation
  to_maturity           text NOT NULL CHECK (to_maturity IN (
                          'PENDING','PARTIALLY_MATURED','FULLY_MATURED',
                          'CENSORED','INVALID_DATA')),
  transitioned_at       timestamptz NOT NULL,
  cause                 text NOT NULL CHECK (cause IN (
                          'HORIZON_COMPLETED','OBSERVATION_REQUIRED_ADDED',
                          'CENSORING_EVENT','INVALID_DATA_EVENT',
                          'EVALUATION_RUN')),
  run_id                text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- monotone maturity progression only (no downgrade to PENDING);
  -- CENSORED/INVALID_DATA are absorbing states.
  CONSTRAINT mat_transition_no_reset CHECK (
      to_maturity NOT IN ('PENDING')),
  CONSTRAINT mat_transition_absorbing CHECK (
      from_maturity NOT IN ('CENSORED','INVALID_DATA')
      OR from_maturity = to_maturity)
);

CREATE TABLE outcome_denominator_disclosures (    -- FR-MAT-010, §68.2
  disclosure_id         text PRIMARY KEY,
  evaluation_run_id     text NOT NULL,
  outcome_profile_version text NOT NULL,
  report_scope          text NOT NULL CHECK (report_scope IN (
                          'PRECISION','FAILURE','CALIBRATION','EXPECTANCY',
                          'UTILITY','PROMOTION')),
  fully_matured_count   integer NOT NULL CHECK (fully_matured_count >= 0),
  pending_count         integer NOT NULL CHECK (pending_count >= 0),
  partially_matured_count integer NOT NULL CHECK (partially_matured_count >= 0),
  censored_count        integer NOT NULL CHECK (censored_count >= 0),
  invalid_count         integer NOT NULL CHECK (invalid_count >= 0),
  low_resolution_count  integer NOT NULL CHECK (low_resolution_count >= 0),
  rights_blocked_count  integer NOT NULL CHECK (rights_blocked_count >= 0),
  unobserved_count      integer NOT NULL CHECK (unobserved_count >= 0),
  signal_only_count     integer NOT NULL CHECK (signal_only_count >= 0),
  observation_collection_scope text NOT NULL,      -- the declared universe
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- INV-012/AC-123/AC-239: final denominators are exactly the matured rows.
  CONSTRAINT mat_denominator_is_matured CHECK (
      fully_matured_count > 0 OR report_scope = 'CALIBRATION')
);
-- append-only.

CREATE TABLE subjective_utility_records (         -- FR-MAT-006, §68.9
  utility_record_id     text PRIMARY KEY,
  candidate_id          text NOT NULL CHECK (length(candidate_id) > 0),
  label_family          text NOT NULL CHECK (label_family IN (
                          'SUBJECTIVE_USER_UTILITY','HUMAN_EXPERT_JUDGMENT')),
  recorded_at           timestamptz NOT NULL,
  utility_payload       jsonb NOT NULL CHECK (jsonb_typeof(utility_payload) = 'object'),
  schema_registry_version integer NOT NULL CHECK (schema_registry_version = 1),
  created_at            timestamptz NOT NULL DEFAULT now()
);
-- append-only; structurally separate table = storage separation (§68.9:
-- objective families live in exec-owned execution_simulations + eval-owned
-- evaluation outputs; subjective families live HERE; no FK between them).

CREATE TABLE outcome_sampling_strata (            -- FR-MAT-007, §31.8/§68.10
  stratum_id            text NOT NULL,
  stratum_version       text NOT NULL,
  outcome_profile_version text NOT NULL,
  dimensions            jsonb NOT NULL,           -- rank, rejection reason,
                          -- source, launchpad, age, regime, profile, coverage
  sampling_frame_scope  text NOT NULL,            -- named §7.8 population
  registered_at         timestamptz NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (stratum_id, stratum_version)
);

CREATE TABLE outcome_sampling_assignments (       -- FR-MAT-007, §68.10
  assignment_id         text PRIMARY KEY,
  stratum_id            text NOT NULL,
  stratum_version       text NOT NULL,
  candidate_id          text NOT NULL CHECK (length(candidate_id) > 0),
  inclusion_probability double precision NOT NULL CHECK (
                          inclusion_probability > 0 AND inclusion_probability <= 1),
  selection_time        timestamptz NOT NULL,
  selection_reason      text NOT NULL CHECK (length(selection_reason) > 0),
  seed_provenance       text NOT NULL CHECK (seed_provenance NOT LIKE 'raw:%'),
  observation_plan_ref  text,                     -- exec outcome_observation_plans
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, stratum_id, stratum_version),
  FOREIGN KEY (stratum_id, stratum_version)
    REFERENCES outcome_sampling_strata(stratum_id, stratum_version),
  -- AC-243 law: assignment recorded BEFORE outcome maturity is evaluated.
  CONSTRAINT mat_sampling_assignment_ordered CHECK (selection_time >= '1970-01-01')
);
-- append-only.
```

### `g1_mat_0002_promotion_evidence.sql`

```text
CREATE TABLE promotion_evidence_records (         -- FR-MAT-008/009/011/012
  evidence_id           text PRIMARY KEY,
  candidate_id          text NOT NULL CHECK (length(candidate_id) > 0),
  outcome_profile_version text NOT NULL,
  tradable_success_claimed boolean NOT NULL,
  -- FR-MAT-008: exact-configuration maturity requirement.
  required_notional_usd text NOT NULL CHECK (
                          required_notional_usd ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
  required_delay_policy_id text NOT NULL,
  required_adapter_id   text NOT NULL,
  required_route_id     text NOT NULL,
  required_exit_policy_id text NOT NULL,
  evidence_resolution   text NOT NULL CHECK (evidence_resolution IN (
                          'FULLY_MATURED_HIGH_RESOLUTION','COARSE_SIGNAL_ONLY',
                          'INSUFFICIENT')),
  coarse_only_refusal_reason text,
  -- FR-MAT-009: adverse ordering primacy + ambiguity disclosure.
  primary_ordering      text NOT NULL CHECK (primary_ordering IN (
                          'ADVERSE_FEASIBLE','UNAMBIGUOUS')),
  path_ambiguous        boolean NOT NULL,
  optimistic_sensitivity jsonb,                    -- secondary analysis only
  -- FR-MAT-011: time-stamped expiry/cancellation/invalidation side effects.
  expiry_side_effect    text CHECK (expiry_side_effect IN (
                          'ALERT_EXPIRED','ALERT_CANCELLED','THESIS_INVALIDATED')),
  side_effect_at        timestamptz,
  post_expiry_gain_excluded boolean NOT NULL DEFAULT false,
  -- FR-MAT-012: capacity disclosure.
  maximum_executable_notional_usd text CHECK (
                          maximum_executable_notional_usd IS NULL
                          OR maximum_executable_notional_usd ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
  deployable_portfolio_capacity_usd text CHECK (
                          deployable_portfolio_capacity_usd IS NULL
                          OR deployable_portfolio_capacity_usd ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
  capacity_generalization_refused boolean NOT NULL DEFAULT false,
  evaluation_run_id     text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mat_promotion_requires_mature_hr CHECK (
      tradable_success_claimed = false OR (
        evidence_resolution = 'FULLY_MATURED_HIGH_RESOLUTION'
        AND primary_ordering IS NOT NULL)),
  -- FR-MAT-009: ambiguity must be disclosed, never silently resolved
  -- optimistically; optimistic sensitivity without adverse primary refused.
  CONSTRAINT mat_optimistic_requires_adverse CHECK (
      (optimistic_sensitivity IS NULL)
      OR (primary_ordering = 'ADVERSE_FEASIBLE' AND path_ambiguous = true)),
  CONSTRAINT mat_coarse_cannot_promote CHECK (
      evidence_resolution <> 'COARSE_SIGNAL_ONLY' OR tradable_success_claimed = false),
  CONSTRAINT mat_expiry_side_effect_timestamped CHECK (
      expiry_side_effect IS NULL OR side_effect_at IS NOT NULL),
  CONSTRAINT mat_capacity_disclosure_pair CHECK (
      (maximum_executable_notional_usd IS NULL) =
      (deployable_portfolio_capacity_usd IS NULL))
);
-- append-only.
```

### `g1_eval_0001_profiles_datasets_registry.sql`

```text
CREATE TABLE outcome_profiles (                   -- FR-EVAL-001, §8.3 shape
  profile_id            text NOT NULL,
  version               text NOT NULL,
  population_scope      text NOT NULL CHECK (population_scope IN (
                          'SUPPORTED_PROGRAM_UNIVERSE','PROSPECTIVELY_OBSERVED_UNIVERSE',
                          'AGGREGATE_PROVIDER_UNIVERSE','AUTHORIZED_LAUNCH_UNIVERSE',
                          'STRATIFIED_SAMPLED_UNIVERSE','CURRENTLY_OBSERVED_SUBSET_ONLY')),
  eligibility           jsonb NOT NULL,
  signal_success        jsonb NOT NULL,
  tradable_success      jsonb NOT NULL,
  tradable_failure      jsonb NOT NULL,
  neutral_definition    text NOT NULL CHECK (neutral_definition = 'FULLY_MATURED_AND_NO_SUCCESS_OR_FAILURE'),
  required_stress_pass_matrix jsonb NOT NULL,     -- exec scenario kind × requirement
  resolution_floor      jsonb NOT NULL,           -- §64.14-consumed resolution law
  registered_at         timestamptz NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, version),
  -- profiles are immutable once registered; a change is a NEW version.
  CONSTRAINT eval_profile_identity UNIQUE (profile_id, version)
);
-- append-only.

CREATE TABLE evaluation_datasets (                -- §31.2 partitions
  dataset_id            text PRIMARY KEY,
  population_claim      text NOT NULL,            -- §7.8 vocabulary + manifest ref
  population_manifest_ref text NOT NULL,
  candidate_universe_hash text NOT NULL CHECK (candidate_universe_hash LIKE 'sha256:%'),
  observation_cutoff    timestamptz NOT NULL,
  partition             text NOT NULL CHECK (partition IN (
                          'TRAIN','CALIBRATION','VALIDATION','FINAL_HOLDOUT',
                          'LIVE_SHADOW','FORWARD_CONFIRMATION')),
  holdout_exposure      text NOT NULL CHECK (holdout_exposure IN (
                          'UNEXPOSED','METRIC_ONLY_EXPOSED','OWNER_REVIEWED',
                          'TUNING_EXPOSED','EXHAUSTED')),
  embargo_bounds        jsonb NOT NULL,           -- purge/embargo windows
  leakage_group_keys    text[] NOT NULL,          -- asset, deployer, funding,
                          -- wallet entity, launchpad, narrative, pool, source, time block
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- FINAL_HOLDOUT promotion evidence requires UNEXPOSED before the registered
  -- evaluation (§31.2).
  CONSTRAINT eval_holdout_frozen CHECK (
      partition <> 'FINAL_HOLDOUT' OR holdout_exposure IN ('UNEXPOSED','METRIC_ONLY_EXPOSED'))
);
-- append-only.

CREATE TABLE evaluation_experiments (             -- FR-EVAL-009, §31.3
  experiment_id         text PRIMARY KEY,
  hypothesis            text NOT NULL CHECK (length(hypothesis) > 0),
  primary_metric        text NOT NULL,
  hard_constraints       jsonb NOT NULL,
  candidate_population  text NOT NULL,
  profile_regime_execution_scope jsonb NOT NULL,
  champion_version      text NOT NULL,
  challenger_version    text,
  preprocessing_features jsonb NOT NULL,
  sample_size_power_target jsonb NOT NULL,
  cluster_definition    text NOT NULL,
  multiple_testing_family text NOT NULL CHECK (multiple_testing_family IN (
                          'FDR_BENJAMINI_HOCHBERG','FDR_BENJAMINI_YEKUTIELI',
                          'FAMILY_WISE_BONFERRONI','FAMILY_WISE_HOLM',
                          'HIERARCHICAL_TREE','RANDOMIZATION_INFERENCE',
                          'SEQUENTIAL_ALPHA_SPENDING','NONE_EXPLORATORY_ONLY')),
  statistical_method    text NOT NULL,
  stopping_rule         text NOT NULL,
  registered_at         timestamptz NOT NULL,
  dataset_id            text NOT NULL REFERENCES evaluation_datasets(dataset_id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- pre-registration law: registered BEFORE results are computed.
  CONSTRAINT eval_experiment_pre_registered CHECK (registered_at IS NOT NULL)
);
-- append-only.
```

### `g1_eval_0002_runs_metrics_controls.sql`

```text
CREATE TABLE evaluation_runs (                    -- FR-EVAL-002, §31.5
  run_id                text PRIMARY KEY,
  experiment_id         text,                     -- NULL for exploratory runs
  dataset_id            text NOT NULL REFERENCES evaluation_datasets(dataset_id),
  replay_kind           text NOT NULL CHECK (replay_kind IN (
                          'BACKTEST','CROSS_FIT','FORWARD_SHADOW','LIVE_SHADOW',
                          'ACTIVE_PRODUCTION')),  -- separate artifact classes
  network_access        text NOT NULL CHECK (network_access IN ('DENIED','REGISTERED_ONLY')),
  as_of                 timestamptz NOT NULL,
  dataset_version       text NOT NULL,
  population_claim      text NOT NULL,
  observation_cutoff    timestamptz NOT NULL,
  collector_coverage_manifest_id text,
  provider_dependence_version text NOT NULL,
  feature_version       text NOT NULL,
  ranking_version       text NOT NULL,
  workflow_version      text NOT NULL,
  prompt_version        text,                     -- NULL: no model surface in G1
  tool_profile_version  text NOT NULL,
  model_profile_version text,
  outcome_profile_version text NOT NULL,
  policy_version        text NOT NULL,
  delivery_latency_policy_version text NOT NULL,
  capacity_contract_version text NOT NULL,
  pool_math_adapter_versions text[] NOT NULL,
  execution_scenario_versions text[] NOT NULL,
  artifact_ids          text[] NOT NULL,
  holdout_exposure_snapshot_id text NOT NULL,
  code_and_dependency_hash text NOT NULL CHECK (code_and_dependency_hash LIKE 'sha256:%'),
  exec_replay_manifest_id text,                   -- proven exec replay manifest
  created_at            timestamptz NOT NULL DEFAULT now()
);
-- append-only.

CREATE TABLE evaluation_metric_results (          -- FR-EVAL-003, §31.6
  result_id             text PRIMARY KEY,
  run_id                text NOT NULL REFERENCES evaluation_runs(run_id),
  metric_kind           text NOT NULL CHECK (metric_kind IN (
                          'NET_PNL','EXPECTANCY','PROFIT_FACTOR','DRAWDOWN','CVAR',
                          'CAPITAL_UTILIZATION','TURNOVER','CONCENTRATION',
                          'OPPORTUNITY_COST','PRECISION_AT_K','RECALL_ELIGIBLE_GEMS',
                          'NDCG_AT_K','FALSE_DISCOVERY_RATE','FALSE_REJECTION_RATE',
                          'MEDIAN_RANK_SUCCESS','MEDIAN_ACTIONABLE_LEAD_TIME',
                          'MFE','MAE','TARGET_DURATION','LIQUIDITY_SURVIVAL',
                          'SECURITY_SURVIVAL','TRADABLE_SUCCESS_BY_NOTIONAL',
                          'TRADABLE_SUCCESS_BY_DELAY_SCENARIO','FILL_EXIT_SURVIVAL',
                          'PARTIAL_FILL_RATE','SIGNAL_TRADABLE_DIVERGENCE',
                          'OUTCOME_MATURITY_RATE','CENSORING_RATE','INVALID_DATA_RATE',
                          'EXECUTABLE_TARGET_FALSE_POSITIVE_RATE',
                          'COST_PER_RESEARCHED_CANDIDATE','COST_PER_USEFUL_CANDIDATE',
                          'SAMPLE_COVERAGE','EFFECTIVE_SAMPLE_SIZE','WEIGHT_STABILITY')),
  metric_value          text NOT NULL CHECK (    -- decimal-string, never float
                          metric_value ~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$'),
  k_parameter           integer,
  maturity_scope        text NOT NULL CHECK (maturity_scope IN (
                          'FINAL_MATURED_ONLY','PROVISIONAL')),
  denominator_disclosure_id text NOT NULL,       -- mat-owned disclosure FK-law
  computed_at           timestamptz NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- §68.2: FINAL metrics only over matured denominators; provisional runs
  -- must be labeled separately.
  CONSTRAINT eval_final_requires_matured CHECK (
      maturity_scope = 'PROVISIONAL' OR metric_kind NOT LIKE 'OUTCOME_%'
      OR maturity_scope = 'FINAL_MATURED_ONLY')
);
-- append-only.

CREATE TABLE clustered_interval_runs (            -- FR-MAT-005, §68.6
  interval_run_id       text PRIMARY KEY,
  run_id                text NOT NULL REFERENCES evaluation_runs(run_id),
  metric_kind           text NOT NULL,
  point_estimate        text NOT NULL CHECK (point_estimate ~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$'),
  interval_low          text NOT NULL,
  interval_high         text NOT NULL,
  confidence_level      double precision NOT NULL CHECK (confidence_level BETWEEN 0 AND 1),
  interval_method       text NOT NULL CHECK (interval_method IN (
                          'CLUSTER_BOOTSTRAP','BLOCK_BOOTSTRAP_CALENDAR',
                          'BLOCK_BOOTSTRAP_REGIME','RANDOMIZATION_INFERENCE')),
  cluster_definition    text NOT NULL CHECK (cluster_definition IN (
                          'CALENDAR_BLOCK','DEPLOYER_CLUSTER','FUNDING_CLUSTER',
                          'WALLET_ENTITY','LAUNCHPAD','NARRATIVE','POOL',
                          'SOURCE_DEPENDENCE_GROUP','REGIME')),
  naive_sample_size     integer NOT NULL CHECK (naive_sample_size > 0),
  cluster_count         integer NOT NULL CHECK (cluster_count > 0),
  effective_sample_size double precision NOT NULL CHECK (effective_sample_size > 0),
  alternate_cluster_sensitivity jsonb NOT NULL,   -- per alternate clustering
  ess_gate_passed       boolean NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eval_interval_order CHECK (interval_low <= interval_high)
);
-- append-only.

CREATE TABLE negative_control_runs (              -- FR-MAT-004, §68.5
  control_run_id        text PRIMARY KEY,
  run_id                text NOT NULL REFERENCES evaluation_runs(run_id),
  control_kind          text NOT NULL CHECK (control_kind IN (
                          'LABEL_PERMUTATION','FEATURE_TIMESTAMP_SHIFT',
                          'DELAYED_PROVIDER_PLACEBO','BACKFILLED_AVAILABILITY_PLACEBO',
                          'SYNTHETIC_NULL_FEATURES','FORBIDDEN_FUTURE_COLUMN_SCAN',
                          'OVERLAPPING_WINDOW_LEAKAGE_SCAN','SAME_ENTITY_LEAKAGE_SCAN',
                          'PROVIDER_ID_ONLY_PREDICTOR','RANDOM_MODEL_OUTPUT_CONTROL',
                          'OUTCOME_PERMUTATION','AVAILABILITY_BACKDATING_PLACEBO',
                          'DELAYED_DELIVERY_PLACEBO','SYNTHETIC_NOISE')),
  control_seed          text NOT NULL CHECK (control_seed NOT LIKE 'raw:%'),
  observed_lift         text NOT NULL,
  material_lift_threshold text NOT NULL,
  unexpected_material_lift boolean NOT NULL,
  incident_created      boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- §68.5/§68.12: unexpected lift blocks promotion and opens an incident.
  CONSTRAINT eval_lift_incident_law CHECK (
      unexpected_material_lift = false OR incident_created = true)
);
-- append-only.

CREATE TABLE evaluation_incidents (               -- §68.12
  incident_id           text PRIMARY KEY,
  run_id                text NOT NULL REFERENCES evaluation_runs(run_id),
  trigger_kind          text NOT NULL CHECK (trigger_kind IN (
                          'LEAKAGE_CONTROL_FAILURE','EXHAUSTED_HOLDOUT_REUSED',
                          'INVALID_SAMPLING_PROPENSITY','MULTIPLE_TESTING_MISMATCH',
                          'CLUSTER_ESS_BELOW_GATE','ACTION_TIME_ASYMMETRY',
                          'POOL_ADAPTER_PARITY_INVALIDATED_OUTCOMES',
                          'POPULATION_CLAIM_EXCEEDS_SUPPORT',
                          'UNEXPLAINED_CHALLENGER_DIVERGENCE')),
  affected_scope        jsonb NOT NULL,
  influence_paused      boolean NOT NULL DEFAULT true,
  detected_at           timestamptz NOT NULL,
  resolved_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);
-- append-only.
```

### `g1_eval_0003_baseline_missed_controls.sql`

```text
CREATE TABLE baseline_results (                   -- FR-EVAL-004, §31.7
  baseline_result_id    text PRIMARY KEY,
  run_id                text NOT NULL REFERENCES evaluation_runs(run_id),
  baseline_kind         text NOT NULL CHECK (baseline_kind IN (
                          'RANDOM_ELIGIBLE_CANDIDATE','PROVIDER_TRENDING_RANK',
                          'FIRST_PARTY_EVENT_RECENCY_RANK','NEW_POOL_RANK',
                          'LIQUIDITY_VOLUME_HEURISTIC','HOLDER_BUYER_GROWTH_HEURISTIC',
                          'SECURITY_EXECUTION_HARD_GATE','MARKET_ONLY_DETERMINISTIC_RANK',
                          'PARETO_LEXICOGRAPHIC_DETERMINISTIC_RANK','OWNER_MANUAL_SHORTLIST')),
  metric_snapshot       jsonb NOT NULL,
  is_promotion_comparator boolean NOT NULL,
  frozen_universe_matches_champion boolean NOT NULL,
  data_cutoff           timestamptz NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- AC-042/§31.7: the comparator must share the champion's frozen universe
  -- and cutoff; a weak-baseline selection is a recorded, reviewable fact.
  CONSTRAINT eval_comparator_universe_match CHECK (
      is_promotion_comparator = false OR frozen_universe_matches_champion = true)
);
-- append-only.

CREATE TABLE missed_opportunities (               -- FR-EVAL-005, §31.10/§31.11
  missed_id             text PRIMARY KEY,
  candidate_id          text NOT NULL CHECK (length(candidate_id) > 0),
  outcome_profile_version text NOT NULL,
  measured_universe_ref text NOT NULL,            -- named population manifest
  discovered            boolean NOT NULL,
  first_source_id       text,
  first_system_availability timestamptz,
  funnel_exit_stage     text,                     -- sig funnel-stage vocabulary
  evidence_exit_state   text,                     -- acquisition-state vocabulary
  miss_classification   text NOT NULL CHECK (miss_classification IN (
                          'NOT_IN_CLAIMED_UNIVERSE','NOT_DISCOVERED','COLLECTOR_FILTER_MISS',
                          'COLLECTOR_GAP','PROVIDER_LATE','IDENTITY_FAILURE','DATA_STALE',
                          'DATA_MISSING','EVIDENCE_NOT_REQUESTED','EVIDENCE_COST_BLOCKED',
                          'EVIDENCE_QUOTA_BLOCKED','CAPABILITY_UNAVAILABLE',
                          'ELIGIBILITY_FALSE_NEGATIVE','SECURITY_FALSE_POSITIVE',
                          'MANIPULATION_MISSED','WALLET_CLUSTER_MISSED',
                          'SOURCE_INDEPENDENCE_OVERESTIMATED','RANK_BELOW_CUTOFF',
                          'DIVERSITY_EXCLUDED','BUDGET_EXHAUSTED','TOOL_SELECTION_ERROR',
                          'MODEL_REASONING_ERROR','UNSUPPORTED_CLAIM','POLICY_TOO_STRICT',
                          'POLICY_TOO_LOOSE','ALERT_TOO_LATE','EXECUTION_MODEL_ERROR',
                          'POOL_ADAPTER_UNSUPPORTED','QUOTE_PARITY_FAILURE',
                          'OUTCOME_UNOBSERVED','OUTCOME_LOW_RESOLUTION',
                          'SAMPLING_WEIGHT_INVALID','ACTION_TIME_ASYMMETRY',
                          'MARKET_REGIME_SHIFT')),
  delay_breakdown       jsonb NOT NULL,           -- collector/provider/system/
                          -- workflow/agent/policy/delivery delay decomposition
  counterfactual_action_at timestamptz NOT NULL,  -- symmetric T_actionable
  frozen_evidence_refs  text[] NOT NULL,
  next_evaluation_dataset_id text,                -- step 8: next dataset, never
                          -- contaminating the current holdout
  created_at            timestamptz NOT NULL DEFAULT now()
);
-- append-only.

CREATE TABLE champion_challenger_comparisons (    -- FR-EVAL-007, §31.12
  comparison_id         text PRIMARY KEY,
  run_id                text NOT NULL REFERENCES evaluation_runs(run_id),
  champion_version      text NOT NULL,
  challenger_version    text NOT NULL,
  same_candidate_stream boolean NOT NULL,
  same_frozen_availability boolean NOT NULL,
  budgets_equalized     boolean NOT NULL CHECK (budgets_equalized = true),
  challenger_external_side_effects integer NOT NULL CHECK (
                          challenger_external_side_effects = 0),
  model_removed_baseline_compared boolean NOT NULL,
  promotion_constraints_met boolean NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- §31.12 structural laws at the persistence layer.
  CONSTRAINT eval_challenger_no_side_effects CHECK (challenger_external_side_effects = 0),
  CONSTRAINT eval_budgets_equalized CHECK (budgets_equalized = true)
);
-- append-only.

CREATE TABLE drift_calibration_controls (         -- FR-EVAL-008
  control_id            text PRIMARY KEY,
  run_id                text NOT NULL REFERENCES evaluation_runs(run_id),
  control_kind          text NOT NULL CHECK (control_kind IN (
                          'CALIBRATION_DRIFT','REGIME_DRIFT','POPULATION_DRIFT',
                          'COVERAGE_DRIFT','FEATURE_DISTRIBUTION_DRIFT')),
  measured_at           timestamptz NOT NULL,
  drift_metric_value    text NOT NULL,
  drift_threshold       text NOT NULL,
  drift_detected        boolean NOT NULL,
  automatic_degradation_triggered boolean NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- AC-154 completion law: detected calibration/regime drift degrades the
  -- expected-net-utility ranking automatically.
  CONSTRAINT eval_drift_degrades CHECK (
      drift_detected = false OR automatic_degradation_triggered = true)
);
-- append-only.

CREATE TABLE selection_bias_diagnostics (         -- FR-EVAL-009, §31.9/§68.10
  diagnostic_id         text PRIMARY KEY,
  run_id                text NOT NULL REFERENCES evaluation_runs(run_id),
  diagnostic_kind       text NOT NULL CHECK (diagnostic_kind IN (
                          'EVIDENCE_ACQUISITION_PROPENSITY','OUTCOME_SAMPLING_PROPENSITY',
                          'POSITIVITY_CHECK','OVERLAP_CHECK','WEIGHT_STABILITY_CHECK',
                          'WEIGHT_DIAGNOSTICS_SUMMARY','RESTRICTED_CLAIM_RECORD')),
  probe_sample_used     boolean NOT NULL,
  max_weight_observed   double precision CHECK (max_weight_observed IS NULL
                          OR max_weight_observed <= 20),   -- G.11 ceiling
  weighting_valid       boolean,
  claim_restriction     text CHECK (claim_restriction IN (
                          'NONE','RESTRICT_TO_OBSERVED_SUBSET','RESTRICT_TO_WEIGHTED_STRATA')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- §68.10: weighting only with valid diagnostics; otherwise restrict.
  CONSTRAINT eval_weighting_requires_diagnostics CHECK (
      weighting_valid = false OR weighting_valid IS NULL
      OR claim_restriction IS NOT NULL)
);
-- append-only.
```

## Module layout (inside writeScopes)

```text
packages/domain/src/mat.ts        OutcomeLabelFamily (5 §68.9 families),
                                  CensorReason (5 §68.3 members), InvalidReason
                                  (5), DenominatorDisclosureClass (9:
                                  PENDING, PARTIALLY_MATURED, CENSORED,
                                  INVALID_DATA, LOW_RESOLUTION, RIGHTS_BLOCKED,
                                  UNOBSERVED, SIGNAL_ONLY, FULLY_MATURED),
                                  ExpirySideEffect (3), EvidenceResolution
                                  (FULLY_MATURED_HIGH_RESOLUTION,
                                  COARSE_SIGNAL_ONLY, INSUFFICIENT),
                                  Horizon (24H, 7D, TARGET_EVENT, EXIT_POLICY),
                                  MatErrorCode block; pure laws:
                                  maturityNeverResets (transition monotonicity),
                                  censorNeverBecomesFailure (§68.3 truth table),
                                  subjectiveCannotAlterObjective (§68.9),
                                  adverseOrderingPrimacy (FR-MAT-009),
                                  postExpiryGainsExcluded (FR-MAT-011),
                                  promotionRequiresExactMatureEvidence
                                  (FR-MAT-008), capacityDisclosureRequired
                                  (FR-MAT-012)
packages/domain/src/eval.ts       DatasetPartition (6 §31.2), HoldoutExposure
                                  (5), ReplayKind (5 §31.4-artifact classes),
                                  MultipleTestingFamily (8), ControlKind (14
                                  §68.5/§31.13), IncidentTrigger (9 §68.12),
                                  MissClassification (34 §31.11), BaselineKind
                                  (10 §31.7), IntervalMethod (4),
                                  ClusterDefinition (9 §68.6),
                                  DriftControlKind (5), ClaimRestriction (3),
                                  EvalErrorCode block; pure laws:
                                  universalActionTime (§31.4 T_delivery/
                                  T_actionable formula), identicalComparison
                                  semantics (AC-042), holdoutExposureGuards
                                  (§31.2), weightingRequiresDiagnostics
                                  (§68.10), populationClaimSupported (§68.4),
                                  materialLiftDetector (§68.5 threshold law),
                                  essGate (§68.6 low-ESS blocks), horizonPurge
                                  (§31.2 purge/embargo overlap)
packages/shared-schemas/src/mat.ts  Zod: OutcomeMaturityStateSchema,
                                  MaturityTransitionSchema,
                                  DenominatorDisclosureSchema,
                                  SubjectiveUtilityRecordSchema,
                                  OutcomeSamplingStratumSchema,
                                  OutcomeSamplingAssignmentSchema,
                                  PromotionEvidenceRecordSchema — importing
                                  domain enums, .strict(), ISO-8601 Z
                                  timestamps, sha256:<hex> refs,
                                  decimal-string money law,
                                  MAT_SCHEMA_REGISTRY_VERSION = 1
packages/shared-schemas/src/eval.ts Zod: OutcomeProfileSchema,
                                  EvaluationDatasetSchema,
                                  EvaluationExperimentSchema,
                                  EvaluationRunSchema (§31.5 field set),
                                  EvaluationMetricResultSchema,
                                  ClusteredIntervalRunSchema,
                                  NegativeControlRunSchema,
                                  EvaluationIncidentSchema,
                                  BaselineResultSchema,
                                  MissedOpportunitySchema,
                                  ChampionChallengerComparisonSchema,
                                  DriftCalibrationControlSchema,
                                  SelectionBiasDiagnosticSchema — importing
                                  domain enums, .strict(),
                                  EVAL_SCHEMA_REGISTRY_VERSION = 1
packages/outcome-maturity/src/    maturity-ledger.ts (maturity resolution per
                                  profile/horizon/scenario over exec simulation
                                  + observation records; no-reset transition
                                  law; absorbing censor/invalid states),
                                  denominators.ts (§68.2 final-denominator
                                  composition + FR-MAT-010 disclosure
                                  assembly; refusal on undisclosed classes),
                                  label-separation.ts (§68.9 storage/query
                                  separation; subjective joins refused from
                                  objective paths), sampling.ts (§31.8
                                  stratified assignment admission with
                                  probability/stratum/seed provenance;
                                  Horvitz–Thompson estimator with positivity/
                                  overlap/weight-stability diagnostics and
                                  G.11 weight ceiling; restricted-claim
                                  fallback), promotion-evidence.ts
                                  (FR-MAT-008 exact-configuration matching over
                                  exec scenario identity; FR-MAT-009 ordering
                                  primacy; FR-MAT-011 expiry side effects;
                                  FR-MAT-012 capacity disclosure), index.ts
packages/evaluation/src/          profiles.ts (FR-EVAL-001 versioned profile
                                  registry, immutable versions),
                                  frozen-replay.ts (FR-EVAL-002 replay runner:
                                  §31.5 manifest freeze, network denial,
                                  visibleAt resolution, byte-identical rerun),
                                  action-time.ts (§31.4 universal function over
                                  candidate_decision_timelines + delay
                                  scenarios; symmetric across all arms —
                                  AC-240), metrics.ts (FR-EVAL-003 §31.6
                                  metric suite; precision/recall/NDCG/rank/
                                  lead-time/risk/cost; maturity-scope
                                  enforcement), baselines.ts (FR-EVAL-004
                                  §31.7 baseline set + comparator selection),
                                  missed-opportunity.ts (FR-EVAL-005 §31.10
                                  steps 1–8 + §31.11 taxonomy),
                                  exploration.ts (FR-EVAL-006 retention + AC-043),
                                  champion-challenger.ts (FR-EVAL-007 §31.12
                                  comparison with equalized budgets),
                                  drift-calibration.ts (FR-EVAL-008 + AC-154
                                  calibration degradation machinery),
                                  experiments.ts (FR-EVAL-009 §31.3 registry,
                                  §31.13 correction procedures, §31.14 power
                                  plans, §68.7 sequential rules),
                                  selection-bias.ts (§31.9 diagnostics over
                                  probe_assignments + sampling propensities),
                                  controls.ts (FR-MAT-004 §68.5 harness with
                                  seeded permutations/placebos/scans),
                                  intervals.ts (FR-MAT-005 §68.6 cluster/block
                                  bootstrap + ESS + sensitivity),
                                  incident.ts (§68.12 trigger law),
                                  read-only-guard.ts (INV-001 structural
                                  assertions + no-model-import test seam),
                                  index.ts
packages/eval-cli/src/            cli.ts (command surface: maturity-sweep,
                                  dataset-build, replay-run, metric-report,
                                  baseline-compare, missed-scan, controls-run,
                                  compare-challenger), report.ts (JSON report
                                  assembly incl. denominator disclosures),
                                  exit-codes.ts, index.ts; bin entry in
                                  package.json; consumes ONLY the two packages'
                                  exported APIs
migrations/g1_mat_0001_maturity_ledger.sql
migrations/g1_mat_0002_promotion_evidence.sql
migrations/g1_eval_0001_profiles_datasets_registry.sql
migrations/g1_eval_0002_runs_metrics_controls.sql
migrations/g1_eval_0003_baseline_missed_controls.sql
tests/fixtures/mat/maturity-vectors.ts, sampling-vectors.ts,
                                  promotion-evidence-vectors.ts,
                                  denominator-vectors.ts
tests/fixtures/eval/profiles.ts, datasets.ts, metrics-vectors.ts,
                                  baselines.ts, missed-opportunities.ts,
                                  controls-vectors.ts, intervals-vectors.ts
telemetry/mat.catalog.json        mat.maturity_resolved, mat.transition_recorded,
                                  mat.denominator_disclosed, mat.sampling_assigned,
                                  mat.promotion_evidence_evaluated,
                                  mat.subjective_utility_recorded
telemetry/eval.catalog.json       eval.profile_registered, eval.dataset_frozen,
                                  eval.experiment_registered, eval.run_started,
                                  eval.metric_computed, eval.interval_computed,
                                  eval.control_evaluated, eval.incident_opened,
                                  eval.baseline_compared, eval.missed_opportunity_classified,
                                  eval.challenger_compared, eval.drift_detected,
                                  eval.selection_bias_diagnosed
```

Dependency direction (one-way, mirroring §9.5): `eval-cli` →
`evaluation` + `outcome-maturity` → `persistence`, `shared-schemas`,
`domain`, and read-only consumers of the proven
`execution-simulator`/`signal-intelligence`/`evidence`/`discovery-universe`
exported APIs. `domain` and `shared-schemas` gain additive modules only.

## Verification strategy per acceptance criterion

- **AC-040…044, AC-150…153 (authored here, 18 files)**: positive suites prove
  the law on deterministic fixture chains over the proven seams; negative
  suites prove structural refusal (schema, SQL CHECK, or typed law) of each
  violation. AC-042/AC-150/AC-151/AC-152/AC-153 negatives target the exact
  refusal seams: universe/cutoff mismatch refused at baseline-compare;
  material lift without incident refused at the control harness; naive
  intervals passing where clustered intervals fail on correlated fixtures;
  alert-claims from IMPLEMENTED-only modules refused at the evidence gate;
  degradation corrupting integrity/audit/dedup/refusal refused at the
  reserve-aware seam.
- **AC-120…128 (exec-authored, extended additively)**: mat/eval facet blocks
  added — evaluation-side denominator composition (AC-123), evaluation-dataset
  retention of censor/invalid reasons (AC-124), subjective-utility evaluation
  isolation (AC-125), weighted-estimator fixtures over observation plans
  (AC-128), replay/label facets (AC-120/121/122/126/127) exercising this
  package's machinery at its seams. Existing cases untouched.
- **AC-154 (sig-authored, extended additively)**: calibration-machinery facet
  — drift detection triggers automatic expected-net-utility degradation; the
  DISABLED-challenger state stays regression-locked.
- **AC-240…249 (data-truth-authored, extended additively)**: evaluation facets
  — universal action-time over all arms (AC-240), challenger replay
  comparison (AC-241), NOT_REQUESTED_BY_POLICY in evaluation datasets
  (AC-242), probe-probability-before-maturity ordering (AC-243),
  selection-adjusted lift (AC-244), correlation-credit reduction (AC-245),
  lineage-collapse sensitivity (AC-246), frozen-count preservation (AC-247),
  power/threshold promotion gates (AC-248), extended negative-control set
  (AC-249). Existing cases untouched.
- **Colocated suites**: domain vocabulary/law truth tables
  (`packages/domain/test/mat.spec.ts`, `eval.spec.ts`), schema payload laws
  (`packages/shared-schemas/test/mat.spec.ts`, `eval.spec.ts`), package
  suites per module (maturity ledger transitions, estimator diagnostics,
  control determinism/byte-identical reruns, action-time symmetry,
  metric golden vectors, taxonomy completeness), CLI end-to-end on PGlite.
- **Gates**: `pnpm --filter @foresift/outcome-maturity test`,
  `pnpm --filter @foresift/evaluation test`,
  `pnpm --filter @foresift/eval-cli test`, the extended central suites
  (`packages/persistence/test/migrator.spec.ts`, schema-parity,
  `tests/telemetry-catalog.spec.ts`), the authored/extended AC files,
  prohibited-capability scanner, then `pnpm verify` + `pnpm spec:verify` at
  the pushed HEAD.

## Material decisions (proposed ADR texts — bind future packages)

- **ADR (proposed) — Evaluation manifests extend, never fork, execution replay
  manifests**: `evaluation_runs` carries the §31.5 field set and references
  the exec `replay_manifests` row (`exec_replay_manifest_id`) when execution
  assumptions are pinned; no second execution-assumption law is created.
  Future packages freeze additional evaluation dimensions by adding nullable
  version columns to `evaluation_runs` (additive migration), never by
  editing frozen rows.
- **ADR (proposed) — Maturity is an append-only ledger, not a mutable status**:
  §12.8's "deployment, retry, provider outage, or policy changes do not reset
  maturity" is enforced structurally (append-only triggers + monotone
  transition constraints with absorbing CENSORED/INVALID_DATA states).
  Consumers join the ledger; they never UPDATE it. Future packages that
  observe additional maturity-relevant evidence add transitions with new
  `cause` values, never re-open absorbing states.
- **ADR (proposed) — Subjective label families are physically separate
  storage**: §68.9 separation is enforced by table isolation (no FK between
  `subjective_utility_records` and objective tables) plus the pure law
  `subjectiveCannotAlterObjective`; joins for analytics are read-side views
  that can never feed back into objective classification. Future packages
  rendering owner feedback must consume the same two-plane split.
- **ADR (proposed) — Decimal-string metric law**: every persisted metric
  value, interval bound, and money amount is a decimal string matching the
  repo CHECK law (`^-?(0|[1-9][0-9]*)(\.[0-9]+)?$`); binary floats never
  cross the persistence boundary for evaluation results, so replay
  reproduction is byte-identical. Estimators may compute in fixed-point
  BigInt numerators/denominators (the G0 exact-sum precedent) and serialize
  once.
- **ADR (proposed) — Negative-control determinism**: control permutations and
  placebo constructions are seeded deterministic transforms of frozen inputs
  (seed provenance recorded, never raw material), so a control run is exactly
  reproducible and its lift comparison is audit-replayable. G.11's
  DAILY_VERSIONED seed policy keys the seed material version, not wall-clock.

## Risks and mitigations (planning-level)

- **Migrator family extension touches shared persistence source** — mitigated
  by the plan-sanctioned exception (ADR-0019/0022 duty; exact precedent:
  g1-execution-simulation T008 added `exec`), test-owned central-registry
  extension in the same package, and PGlite apply/idempotency suites.
- **Drizzle mirror catch-up is large (≈20 public tables)** — mitigated by
  generating mirror entries from the SQL truth in-package (the schema-parity
  gate mechanically verifies every column/PK), same as the three landed G1
  precedents.
- **Estimator/statistical correctness** — mitigated by golden-vector fixtures
  with hand-computed expectations (Horvitz–Thompson weights, cluster
  bootstrap ESS on synthetic correlated fixtures with known truth),
  property tests (weight sum invariants, permutation invariance), and the
  negative suites proving diagnostics fail-closed.
- **AC-suite extension volume (20 files)** — mitigated by the facet convention
  (describe blocks with facet-scope headers, existing content untouched) and
  by authoring all extensions as test-owned tasks.
- **Scope creep into objective-governance (FR-OBJ-*)** — mitigated by the
  explicit boundary: this package delivers the deterministic metric framework
  and statistical substrate; the shadow-portfolio objective, hard-constraint
  promotion policy, and utility optimization stay with `g1-objective-governance`
  (recorded in out-of-scope notes).

## Non-goals reaffirmed (must not creep into tasks.md)

- No shadow-portfolio utility objective definition, hard-constraint promotion
  policy, or guaranteed-profit language enforcement (FR-OBJ-001…010 —
  `g1-objective-governance`, PENDING).
- No new pool math, adapters, execution simulation, or tradability gates
  (exec-proven; consumed read-only).
- No learned/calibrated challenger model implementation (FR-SIG-010, G6) — the
  calibration machinery and the disabled state are proven; the model lands
  with its own milestone.
- No feature computation, ranking, or lifecycle changes (sig-proven; consumed
  read-only).
- No UI/dashboard/API/notification surfaces (G2+ milestones); telemetry stays
  DECLARATIVE_CONTRACT_ONLY.
- No collector, decoder, provider-lifecycle, or rights changes (G0-proven).

## Validation

1. `node scripts/automation/package-plan-complete.mjs --package
   g1-outcome-evaluation --artifacts-dir <ARTIFACTS_DIR>` → complete:true.
2. `pnpm spec:verify` after artifacts land (manifest integrity unaffected;
   scoped artifacts only added).
3. No placeholder markers in `specs/g1-outcome-evaluation/**`; every task
   traces to FR-MAT-*/FR-EVAL-* or its ACs; validator rejects out-of-scope
   requirement tracing.
4. Milestone verification commands present and executable:
   `test -d packages/outcome-maturity && pnpm --filter @foresift/outcome-maturity
   test`, `test -d packages/evaluation && pnpm --filter @foresift/evaluation
   test`, `test -d packages/eval-cli && pnpm --filter @foresift/eval-cli test`.
