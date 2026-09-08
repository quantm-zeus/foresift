# Tasks: g1-signal-registry

**Input**: `specs/g1-signal-registry/spec.md`, `specs/g1-signal-registry/plan.md`
**Traceability rule**: every task cites at least one assigned requirement
(FR-SIG-001…006, FR-SIG-009) or an acceptance criterion of those requirements.
Requirement IDs not assigned to this package never appear here.

Format: `- [ ] T### [P?]` — **[P]** = parallelizable with its neighbors (disjoint files).
A PRODUCT task that must stay serial carries exactly one
`[serial-reason: SEMANTIC_DEPENDENCY|SHARED_FILE|ORDERED_MIGRATION|SHARED_INVARIANT|COORDINATOR_BOUNDARY|SAFETY_SERIALIZATION]`
marker (2026-09-08 maintainer directive; the parallelism audit refuses an
unjustified serial plan). Test-owned work carries `[executor: TEST]` and is
routed to the test-author lanes; implementation-dispatched product tasks
NEVER carry test/fixture/spec writes (2026-09-07 ownership admission law —
the graph builder refuses such plans before any provider spend).
Tests are mandatory per PRD evidence rules: positive AND negative/failure-path
specs for every acceptance criterion this package authors (AC-154, AC-190,
AC-191, AC-192, AC-193) plus additive sig-scoped extends of the shared
AC-020/021/022/023/136 suites.
Plan-sanctioned scope exceptions recorded per the milestone plan-level
decisions (1 and 4) and ADR-0019/0022 duty, named by exact path:
`packages/persistence/src/migrator.ts` (family-list extension with `sig`,
product-owned T007), `packages/persistence/src/generated/schema.ts`
(ADR-001 mirror catch-up, product-owned T008),
`packages/persistence/test/migrator.spec.ts` (central expected-script
registry, test-owned T039), and the central telemetry parity suite
(test-owned T040) are extended by this package even though they sit outside
the listed writeScopes. The ADR-001 mirror duty follows the landed precedent
of g1-data-truth-extensions (#175) and g1-execution-simulation (#208).

Staging order mirrors the PRD-mandated deterministic pipeline: registries and
vocabularies first, then persistence, then the feature/robust-baseline
computation core, then vectors/funnel, then deterministic selection, then
diversity/exploration/lifecycle/rechecks, then fixtures and AC suites, then
telemetry and gates.

## Phase 1 — Foundations: domain vocabularies and shared schemas (blocks later phases)

- [ ] T001 [P] Create `packages/domain/src/sig.ts`: `FunnelStage` (21 §20.1 stages,
      UPPERCASE snake literals from FREE_DISCOVERY_UNIVERSE_ATTRIBUTION through
      ALERT_POLICY), `VectorKind` (OPPORTUNITY, RISK, DATA_QUALITY, URGENCY,
      NOVELTY, TRADABILITY, SOURCE_INDEPENDENCE — §20.3 + Appendix I step 3),
      `ParetoStatus` (EFFICIENT, DOMINATED, UNKNOWN_DIMENSION_BLOCKED — §20.10
      unknown-never-favorable), `SelectionArm` (EXPLOITATION, UNCERTAINTY,
      RANDOM_EXPLORATION, EVIDENCE_PROBE, OUTCOME_OBSERVATION_ONLY,
      NOT_SELECTED — §20.8), `CutoffReason` (BELOW_BUDGET_CUTOFF,
      HARD_GATE_FAILED, PARETO_DOMINATED, DIVERSITY_CONSTRAINT,
      EXPLORATION_ARM, NOT_SELECTED_WITH_REASON — §20.7/§20.8),
      `CohortFallbackLevel` (EXACT_COHORT, REMOVE_NARRATIVE, REMOVE_REGIME,
      WIDEN_MARKET_CAP_BAND, WIDEN_AGE_BAND, CHAIN_LAUNCHPAD,
      OWN_HISTORY_ANOMALY — §19.9 default order, ordered), `LifecycleState`
      (DISCOVERED, QUALIFIED, EMERGING, CONFIRMED, MONITORING, DECAYING,
      REJECTED, ARCHIVED — §21.1), `RecheckDecisionKind` (RECHECK_NOW,
      DEFER_BACKOFF, STARVED_SKIP, EXPIRED_STOP, BUDGET_EXHAUSTED_STOP,
      INFO_VALUE_BELOW_FLOOR_SKIP — §21.2), `DiversityConstraintKind`
      (NARRATIVE, DEVELOPER_CLUSTER, FUNDING_CLUSTER, LAUNCHPAD — §20.5) with
      fail-closed parse throwing typed errors with stable `SigErrorCode`s
      (SIG_STAGE_UNKNOWN, SIG_VECTOR_KIND_UNKNOWN, SIG_ARM_UNKNOWN,
      SIG_CUTOFF_UNKNOWN, SIG_FALLBACK_LEVEL_UNKNOWN, SIG_LIFECYCLE_UNKNOWN,
      SIG_RECHECK_DECISION_UNKNOWN, SIG_CONSTRAINT_KIND_UNKNOWN); plus the
      pure laws `unknownCannotDominate` (§20.10: a candidate with unknown data
      cannot dominate one with known favorable evidence merely because unknown
      dimensions are omitted), `numericFeatureStabilityComplete` (FR-SIG-009:
      minimum denominator/sample, stability transform, outlier/null policy,
      shrinkage, capped contribution, cohort fallback all defined → boolean),
      and `confirmedRequiresTradableVerdict` (FR-SIG-005 risk separation: the
      proven `TradabilityVerdict` TRADABLE member is the only pass). Colocated
      unit tests are authored by the test-owned task T037 (2026-09-07
      ownership law: implementation lanes carry product work only).
      Traces: FR-SIG-001, FR-SIG-002, FR-SIG-003, FR-SIG-004,
      FR-SIG-005, FR-SIG-006, FR-SIG-009, AC-136, AC-154.
- [ ] T002 [serial-reason: SEMANTIC_DEPENDENCY] [P] Extend `packages/domain/src/index.ts` exports for the new sig
      module. Traces: FR-SIG-001…006, FR-SIG-009.
- [ ] T003 [P] Create `packages/shared-schemas/src/sig.ts`: Zod schemas for
      `FeatureDefinition` (§19.1 exact field set incl. minimumDenominator,
      stabilityTransform, shrinkagePolicy, cohortFallbackPolicyId,
      economicEventRequired; refinement: every numeric feature defines the
      §19.9 field set — FR-SIG-009 at the payload layer), `FeatureLineage`
      (§19.10 exact: definition id + version, entity and profile, event/window
      bounds, input observation/evidence IDs, input hashes `sha256:<hex>`,
      calculation code version, calculated_at, quality codes),
      `CohortSnapshot` (fallback level + cohort size + effective sample size +
      peer percentile + low-sample warning), `FunnelStageRecord` (§20.2
      profile-versioned, reason-coded gate outcomes),
      `CandidateVectorRecord` (components as named values or explicit
      null + quality code — never silently absent), `RankingAudit` (§20.7
      exact field set + §20.8 arm/probability + protected allocations +
      algorithm version + t_decision_ready), `LifecycleTransition`,
      `RecheckBudget` (§21.2 exact seven fields), `RecheckDecision` —
      importing domain enums (never restating), `.strict()`, decimal-string
      quantity rules, ISO-8601 Z timestamps, `sha256:<hex>` hashes,
      `SIG_SCHEMA_REGISTRY_VERSION = 1`; unknown state/level/arm values fail
      closed; schema refinement enforces exploration-assignment nonzero
      probability and the unknown-cannot-dominate vector shape at the payload
      layer. Extend `packages/shared-schemas/src/index.ts` exports. Colocated
      schema tests are authored by the test-owned task T038 (2026-09-07
      ownership law). Traces: FR-SIG-001, FR-SIG-002, FR-SIG-003, FR-SIG-004,
      FR-SIG-005, FR-SIG-006, FR-SIG-009.

## Phase 2 — Persistence: migration family + registry extensions (blocks repos and PGlite suites)

- [ ] T004 [serial-reason: ORDERED_MIGRATION] Create `migrations/g1_sig_0001_feature_registry.sql`:
      `sig.feature_definitions` (§19.1 field-for-field; numeric-feature
      §19.9 CHECK law: minimum_denominator ≥ 1, stability_transform,
      shrinkage_policy, cohort_fallback_policy_id, robust outlier policy all
      required when numeric — FR-SIG-009; capped_contribution ∈ (0,1] on
      ranking-eligible numeric features), `sig.feature_lineage` (§19.10 field
      set, input_hashes cardinality > 0, event_time_resolved_at replay
      boundary), `sig.cohort_snapshots` (fallback_level CHECK with the seven
      §19.9 members, cohort_size, effective_sample_size, peer_percentile ∈
      [0,1], low_sample_warning). Traces: FR-SIG-001, FR-SIG-009, AC-021,
      AC-136.
- [ ] T005 [serial-reason: ORDERED_MIGRATION] Create `migrations/g1_sig_0002_funnel_vectors_ranking.sql`:
      `sig.candidate_funnel_stages` (§20.1 stages, §20.2 gate_code required on
      failure, profile_version), `sig.candidate_vectors` (seven VectorKind
      members, components JSON with explicit null+code honesty, algorithm
      version, lineage FK), `sig.ranking_audits` (§20.7 exact fields,
      ParetoStatus/DiversityAdjustment/CutoffReason/SelectionArm CHECKs,
      selection_probability ∈ (0,1] or NULL for deterministic arms,
      protected_allocations JSON, capacity_admission, algorithm_version,
      t_decision_ready). Traces: FR-SIG-002, FR-SIG-003, FR-SIG-004, AC-190,
      AC-192, AC-193.
- [ ] T006 [serial-reason: ORDERED_MIGRATION] Create `migrations/g1_sig_0003_lifecycle_rechecks.sql`:
      `sig.candidate_lifecycle` (§21.1 states, from ≠ to CHECK,
      `sig_confirmed_requires_tradability` CHECK implementing the FR-SIG-005
      risk separation at the persistence layer, diagnostic_signal_labels
      preserved, thesis_invalidation_conditions JSON §21.4, policy_version,
      dwell column), `sig.recheck_budgets` (§21.2 exact seven fields + usage
      counters + starved_since, expires_at > next_check_at CHECK),
      `sig.recheck_decisions` (append-only decision audit with §62.7
      information_value stored as allocation aid, protected_reserve_class
      domain-ReserveClass members, FK to budget row). Traces: FR-SIG-005,
      FR-SIG-006, AC-190, AC-193.
- [ ] T007 [P] Extend `packages/persistence/src/migrator.ts`
      MIGRATION_FAMILIES with the `sig` family (fail-closed pattern
      extension) — the plan-sanctioned scope exception (plan-level decision
      1). The central expected-script registry suite is extended by the
      test-owned task T039 in the same package (ADR-0019/0022 duty;
      2026-09-07 ownership law). Traces: FR-SIG-001…006, FR-SIG-009.
- [ ] T008 [P] Extend `packages/persistence/src/generated/schema.ts` (the
      hand-maintained ADR-001 Drizzle mirror) with the sig.* tables from
      g1_sig_0001…0003 so the persistence schema-parity gate stays green —
      the plan-sanctioned mirror catch-up scope exception (exact precedent:
      g1-data-truth-extensions #175, g1-execution-simulation #208). The
      parity suite itself is test-owned; its verification runs in T039's
      suite and T034's coordinator gate, never from this lane.
      Traces: FR-SIG-001, FR-SIG-002, FR-SIG-003, FR-SIG-004, FR-SIG-005,
      FR-SIG-006, FR-SIG-009.

## Phase 3 — Feature registry, stability, and Appendix H baseline computation (blocks vectors and selection)

- [ ] T009 [serial-reason: SEMANTIC_DEPENDENCY] Scaffold `packages/signal-intelligence` (package.json
      `@foresift/signal-intelligence` with workspace `*` deps on domain,
      persistence, shared-schemas, evidence; `bun test` script; tsconfig
      extending tsconfig.base.json; no per-package runner config — G0/G1
      scaffold pattern). Traces: FR-SIG-001…006, FR-SIG-009.
- [ ] T010 [serial-reason: SEMANTIC_DEPENDENCY] Implement `packages/signal-intelligence/src/registry.ts` +
      `src/lineage.ts`: FR-SIG-001 registration law (§19.1 field-for-field,
      additive versioning — a change is a new version, never an edit;
      registration refuses drift of an existing version; independent-
      reimplementation explicitness enforced at registration review + test),
      §19.10 lineage records with input observation/evidence IDs, input
      hashes, code version, calculated_at, quality codes, and the
      event-time-resolved-at replay boundary; claim-support law: a value whose
      required input lineage is missing or was unavailable at decision time
      cannot support a claim (§19.10 closing law; extends the G0
      `supportsPopulationClaim` seam). Colocated suites: registration
      drift refusal, lineage completeness, unavailable-at-decision-time
      refusal — authored by test-owned T037 (ownership law).
      Traces: FR-SIG-001, FR-SIG-009, AC-021.
- [ ] T011 [serial-reason: SEMANTIC_DEPENDENCY] Implement `packages/signal-intelligence/src/stability.ts` +
      `src/cohort.ts`: FR-SIG-009/§19.9 numerical stability — zero/one/
      low-sample denominator behavior, log1p-style stable transforms,
      winsorization/robust outlier policy, shrinkage toward an appropriate
      prior for small samples, maximum capped contribution clamp, quality
      downgrade when economic actors cannot be resolved (consuming the proven
      actor-resolution vocabulary), deterministic cohort fallback hierarchy
      resolver over the exact §19.9 order (exact cohort → remove narrative →
      remove regime → widen market-cap band → widen age band → chain+launchpad
      → own-history anomaly) with every percentile storing the chosen fallback
      level and cohort size, plus §19.11 cohort comparison outputs (peer
      percentile, sample size, low-sample warning; dimensions with no G1
      upstream data degrade explicitly). Colocated suites: fallback-level
      truth table (all seven reachable and deterministic), shrinkage bounds,
      capped-contribution clamp, low-sample warnings — authored by test-owned
      T037 (ownership law). Traces: FR-SIG-009, FR-SIG-001, AC-136.
- [ ] T012 [serial-reason: SEMANTIC_DEPENDENCY] Implement `packages/signal-intelligence/src/baseline-features.ts`:
      Appendix H.1–H.12 baseline formulas as versioned registered features
      computed over EVENT time through the proven replay-honest seam
      (`visibleAt`-resolved; exact decimal arithmetic; unquantified-event
      accounting): H.1 volume acceleration (LOW_SAMPLE < 3 populated 5m
      buckets), H.2 volume persistence, H.3 price extension, H.4 unique-buyer
      log growth with economic-actor deduplication when cluster confidence
      exceeds the configured threshold (consuming proven
      `actor_resolution_state`/`actor_resolution_confidence` — never restated),
      H.5 buy/sell imbalance, H.6 liquidity growth, H.7 top-10 concentration
      slope, H.8 holder log growth, H.9 trade-size entropy (one-bucket → null
      with LOW_SAMPLE), H.10 manipulation indicators (shared funder ratio,
      round-trip ratio, actor volume concentration — risk indicators, not
      proof), H.12 data coverage. Colocated suites: golden vectors per
      formula, boundedness properties (imbalance ∈ [−1,1], entropy ∈ [0,1]),
      window boundary fixtures, dedup threshold fixtures — authored by
      test-owned T037 (ownership law). Traces: FR-SIG-001, FR-SIG-009,
      AC-136, AC-020, AC-022, AC-023.
- [ ] T013 [serial-reason: SEMANTIC_DEPENDENCY] Implement `packages/signal-intelligence/src/robust-baseline.ts`:
      H.11 robust activity and change-point baseline — log1p transform, median
      center, 1.4826·MAD scale with epsilon floor, robust z, EWMA fast/slow
      (0.50/0.10 alphas), ewma_delta, emergence change-point requiring both
      detectors above profile thresholds for ≥ 2 populated buckets plus
      minimum absolute activity, one-sided CUSUM second detector
      (`S_t = max(0, S_{t-1} + robust_z_t - drift_allowance)`); all windows,
      alphas, drift allowance, threshold, minimum activity and missing-bucket
      handling versioned by feature/profile; a detector cannot promote when
      the baseline sample is below its minimum or economic-event coverage is
      insufficient. Colocated suites: emergence fixtures, no-promotion-below-
      minimum, CUSUM drift vectors, missing-bucket handling — authored by
      test-owned T037 (ownership law). Traces: FR-SIG-009, FR-SIG-002,
      AC-136.

## Phase 4 — Funnel, vectors, and deterministic selection (blocks diversity/lifecycle)

- [ ] T014 [serial-reason: SEMANTIC_DEPENDENCY] Implement `packages/signal-intelligence/src/funnel.ts` +
      `src/vectors.ts`: FR-SIG-002 — §20.1 funnel stage vocabulary with
      profile-versioned, reason-coded §20.2 hard gates (invalid/ambiguous
      identity, unsupported chain/provider, liquidity below minimum, critical
      honeypot/transfer restriction, known malicious deployer, unusable
      canonical pool, data coverage below minimum, price extension beyond
      profile maximum, license restriction, non-executable entry/exit,
      unknown required Token-2022 behavior, unavailable required capability,
      unacceptably extended price move); the seven independent vectors
      (§20.3 + Appendix I step 3) with unknown components rendered as explicit
      null + quality code, never favorable (§20.10); TradabilityVector
      consuming the PROVEN execution-simulator verdicts/feasibility envelope
      (H.14–H.16 consumed, never computed here); SourceIndependenceVector
      consuming the PROVEN point-in-time dependence state (H.13 —
      SAME_UPSTREAM duplicates share one capped group credit,
      UNKNOWN_DEPENDENCE conservative weight); structural no-single-buy-score
      law (no vector set collapses to one scalar). Colocated suites: gate
      reason-coding truth table, vector null-honesty, unknown-blocking,
      tradability consumption — authored by test-owned T037 (ownership law).
      Traces: FR-SIG-002, AC-020, AC-136.
- [ ] T015 [serial-reason: SEMANTIC_DEPENDENCY] Implement `packages/signal-intelligence/src/selection.ts`:
      FR-SIG-003 — the Appendix I deterministic selection algorithm steps 1–13
      as pure versioned functions over a FROZEN eligible universe: resolve
      identity/program/source/availability point-in-time (1); hard gates (2);
      seven vectors (3); robust cohort values with stored fallback level,
      sample size, quality (4); required execution scenarios via proven
      adapters (5); conservative feasibility envelope (6); gate removal (7);
      Pareto efficiency with unknown-dimension blocking (8); lexicographic
      sort a–g exactly as specified (9); exposure constraints (10); protected
      allocations — risk, alert verification, outcome observation, interactive
      reserve — using the proven ReserveClass vocabulary (11); budget
      partition among exploitation, uncertainty, stratified randomized
      exploration, randomized evidence probes (12); persist eligible universe,
      vector values, gates, source dependence, adapter/scenario results, rank,
      selection arm/probability, cutoff reason, capacity admission, algorithm
      version, T_decision_ready (13). §20.7 ranking audit records; §20.4
      deterministic-versioned reproducibility law (identical frozen inputs →
      byte-identical audit). Colocated suites: reproducibility
      (byte-identical rerun), step-indexed positive/negative cases, sort-key
      a–g ordering fixtures, frozen-universe drift refusal — authored by
      test-owned T037 (ownership law). Traces: FR-SIG-003, FR-SIG-002,
      AC-154, AC-190.
- [ ] T016 [serial-reason: SEMANTIC_DEPENDENCY] Implement `packages/signal-intelligence/src/challenger-seam.ts`:
      the AC-154/§20.4/Appendix-I closing law as structure — pre-proof the
      deterministic path structurally excludes learned input (registry rows +
      typed refusal), post-proof a challenger may only break ties or allocate
      research within allowed scope, hard gates/steps 1–8/protected
      allocations remain non-overridable, and calibration/regime drift
      automatically degrades the challenger to disabled (§20.4: "disabled
      automatically on calibration or regime drift"); not rendered as a buy
      probability. Colocated suites: pre-proof ordering-input refusal,
      override refusal truth table, drift → automatic degradation,
      tie-break-only effect — authored by test-owned T037 (ownership law).
      Traces: FR-SIG-003, AC-154.

## Phase 5 — Diversity, exploration, lifecycle, rechecks (blocks AC suites)

- [ ] T017 [serial-reason: SEMANTIC_DEPENDENCY] Implement `packages/signal-intelligence/src/diversity.ts` +
      `src/exploration.ts`: FR-SIG-004 — §20.5 diversity constraints with the
      configurable defaults (max 2 per narrative, 1 per developer cluster,
      1 per funding cluster, 3 per launchpad) and explicit
      CONSTRAINT_DIMENSION_UNAVAILABLE records for G1-absent upstream data;
      §20.6 exploration/control sample — at least 5% of otherwise eligible
      low-ranked candidates randomly selected for outcome-only tracking
      (seeded deterministic sampling with recorded seed provenance, valid
      stratum, nonzero inclusion probability; never auto-alerted); §20.8
      selection arms/probabilities/not_selected_with_reason; budget partition
      with protected reserves first (§20.10: frontier dominance may reduce
      exploitation only after protected risk/outcome workloads, minimum
      exploration, population coverage, source diversity, novelty quotas);
      exploration floor preservation with audited-emergency-policy draw
      records (AC-192/AC-193 field set: eligibility universe, stratum, policy
      version, assignment probability, seed/entropy provenance, inclusion
      timestamp — stored BEFORE outcomes; corrupted assignments excluded from
      weighted claims by pure predicate). Colocated suites: constraint
      application, ≥5% floor, seed determinism (same seed → same sample,
      any iteration order), corrupted-assignment exclusion, emergency-draw
      audit trail — authored by test-owned T037 (ownership law).
      Traces: FR-SIG-004, AC-192, AC-193, AC-190.
- [ ] T018 [serial-reason: SEMANTIC_DEPENDENCY] Implement `packages/signal-intelligence/src/lifecycle.ts`:
      FR-SIG-005 — §21.1 lifecycle state machine (DISCOVERED, QUALIFIED,
      EMERGING, CONFIRMED, MONITORING, DECAYING, REJECTED, ARCHIVED) with
      entry-intent/default-action records; §21.3 transition hysteresis
      (promotion and demotion use different thresholds + minimum dwell times;
      versioned profile/policy thresholds — e.g. the QUALIFIED↔EMERGING
      persistence ≥ 0.70 / < 0.45-for-two-windows example shape); §21.4
      thesis-invalidation conditions stored at CONFIRMED/MONITORING
      (liquidity drawdown, top-holder concentration rise, developer wallet
      transfers, independent cohort exits, manipulation risk high, sponsored
      social concentration, price extension eliminating risk/reward);
      CONFIRMED requires the proven TRADABLE verdict (risk separation — the
      execution-simulator blocking gate consumed, diagnostic signal labels
      preserved). Colocated
      tests: state-machine transition truth table, hysteresis asymmetry,
      dwell violations, CONFIRMED-without-tradable refusal, invalidation
      condition evaluation. Traces: FR-SIG-005, AC-154.
- [ ] T019 [serial-reason: SEMANTIC_DEPENDENCY] Implement `packages/signal-intelligence/src/rechecks.ts` +
      `src/read-only-guard.ts`: FR-SIG-006 — §21.2 adaptive rechecks with the
      exact budget fields (max_rechecks, max_recheck_provider_calls,
      max_recheck_model_cost, next_check_at, expires_at, backoff_factor,
      minimum_expected_information_gain) enforced at the seam: scheduling only
      while budget remains, not expired, not starved past the starvation
      limit, and §62.7 information-value ≥ the configured minimum; §62.7
      formula (estimated decision impact × material-state-change probability ×
      evidence reliability × incremental independence value ÷ normalized
      resource cost) as an ALLOCATION AID ONLY, structurally barred from the
      deterministic rank; one-off check intervals (5/15/30/60 min or custom);
      every deferred/stopped decision recorded with reason; a candidate MUST
      NOT recheck indefinitely. Read-only guard: INV-001 structural surface,
      no-LLM import assertion seam asserting the package imports no
      model-provider/agent surface (no LLM anywhere in the deterministic
      path, Appendix I step 14), prohibited-capability scanner run. Colocated
      suites (budget-exhaustion state machine, starvation/expiry/backoff
      vectors, info-value ordering, indefinite-recheck refusal, no-LLM scan)
      are authored by the test-owned task T041 (2026-09-07 ownership law).
      Traces: FR-SIG-006, FR-SIG-003, AC-190, AC-191, AC-154.

## Phase 6 — Fixtures and acceptance/negative suites (blocks gates)

- [ ] T020 [P] Author `tests/fixtures/sig/feature-definitions.json` +
      `tests/fixtures/sig/baseline-features.json`: §19.1 registration vectors
      (complete numeric definitions and §19.9-incomplete refusals) and the
      Appendix H.1–H.12 golden vectors — volume acceleration with < 3 buckets
      (LOW_SAMPLE), persistence windows, price extension, dedup economic-actor
      growth above/below the cluster-confidence threshold, imbalance boundary
      values, entropy one-bucket null, manipulation-indicator cases, H.11
      robust change-point emergence and no-promotion cases, H.12 coverage
      weights. Traces: FR-SIG-001, FR-SIG-009, AC-136, AC-020, AC-023.
- [ ] T021 [P] Author `tests/fixtures/sig/cohort-fallback.json` +
      `tests/fixtures/sig/diversity-exploration.json`: §19.9 fallback
      hierarchy vectors (all seven levels, stored fallback level + cohort
      size, effective sample size, low-sample warnings) and §20.5/§20.6/§20.8
      vectors (constraint application incl. unavailable-dimension records,
      ≥5% exploration floor, strata + nonzero probabilities + seed provenance,
      corrupted assignments, emergency-policy draw audits, selection-arm
      partitions). Traces: FR-SIG-009, FR-SIG-004, FR-SIG-003, AC-136,
      AC-192, AC-193, AC-190.
- [ ] T022 [P] Author `tests/fixtures/sig/funnel-selection.json` +
      `tests/fixtures/sig/lifecycle-rechecks.json`: frozen eligible universes
      with expected deterministic ranks (reproducibility), §20.2 hard-gate
      reason codes, Pareto/unknown-dimension cases, lexicographic a–g sort
      cases, §20.7 audit field expectations; §21.3 hysteresis threshold pairs
      and dwell violations, §21.4 invalidation conditions, §21.2 budget
      exhaustion/starvation/expiry/backoff and §62.7 information-value
      ordering cases. Traces: FR-SIG-002, FR-SIG-003, FR-SIG-005, FR-SIG-006,
      AC-154, AC-190, AC-191.
- [ ] T023 [P] Author `tests/acceptance/AC-154.spec.ts` +
      `tests/negative/AC-154.negative.spec.ts`: positive — expected-net-utility
      ranking remains disabled before mature calibration (deterministic rank
      byte-identical with and without a challenger present); when a fixture
      challenger at PROVEN state is enabled it can only break ties/allocate,
      cannot override hard gates, and automatically degrades on injected
      calibration/regime drift; negative — any pre-proof learned ordering
      input, hard-gate override, or missing automatic degradation is
      structurally refused. Traces: FR-SIG-003, AC-154.
- [ ] T024 [P] Author `tests/acceptance/AC-190.spec.ts` +
      `tests/negative/AC-190.negative.spec.ts`: positive — under quota
      pressure the information-value scheduler preserves
      risk/verification/outcome protected reserves (persisted
      protected_allocations) and reduces low-value scans first; negative — a
      schedule consuming a protected reserve class to fund scans, or a
      reduction order touching protected classes first, is refused. Traces:
      FR-SIG-006, FR-SIG-003, AC-190.
- [ ] T025 [P] Author `tests/acceptance/AC-191.spec.ts` +
      `tests/negative/AC-191.negative.spec.ts`: positive — static-cadence and
      adaptive-scheduler replay over IDENTICAL fixture universes demonstrate
      measured information gained per quota unit without a higher
      missed-critical-event rate before promotion; negative — universe drift
      between replays, a higher missed-critical rate, or an unevidenced
      information-gain claim is refused. Traces: FR-SIG-006, AC-191.
- [ ] T026 [P] Author `tests/acceptance/AC-192.spec.ts` +
      `tests/negative/AC-192.negative.spec.ts`: positive — every exploration
      sample stores valid stratum and nonzero inclusion probability (plus
      policy version, seed provenance, inclusion timestamp) and corrupted
      assignments are excluded from weighted population claims; negative —
      zero/out-of-range probability, missing stratum/seed, or a universe-wide
      weighted claim including corrupted assignments is refused. Traces:
      FR-SIG-004, AC-192.
- [ ] T027 [P] Author `tests/acceptance/AC-193.spec.ts` +
      `tests/negative/AC-193.negative.spec.ts`: positive — exploitation
      allocations preserve the configured exploration floor; a floor draw
      occurs only with a recorded audited emergency policy version and full
      audit trail; negative — floor reduction without an audited emergency
      policy is refused (SQL CHECK + pure law). Traces: FR-SIG-004, FR-SIG-003,
      AC-193.
- [ ] T028 [P] Extend `tests/acceptance/AC-020.spec.ts` +
      `tests/negative/AC-020.negative.spec.ts` ADDITIVELY with a sig-scoped
      describe block: feature computation at replay boundary T reads only
      inputs with available_at ≤ T (no event-time substitution at the registry
      computation seam); a post-T row cannot leak into a pre-T replay value
      (existing content untouched, header trace list updated). Traces:
      FR-SIG-001, FR-SIG-009, AC-020.
- [ ] T029 [P] Extend `tests/acceptance/AC-021.spec.ts` +
      `tests/negative/AC-021.negative.spec.ts` ADDITIVELY with a sig-scoped
      describe block: feature lineage preserves original observation
      coordinates and input hashes across revisions/reorgs — originals are
      never erased by recomputation (existing content untouched, header trace
      list updated). Traces: FR-SIG-001, AC-021.
- [ ] T030 [P] Extend `tests/acceptance/AC-022.spec.ts` +
      `tests/negative/AC-022.negative.spec.ts` ADDITIVELY with a sig-scoped
      describe block: migration-aware feature windows avoid double counting in
      fixture tests (asset migration mid-window does not double-count volume/
      buyer features across pre/post segments) (existing content untouched,
      header trace list updated). Traces: FR-SIG-001, FR-SIG-009, AC-022.
- [ ] T031 [P] Extend `tests/acceptance/AC-023.spec.ts` +
      `tests/negative/AC-023.negative.spec.ts` ADDITIVELY with a sig-scoped
      describe block: decimals and address normalization in feature inputs
      pass chain-specific golden fixtures; raw unnormalized keys are refused
      at the registry input seam (existing content untouched, header trace
      list updated). Traces: FR-SIG-001, AC-023.
- [ ] T032 [P] Extend `tests/acceptance/AC-136.spec.ts` +
      `tests/negative/AC-136.negative.spec.ts` ADDITIVELY with a sig-scoped
      describe block: low-denominator growth (H.1 < 3 buckets), one-bucket
      entropy (H.9 → null + LOW_SAMPLE), robust change-point (H.11 no
      promotion below minimum baseline), shrinkage, and cohort-fallback
      fixtures produce bounded deterministic features and correct quality
      codes (existing actor-uncertainty facet preserved untouched, header
      trace list updated). Traces: FR-SIG-009, FR-SIG-001, AC-136.

## Phase 6b — Test-owned suites and central parity extensions (blocks gates)

- [ ] T037 [P] [executor: TEST] Author the colocated unit suites under
      `packages/signal-intelligence/test/` and `packages/domain/test/` named
      by T010-T019: registry drift refusal, lineage completeness,
      unavailable-at-decision-time refusal, fallback-level truth table,
      shrinkage bounds, capped-contribution clamp, low-sample warnings,
      H.1-H.12 golden vectors, boundedness properties (imbalance ∈ [−1,1],
      entropy ∈ [0,1]), window boundary and dedup-threshold fixtures,
      emergence/no-promotion fixtures, CUSUM drift vectors, missing-bucket
      handling, gate reason-coding truth table, vector null-honesty,
      unknown-blocking, tradability consumption, reproducibility
      (byte-identical rerun), step-indexed positive/negative cases, sort-key
      a-g ordering fixtures, frozen-universe drift refusal, pre-proof
      ordering-input refusal, override refusal truth table, drift → automatic
      degradation, tie-break-only effect, constraint application, ≥5% floor,
      seed determinism, corrupted-assignment exclusion, emergency-draw audit
      trail, budget-exhaustion state machine, starvation/expiry/backoff
      vectors, info-value ordering, indefinite-recheck refusal, no-LLM
      structural scan, and the domain sig-vocabulary fail-closed +
      `numericFeatureStabilityComplete`/`confirmedRequiresTradableVerdict`
      truth tables (T001's law list) and the shared-schemas schema tests
      (unknown enum rejection, refinement boundaries). Traces: FR-SIG-001,
      FR-SIG-002, FR-SIG-003, FR-SIG-004, FR-SIG-005, FR-SIG-006, FR-SIG-009,
      AC-136, AC-154.
- [ ] T038 [P] [executor: TEST] Author
      `packages/shared-schemas/test/sig.spec.ts`: schema-mirror unit tests for
      the T003 schemas — unknown state/level/arm rejection, decimal-string and
      timestamp rules, hash-format rules, exploration-assignment nonzero
      probability refinement, unknown-cannot-dominate payload shape, strict
      unknown-key refusal. Traces: FR-SIG-001, FR-SIG-002, FR-SIG-003,
      FR-SIG-004, FR-SIG-005, FR-SIG-009.
- [ ] T039 [P] [executor: TEST] Extend the central expected-script registry
      `packages/persistence/test/migrator.spec.ts` with
      `g1_sig_0001_feature_registry`, `g1_sig_0002_funnel_vectors_ranking`,
      `g1_sig_0003_lifecycle_rechecks` (lexicographic, checksum-pinned) — the
      plan-sanctioned central-registry scope exception (plan-level decision 1;
      ADR-0019/0022 duty). Traces: FR-SIG-001, FR-SIG-002, FR-SIG-003,
      FR-SIG-004, FR-SIG-005, FR-SIG-006, FR-SIG-009.
- [ ] T040 [P] [executor: TEST] Extend the central telemetry parity suite
      with the sig catalog assertions — the plan-sanctioned central-parity
      scope exception (plan-level decision 4) — pinning the T033 declarative
      sig catalog to the authoritative schemas field-for-field (the exact
      path is `tests/telemetry-catalog.spec.ts` (test-owned); no product
      surface is touched). Traces: FR-SIG-001, FR-SIG-002, FR-SIG-003,
      FR-SIG-004, FR-SIG-005, FR-SIG-006, FR-SIG-009.
- [ ] T041 [executor: TEST] [serial-reason: SEMANTIC_DEPENDENCY] Author the fixtures/suite files this package
      owns outside the colocated trees: none are re-assigned from product
      tasks; T020-T032 (fixtures and AC/negative suite authoring) stay
      test-owned work executed by the test lanes under their own task ids.
      This task exists as the single test-author completion record for the
      read-only-guard no-LLM scan verification (T019's scan) executed against
      the landed product surface. Traces: FR-SIG-006, FR-SIG-003, AC-154.

## Phase 7 — Telemetry contract, manifest regen, and gates

- [ ] T033 [P] Create `telemetry/sig.catalog.json` (DECLARATIVE_CONTRACT_ONLY
      header, fields mirroring `packages/shared-schemas/src/sig.ts` exactly,
      requirementRefs per event): `sig.feature_registered` (FR-SIG-001),
      `sig.feature_computed` (FR-SIG-001/009), `sig.cohort_resolved`
      (FR-SIG-009), `sig.vector_built` (FR-SIG-002), `sig.ranking_recorded`
      (FR-SIG-003), `sig.selection_decided` (FR-SIG-003/004),
      `sig.lifecycle_transitioned` (FR-SIG-005), `sig.recheck_decided`
      (FR-SIG-006). The central telemetry parity suite is extended by the
      test-owned task T040 in the same package — the plan-sanctioned
      central-parity scope exception (plan-level decision 4; 2026-09-07
      ownership law). Traces: FR-SIG-001, FR-SIG-002, FR-SIG-003,
      FR-SIG-004, FR-SIG-005, FR-SIG-006, FR-SIG-009.
- [ ] T034 [executor: COORDINATOR] [evidence: VERIFICATION_ONLY] Run the
      milestone verification command on the canonical tree: `test -d
packages/signal-intelligence && pnpm --filter @foresift/signal-intelligence test`;
      plus the extended central suites (`pnpm --filter @foresift/persistence
      test` for migrator + schema-parity; `tests/telemetry-catalog.spec.ts`)
      and the authored/extended AC files (AC-154, AC-190, AC-191, AC-192,
      AC-193, AC-020…023, AC-136). All green required. Traces: FR-SIG-001…006,
      FR-SIG-009 (package-gate proof of every assigned requirement's
      substrate).
- [ ] T035 [executor: COORDINATOR] Regenerate the coordinator test manifest
      (`node scripts/automation/bun-migration-manifest.mjs --out
evidence/bun-migration/bun-migration-manifest.json`) after all new test
      files exist so `pnpm test`/`test:all` collect and classify them
      (PGlite-backed suites → DATABASE_PGLITE; OOM-safe per the test runtime
      contract). Mechanical bookkeeping (ADR-0020: coordinator-owned,
      zero-AI). Traces: FR-SIG-001…006, FR-SIG-009 (verification substrate for
      every assigned requirement).
- [ ] T036 [executor: COORDINATOR] [evidence: VERIFICATION_ONLY] Run the full
      aggregate gate `pnpm verify` and the integrity gate `pnpm spec:verify`
      at the pushed HEAD; require green (the complete Bun suite runs ONLY
      through the coordinator — never a bare `bun test` over the tree). If
      anything turns red outside writeScopes, classify per governance, fix
      only in-scope failures, and record the rest in the run's out-of-scope
      notes. Traces: FR-SIG-001…006, FR-SIG-009 (full suite + manifest
      integrity proof).

## Cross-artifact consistency analysis (speckit-analyze, completed at planning)

- **Coverage**: 7/7 assigned requirements traced (FR-SIG-001…006, FR-SIG-009);
  every assigned AC has an explicit owner: AC-154, AC-190, AC-191, AC-192,
  AC-193 authored here (T023–T027), AC-020/021/022/023/136 extended additively
  here (T028–T032; AC-136's existing actor-uncertainty facet authored by
  g1-data-truth-extensions stays), and the FR-AIG/FR-EXP scheduler/bandit
  extensions of AC-190…193 recorded for their G7 owners in out-of-scope notes;
  the FR-EVAL/FR-MAT challenger-calibration extensions of AC-154 recorded for
  g1-outcome-evaluation.
- **Traceability**: no task cites a requirement outside the package's
  assignment (validator-enforced: wallet/social/challenger requirement IDs and
  every non-FR-SIG ID
  are absent from tasks.md); every task cites ≥1 FR-SIG-* or its AC.
- **Scope**: every predicted write lands inside writeScopes except the
  plan-sanctioned exceptions named by exact path (T007 central migration
  registry + migrator family extension; T008 ADR-001 mirror catch-up; T033
  central telemetry parity suite; T035 mechanical manifest regen per ADR-0020
  coordinator duty), consistent with the live g1-data-truth (#175) /
  g1-execution-simulation (#208) precedent.
- **Ordering**: the deterministic pipeline staging order is enforced by phase
  structure and explicit T-id references: Phase 1 schemas/vocabularies →
  Phase 2 persistence → Phase 3 feature registry + H-baseline computation →
  Phase 4 funnel/vectors/deterministic selection → Phase 5
  diversity/exploration/lifecycle/rechecks → Phase 6 fixtures/suites → Phase 7
  telemetry + gates. `(blocks` headings in phases add the blocking-phase
  dependency edges the task-graph builder requires.
- **Read-only law**: no task introduces trading/custody/signing/transaction-
  submission capability or any model/LLM surface into the deterministic path;
  T019 runs the no-LLM structural scan and the prohibited-capability scanner
  as explicit gates; §62.7 information value is bounded to allocation-aid use
  (ADR-5).
- **No placeholders**: no template markers, no unresolved clarification
  blocks anywhere in the scoped artifacts.
