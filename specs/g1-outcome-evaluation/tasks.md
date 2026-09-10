# Tasks: g1-outcome-evaluation

**Input**: `specs/g1-outcome-evaluation/spec.md`, `specs/g1-outcome-evaluation/plan.md`
**Traceability rule**: every task cites at least one assigned requirement
(FR-MAT-001…012, FR-EVAL-001…009) or an acceptance criterion of those
requirements. Requirement IDs not assigned to this package never appear here.

Format: `- [ ] T### [P?]` — **[P]** = parallelizable with its neighbors (disjoint
files). A PRODUCT task that must stay serial carries exactly one
`[serial-reason: SEMANTIC_DEPENDENCY|SHARED_FILE|ORDERED_MIGRATION|SHARED_INVARIANT|COORDINATOR_BOUNDARY|SAFETY_SERIALIZATION]`
marker (2026-09-08 maintainer directive; the parallelism audit refuses an
unjustified serial plan). Test-owned work carries `[executor: TEST]` and is
routed to the test-author lanes; implementation-dispatched product tasks NEVER
carry test/fixture/spec writes (2026-09-07 ownership admission law — the graph
builder refuses such plans before any provider spend). Tests are mandatory per
PRD evidence rules: positive AND negative/failure-path specs for every AC this
package authors (AC-040…044, AC-150…153 — 18 files) plus additive mat/eval
facet extends of the shared AC-120…128, AC-154, AC-240…249 suites (existing
content untouched).

Plan-sanctioned scope exceptions recorded per ADR-0019/0022 duty and milestone
plan-level decisions 1 and 4, named by exact path:
`packages/persistence/src/migrator.ts` (family-list extension with `mat|eval`,
product-owned T005 — exact g1-execution-simulation T008 precedent),
`packages/persistence/src/generated/schema.ts` (ADR-001 mirror catch-up,
product-owned T006 — the #175/#208/#245 precedent),
`packages/persistence/test/migrator.spec.ts` (central expected-script
registry, test-owned T022), and the central telemetry parity suite
`tests/telemetry-catalog.spec.ts` (test-owned T021). No other out-of-scope
write exists; `evidence/bun-migration/bun-migration-manifest.json` regen (T025)
is mechanical coordinator bookkeeping per ADR-0020.

**Vocabulary law (binding)**: the SQL CHECK/ENUM literal lists in plan.md's
data model are THE vocabulary authority. Every task below transcribes them
verbatim; no writer or test author may invent, rename, or omit members:

- Horizon (4): `24H`, `7D`, `TARGET_EVENT`, `EXIT_POLICY`
- CensorReason (5): `RIGHTS_DRIVEN_DELETION`, `PERMANENT_IDENTITY_AMBIGUITY`, `UNRECOVERABLE_OBSERVATION_GAP`, `UNSUPPORTED_HISTORICAL_POOL_STATE`, `CHAIN_ARCHIVE_UNAVAILABLE`
- InvalidReason (5): `CORRUPTED_SAMPLING_ASSIGNMENT`, `IMPOSSIBLE_TIME_ORDER`, `FAILED_POOL_PARITY`, `UNRESOLVABLE_DECIMALS`, `UNESTABLISHABLE_AVAILABILITY`
- DenominatorDisclosureClass (9): `PENDING`, `PARTIALLY_MATURED`, `CENSORED`, `INVALID_DATA`, `LOW_RESOLUTION`, `RIGHTS_BLOCKED`, `UNOBSERVED`, `SIGNAL_ONLY`, `FULLY_MATURED`
- OutcomeLabelFamily (5): `OBJECTIVE_SIGNAL_OUTCOME`, `OBJECTIVE_TRADABLE_OUTCOME`, `OBJECTIVE_PORTFOLIO_UTILITY`, `SUBJECTIVE_USER_UTILITY`, `HUMAN_EXPERT_JUDGMENT`
- EvidenceResolution (3): `FULLY_MATURED_HIGH_RESOLUTION`, `COARSE_SIGNAL_ONLY`, `INSUFFICIENT`
- ExpirySideEffect (3): `ALERT_EXPIRED`, `ALERT_CANCELLED`, `THESIS_INVALIDATED`
- DatasetPartition (6): `TRAIN`, `CALIBRATION`, `VALIDATION`, `FINAL_HOLDOUT`, `LIVE_SHADOW`, `FORWARD_CONFIRMATION`
- HoldoutExposure (5): `UNEXPOSED`, `METRIC_ONLY_EXPOSED`, `OWNER_REVIEWED`, `TUNING_EXPOSED`, `EXHAUSTED`
- ReplayKind (5): `BACKTEST`, `CROSS_FIT`, `FORWARD_SHADOW`, `LIVE_SHADOW`, `ACTIVE_PRODUCTION`
- MultipleTestingFamily (8): `FDR_BENJAMINI_HOCHBERG`, `FDR_BENJAMINI_YEKUTIELI`, `FAMILY_WISE_BONFERRONI`, `FAMILY_WISE_HOLM`, `HIERARCHICAL_TREE`, `RANDOMIZATION_INFERENCE`, `SEQUENTIAL_ALPHA_SPENDING`, `NONE_EXPLORATORY_ONLY`
- ControlKind (14): `LABEL_PERMUTATION`, `FEATURE_TIMESTAMP_SHIFT`, `DELAYED_PROVIDER_PLACEBO`, `BACKFILLED_AVAILABILITY_PLACEBO`, `SYNTHETIC_NULL_FEATURES`, `FORBIDDEN_FUTURE_COLUMN_SCAN`, `OVERLAPPING_WINDOW_LEAKAGE_SCAN`, `SAME_ENTITY_LEAKAGE_SCAN`, `PROVIDER_ID_ONLY_PREDICTOR`, `RANDOM_MODEL_OUTPUT_CONTROL`, `OUTCOME_PERMUTATION`, `AVAILABILITY_BACKDATING_PLACEBO`, `DELAYED_DELIVERY_PLACEBO`, `SYNTHETIC_NOISE`
- IncidentTrigger (9): `LEAKAGE_CONTROL_FAILURE`, `EXHAUSTED_HOLDOUT_REUSED`, `INVALID_SAMPLING_PROPENSITY`, `MULTIPLE_TESTING_MISMATCH`, `CLUSTER_ESS_BELOW_GATE`, `ACTION_TIME_ASYMMETRY`, `POOL_ADAPTER_PARITY_INVALIDATED_OUTCOMES`, `POPULATION_CLAIM_EXCEEDS_SUPPORT`, `UNEXPLAINED_CHALLENGER_DIVERGENCE`
- BaselineKind (10): `RANDOM_ELIGIBLE_CANDIDATE`, `PROVIDER_TRENDING_RANK`, `FIRST_PARTY_EVENT_RECENCY_RANK`, `NEW_POOL_RANK`, `LIQUIDITY_VOLUME_HEURISTIC`, `HOLDER_BUYER_GROWTH_HEURISTIC`, `SECURITY_EXECUTION_HARD_GATE`, `MARKET_ONLY_DETERMINISTIC_RANK`, `PARETO_LEXICOGRAPHIC_DETERMINISTIC_RANK`, `OWNER_MANUAL_SHORTLIST`
- IntervalMethod (4): `CLUSTER_BOOTSTRAP`, `BLOCK_BOOTSTRAP_CALENDAR`, `BLOCK_BOOTSTRAP_REGIME`, `RANDOMIZATION_INFERENCE`
- ClusterDefinition (9): `CALENDAR_BLOCK`, `DEPLOYER_CLUSTER`, `FUNDING_CLUSTER`, `WALLET_ENTITY`, `LAUNCHPAD`, `NARRATIVE`, `POOL`, `SOURCE_DEPENDENCE_GROUP`, `REGIME`
- DriftControlKind (5): `CALIBRATION_DRIFT`, `REGIME_DRIFT`, `POPULATION_DRIFT`, `COVERAGE_DRIFT`, `FEATURE_DISTRIBUTION_DRIFT`
- ClaimRestriction (3): `NONE`, `RESTRICT_TO_OBSERVED_SUBSET`, `RESTRICT_TO_WEIGHTED_STRATA`

Staging order mirrors the deterministic pipeline: vocabularies/laws first,
then shared schemas, then persistence (migrations + registry + mirror), then
the outcome-maturity ledger core, then the evaluation engine, then the CLI,
then fixtures and AC suites, then telemetry and gates.

## Phase 1 — Domain vocabularies and pure laws (blocks later phases)

- [x] T001 [P] Create `packages/domain/src/mat.ts`: `Horizon` (4), `CensorReason`
      (5), `InvalidReason` (5), `DenominatorDisclosureClass` (9),
      `OutcomeLabelFamily` (5), `EvidenceResolution` (3), `ExpirySideEffect`
      (3) as const objects with fail-closed parse functions throwing typed
      `MatError`s with stable `MatErrorCode`s (MAT_HORIZON_UNKNOWN,
      MAT_CENSOR_REASON_UNKNOWN, MAT_INVALID_REASON_UNKNOWN,
      MAT_DISCLOSURE_CLASS_UNKNOWN, MAT_LABEL_FAMILY_UNKNOWN,
      MAT_EVIDENCE_RESOLUTION_UNKNOWN, MAT_SIDE_EFFECT_UNKNOWN,
      MAT_TRANSITION_ILLEGAL, MAT_DENOMINATOR_CLASS_UNDISCLOSED,
      MAT_SUBJECTIVE_JOIN_REFUSED, MAT_PROMOTION_EVIDENCE_INSUFFICIENT,
      MAT_CAPACITY_DISCLOSURE_MISSING); plus the pure laws
      `maturityNeverResets` (transition monotonicity: no downgrade to
      PENDING; CENSORED/INVALID_DATA absorbing — §12.8/FR-MAT-001),
      `censorNeverBecomesFailure` (a CENSORED/INVALID_DATA outcome can never
      enter a failure class — §68.3/FR-MAT-003 truth table),
      `subjectiveCannotAlterObjective` (objective label is a pure function
      that ignores subjective families — §68.9/FR-MAT-006),
      `adverseOrderingPrimacy` (adverse feasible order is primary when
      ordering is unknown; optimistic sensitivity only as secondary —
      FR-MAT-009), `postExpiryGainsExcluded` (post-expiry/cancellation/
      invalidation gains never count as actionable success — FR-MAT-011),
      `promotionRequiresExactMatureEvidence` (TRADABLE_SUCCESS promotion
      evidence requires fully matured high-resolution execution evidence for
      the exact notional/delay/adapter/route/exit policy; coarse signal data
      refuses — FR-MAT-008), and `capacityDisclosureRequired` (a
      capacity-limited opportunity reports maximum executable notional +
      deployable portfolio capacity; small-notional generalization without
      simulation is refused — FR-MAT-012). Colocated unit tests are authored
      by the test-owned task T020 (2026-09-07 ownership law). Traces:
      FR-MAT-001, FR-MAT-003, FR-MAT-006, FR-MAT-008, FR-MAT-009, FR-MAT-011,
      FR-MAT-012.
- [x] T002 [P] Create `packages/domain/src/eval.ts`: `DatasetPartition` (6),
      `HoldoutExposure` (5), `ReplayKind` (5), `MultipleTestingFamily` (8),
      `ControlKind` (14), `IncidentTrigger` (9), `BaselineKind` (10),
      `IntervalMethod` (4), `ClusterDefinition` (9), `DriftControlKind` (5),
      `ClaimRestriction` (3) as const objects with fail-closed parse
      functions throwing typed `EvalError`s with stable `EvalErrorCode`s
      (EVAL_PARTITION_UNKNOWN, EVAL_HOLDOUT_EXPOSURE_UNKNOWN,
      EVAL_REPLAY_KIND_UNKNOWN, EVAL_TESTING_FAMILY_UNKNOWN,
      EVAL_CONTROL_KIND_UNKNOWN, EVAL_INCIDENT_TRIGGER_UNKNOWN,
      EVAL_BASELINE_KIND_UNKNOWN, EVAL_INTERVAL_METHOD_UNKNOWN,
      EVAL_CLUSTER_DEFINITION_UNKNOWN, EVAL_DRIFT_KIND_UNKNOWN,
      EVAL_CLAIM_RESTRICTION_UNKNOWN, EVAL_HOLDOUT_EXHAUSTED_REUSED,
      EVAL_UNIVERSE_MISMATCH, EVAL_POPULATION_CLAIM_UNSUPPORTED,
      EVAL_WEIGHTING_INVALID, EVAL_ACTION_TIME_ASYMMETRY,
      EVAL_NETWORK_ACCESS_DENIED, EVAL_ESS_BELOW_GATE); plus the pure laws
      `universalActionTime` (§31.4 T_delivery/T_actionable — the exact
      formula over decision-ready, policy-decided, delivery + scenario delay,
      and required-state availability, identical for every arm —
      FR-EVAL-002/§31.4), `holdoutExposureGuards` (FINAL_HOLDOUT promotion
      evidence requires UNEXPOSED; a slice becomes EXHAUSTED after material
      tuning/inspection and cannot be relabeled — §31.2),
      `weightingRequiresDiagnostics` (valid positivity, overlap, weight
      stability, model diagnostics; otherwise RESTRICT — §68.10),
      `populationClaimSupported` (one §7.8 population per result; claims
      beyond the declared universe refuse — §68.4),
      `essGate` (low effective independent sample size blocks
      calibrated/proven claims even when token count is high — §68.6),
      `materialLiftDetector` (unexpected material lift blocks promotion and
      opens an incident — §68.5/§68.12), and `horizonPurge` (purge/embargo
      where outcome horizons or features overlap — §31.2). Colocated unit
      tests are authored by the test-owned task T020 (ownership law).
      Traces: FR-MAT-004, FR-MAT-005, FR-EVAL-002, FR-EVAL-003, FR-EVAL-009,
      AC-240, AC-242, AC-244, AC-248, AC-249.
- [x] T003 [serial-reason: SEMANTIC_DEPENDENCY] Extend
      `packages/domain/src/errors.ts` with the MAT__/EVAL__ error-code blocks
      and the `MatError`/`EvalError` subclasses, and extend
      `packages/domain/src/index.ts` exports for the new mat and eval modules.
      Traces: FR-MAT-001…012, FR-EVAL-001…009.

## Phase 2 — Shared schemas (blocks persistence repos and PGlite suites)

- [x] T004 [serial-reason: SEMANTIC_DEPENDENCY] Create
      `packages/shared-schemas/src/mat.ts` + `packages/shared-schemas/src/eval.ts`
      and extend `packages/shared-schemas/src/index.ts`: mat —
      `OutcomeMaturityStateSchema`, `MaturityTransitionSchema`,
      `DenominatorDisclosureSchema`, `SubjectiveUtilityRecordSchema`,
      `OutcomeSamplingStratumSchema`, `OutcomeSamplingAssignmentSchema`,
      `PromotionEvidenceRecordSchema`; eval — `OutcomeProfileSchema`,
      `EvaluationDatasetSchema`, `EvaluationExperimentSchema`,
      `EvaluationRunSchema` (the §31.5 field set),
      `EvaluationMetricResultSchema`, `ClusteredIntervalRunSchema`,
      `NegativeControlRunSchema`, `EvaluationIncidentSchema`,
      `BaselineResultSchema`, `MissedOpportunitySchema`,
      `ChampionChallengerComparisonSchema`, `DriftCalibrationControlSchema`,
      `SelectionBiasDiagnosticSchema` — importing domain enums (never
      restating), `.strict()`, ISO-8601 Z timestamps, `sha256:<hex>` content
      addresses, decimal-string metric/money law (`^-?(0|[1-9][0-9]*)(\.[0-9]+)?$`),
      `MAT_SCHEMA_REGISTRY_VERSION = 1`, `EVAL_SCHEMA_REGISTRY_VERSION = 1`;
      unknown class/state/reason values fail closed; refinements enforce
      censor-reason-required, promotion-requires-mature-evidence,
      interval-order, lift-implies-incident, and weighting-requires-
      diagnostics at the payload layer mirroring the SQL law. Colocated
      schema tests are authored by the test-owned task T020 (ownership law).
      Traces: FR-MAT-001, FR-MAT-002, FR-MAT-003, FR-MAT-006, FR-MAT-007,
      FR-MAT-008, FR-MAT-009, FR-MAT-010, FR-MAT-011, FR-MAT-012, FR-EVAL-001,
      FR-EVAL-002, FR-EVAL-003, FR-EVAL-005, FR-EVAL-007, FR-EVAL-008,
      FR-EVAL-009.

## Phase 3 — Persistence: migration families + registry + mirror (blocks repos and PGlite suites)

- [x] T005 [serial-reason: ORDERED_MIGRATION] Create
      `migrations/g1_mat_0001_maturity_ledger.sql`:
      `outcome_maturity_states` (§12.8 five-state CHECK, §68.3 censor (5) +
      invalid (5) reason CHECKs transcribed verbatim, unique per
      candidate × profile-version × horizon × scenario-id × scenario-version,
      reason-required and censor/invalid-exclusive constraints),
      `maturity_transitions` (monotone, absorbing censor/invalid, no-reset),
      `outcome_denominator_disclosures` (FR-MAT-010: nine disclosure class
      counts + observation-collection scope + report scope, append-only),
      `subjective_utility_records` (FR-MAT-006: physically separate storage,
      label-family CHECK, no FK to objective tables),
      `outcome_sampling_strata` + `outcome_sampling_assignments` (FR-MAT-007:
      dimensions jsonb, nonzero inclusion probability, selection time/reason,
      seed provenance `NOT LIKE 'raw:%'`); append-only `refuse_mutation`
      triggers on states, disclosures, subjective records, and assignments
      (G0 pattern). Apply-on-PGlite clean, idempotent on replay. Traces:
      FR-MAT-001, FR-MAT-002, FR-MAT-003, FR-MAT-006, FR-MAT-007, FR-MAT-010.
- [x] T006 [serial-reason: ORDERED_MIGRATION] Create
      `migrations/g1_mat_0002_promotion_evidence.sql`:
      `promotion_evidence_records` (FR-MAT-008 exact-configuration columns
      required_notional/delay/adapter/route/exit-policy,
      evidence_resolution CHECK (3), coarse-cannot-promote CHECK;
      FR-MAT-009 primary_ordering CHECK + path_ambiguous +
      optimistic-requires-adverse CHECK; FR-MAT-011 timestamped
      expiry-side-effect CHECK + post_expiry_gain_excluded; FR-MAT-012
      decimal-string capacity disclosure pair CHECK); append-only trigger.
      Traces: FR-MAT-008, FR-MAT-009, FR-MAT-011, FR-MAT-012.
- [x] T007 [serial-reason: ORDERED_MIGRATION] Create
      `migrations/g1_eval_0001_profiles_datasets_registry.sql`:
      `outcome_profiles` (FR-EVAL-001: §8.3-shaped eligibility/success/failure/
      neutral clauses as jsonb + population_scope §7.8 CHECK (6) + immutable
      PRIMARY KEY (profile_id, version)), `evaluation_datasets` (§31.2:
      partition CHECK (6), holdout_exposure CHECK (5), FINAL_HOLDOUT-frozen
      CHECK, sha256 universe hash, embargo bounds, leakage group keys),
      `evaluation_experiments` (FR-EVAL-009 §31.3 exact field set incl.
      multiple_testing_family CHECK (8), pre-registration timestamp);
      append-only triggers. Traces: FR-EVAL-001, FR-EVAL-009.
- [x] T008 [serial-reason: ORDERED_MIGRATION] Create
      `migrations/g1_eval_0002_runs_metrics_controls.sql`:
      `evaluation_runs` (FR-EVAL-002 §31.5 field set: replay_kind CHECK (5),
      network_access CHECK, all version columns, holdout snapshot,
      code+dependency hash, exec_replay_manifest_ref),
      `evaluation_metric_results` (FR-EVAL-003: metric_kind CHECK (35),
      decimal-string values, maturity_scope CHECK with
      final-requires-matured law, denominator disclosure ref),
      `clustered_interval_runs` (FR-MAT-005: interval_method CHECK (4),
      cluster_definition CHECK (9), naive vs effective sample size, ESS gate,
      alternate-cluster sensitivity jsonb),
      `negative_control_runs` (FR-MAT-004: control_kind CHECK (14), seed
      provenance, lift vs threshold, lift-implies-incident CHECK),
      `evaluation_incidents` (§68.12: trigger CHECK (9), influence-paused);
      append-only triggers. Traces: FR-MAT-004, FR-MAT-005, FR-EVAL-002,
      FR-EVAL-003, FR-EVAL-009.
- [x] T009 [serial-reason: ORDERED_MIGRATION] Create
      `migrations/g1_eval_0003_baseline_missed_controls.sql`:
      `baseline_results` (FR-EVAL-004: baseline_kind CHECK (10),
      comparator-universe-match CHECK),
      `missed_opportunities` (FR-EVAL-005: miss_classification CHECK (34
      §31.11 members verbatim), delay decomposition jsonb, counterfactual
      action time, frozen evidence refs, next-evaluation-dataset ref),
      `champion_challenger_comparisons` (FR-EVAL-007: budgets-equalized and
      zero-side-effects CHECKs),
      `drift_calibration_controls` (FR-EVAL-008: control_kind CHECK (5),
      drift-detected-implies-degradation CHECK),
      `selection_bias_diagnostics` (FR-EVAL-009: diagnostic_kind CHECK (7),
      G.11 max-weight ≤ 20 CHECK, weighting-requires-diagnostics CHECK,
      claim_restriction CHECK (3)); append-only triggers. Traces:
      FR-EVAL-004, FR-EVAL-005, FR-EVAL-007, FR-EVAL-008, FR-EVAL-009.
- [ ] T010 [serial-reason: SEMANTIC_DEPENDENCY] Extend
      `packages/persistence/src/migrator.ts` MIGRATION_FAMILIES with `mat|eval`
      (the plan-sanctioned central-registry source exception, exact path:
      `^g\d+_(data|dr|sec|prov|core|cost|col|disc|mcp|trace|sig|solsec|trd|sup|exec|mat|eval)_\d{4}_[a-z0-9_]+\.sql$`)
      — the fail-closed unknown-family refusal must accept exactly the five
      new scripts and nothing else. Depends on T005–T009. Traces: FR-MAT-001…012,
      FR-EVAL-001…009 (persistence substrate for every assigned requirement).
- [ ] T011 [serial-reason: SEMANTIC_DEPENDENCY] Extend
      `packages/persistence/src/generated/schema.ts` (ADR-001 mirror
      catch-up, exact path) with the mat/eval public tables: mirror
      definitions for `outcome_maturity_states`, `maturity_transitions`,
      `outcome_denominator_disclosures`, `subjective_utility_records`,
      `outcome_sampling_strata`, `outcome_sampling_assignments`,
      `promotion_evidence_records`, `outcome_profiles`,
      `evaluation_datasets`, `evaluation_experiments`, `evaluation_runs`,
      `evaluation_metric_results`, `clustered_interval_runs`,
      `negative_control_runs`, `evaluation_incidents`, `baseline_results`,
      `missed_opportunities`, `champion_challenger_comparisons`,
      `drift_calibration_controls`, `selection_bias_diagnostics` — the
      schema-parity gate (enumerates `public`) requires exact column/
      nullability/PK parity. Depends on T005–T009. Traces: FR-MAT-001…012,
      FR-EVAL-001…009 (mirror substrate).

## Phase 4 — Outcome-maturity package core (blocks evaluation engine and AC suites)

- [x] T012 [serial-reason: SEMANTIC_DEPENDENCY] Scaffold
      `packages/outcome-maturity` and `packages/evaluation` and
      `packages/eval-cli` (package.json `@foresift/outcome-maturity`,
      `@foresift/evaluation`, `@foresift/eval-cli` with workspace `*` deps:
      outcome-maturity on domain/shared-schemas/persistence;
      evaluation additionally on evidence, signal-intelligence,
      execution-simulator, discovery-universe as read-only consumers;
      eval-cli on the two sibling packages only; `bun test` scripts;
      tsconfig extending tsconfig.base.json; bin entry for eval-cli; no
      per-package runner config — G0/G1 scaffold pattern). Depends on
      T001–T011. Traces: FR-MAT-001…012, FR-EVAL-001…009.
- [x] T013 [serial-reason: SEMANTIC_DEPENDENCY] Implement
      `packages/outcome-maturity/src/maturity-ledger.ts` + extend index.ts:
      FR-MAT-001/002 — maturity resolution per candidate × profile/horizon/
      scenario over the proven `execution_simulations` records and
      observation-plan inputs (horizon completion + required
      outcome/security/liquidity/pool-state observations per §68.1),
      append-only transition application through the T013 ledger seam with
      absorbing censor/invalid states and the no-reset law (deployment/
      retry/outage/policy changes never reset; lifecycle/alert state never
      overwrites), idempotent under retry (natural-key upsert of the
      initial observation, append-only transitions), and the §68.2
      final-denominator predicate (FULLY_MATURED + valid only) with
      provisional-scope labeling. Depends on T001, T004, T005, T012.
      Colocated suites authored by test-owned T020. Traces: FR-MAT-001,
      FR-MAT-002, AC-123.
- [x] T014 [serial-reason: SEMANTIC_DEPENDENCY] Implement
      `packages/outcome-maturity/src/denominators.ts` +
      `src/label-separation.ts`: FR-MAT-010 — denominator disclosure
      assembly counting every excluded class (invalid, censored, partial,
      low-resolution, rights-blocked, unobserved, signal-only) beside the
      matured denominator, refusing any final metric whose denominator
      composition contains undisclosed classes, and proving policies cannot
      improve measured performance by reducing outcome collection (reduced
      collection increases disclosed exclusions, never the success rate);
      FR-MAT-006 — the §68.9 two-plane query law: objective metric paths
      structurally cannot join subjective records (typed
      MAT_SUBJECTIVE_JOIN_REFUSED), subjective utility recorded only in its
      own plane. Depends on T013. Colocated suites authored by T020.
      Traces: FR-MAT-006, FR-MAT-010, AC-123, AC-125, AC-239.
- [x] T015 [serial-reason: SEMANTIC_DEPENDENCY] Implement
      `packages/outcome-maturity/src/sampling.ts`: FR-MAT-007 — stratified
      sampling assignment admission (dimensions across rank/rejection
      reason/source/launchpad/age/regime/profile/coverage per §31.8,
      nonzero inclusion probability, selection time, reason, seed
      provenance), the design-weighted estimator (Horvitz–Thompson over
      inclusion probabilities with fixed-point arithmetic), positivity/
      overlap/weight-stability diagnostics and the G.11
      `maximum_sampling_weight: 20` ceiling, and the explicit
      claim-restriction fallback (`RESTRICT_TO_OBSERVED_SUBSET` /
      `RESTRICT_TO_WEIGHTED_STRATA`) when diagnostics fail — selected-only
      samples can never produce universe-wide claims (§31.8). Depends on
      T002, T004, T005, T012. Colocated suites authored by T020. Traces:
      FR-MAT-007, AC-128, AC-244.
- [x] T016 [serial-reason: SEMANTIC_DEPENDENCY] Implement
      `packages/outcome-maturity/src/promotion-evidence.ts`: FR-MAT-008 —
      exact-configuration matching of TRADABLE_SUCCESS promotion claims
      against fully matured high-resolution execution evidence for the
      exact notional, delay policy, adapter, route, and exit policy (keys
      consumed from `execution_scenarios` + `execution_simulations`), the
      coarse-signal-only refusal, and the AC-152 evidence gate (results
      from modules not AVAILABLE are labeled shadow and cannot support
      alert claims; PROVEN additionally required when the profile specifies);
      FR-MAT-009 — adverse-feasible primacy + path-ambiguity disclosure with
      optimistic sensitivity recorded as secondary only; FR-MAT-011 —
      time-stamped alert expiry/cancellation/thesis-invalidation side
      effects consumed from `sig.candidate_lifecycle` + timeline validity
      (`valid_until`/`expired_at`), post-expiry gains structurally excluded
      from actionable success; FR-MAT-012 — maximum-executable-notional +
      deployable-portfolio-capacity disclosure consumed read-only from the
      proven execution-simulator concurrent-aggregation outputs, with
      small-notional generalization refused without a simulation at the
      larger notional. Depends on T013–T015. Colocated suites authored by
      T020. Traces: FR-MAT-008, FR-MAT-009, FR-MAT-011, FR-MAT-012, AC-120,
      AC-126, AC-152.
- [x] T017 [P] Implement `packages/outcome-maturity/src/read-only-guard.ts`:
      INV-001 structural surface asserting the package exposes no
      transaction-construction/submission/custody/signing surface and no
      model-provider/agent import; prohibited-capability scanner hook
      (`node scripts/scan-prohibited-capabilities/cli.mjs` clean on the
      package surface). Depends on T013–T016. Traces: FR-MAT-001…012.

## Phase 5 — Evaluation engine (blocks CLI and AC suites)

- [x] T018 [serial-reason: SEMANTIC_DEPENDENCY] Implement
      `packages/evaluation/src/profiles.ts` + `src/frozen-replay.ts` +
      `src/action-time.ts`: FR-EVAL-001 — the versioned §8.3-shaped outcome
      profile registry (immutable versions; population scope; required
      stress pass matrix; resolution floor); FR-EVAL-002 — the §31.5-extended
      frozen replay runner (manifest freeze with dataset version, population
      claim, observation cutoff, holdout snapshot, code hash; network access
      DENIED for decision-quality runs; input resolution through the proven
      `visibleAt`; byte-identical rerun determinism) and the five separate
      replay artifact classes (BACKTEST, CROSS_FIT, FORWARD_SHADOW,
      LIVE_SHADOW, ACTIVE_PRODUCTION — never blended); §31.4 — the universal
      decision/action-time function over the proven
      `candidate_decision_timelines` (T_delivery real-or-counterfactual;
      T_actionable = max(decision_ready, policy_decided, delivery + delay,
      execution-state availability, security-evidence availability)),
      applied identically to alerted/watched/ignored/rejected/below-cutoff/
      challenger/control/missed arms (AC-240). Depends on T002, T004,
      T007–T009, T012. Colocated suites authored by test-owned T020.
      Traces: FR-EVAL-001, FR-EVAL-002, AC-240, AC-241, AC-247.
- [x] T019 [serial-reason: SEMANTIC_DEPENDENCY] Implement
      `packages/evaluation/src/metrics.ts` + `src/baselines.ts`:
      FR-EVAL-003 — the §31.6 metric suite over matured denominators
      (Precision@K, Recall@eligible-gems, NDCG@K, false discovery/rejection,
      median rank, median actionable lead time, MFE/MAE, target duration,
      liquidity/security survival, tradable success by notional and by
      delay scenario, fill/exit survival, partial-fill rate,
      signal-to-tradable divergence, maturity/censoring/invalid-data rates,
      executable-target false-positive rate, cost per researched/useful
      candidate via the proven cost ledgers read-only; expectancy/drawdown/
      CVaR/capital-utilization deterministic components for the
      objective-governance consumer), every FINAL metric refusing
      non-matured denominators and every result carrying its disclosure
      ref; FR-EVAL-004 — the §31.7 baseline set with comparator selection
      (strongest eligible simple baseline; identical frozen universe +
      cutoff + action-time semantics enforced — AC-042; weak-baseline
      selection recorded and refused as comparator). Depends on T013–T016,
      T018. Colocated suites authored by T020. Traces: FR-EVAL-003,
      FR-EVAL-004, AC-040, AC-041, AC-042, AC-123.
- [ ] T020 is reserved for the test lane (see Phase 7): product tasks do not
      author suites. — [evidence: NO_OP_ALREADY_SATISFIED] planning-time
      numbering reservation only; no product code.
      Traces: FR-MAT-001…012, FR-EVAL-001…009.
- [x] T021 [serial-reason: SEMANTIC_DEPENDENCY] Implement
      `packages/evaluation/src/missed-opportunity.ts` + `src/exploration.ts`:
      FR-EVAL-005 — the §31.10 Missed Opportunity Analyzer steps 1–8 over the
      proven `disc.discovery_universe_entries` + coverage populations +
      `sig.candidate_funnel_stages` + `evidence_acquisition_decisions` +
      `candidate_decision_timelines` (coverage existence, first
      source/availability, funnel/evidence exit, §31.11 classification,
      delay decomposition, symmetric counterfactual action time, frozen
      evidence/versions/population boundary, next-eligible-dataset
      attachment without current-holdout contamination); FR-EVAL-006 —
      exploration/control retention consuming `sig.ranking_audits`
      exploration arms (selection arm + probability + cutoff reason),
      outcome-only tracking of control candidates, and the AC-043 retention
      law (the exploration sample is retained for outcome analysis and
      enters evaluation under the same action-time semantics). Depends on
      T018. Colocated suites authored by test-owned T027. Traces:
      FR-EVAL-005, FR-EVAL-006, AC-041, AC-043.
- [x] T022 [serial-reason: SEMANTIC_DEPENDENCY] Implement
      `packages/evaluation/src/controls.ts` + `src/intervals.ts` +
      `src/incident.ts`: FR-MAT-004 — the §68.5 negative-control harness
      (label permutation, feature-time shift, delayed-provider placebo,
      backfilled-availability placebo, synthetic null features,
      forbidden-future/outcome-column scan, same-entity/overlapping-window
      leakage scans, provider-ID-only predictor) as seeded deterministic
      transforms of frozen inputs with registered material-lift thresholds;
      unexpected lift blocks promotion and opens a §68.12 incident;
      FR-MAT-005 — cluster/block bootstrap intervals (CLUSTER_BOOTSTRAP,
      BLOCK_BOOTSTRAP_CALENDAR, BLOCK_BOOTSTRAP_REGIME,
      RANDOMIZATION_INFERENCE) over the nine §68.6 cluster definitions with
      naive-vs-effective sample size, alternate-clustering sensitivity, and
      the low-ESS gate (AC-151); §68.12 incident triggers with
      influence-paused records (AC-150 negative-control subset this package
      computes; the availability-backdating placebo facet stays shared with
      the data-truth owner via AC-249 extension). Depends on T002, T013,
      T018. Colocated suites authored by test-owned T027. Traces:
      FR-MAT-004, FR-MAT-005, AC-150, AC-151, AC-245, AC-246, AC-249.
- [x] T023 [serial-reason: SEMANTIC_DEPENDENCY] Implement
      `packages/evaluation/src/champion-challenger.ts` +
      `src/drift-calibration.ts` + `src/experiments.ts` +
      `src/selection-bias.ts`: FR-EVAL-007 — §31.12 comparison (same
      candidate stream, same frozen availability boundary, equalized
      budgets structurally CHECKed, zero challenger external side effects,
      model-removed baseline comparison, promotion constraints recorded);
      FR-EVAL-008 — drift/calibration controls (five kinds) with automatic
      expected-net-utility degradation on detected calibration/regime drift
      completing AC-154's machinery (the sig-proven DISABLED challenger
      state stays regression-locked); FR-EVAL-009 — the §31.3 experiment
      registry (pre-registration before results), §31.13 multiple-testing
      families with adjusted values + winner's-curse diagnostics +
      holdout-exposure status, §31.14 versioned power/precision plans
      (minimum mature cases, successes, failures, rugs, cluster ESS,
      calendar blocks, regime coverage, interval width, minimum detectable
      utility — never a single global count; AC-248), §68.7 registered
      sequential rules; §31.9/§68.10 selection-bias diagnostics over the
      proven `probe_assignments` (assignment probability recorded before
      retrieval — AC-243 — and before outcome maturity), propensity
      validity, and the claim-restriction fallback. Depends on T018–T022.
      Colocated suites authored by test-owned T027. Traces: FR-EVAL-007,
      FR-EVAL-008, FR-EVAL-009, AC-154, AC-243, AC-244, AC-248, AC-249.
- [x] T024 [P] Implement `packages/evaluation/src/read-only-guard.ts`:
      INV-001 structural surface (no execution/custody/signing/submission
      surface, no model-provider/agent import — the deterministic evaluation
      path is closed to learned input; §31.5 network denial asserted);
      prohibited-capability scanner hook. Depends on T018–T023. Traces:
      FR-EVAL-001…009.

## Phase 6 — Evaluation CLI (blocks gates)

- [x] T025 [serial-reason: SEMANTIC_DEPENDENCY] Implement
      `packages/eval-cli/src/cli.ts` + `src/report.ts` + `src/exit-codes.ts` +
      index.ts and the bin entry: the deterministic command surface
      (`maturity-sweep`, `dataset-build`, `replay-run`, `metric-report`,
      `baseline-compare`, `missed-scan`, `controls-run`,
      `compare-challenger`) driving `outcome-maturity`/`evaluation` exported
      APIs ONLY (no business law of its own; no network client, no
      credentials, no interactive auth; JSON reports to stdout or `--out`
      including denominator disclosures and population claims; exit codes
      0/1 with typed refusal reporting). Depends on T013–T024. Colocated
      end-to-end suites authored by test-owned T027. Traces: FR-EVAL-001…009
      (CLI implementation surface per the manifest), FR-MAT-010 (report
      disclosure law).

## Phase 7 — Fixtures and acceptance/negative suites (blocks gates)

- [x] T026 [P] [executor: TEST] Author `tests/fixtures/mat/maturity-vectors.ts` +
      `tests/fixtures/mat/denominator-vectors.ts`: §12.8/§68.1 maturity
      vectors over every horizon and maturity state (pending → partial →
      matured progression, absorbing censor/invalid, no-reset regression
      cases), §68.3 censor (5) + invalid (5) reason vectors, and §68.2
      denominator vectors with every FR-MAT-010 excluded class represented
      (invalid, censored, partial, low-resolution, rights-blocked,
      unobserved, signal-only) and hand-computed expected denominators.
      Traces: FR-MAT-001, FR-MAT-002, FR-MAT-003, FR-MAT-010, AC-123, AC-124.
- [x] T027 [P] [executor: TEST] Author `tests/fixtures/mat/sampling-vectors.ts` +
      `tests/fixtures/mat/promotion-evidence-vectors.ts`: §31.8 stratified
      sampling vectors (strata across the eight dimensions, inclusion
      probabilities, Horvitz–Thompson expected weighted estimates,
      weight-stability violation cases, max-weight ceiling cases), and
      FR-MAT-008/009/011/012 promotion-evidence vectors (exact-configuration
      match/mismatch, coarse-only refusals, adverse-vs-optimistic ordering
      pairs, expiry/cancellation/invalidation side effects with post-expiry
      gains, capacity-limited opportunities with expected notional/capacity
      disclosures). Traces: FR-MAT-007, FR-MAT-008, FR-MAT-009, FR-MAT-011,
      FR-MAT-012, AC-128, AC-152.
- [x] T028 [P] [executor: TEST] Author `tests/fixtures/eval/profiles.ts` +
      `tests/fixtures/eval/datasets.ts` + `tests/fixtures/eval/metrics-vectors.ts`:
      §8.3-shaped profile vectors (population scopes, success/failure/neutral
      clauses, stress pass matrices), §31.2 dataset vectors (six partitions,
      holdout-exposure states, purge/embargo bounds, leakage group keys), and
      §31.6 metric golden vectors with hand-computed expectations (precision/
      recall/NDCG, rank, lead time, MFE/MAE, survival, divergence, maturity
      rates, deterministic expectancy/drawdown/CVaR components) over the
      maturity fixtures. Traces: FR-EVAL-001, FR-EVAL-002, FR-EVAL-003, AC-040.
- [x] T029 [P] [executor: TEST] Author `tests/fixtures/eval/baselines.ts` +
      `tests/fixtures/eval/missed-opportunities.ts` +
      `tests/fixtures/eval/controls-vectors.ts` +
      `tests/fixtures/eval/intervals-vectors.ts`: §31.7 baseline vectors
      (matching/unmatched universes, comparator selection), §31.10/§31.11
      missed-opportunity vectors (every reachable taxonomy member with
      expected classification, delay decompositions, counterfactual action
      times), §68.5 control vectors (seeded permutations, placebo
      constructions, leakage scans, expected no-material-lift and
      material-lift cases), and §68.6 interval vectors (correlated-token
      fixtures with known cluster structure, naive-vs-clustered expected
      divergence, alternate-cluster sensitivity, ESS gate cases). Traces:
      FR-EVAL-004, FR-EVAL-005, FR-MAT-004, FR-MAT-005, AC-042, AC-150,
      AC-151.
- [ ] T030 [P] [executor: TEST] Author the colocated product-side suites under
      `packages/domain/test/` (`mat.spec.ts`, `eval.spec.ts`) and
      `packages/shared-schemas/test/` (`mat.spec.ts`, `eval.spec.ts`): the
      18 vocabulary objects with fail-closed parse functions and stable
      error codes (unknown-member refusal for every vocabulary), the pure
      laws (maturityNeverResets truth table, censorNeverBecomesFailure,
      subjectiveCannotAlterObjective, adverseOrderingPrimacy,
      postExpiryGainsExcluded, promotionRequiresExactMatureEvidence,
      capacityDisclosureRequired, universalActionTime truth table,
      holdoutExposureGuards, weightingRequiresDiagnostics,
      populationClaimSupported, essGate, materialLiftDetector, horizonPurge),
      the MAT__/EVAL__ error-code blocks and error subclasses, and the
      shared-schema payload laws (censor-reason-required refinement,
      promotion-requires-mature-evidence, interval-order, lift-implies-
      incident, weighting-requires-diagnostics, unknown enum refusal, strict
      unknown-key refusal, ISO-8601 timestamps, sha256 refs, decimal-string
      metric law). Traces: FR-MAT-001…012, FR-EVAL-001…009.
- [ ] T031 [P] [executor: TEST] Author colocated package suites under
      `packages/outcome-maturity/test/` (maturity-ledger.spec.ts,
      denominators.spec.ts, label-separation.spec.ts, sampling.spec.ts,
      promotion-evidence.spec.ts, read-only-guard.spec.ts) and
      `packages/evaluation/test/` (profiles.spec.ts, frozen-replay.spec.ts,
      action-time.spec.ts, metrics.spec.ts, baselines.spec.ts,
      missed-opportunity.spec.ts, exploration.spec.ts, controls.spec.ts,
      intervals.spec.ts, incident.spec.ts, champion-challenger.spec.ts,
      drift-calibration.spec.ts, experiments.spec.ts,
      selection-bias.spec.ts, read-only-guard.spec.ts): ledger append-only +
      idempotency + no-reset laws on PGlite; disclosure refusal laws;
      two-plane separation; estimator golden vectors + diagnostics
      fail-closed; promotion-evidence matching/refusal truth tables;
      replay byte-identical reruns + network denial; action-time symmetry
      across all arms; metric golden vectors; baseline comparator law;
      taxonomy completeness; control determinism (identical seeds →
      identical verdicts) and incident emission; clustered-vs-naive
      divergence; registry pre-registration; power-plan gates; propensity
      diagnostics; no-execution/no-LLM structural scans. PGlite-backed
      suites classified DATABASE_PGLITE via the coordinator manifest (T035).
      Traces: FR-MAT-001…012, FR-EVAL-001…009.
- [x] T032 [P] [executor: TEST] Author `packages/eval-cli/test/cli.spec.ts`:
      end-to-end command runs on PGlite (maturity-sweep → dataset-build →
      replay-run → metric-report with disclosure output → baseline-compare →
      missed-scan → controls-run), exit-code and typed-refusal reporting,
      report JSON carrying population claim + denominator disclosures, and
      the no-network assertion (§31.5 denial at the CLI seam). Traces:
      FR-EVAL-001…009, FR-MAT-010.
- [x] T033 [P] [executor: TEST] Author the 18 new AC files
      `tests/acceptance/AC-040.spec.ts` + `tests/negative/AC-040.negative.spec.ts`
      through `AC-044` pair + `AC-150` pair + `AC-151` pair + `AC-152` pair +
      `AC-153` pair (positive AND negative each): AC-040 separate
      signal/tradable labels from delivery time, canonical pool, notional/
      delay, impact, fees, fill constraints, exit policy, maturity state
      (§8.2 + FR-MAT-001); AC-041 precision AND recall/missed-gems reported
      together; AC-042 baseline/champion identical frozen universe + cutoff;
      AC-043 exploration sample retained for outcome analysis; AC-044 all
      experiment versions + attempted configurations recorded; AC-150 the
      four §31.13/68.5 controls show no unexplained material lift;
      AC-151 cluster/block intervals diverge from naive intervals on
      correlated fixtures; AC-152 IMPLEMENTED-but-unavailable cannot support
      alert claims, promotion requires PROVEN when specified; AC-153
      free-tier degradation preserves integrity/audit/dedup/critical-risk
      monitoring (outcome observation as protected reserve). Traces:
      FR-MAT-001…012, FR-EVAL-001…009, AC-040…044, AC-150…153.
- [ ] T034 [P] [executor: TEST] Extend shared AC suites IN PLACE (facet
      convention — never rewrite or weaken existing cases; header trace
      lists updated): `AC-120` pair + `AC-121` pair + `AC-122` pair +
      `AC-126` pair + `AC-127` pair (evaluation-side replay/label facets at
      this package's seams), `AC-123` pair (evaluation-side denominator
      composition facet — final metric refusal over pending/partial
      denominators with disclosure output), `AC-124` pair (evaluation-dataset
      retention of censor/invalid reasons facet), `AC-125` pair (objective/
      subjective evaluation isolation facet), `AC-128` pair (Horvitz–
      Thompson weighted-estimate facet over observation-plan samples with
      inclusion-weighted reproduction and universe-wide-claim refusal),
      `AC-154` pair (calibration-machinery facet — automatic
      expected-net-utility degradation on calibration/regime drift;
      DISABLED-challenger regression-locked), `AC-240` pair (universal
      action-time across all seven arm types facet),
      `AC-241` pair (champion/challenger frozen-replay comparison facet),
      `AC-242` pair (NOT_REQUESTED_BY_POLICY honesty in evaluation datasets
      facet), `AC-243` pair (probe-probability-before-maturity ordering
      facet), `AC-244` pair (selection-adjusted lift claim facet),
      `AC-245` pair (correlation-credit reduction facet at the cluster
      seam), `AC-246` pair (lineage-collapse sensitivity facet),
      `AC-247` pair (frozen-count preservation in realizable replay facet),
      `AC-248` pair (power/threshold promotion-gate facet — registered
      mature counts, cluster ESS, calendar/regime coverage, interval
      precision required even with favorable point estimates),
      `AC-249` pair (extended negative-control set facet — timestamp-shift,
      backdating placebo, outcome permutation, provider-ID predictor,
      synthetic noise, delayed-delivery, leakage controls at the evaluation
      seam). Every extended pair gains at least one positive and one
      negative mat/eval case. Traces: FR-MAT-001…012, FR-EVAL-001…009,
      AC-120…128, AC-154, AC-240…249.

## Phase 7b — Central registry extensions (blocks gates; plan-sanctioned scope exceptions)

- [ ] T035 [P] [executor: TEST] Extend `tests/telemetry-catalog.spec.ts` — the
      plan-sanctioned central-parity scope exception (milestone plan-level
      decision 4, exact path) — with `telemetry/mat.catalog.json` and
      `telemetry/eval.catalog.json` assertions pinning every new event's
      fields to the authoritative shared schemas field-for-field. No product
      surface is authored here. Traces: FR-MAT-001…012, FR-EVAL-001…009.
- [ ] T036 [P] [executor: TEST] Extend the central expected-script registry
      `packages/persistence/test/migrator.spec.ts` — the plan-sanctioned
      scope exception (ADR-0019/0022 duty, exact path): add
      `g1_mat_0001_maturity_ledger`, `g1_mat_0002_promotion_evidence`,
      `g1_eval_0001_profiles_datasets_registry`,
      `g1_eval_0002_runs_metrics_controls`,
      `g1_eval_0003_baseline_missed_controls` in lexicographic position in
      ALL expected-script lists and update the applied-count assertions
      (60 → 65). No other `packages/persistence/test/**` write exists.
      Traces: FR-MAT-001…012, FR-EVAL-001…009 (persistence substrate).

## Phase 8 — Telemetry catalog, manifest regen, and gates

- [x] T037 [P] Create `telemetry/mat.catalog.json` +
      `telemetry/eval.catalog.json` (DECLARATIVE_CONTRACT_ONLY header
      preserved, fields mirroring `packages/shared-schemas/src/mat.ts` /
      `eval.ts` exactly, requirementRefs per event):
      `mat.maturity_resolved` (FR-MAT-001), `mat.transition_recorded`
      (FR-MAT-001/002), `mat.denominator_disclosed` (FR-MAT-010),
      `mat.sampling_assigned` (FR-MAT-007), `mat.promotion_evidence_evaluated`
      (FR-MAT-008/009/011/012), `mat.subjective_utility_recorded`
      (FR-MAT-006); `eval.profile_registered` (FR-EVAL-001),
      `eval.dataset_frozen` (FR-EVAL-002), `eval.experiment_registered`
      (FR-EVAL-009), `eval.run_started` (FR-EVAL-002),
      `eval.metric_computed` (FR-EVAL-003), `eval.interval_computed`
      (FR-MAT-005), `eval.control_evaluated` (FR-MAT-004),
      `eval.incident_opened` (§68.12), `eval.baseline_compared`
      (FR-EVAL-004), `eval.missed_opportunity_classified` (FR-EVAL-005),
      `eval.challenger_compared` (FR-EVAL-007), `eval.drift_detected`
      (FR-EVAL-008), `eval.selection_bias_diagnosed` (FR-EVAL-009). The
      central telemetry parity suite is extended by the test-owned task T035
      in the same package — the plan-sanctioned central-parity scope
      exception. Traces: FR-MAT-001…012, FR-EVAL-001…009.
- [ ] T038 [executor: COORDINATOR] [evidence: VERIFICATION_ONLY] Run the
      milestone verification commands on the canonical tree: `test -d
packages/outcome-maturity && pnpm --filter @foresift/outcome-maturity test`;
      `test -d packages/evaluation && pnpm --filter @foresift/evaluation
test`; `test -d packages/eval-cli && pnpm --filter @foresift/eval-cli
test`; plus the extended central suites (`pnpm --filter
@foresift/persistence test` incl. migrator + schema-parity,
      `tests/telemetry-catalog.spec.ts`) and the authored/extended AC files
      (AC-040…044, AC-120…128, AC-150…154, AC-240…249). All green required.
      Traces: FR-MAT-001…012, FR-EVAL-001…009 (package-gate proof of every
      assigned requirement's substrate).
- [ ] T039 [executor: COORDINATOR] Regenerate the coordinator test manifest
      (`node scripts/automation/bun-migration-manifest.mjs --out
evidence/bun-migration/bun-migration-manifest.json`) after all new test
      files exist so `pnpm test`/`test:all` collect and classify them
      (PGlite-backed suites → DATABASE_PGLITE; OOM-safe per the test runtime
      contract). Mechanical bookkeeping (ADR-0020: coordinator-owned,
      zero-AI). Traces: FR-MAT-001…012, FR-EVAL-001…009 (verification
      substrate for every assigned requirement).
- [ ] T040 [executor: COORDINATOR] [evidence: VERIFICATION_ONLY] Run the full
      aggregate gate `pnpm verify` and the integrity gate `pnpm spec:verify`
      at the pushed HEAD; require green (the complete Bun suite runs ONLY
      through the coordinator — never a bare `bun test` over the tree). If
      anything turns red outside writeScopes, classify per governance, fix
      only in-scope failures, and record the rest in the run's out-of-scope
      notes. Traces: FR-MAT-001…012, FR-EVAL-001…009 (full suite + manifest
      integrity proof).

## Task → requirement coverage matrix

| Task | Requirements                                                                       | ACs                                            | Key files                                                                                               |
| ---- | ---------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| T001 | FR-MAT-001, FR-MAT-003, FR-MAT-006, FR-MAT-008, FR-MAT-009, FR-MAT-011, FR-MAT-012 | —                                              | packages/domain/src/mat.ts (vocabulary law)                                                             |
| T002 | FR-MAT-004, FR-MAT-005, FR-EVAL-002, FR-EVAL-003, FR-EVAL-009                      | AC-240, AC-242, AC-244, AC-248, AC-249         | packages/domain/src/eval.ts (vocabulary law)                                                            |
| T003 | FR-MAT-001…012, FR-EVAL-001…009                                                    | —                                              | packages/domain/src/errors.ts, index.ts                                                                 |
| T004 | FR-MAT-001…003, 006…012, FR-EVAL-001…003, 005, 007…009                             | —                                              | packages/shared-schemas/src/mat.ts, eval.ts                                                             |
| T005 | FR-MAT-001, FR-MAT-002, FR-MAT-003, FR-MAT-006, FR-MAT-007, FR-MAT-010             | —                                              | migrations/g1_mat_0001_maturity_ledger.sql                                                              |
| T006 | FR-MAT-008, FR-MAT-009, FR-MAT-011, FR-MAT-012                                     | —                                              | migrations/g1_mat_0002_promotion_evidence.sql                                                           |
| T007 | FR-EVAL-001, FR-EVAL-009                                                           | —                                              | migrations/g1_eval_0001_profiles_datasets_registry.sql                                                  |
| T008 | FR-MAT-004, FR-MAT-005, FR-EVAL-002, FR-EVAL-003, FR-EVAL-009                      | —                                              | migrations/g1_eval_0002_runs_metrics_controls.sql                                                       |
| T009 | FR-EVAL-004, FR-EVAL-005, FR-EVAL-007, FR-EVAL-008, FR-EVAL-009                    | —                                              | migrations/g1_eval_0003_baseline_missed_controls.sql                                                    |
| T010 | FR-MAT-001…012, FR-EVAL-001…009                                                    | —                                              | packages/persistence/src/migrator.ts (sanctioned exception)                                             |
| T011 | FR-MAT-001…012, FR-EVAL-001…009                                                    | —                                              | packages/persistence/src/generated/schema.ts (sanctioned exception)                                     |
| T012 | FR-MAT-001…012, FR-EVAL-001…009                                                    | —                                              | packages/outcome-maturity, packages/evaluation, packages/eval-cli scaffolds                             |
| T013 | FR-MAT-001, FR-MAT-002                                                             | AC-123                                         | packages/outcome-maturity/src/maturity-ledger.ts                                                        |
| T014 | FR-MAT-006, FR-MAT-010                                                             | AC-123, AC-125, AC-239                         | packages/outcome-maturity/src/denominators.ts, label-separation.ts                                      |
| T015 | FR-MAT-007                                                                         | AC-128, AC-244                                 | packages/outcome-maturity/src/sampling.ts                                                               |
| T016 | FR-MAT-008, FR-MAT-009, FR-MAT-011, FR-MAT-012                                     | AC-120, AC-126, AC-152                         | packages/outcome-maturity/src/promotion-evidence.ts                                                     |
| T017 | FR-MAT-001…012                                                                     | —                                              | packages/outcome-maturity/src/read-only-guard.ts                                                        |
| T018 | FR-EVAL-001, FR-EVAL-002                                                           | AC-240, AC-241, AC-247                         | packages/evaluation/src/profiles.ts, frozen-replay.ts, action-time.ts                                   |
| T019 | FR-EVAL-003, FR-EVAL-004                                                           | AC-040, AC-041, AC-042, AC-123                 | packages/evaluation/src/metrics.ts, baselines.ts                                                        |
| T021 | FR-EVAL-005, FR-EVAL-006                                                           | AC-041, AC-043                                 | packages/evaluation/src/missed-opportunity.ts, exploration.ts                                           |
| T022 | FR-MAT-004, FR-MAT-005                                                             | AC-150, AC-151, AC-245, AC-246, AC-249         | packages/evaluation/src/controls.ts, intervals.ts, incident.ts                                          |
| T023 | FR-EVAL-007, FR-EVAL-008, FR-EVAL-009                                              | AC-154, AC-243, AC-244, AC-248, AC-249         | packages/evaluation/src/champion-challenger.ts, drift-calibration.ts, experiments.ts, selection-bias.ts |
| T024 | FR-EVAL-001…009                                                                    | —                                              | packages/evaluation/src/read-only-guard.ts                                                              |
| T025 | FR-EVAL-001…009, FR-MAT-010                                                        | —                                              | packages/eval-cli/src/cli.ts                                                                            |
| T026 | FR-MAT-001, FR-MAT-002, FR-MAT-003, FR-MAT-010                                     | AC-123, AC-124                                 | tests/fixtures/mat/maturity-vectors.ts, denominator-vectors.ts                                          |
| T027 | FR-MAT-007, FR-MAT-008, FR-MAT-009, FR-MAT-011, FR-MAT-012                         | AC-128, AC-152                                 | tests/fixtures/mat/sampling-vectors.ts, promotion-evidence-vectors.ts                                   |
| T028 | FR-EVAL-001, FR-EVAL-002, FR-EVAL-003                                              | AC-040                                         | tests/fixtures/eval/profiles.ts, datasets.ts, metrics-vectors.ts                                        |
| T029 | FR-EVAL-004, FR-EVAL-005, FR-MAT-004, FR-MAT-005                                   | AC-042, AC-150, AC-151                         | tests/fixtures/eval/baselines.ts, missed-opportunities.ts, controls-vectors.ts, intervals-vectors.ts    |
| T030 | FR-MAT-001…012, FR-EVAL-001…009                                                    | —                                              | packages/domain/test/{mat,eval}.spec.ts, packages/shared-schemas/test/{mat,eval}.spec.ts                |
| T031 | FR-MAT-001…012, FR-EVAL-001…009                                                    | AC-120…128, AC-154, AC-240…249                 | packages/outcome-maturity/test/_.spec.ts, packages/evaluation/test/_.spec.ts                            |
| T032 | FR-EVAL-001…009, FR-MAT-010                                                        | —                                              | packages/eval-cli/test/cli.spec.ts                                                                      |
| T033 | FR-MAT-001…012, FR-EVAL-001…009                                                    | AC-040…044, AC-150…153                         | tests/acceptance/AC-0{40…44}.spec.ts (+negative), AC-15{0…3}.spec.ts (+negative)                        |
| T034 | FR-MAT-001…012, FR-EVAL-001…009                                                    | AC-120…128, AC-154, AC-240…249                 | tests/acceptance + tests/negative facet extends                                                         |
| T035 | FR-MAT-001…012, FR-EVAL-001…009                                                    | —                                              | tests/telemetry-catalog.spec.ts (sanctioned exception)                                                  |
| T036 | FR-MAT-001…012, FR-EVAL-001…009                                                    | —                                              | packages/persistence/test/migrator.spec.ts (sanctioned exception)                                       |
| T037 | FR-MAT-001…012, FR-EVAL-001…009                                                    | —                                              | telemetry/mat.catalog.json, telemetry/eval.catalog.json                                                 |
| T038 | FR-MAT-001…012, FR-EVAL-001…009                                                    | AC-040…044, AC-120…128, AC-150…154, AC-240…249 | — (verification)                                                                                        |
| T039 | FR-MAT-001…012, FR-EVAL-001…009                                                    | —                                              | evidence/bun-migration/bun-migration-manifest.json (coordinator)                                        |
| T040 | FR-MAT-001…012, FR-EVAL-001…009                                                    | —                                              | — (verification)                                                                                        |

## Cross-artifact consistency analysis (speckit-analyze, completed at planning)

- **Coverage**: 21/21 assigned requirements traced (FR-MAT-001…012,
  FR-EVAL-001…009); every assigned AC has an explicit owner: AC-040…044 and
  AC-150…153 authored here (T033 — 18 files, files do not yet exist),
  AC-120…128, AC-154, AC-240…249 extended additively here (T034 + T031/T032
  colocated suites; the exec-side classification facets of AC-123/124/125/128
  and the promotion-denominator DISCLOSURE facet of AC-239 stay
  regression-locked from g1-execution-simulation — no case duplicates them),
  and the FR-MAT statistical extensions recorded exactly as g1-execution-
  simulation's spec anticipated ("g1-outcome-evaluation will EXTEND
  additively with its machinery").
- **Traceability**: no task cites a requirement outside the package's
  assignment (validator-enforced: FR-EXEC/FR-SIG/FR-DATA/FR-DISC/FR-COST/
  FR-OBJ and every non-assigned ID are absent from tasks.md); every task
  cites ≥1 FR-MAT-_/FR-EVAL-_ ID or its AC.
- **Scope**: every predicted write lands inside writeScopes except the four
  plan-sanctioned exceptions named by exact path (T010 migrator family-list
  extension, product-owned; T011 ADR-001 Drizzle mirror catch-up,
  product-owned; T036 central migration registry suite, test-owned; T035
  central telemetry parity suite, test-owned) plus the T039 mechanical
  manifest regen (ADR-0020 coordinator duty) — consistent with the landed
  g1-data-truth (#175), g1-execution-simulation (#208), g1-signal-registry
  (#245) precedent; the four sanctioned paths match the milestone plan-level
  decisions 1 and 4 mechanism verbatim.
- **Ownership routing per the 2026-09-07 admission law**: all test/fixture/
  suite authorship lives in test-owned tasks (T026–T030, T031–T036);
  implementation lanes carry product code only (T001–T025, T037); T038–T040
  are coordinator verification/bookkeeping ([evidence: VERIFICATION_ONLY]
  where required). Parallelism markers per the 2026-09-08 directive: [P] on
  write-disjoint tasks (T001, T002, T017, T024, T026–T030, T031–T037),
  exactly one six-vocabulary [serial-reason] on each truly-serial product
  task (ORDERED_MIGRATION for the five g1_mat/g1_eval migrations
  T005–T009 + registry/mirror seam T010/T011; SEMANTIC_DEPENDENCY for the
  vocabulary → schema → package-core → evaluation-engine → CLI chain
  T003/T004/T012–T016/T018–T019/T021–T023/T025).
- **Ordering**: the deterministic pipeline staging order is enforced by phase
  structure and explicit dependency references: Phase 1 vocabularies/laws →
  Phase 2 schemas → Phase 3 persistence (migrations, migrator, mirror) →
  Phase 4 outcome-maturity core → Phase 5 evaluation engine → Phase 6 CLI →
  Phase 7 fixtures/suites → Phase 7b central extensions → Phase 8 telemetry
  - gates. `(blocks` headings in phases add the blocking-phase dependency
    edges the task-graph builder requires.
- **Read-only law**: no task introduces trading/custody/signing/transaction-
  submission capability or any model/LLM surface; T017/T024 run the
  structural scan and the prohibited-capability scanner as explicit gates;
  §31.5 network denial is asserted at the replay runner and CLI seams.
- **No placeholders**: no template markers, no unresolved clarification
  blocks anywhere in the scoped artifacts.
