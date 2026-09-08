# Implementation Plan: g1-signal-registry

**Package**: `g1-signal-registry` | **Date**: 2026-09-08 | **Spec**: `specs/g1-signal-registry/spec.md` (scoped derivative of PRD §19 in full, §20 in full, §21 in full, §62.7, §45 invariants, Appendix H, Appendix I + manifest FR-SIG-001…006, FR-SIG-009)
**Authority**: PRD wins over every word below; material decisions are recorded as proposed ADR texts in this file.

## Summary

Deliver the versioned Feature Registry and the deterministic signal baseline
Appendix I requires BEFORE any learned ranking, as ONE new package plus additive
extensions, consuming only the proven substrate:

1. **Versioned Feature Registry (FR-SIG-001, FR-SIG-009)** — the §19.1
   `FeatureDefinition` contract as a Zod schema + persistence (every numeric
   feature carrying minimumObservations/minimumDenominator, nullPolicy,
   outlierPolicy, stabilityTransform, shrinkagePolicy, cappedContribution,
   cohortFallbackPolicyId, economicEventRequired); §19.10 derived-feature
   lineage on every computed value (input observation/evidence IDs, input
   hashes, code version, calculated_at, quality codes); §19.9 numerical
   stability + cohort fallback (deterministic fallback hierarchy: exact cohort,
   remove narrative, remove regime, widen market-cap band, widen age band,
   chain+launchpad, own-history anomaly — every percentile storing the chosen
   fallback level and cohort size); §19.11 cohort comparison with peer
   percentile, sample size, and low-sample warning; and the Appendix H baseline
   formulas (H.1 volume acceleration, H.2 volume persistence, H.3 price
   extension, H.4 unique-buyer growth with economic-actor deduplication above
   the configured cluster-confidence threshold, H.5 buy/sell imbalance, H.6
   liquidity growth, H.7 top-10 concentration slope, H.8 holder growth, H.9
   trade-size entropy, H.10 manipulation indicators, H.11 robust
   activity/change-point EWMA+CUSUM baseline, H.12 data coverage) computed over
   EVENT time through the proven replay-honest computation seam — with H.13
   effective source independence consumed from the proven dependence
   vocabulary and H.14–H.16 consumed from the proven execution-simulator
   outputs.
2. **Candidate funnel, vectors, ranking, selection (FR-SIG-002, FR-SIG-003,
   FR-SIG-004)** — §20.1 funnel stage vocabulary; §20.2 profile-versioned
   reason-coded hard gates; §20.3/Appendix-I-step-3 seven independent vectors
   (Opportunity/Risk/DataQuality/Urgency/Novelty/Tradability/
   SourceIndependence — structurally no single buy score); the Appendix I
   deterministic selection algorithm steps 1–13 as pure versioned functions
   (hard gates → vectors → robust cohort values → feasibility envelope →
   gate removal → Pareto efficiency without unknown-is-favorable →
   lexicographic sort a–g → exposure constraints → protected allocations →
   budget partition → persistence of everything including
   T_decision_ready); §20.7 ranking audit records; §20.5 diversity
   constraints; §20.6 ≥5% exploration/control sample with §20.8 selection
   arms, selection probability, and cutoff reasons; §20.10 frontier
   interaction (unknown dimensions can never dominate known favorable
   evidence).
3. **Candidate lifecycle and adaptive rechecks (FR-SIG-005, FR-SIG-006)** —
   §21.1 lifecycle state machine (DISCOVERED → QUALIFIED → EMERGING →
   CONFIRMED → MONITORING → DECAYING → REJECTED → ARCHIVED) with §21.3
   hysteresis (different promotion/demotion thresholds + minimum dwell times)
   and §21.4 thesis-invalidation conditions; §21.2 adaptive rechecks with the
   exact budget fields (max_rechecks, max_recheck_provider_calls,
   max_recheck_model_cost, next_check_at, expires_at, backoff_factor,
   minimum_expected_information_gain), finite budgets, information-value
   selection (§62.7 as allocation aid only), starvation limits, and explicit
   expiry — a candidate MUST NOT recheck indefinitely.

Plus additive extensions: `packages/domain/src/sig.ts` +
`packages/shared-schemas/src/sig.ts` vocabularies/schemas, migration family
`sig` (`migrations/g1_sig_*.sql`), fixtures `tests/fixtures/sig/`, telemetry
`telemetry/sig.catalog.json`, and the manifest-owned AC suites.

The AC-154 disabled-challenger law is structural: the deterministic path
contains NO learned probability (Appendix I: "Before a calibrated utility
challenger is proven, no learned probability enters the ordering"), and the
registry refuses any challenger override of steps 1–8 or protected allocations
even when a proven challenger exists later (its lower-bound utility may only
break ties or allocate research within allowed scope, and degrades
automatically on calibration/regime drift).

Strictly read-only (INV-001): no trading, custody, wallet-signing, private-key,
or transaction-submission capability anywhere in the registry, ranking, or
scheduler.

## Technical Context

- **Language/runtime**: TypeScript (ESM, strict, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`) in the existing pnpm workspace; Bun Test is
  the repository test authority. New package `packages/signal-intelligence`
  (`@foresift/signal-intelligence`) follows the G0/G1 scaffold pattern:
  workspace `*` dependencies, `bun test` script, tsconfig extending
  `tsconfig.base.json`, no per-package runner config.
- **Storage**: PostgreSQL schema via `@foresift/persistence` (`DatabaseEngine`
  seam); tests run on PGlite per ADR-0014. Migrations are the SQL source of
  truth. G1 adds tables only — never alters tables owned by other packages'
  families. New migration family `sig` — `g1_sig_*.sql`, additive only; the
  fail-closed family list in `packages/persistence/src/migrator.ts` is
  extended with `sig` and the central expected-script registry
  (`packages/persistence/test/migrator.spec.ts`) is extended in the same
  package (plan-sanctioned scope exception, plan-level decision 1 /
  ADR-0019·0022 duty). The hand-maintained ADR-001 Drizzle mirror
  (`packages/persistence/src/generated/schema.ts`) catches up to SQL truth in
  the same package — the schema-parity gate (`packages/persistence/test/
schema-parity.spec.ts`) enumerates `public` tables and fails on any gap
  (same precedent as g1-data-truth-extensions #175 and g1-execution-simulation
  #208, which both updated the mirror with their migrations).
- **Validation**: Zod schemas authoritative in `packages/shared-schemas`
  (ADR-0013). Closed vocabularies (funnel stages, vector kinds, selection
  arms, cutoff reasons, lifecycle states, recheck outcomes, cohort fallback
  levels, gate codes, diversity constraint kinds) are declared in
  `packages/domain/src/sig.ts` and imported — never restated — by
  `packages/shared-schemas/src/sig.ts` (milestone plan-level decision 5,
  ADR-0018 precedent). Unknown values fail closed with stable `ErrorCode`s.
  Existing vocabularies consumed from domain, never duplicated:
  `QualityCode`, `TradabilityVerdict`/exec vocabularies, `ReserveClass`,
  dependence vocabulary, acquisition states.
- **Replay law**: THE single domain predicate `visibleAt` (available_at ≤ T)
  stays the only visibility definition; every feature computation resolves
  inputs through it at the requested event-time boundary (INV-005/006, AC-020
  sig facet). The G0 `feature-computation.ts` replay-honest pattern (exact
  BigInt sums, unquantified-event accounting) is extended, not forked.
- **Determinism law**: ranking, selection, diversity, and recheck scheduling
  are pure functions of persisted inputs + versioned configuration. No
  wall-clock reads inside the algorithm (timestamps are inputs); sampling uses
  a seeded deterministic PRNG with recorded seed provenance (G0
  `probe_assignments` precedent, AC-243 write-before-outcome pattern).
- **Test stack**: Bun Test; new suites colocated per package
  (`packages/signal-intelligence/test/*.spec.ts`) plus in-place additive
  extensions of the shared `tests/acceptance` / `tests/negative` AC files; the
  coordinator manifest (`evidence/bun-migration/bun-migration-manifest.json`)
  is regenerated after new test files exist so `test:all` workloads classify
  them (PGlite suites → DATABASE_PGLITE).
- **Telemetry**: declarative catalogs only (`telemetry/sig.catalog.json` new) —
  emitter wiring is G2, never in this package's verification.

## Constitution Check

- **I. Product-Contract Authority**: scope limited to the seven assigned
  requirements; §19, §20, §21, Appendices H/I quoted surfaces are implemented
  as specified, no reinterpretation. The Appendix I algorithm is transcribed
  step-for-step.
- **IV. Read-only law**: the registry/scheduler only computes, persists, and
  schedules research; no execution, custody, signing, or submission surface
  (INV-001). A colocated structural test asserts the package imports no
  model-provider/agent surface (no-LLM law).
- **V/VI. Point-in-time + event-time correctness**: all features over event
  time through `visibleAt`; cohort values and vectors carry event/window
  bounds (§19.10).
- **VII. Provenance and evidence**: §19.10 lineage on every value; input
  hashes; missing lineage blocks claim support (G0
  `supportsPopulationClaim` extended by registration law).
- **VIII. Fail-closed**: unknown stage/vector/state/recheck-field values
  refuse with typed errors; unknown data never dominates known favorable
  evidence (§20.10).
- **XI/XII. Deterministic + failure-path verification**: every AC gets
  positive AND negative proof at the manifest paths; reproducibility is
  proven by byte-identical rerun tests (no AI self-assessment).
- **XIII. Idempotency**: recheck scheduling and lifecycle transitions are
  idempotent under replay (state-transition records keyed by candidate +
  policy version + decision time).

## Data model (SQL truth under `migrations/`, family `sig`)

### `g1_sig_0001_feature_registry.sql`

```text
CREATE TABLE sig.feature_definitions (             -- FR-SIG-001, §19.1 exact
  feature_id            text NOT NULL,
  version               integer NOT NULL CHECK (version >= 1),
  description           text NOT NULL CHECK (length(description) > 0),
  formula               text NOT NULL CHECK (length(formula) > 0),
  input_fields          text[] NOT NULL,
  unit                  text NOT NULL,
  windows               text[] NOT NULL DEFAULT ARRAY[]::text[],
  minimum_observations  integer NOT NULL CHECK (minimum_observations >= 1),
  null_policy           text NOT NULL CHECK (length(null_policy) > 0),
  outlier_policy        text NOT NULL CHECK (length(outlier_policy) > 0),
  update_policy         text NOT NULL CHECK (length(update_policy) > 0),
  freshness_limit_seconds integer NOT NULL CHECK (freshness_limit_seconds >= 0),
  cohort_definition_id  text,
  evidence_requirements text[] NOT NULL DEFAULT ARRAY[]::text[],
  -- FR-SIG-009 fields: EVERY numeric feature defines them (CHECK-enforced).
  minimum_denominator   integer,     -- NULL only for non-numeric features
  is_numeric            boolean NOT NULL DEFAULT TRUE,
  stability_transform   text,        -- required when is_numeric
  shrinkage_policy      text,        -- required when is_numeric
  capped_contribution   double precision CHECK (capped_contribution IS NULL
                          OR (capped_contribution > 0 AND capped_contribution <= 1)),
  outlier_policy_is_robust boolean NOT NULL DEFAULT FALSE,  -- winsorization/robust law
  cohort_fallback_policy_id text,     -- required when is_numeric
  economic_event_required boolean NOT NULL DEFAULT FALSE,
  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (feature_id, version),
  CONSTRAINT sig_numeric_feature_stability_defined CHECK (
    NOT is_numeric OR (
      minimum_denominator IS NOT NULL AND minimum_denominator >= 1
      AND stability_transform IS NOT NULL
      AND shrinkage_policy IS NOT NULL
      AND cohort_fallback_policy_id IS NOT NULL
      AND outlier_policy_is_robust)),
  -- §19.9 capped contribution: a numeric feature with ranking influence must cap it.
  CONSTRAINT sig_ranking_features_capped CHECK (
    capped_contribution IS NOT NULL OR NOT is_numeric),
  -- §19.1 explicitness law: formula present is structural; independent-
  -- reimplementation sufficiency is registration-review + test law.
  CONSTRAINT sig_numeric_feature_event_required CHECK (
    NOT economic_event_required OR is_numeric OR TRUE)  -- documentation column
);

CREATE TABLE sig.feature_lineage (                 -- FR-SIG-001, §19.10 exact
  lineage_id            text PRIMARY KEY,
  feature_id            text NOT NULL,
  feature_version       integer NOT NULL,
  entity_id             text NOT NULL,
  profile_id            text NOT NULL,
  window_start          timestamptz,
  window_end            timestamptz NOT NULL,
  input_observation_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  input_evidence_ids    text[] NOT NULL DEFAULT ARRAY[]::text[],
  input_hashes          text[] NOT NULL,           -- sha256 per required input
  calculation_code_version text NOT NULL CHECK (length(calculation_code_version) > 0),
  calculated_at         timestamptz NOT NULL,
  quality_codes         text[] NOT NULL,           -- domain QualityCode members
  event_time_resolved_at timestamptz NOT NULL,     -- the replay boundary T used
  created_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (feature_id, feature_version)
    REFERENCES sig.feature_definitions(feature_id, version),
  CONSTRAINT sig_lineage_hashes_present CHECK (cardinality(input_hashes) > 0),
  CONSTRAINT sig_lineage_window_order CHECK (
    window_start IS NULL OR window_start < window_end)
);

CREATE TABLE sig.cohort_snapshots (                -- §19.9/§19.11 cohort law
  snapshot_id           text PRIMARY KEY,
  feature_id            text NOT NULL,
  feature_version       integer NOT NULL,
  entity_id             text NOT NULL,
  cohort_chain          text NOT NULL,
  cohort_launchpad      text,
  cohort_age_band       text,
  cohort_market_cap_band text,
  cohort_liquidity_band text,
  cohort_narrative      text,                      -- NULL = dimension unavailable
  cohort_regime         text,                      -- NULL = dimension unavailable
  fallback_level        text NOT NULL CHECK (fallback_level IN (
    'EXACT_COHORT','REMOVE_NARRATIVE','REMOVE_REGIME',
    'WIDEN_MARKET_CAP_BAND','WIDEN_AGE_BAND','CHAIN_LAUNCHPAD',
    'OWN_HISTORY_ANOMALY')),
  cohort_size           integer NOT NULL CHECK (cohort_size >= 0),
  effective_sample_size double precision NOT NULL CHECK (effective_sample_size >= 0),
  peer_percentile       double precision CHECK (peer_percentile BETWEEN 0 AND 1),
  low_sample_warning    boolean NOT NULL DEFAULT FALSE,
  computed_at           timestamptz NOT NULL,
  FOREIGN KEY (feature_id, feature_version)
    REFERENCES sig.feature_definitions(feature_id, version)
);
```

### `g1_sig_0002_funnel_vectors_ranking.sql`

```text
CREATE TABLE sig.candidate_funnel_stages (         -- FR-SIG-002, §20.1/§20.2
  stage_id          text PRIMARY KEY,
  candidate_id      text NOT NULL,
  profile_id        text NOT NULL,
  profile_version   text NOT NULL,
  stage             text NOT NULL CHECK (stage IN (
    'FREE_DISCOVERY_UNIVERSE_ATTRIBUTION','IDENTITY_VALIDATION',
    'CAPABILITY_DATA_QUALITY_GATE','ELIGIBILITY_GATES','ZERO_COST_COARSE_GATE',
    'CHEAP_BATCH_MONITORING_PERSISTENCE_GATE',
    'SELECTIVE_FREE_QUOTA_VERIFICATION','ECONOMIC_NORMALIZATION_SECURITY',
    'FEATURE_UPDATE','REGIME_ROUTE_RESOLUTION','NARRATIVE_CROSS_CHAIN_CONTEXT',
    'VECTOR_CONSTRUCTION','CROWDING_DECAY_PRECHECK','PARETO_FILTERING',
    'RESEARCH_PRIORITY_RANKING','DIVERSITY_SELECTION','AGENT_RESEARCH',
    'THESIS_WHY_NOW','EVIDENCE_VALIDATION_ROBUSTNESS',
    'EXECUTION_TRADABILITY_GATE','ALERT_POLICY')),
  entered_at        timestamptz NOT NULL,
  passed            boolean NOT NULL,
  gate_code         text,                          -- reason-coded hard gates §20.2
  gate_profile_version text NOT NULL,
  evidence_refs     text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sig_gate_failure_reason_coded CHECK (passed OR gate_code IS NOT NULL),
  UNIQUE (candidate_id, profile_version, stage, entered_at)
);

CREATE TABLE sig.candidate_vectors (               -- FR-SIG-002, §20.3 + App I step 3
  vector_id         text PRIMARY KEY,
  candidate_id      text NOT NULL,
  profile_version   text NOT NULL,
  as_of             timestamptz NOT NULL,          -- T_decision_ready anchor
  vector_kind       text NOT NULL CHECK (vector_kind IN (
    'OPPORTUNITY','RISK','DATA_QUALITY','URGENCY','NOVELTY','TRADABILITY',
    'SOURCE_INDEPENDENCE')),
  components        text NOT NULL,                 -- JSON object: named components
                                                   -- with values or explicit null+code
  algorithm_version text NOT NULL CHECK (length(algorithm_version) > 0),
  lineage_ref       text NOT NULL REFERENCES sig.feature_lineage(lineage_id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, profile_version, as_of, vector_kind)
);

CREATE TABLE sig.ranking_audits (                  -- FR-SIG-003, §20.7 + App I step 13
  audit_id          text PRIMARY KEY,
  candidate_id      text NOT NULL,
  rank_at_time      integer NOT NULL CHECK (rank_at_time >= 1),
  ranking_version   text NOT NULL CHECK (length(ranking_version) > 0),
  profile_version   text NOT NULL,
  component_values  text NOT NULL,                 -- JSON of vector components
  hard_gate_results text NOT NULL,                 -- JSON of gate code -> pass/fail
  pareto_status     text NOT NULL CHECK (pareto_status IN (
    'EFFICIENT','DOMINATED','UNKNOWN_DIMENSION_BLOCKED')),
  diversity_adjustment text NOT NULL,              -- JSON: constraint kind -> applied
  exploration_selected boolean NOT NULL,
  cutoff_reason     text NOT NULL CHECK (cutoff_reason IN (
    'BELOW_BUDGET_CUTOFF','HARD_GATE_FAILED','PARETO_DOMINATED',
    'DIVERSITY_CONSTRAINT','EXPLORATION_ARM','NOT_SELECTED_WITH_REASON')),
  selection_arm     text NOT NULL CHECK (selection_arm IN (
    'EXPLOITATION','UNCERTAINTY','RANDOM_EXPLORATION','EVIDENCE_PROBE',
    'OUTCOME_OBSERVATION_ONLY','NOT_SELECTED')),
  selection_probability double precision CHECK (
    selection_probability IS NULL OR (selection_probability > 0
      AND selection_probability <= 1)),
  protected_allocations text NOT NULL,             -- JSON: reserve class -> units
  capacity_admission text NOT NULL,
  algorithm_version text NOT NULL CHECK (length(algorithm_version) > 0),
  t_decision_ready  timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, ranking_version, profile_version, t_decision_ready)
);
```

### `g1_sig_0003_lifecycle_rechecks.sql`

```text
CREATE TABLE sig.candidate_lifecycle (             -- FR-SIG-005, §21.1/§21.3/§21.4
  transition_id     text PRIMARY KEY,
  candidate_id      text NOT NULL,
  profile_version   text NOT NULL,
  from_state        text CHECK (from_state IN (
    'DISCOVERED','QUALIFIED','EMERGING','CONFIRMED','MONITORING','DECAYING',
    'REJECTED','ARCHIVED')),
  to_state          text NOT NULL CHECK (to_state IN (
    'DISCOVERED','QUALIFIED','EMERGING','CONFIRMED','MONITORING','DECAYING',
    'REJECTED','ARCHIVED')),
  reason            text NOT NULL CHECK (length(reason) > 0),
  persistence_measure double precision,           -- §21.3 hysteresis input
  dwell_since_prior_transition interval,
  policy_version    text NOT NULL,                 -- versioned thresholds
  tradability_verdict text,                       -- proven exec verdict when gate-relevant
  diagnostic_signal_labels text NOT NULL DEFAULT '{}'::text[],
  thesis_invalidation_conditions text,             -- §21.4 JSON list (CONFIRMED/MONITORING)
  transitioned_at   timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sig_lifecycle_state_change CHECK (from_state IS DISTINCT FROM to_state),
  CONSTRAINT sig_confirmed_requires_tradability CHECK (
    to_state <> 'CONFIRMED' OR tradability_verdict = 'TRADABLE')
);

CREATE TABLE sig.recheck_budgets (                 -- FR-SIG-006, §21.2 exact fields
  candidate_id      text NOT NULL,
  profile_version   text NOT NULL,
  max_rechecks      integer NOT NULL CHECK (max_rechecks >= 0),
  max_recheck_provider_calls integer NOT NULL CHECK (max_recheck_provider_calls >= 0),
  max_recheck_model_cost   double precision NOT NULL CHECK (max_recheck_model_cost >= 0),
  backoff_factor    double precision NOT NULL CHECK (backoff_factor > 1),
  minimum_expected_information_gain double precision NOT NULL
    CHECK (minimum_expected_information_gain >= 0),
  next_check_at     timestamptz NOT NULL,
  expires_at        timestamptz NOT NULL,
  rechecks_used     integer NOT NULL DEFAULT 0 CHECK (rechecks_used >= 0),
  provider_calls_used integer NOT NULL DEFAULT 0 CHECK (provider_calls_used >= 0),
  model_cost_used   double precision NOT NULL DEFAULT 0 CHECK (model_cost_used >= 0),
  starved_since     timestamptz,                   -- starvation-limit law
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (candidate_id, profile_version),
  CONSTRAINT sig_recheck_budget_order CHECK (expires_at > next_check_at)
);

CREATE TABLE sig.recheck_decisions (               -- FR-SIG-006, App I step 13 audit
  decision_id       text PRIMARY KEY,
  candidate_id      text NOT NULL,
  profile_version   text NOT NULL,
  decided_at        timestamptz NOT NULL,
  decision          text NOT NULL CHECK (decision IN (
    'RECHECK_NOW','DEFER_BACKOFF','STARVED_SKIP','EXPIRED_STOP',
    'BUDGET_EXHAUSTED_STOP','INFO_VALUE_BELOW_FLOOR_SKIP')),
  expected_decision_impact   double precision,
  boundary_proximity         double precision,
  expected_state_change      double precision,
  information_gap            double precision,
  risk_urgency               double precision,
  candidate_utility          double precision,
  quota_cost                 double precision CHECK (quota_cost IS NULL OR quota_cost >= 0),
  information_value          double precision,     -- §62.7 allocation aid only
  provider_calls_costed      integer NOT NULL DEFAULT 0 CHECK (provider_calls_costed >= 0),
  model_cost_costed          double precision NOT NULL DEFAULT 0
    CHECK (model_cost_costed >= 0),
  protected_reserve_class    text,                 -- domain ReserveClass member
  created_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (candidate_id, profile_version)
    REFERENCES sig.recheck_budgets(candidate_id, profile_version)
);
```

## Module layout (inside writeScopes)

```text
packages/signal-intelligence/               # NEW package (@foresift/signal-intelligence)
  src/
    index.ts                  # barrel
    registry.ts               # FR-SIG-001: FeatureDefinition registration
                              #   (§19.1 field-for-field, explicitness law),
                              #   versioned, additive; refuses re-registration
                              #   drift of an existing version
    lineage.ts                # §19.10 lineage records + claim-support law
                              #   (missing/unavailable-at-decision-time lineage
                              #   cannot back a claim)
    stability.ts              # FR-SIG-009/§19.9: low-sample behavior, log1p
                              #   transforms, winsorization, shrinkage toward
                              #   prior, capped contribution clamp, quality
                              #   downgrade on unresolvable economic actors
    cohort.ts                 # §19.9 fallback hierarchy resolver (deterministic,
                              #   versioned; every percentile stores fallback
                              #   level + cohort size) + §19.11 cohort
                              #   comparison outputs
    baseline-features.ts      # Appendix H.1–H.12 formulas over event time,
                              #   consuming the proven economic-trade-event
                              #   substrate (actor dedup above configured
                              #   cluster-confidence threshold) + G0 feature
                              #   computation seam (visibleAt-resolved)
    robust-baseline.ts        # H.11 robust center/scale, EWMA fast/slow,
                              #   change-point + one-sided CUSUM detector with
                              #   versioned windows/alphas/thresholds; cannot
                              #   promote below minimum baseline sample
    funnel.ts                 # FR-SIG-002: §20.1 stage vocabulary, §20.2
                              #   profile-versioned reason-coded hard gates
    vectors.ts                # FR-SIG-002: the seven independent vectors;
                              #   TradabilityVector consumes proven exec
                              #   verdicts/feasibility (H.14–H.16);
                              #   SourceIndependenceVector consumes proven
                              #   dependence state (H.13); unknowns never
                              #   render favorable
    selection.ts              # FR-SIG-003: Appendix I steps 1–13 as pure
                              #   versioned functions; Pareto efficiency with
                              #   unknown-dimension blocking (§20.10);
                              #   lexicographic sort a–g; persisted audit
                              #   (§20.7); T_decision_ready anchoring
    challenger-seam.ts        # AC-154 structural law: pre-proof refusal of
                              #   any learned ordering input; post-proof
                              #   tie-break/allocation scope + automatic
                              #   degradation on calibration/regime drift;
                              #   hard-gate override structurally refused
    diversity.ts              # FR-SIG-004: §20.5 constraints (configurable
                              #   defaults: 2 per narrative, 1 per developer
                              #   cluster, 1 per funding cluster, 3 per
                              #   launchpad); unavailable upstream dimensions
                              #   recorded as CONSTRAINT_DIMENSION_UNAVAILABLE
    exploration.ts            # FR-SIG-004: §20.6 ≥5% exploration/control
                              #   sampling (seeded, stratum + nonzero
                              #   probability stored), §20.8 arms/probabilities/
                              #   not_selected_with_reason, budget partition
                              #   with protected reserves first, §20.10 frontier
                              #   interaction, exploration floor + audited
                              #   emergency policy seam (AC-193)
    lifecycle.ts              # FR-SIG-005: §21.1 state machine, §21.3
                              #   hysteresis (promotion ≠ demotion thresholds +
                              #   minimum dwell), §21.4 invalidation
                              #   conditions; CONFIRMED requires proven
                              #   TRADABLE verdict (risk separation law);
                              #   diagnostic signal labels preserved
    rechecks.ts               # FR-SIG-006: §21.2 budget enforcement, §62.7
                              #   information-value selection aid, starvation
                              #   limits, backoff, explicit expiry; deferred/
                              #   stopped decisions always recorded
    read-only-guard.ts        # INV-001 structural surface + no-LLM import
                              #   assertion; runs the repo
                              #   prohibited-capability scanner seam
  test/                       # colocated suites (PGlite-backed where
                              #   persistence needed): registry, lineage,
                              #   stability/cohort truth tables, H-formula
                              #   golden vectors + property tests, selection
                              #   reproducibility (byte-identical rerun),
                              #   exploration determinism + floor, lifecycle
                              #   hysteresis truth table, recheck budget
                              #   exhaustion, no-LLM structural scan

packages/domain/src/
  sig.ts                      # NEW — SelectionArm, CutoffReason, FunnelStage,
                              #   VectorKind, LifecycleState, RecheckDecision,
                              #   CohortFallbackLevel, DiversityConstraintKind,
                              #   GateOutcome, ParetoStatus — each with
                              #   fail-closed parse + stable SigErrorCode
                              #   additions; consumed-by-import from
                              #   shared-schemas (compile-parity law)
  index.ts                    # extend exports

packages/shared-schemas/src/
  sig.ts                      # NEW — Zod mirrors: FeatureDefinitionSchema
                              #   (§19.1 exact incl. minimumDenominator/
                              #   stabilityTransform/shrinkagePolicy/
                              #   cohortFallbackPolicyId/economicEventRequired),
                              #   FeatureLineageSchema (§19.10 exact),
                              #   CohortSnapshotSchema, FunnelStageRecordSchema,
                              #   CandidateVectorSchema (components with
                              #   null+code honesty), RankingAuditSchema (§20.7
                              #   exact), SelectionDecisionSchema (§20.8),
                              #   LifecycleTransitionSchema, RecheckBudgetSchema
                              #   (§21.2 exact), RecheckDecisionSchema;
                              #   SIG_SCHEMA_REGISTRY_VERSION = 1; registry
                              #   object + parseSigSchema helper (exec.ts
                              #   pattern); refinement laws: numeric features
                              #   define all §19.9 fields; exploration
                              #   assignments carry nonzero probability
  index.ts                    # export sig.ts

packages/persistence/src/
  generated/schema.ts         # hand-maintained ADR-001 mirror catches up to
                              #   SQL truth for the sig.* tables (schema-parity
                              #   gate; same precedent as #175/#208)
  migrator.ts                 # MIGRATION_FAMILIES extended with `sig`
  repos/sig-registry.ts       # NEW — feature registry + lineage + cohort CRUD
  repos/sig-selection.ts      # NEW — funnel/vectors/ranking audit writes
  repos/sig-lifecycle.ts      # NEW — lifecycle transitions + recheck budgets
                              #   + decisions (idempotent re-apply law)

tests/fixtures/sig/           # (tests/fixtures/sig/** is in writeScopes)
  feature-definitions.json    # §19.1 registration vectors incl. numeric
                              #   features missing §19.9 fields (refusal) and
                              #   the Appendix H baseline definitions
  baseline-features.json      # H.1–H.12 golden vectors: low-denominator
                              #   growth, one-bucket entropy, change-point
                              #   emergence, dedup economic-actor growth,
                              #   imbalance boundaries (+1/−1/0), coverage
                              #   weights (AC-136 sig facet)
  cohort-fallback.json        # §19.9 hierarchy vectors: every fallback level,
                              #   effective sample size, low-sample warnings
  funnel-selection.json       # frozen universe + vectors + expected ranks
                              #   (reproducibility), Pareto/unknown-dimension
                              #   cases, lexicographic sort a–g cases
  diversity-exploration.json  # constraint violations, ≥5% floor, stratum/
                              #   probability vectors, corrupted assignments,
                              #   emergency-policy audit records
  lifecycle-rechecks.json     # hysteresis threshold pairs, dwell violations,
                              #   budget exhaustion, starvation, expiry,
                              #   information-value ordering cases
  index.ts                    # extend exports

tests/acceptance/  — shared AC files extended IN PLACE (facet convention):
  AC-020 + negative: sig facet — feature computation at replay boundary T reads
                     only inputs with available_at ≤ T; no event-time
                     substitution (registry computation seam)
  AC-021 + negative: sig facet — feature lineage preserves original observation
                     coordinates across revisions/reorgs
  AC-022 + negative: sig facet — migration-aware feature windows avoid double
                     counting in fixtures
  AC-023 + negative: sig facet — decimal/address normalization in feature
                     inputs passes chain-specific golden fixtures
  AC-136 + negative: sig facet — H.1 low-denominator growth, H.9 one-bucket
                     entropy, H.11 robust change-point, shrinkage, and cohort
                     fallback fixtures produce bounded deterministic features
                     with correct quality codes (LOW_SAMPLE, null-with-code)
  AC-154 + negative: AUTHORED HERE — expected-net-utility ranking remains
                     disabled before mature calibration; when enabled it cannot
                     override hard gates and automatically degrades on
                     calibration/regime drift (challenger-seam law)
  AC-190 + negative: AUTHORED HERE — under quota pressure the information-value
                     scheduler preserves risk/verification/outcome reserves and
                     reduces low-value scans first
  AC-191 + negative: AUTHORED HERE — static-cadence vs adaptive-scheduler
                     replay over identical fixture universes demonstrates
                     measured information gained per quota unit without a
                     higher missed-critical-event rate before promotion
  AC-192 + negative: AUTHORED HERE — every exploration sample stores valid
                     stratum and nonzero inclusion probability; corrupted
                     assignments are excluded from weighted population claims
  AC-193 + negative: AUTHORED HERE — exploitation cannot reduce exploration
                     below the configured floor without an audited emergency
                     policy
tests/negative/    — matching negative additions in the same files' negative
                     twins (registry refusals, unknown-vocabulary fail-closed,
                     corrupted-assignment exclusion, floor breach refusal,
                     non-reproducible rank refusal, challenger override
                     refusal)

telemetry/
  sig.catalog.json            # NEW (DECLARATIVE_CONTRACT_ONLY): sig.feature_
                              #   registered, sig.feature_computed,
                              #   sig.cohort_resolved, sig.vector_built,
                              #   sig.ranking_recorded, sig.selection_decided,
                              #   sig.lifecycle_transitioned,
                              #   sig.recheck_decided; fields mirror
                              #   packages/shared-schemas/src/sig.ts exactly;
                              #   requirementRefs per event
tests/telemetry-catalog.spec.ts — extended in place (plan-sanctioned scope
                              #   exception, plan-level decision 4) pinning the
                              #   new catalog to the authoritative schemas
packages/persistence/test/migrator.spec.ts — extended in place (plan-sanctioned
                              #   scope exception, plan-level decision 1 /
                              #   ADR-0019·0022 duty) with the g1_sig_0001…0003
                              #   registry entries (lexicographic,
                              #   checksum-pinned)
evidence/bun-migration/bun-migration-manifest.json — regenerated after new
                              #   suites exist (mechanical, coordinator duty;
                              #   g0-first-party-observation T063 precedent)
```

## Verification strategy per acceptance criterion

| AC     | Surface                        | Positive proof                                                                                                                                                                                                                                                     | Negative proof                                                                                                                                                                  |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-020 | replay boundary (sig facet)    | feature computation at boundary T returns exactly the H-formula values derivable from rows with available_at ≤ T (fixture `baseline-features.json`); a later row changes only post-T replay results                                                                | negative: a computation path reading a row with available_at > T is refused (typed error), and a value computed from post-T inputs cannot persist with an earlier resolved-at   |
| AC-021 | lineage preservation           | fixture lineage records keep original observation IDs + hashes across a revision; recomputation links both revisions without erasing the original (AC-021 sig describe block)                                                                                      | negative: a lineage record missing input hashes or reusing a superseded revision's coordinates as the only lineage is refused                                                   |
| AC-022 | migration-aware windows        | migration-aware H-window fixtures (asset migration mid-window) produce no double-counted volume/buyer features across pre/post migration segments (AC-022 sig describe block)                                                                                      | negative: double-counted migration window features are detected by the fixture expectation and fail                                                                             |
| AC-023 | normalization goldens          | feature inputs normalized through the proven identity/decimal seams match chain-specific golden fixture values exactly (AC-023 sig describe block)                                                                                                                 | negative: a drifted normalization vector diverges from the golden and fails; raw unnormalized keys are refused at the registry input seam                                       |
| AC-136 | bounded deterministic features | H.1 low-denominator growth → bounded value + LOW_SAMPLE; H.9 one-bucket entropy → null + LOW_SAMPLE; H.11 change-point under minimum baseline → no promotion; shrinkage pulls small samples toward prior; cohort fallback stores level + size (sig describe block) | negative: unbounded/unclamped contribution, null-without-code, promotion below minimum sample, or a fallback percentile missing its fallback level/cohort size is refused       |
| AC-154 | challenger disabled            | the deterministic rank is byte-identical with and without a challenger module present; challenger-seam refuses ranking/override use pre-proof; tie-break-only + drift-degradation proven with a fixture challenger at PROVEN state                                 | negative: any pre-proof learned ordering input, hard-gate override, or missing automatic degradation on injected calibration/regime drift is structurally refused (typed error) |
| AC-190 | protected reserves first       | quota-pressured recheck/selection runs over the fixture universe: low-value scans reduce first; RISK_MONITORING/ALERT_VERIFICATION/OUTCOME_COLLECTION allocations preserved in the persisted protected_allocations (AC-190 sig)                                    | negative: a schedule that consumes a protected reserve class to fund a scan is refused; the reduction order skipping protected classes fails                                    |
| AC-191 | adaptive vs static replay      | identical fixture universes replayed under static-cadence and adaptive-scheduler policies; adaptive shows strictly measured useful information per quota unit ≥ static with missed-critical-event rate not higher (AC-191 sig)                                     | negative: universe drift between the two replays is refused; promotion with a higher missed-critical rate or unevidenced information-gain claim fails                           |
| AC-192 | sampling honesty               | every exploration assignment in the fixture run stores valid stratum, policy version, nonzero assignment probability, seed provenance, inclusion timestamp; weighted claims exclude corrupted rows (AC-192 sig)                                                    | negative: zero/out-of-range probability, missing stratum/seed, or a weighted universe-wide claim including corrupted assignments is refused                                     |
| AC-193 | exploration floor              | budget partition preserves the configured exploration floor; an emergency draw requires a recorded audited emergency policy version and is fully audit-traceable (AC-193 sig)                                                                                      | negative: exploitation reducing exploration below the floor without an audited emergency policy record is refused (SQL CHECK + pure law)                                        |

Package-level unit suites (`packages/signal-intelligence/test/**`): registry
fail-closed parses + §19.1 explicitness law; §19.10 lineage claim-support;
§19.9 stability/cohort truth tables (every fallback level reachable and
deterministic); Appendix H golden vectors + boundedness property tests;
Appendix I selection reproducibility (same frozen inputs → byte-identical
audit), Pareto unknown-blocking, lexicographic key a–g ordering; exploration
seed determinism (same seed → same sample, any iteration order); lifecycle
hysteresis truth table + CONFIRMED-requires-tradable law; recheck budget
exhaustion/starvation/expiry state machine; no-LLM structural import scan;
read-only guard refusals.

## Material decisions (proposed ADR texts — bind future packages)

### ADR-1 — Feature Registry is additive-versioned and §19.1-exact

**Decision**: `sig.feature_definitions` is keyed (feature_id, version) with
immutable rows; a feature change is a NEW version, never an edit (Appendix H
"Later changes require new feature versions"). The §19.1 interface is
transcribed field-for-field with FR-SIG-009's fields (minimumDenominator,
stabilityTransform, shrinkagePolicy, cohortFallbackPolicyId,
economicEventRequired) as SQL CHECK-enforced requirements for numeric features,
plus `capped_contribution ∈ (0,1]` (§19.9 "maximum capped contribution to
ranking" as a fraction). Registration refuses drift against an existing
version. `sig.feature_definitions` is a separate sig-schema table LINKING the
G0 `feature_definitions`/`feature_values` substrate by definition/subject
coordinates — the G0 tables stay untouched (FR-DATA-004 behavior unchanged).

**Why binding**: g1-outcome-evaluation and all later feature families
(FR-SIG-007/008 in G5) register through this table; a mutable definition row
would silently rewrite served history (violates INV-004 and the point-in-time
constitution principle).

### ADR-2 — Deterministic selection as pure versioned functions over frozen inputs

**Decision**: Appendix I steps 1–13 are pure functions in
`packages/signal-intelligence/src/selection.ts`, keyed by
`algorithm_version` + `ranking_version` + `profile_version`; the eligible
universe is FROZEN before ranking (§20.8) and persisted with the audit
(§20.7/step 13: eligible universe, all vector values, gates, source dependence,
adapter/scenario results, rank, selection arm/probability, cutoff reason,
capacity admission, algorithm version, T_decision_ready). Reproducibility is a
tested law: identical frozen inputs + versions → byte-identical ranking audit
(canonical JSON). No wall-clock or ambient randomness exists inside the
algorithm; exploration sampling uses a seeded PRNG with recorded seed
provenance. Unknown values in Pareto comparison block domination rather than
rendering favorable (§20.10).

**Why binding**: g1-outcome-evaluation consumes ranking audits as denominators'
rank context; g1-objective-governance uses the deterministic rank as the
baseline comparator and its objective-integrity checks (§C denominator gaming,
universe changes) read the frozen-universe records. A second private ranking
implementation anywhere is a violation.

### ADR-3 — Challenger seam: disabled by construction, never an override

**Decision**: `challenger-seam.ts` encodes the §20.4/Appendix-I closing law as
types + registry rows: before a proven calibration, the deterministic path
structurally excludes learned inputs (the no-LLM/no-learned-input structural
test also covers this seam). After proof, the challenger's lower-bound expected
utility may (a) break ties and (b) allocate research within the allowed scope
ONLY — it can never modify steps 1–8 outcomes, hard gates, protected
allocations (step 11), or the exploration floor (step 12 minimum); and it
degrades automatically to disabled on calibration or regime drift signals.
The challenger model itself is FR-SIG-010 (dependency group G6); its
calibration machinery is `g1-outcome-evaluation`. AC-154's G1 half (remains
disabled, cannot override, degrades on drift) is proven here at the seam.

**Why binding**: later milestones plug challengers into exactly this seam;
the hard-gate/preserved-allocation invariants must not be re-litigated per
consumer.

### ADR-4 — Exploration honesty at the sig seam (AC-192/AC-193 field set)

**Decision**: the §20.6 exploration/control sample and §20.8 arms persist
eligibility universe ref, stratum, policy version, assignment probability
(nonzero, ≤1), seed/entropy provenance (never raw secret material — the G0
`probe_assignments` CHECK pattern), and inclusion timestamp, BEFORE outcome
observation. Corrupted assignments (zero/out-of-range probability, missing
stratum/seed, outcome-dependent assignment) are excluded from weighted
population claims by a pure predicate and stay queryable for audit. The
configured exploration floor is a versioned policy row; exploitation budget
may cross it only through a recorded audited emergency policy version, fully
traceable in the persisted partition. Protected reserves (step 11:
RISK_MONITORING, ALERT_VERIFICATION, OUTCOME_COLLECTION,
SCHEDULED_CANDIDATE_VERIFICATION via the proven `ReserveClass` vocabulary) are
allocated BEFORE the exploitation/uncertainty/exploration/probe split (step
12). Diversity dimensions whose upstream data does not exist in G1 (narrative,
developer/funding clusters) are enforced as explicit
`CONSTRAINT_DIMENSION_UNAVAILABLE` records — never silently skipped.

**Why binding**: g1-outcome-evaluation's weighted estimators and g1-objective-
governance's objective-integrity detection (reduced-exploration gaming,
FR-OBJ-008) read these exact records; the FR-EXP (G7) bandit will extend the
same partition records additively.

### ADR-5 — Recheck budgets are enforced at the seam, not by discipline

**Decision**: §21.2's per-candidate budget fields live in
`sig.recheck_budgets` (PRIMARY KEY candidate + profile_version) with usage
counters updated only through `sig.recheck_decisions` (append-only, FK to the
budget row). A recheck is scheduled only when: budget remains (rechecks, calls,
model cost), `next_check_at ≤ now` (now is an input, never read inside),
`expires_at` not passed, the candidate is not starved beyond the starvation
limit, and the §62.7 information-value aid meets
`minimum_expected_information_gain`. Every deferred/stopped decision is
recorded with its reason (STARVED_SKIP / EXPIRED_STOP /
BUDGET_EXHAUSTED_STOP / INFO_VALUE_BELOW_FLOOR_SKIP / DEFER_BACKOFF) — a
candidate MUST NOT recheck indefinitely (§21.2 closing law), and the §62.7
formula is stored only as an allocation aid, structurally barred from the
deterministic rank.

**Why binding**: g1-capacity-contracts' admission/degradation plane counts
recheck operations against capacity contracts; unbounded rechecking would
breach the proven capacity law. The information-value-as-aid-only boundary was
already asserted by the g1-capacity-contracts non-goals (§62.7 never a ranking
input) — this ADR is the consuming-side counterpart.

### ADR-6 — New migration family `sig` + mirror catch-up in the same package

**Decision**: FR-SIG persistence uses `g1_sig_*.sql` per the milestone
writeScopes; the migrator's fail-closed family list is extended with `sig`
and the central expected-script registry (`packages/persistence/test/
migrator.spec.ts`) is extended in the same package that introduces the family
(plan-level decision 1; ADR-0019/0022 central-registry duty, plan-sanctioned
scope exception). The hand-maintained ADR-001 Drizzle mirror
(`packages/persistence/src/generated/schema.ts`) is extended with the sig.*
tables in the same package so the schema-parity gate stays green — the exact
precedent of g1-data-truth-extensions (#175: "mirror catches up to SQL truth")
and g1-execution-simulation (#208). Migration files stay additive — no table
owned by another family is altered.

**Why binding**: keeps the fail-closed family discovery and the mirror-parity
invariant meaningful; the exceptions are named by exact path so the task-graph
builder records them instead of refusing at graph build.

### ADR-7 — Lifecycle risk separation consumes the proven tradability verdict

**Decision**: `sig.candidate_lifecycle` transitions carry
`tradability_verdict` (domain `TradabilityVerdict`, imported) and the SQL law
`sig_confirmed_requires_tradability` enforces that CONFIRMED requires
`TRADABLE` — the g1-execution-simulation FR-EXEC-007 blocking gate, consumed
not restated. Diagnostic signal labels persist alongside (the FR-EXEC-007
preservation law) so a tradability-blocked candidate keeps its EMERGING/
signal context. §21.3 hysteresis (different promotion/demotion thresholds,
minimum dwell) is enforced by versioned policy rows + pure resolver; §21.4
thesis-invalidation conditions are stored per candidate at CONFIRMED/MONITORING
and evaluated deterministically.

**Why binding**: g1-outcome-evaluation's promotion statistics and
g1-objective-governance's constraint layer assume CONFIRMED implies proven
tradability; a parallel lifecycle law would fork the risk separation.

## Risks and mitigations (planning-level)

| Risk                                                                    | Likelihood | Impact | Mitigation                                                                                                                                                                            |
| ----------------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Appendix I transcribed incompletely (a step silently dropped)           | Medium     | HIGH   | step-indexed implementation + step-indexed tests (each of steps 1–13 has at least one positive and one negative case); reproducibility test byte-pins the audit                       |
| Feature formulas subtly wrong (window edges, dedup thresholds, log1p)   | Medium     | HIGH   | golden vectors from Appendix H text transcribed verbatim into `baseline-features.json`; boundedness/monotonicity property tests; BigInt/exact-decimal math at the G0 computation seam |
| Scope creep into outcome-evaluation statistics or G7 bandit machinery   | Medium     | HIGH   | hard boundaries at the challenger seam and partition records (spec I3); FR-EVAL/FR-MAT/FR-AIG/FR-EXP obligations recorded in out-of-scope notes; tasks cite only FR-SIG IDs           |
| Shared AC files (AC-154, AC-190…193) later double-authored by G7 owners | Medium     | MEDIUM | ownership law fixed in spec I3 (this package authors, later packages extend additively); recorded in out-of-scope notes                                                               |
| Diversity on missing G1 upstream data fabricated or silently skipped    | Medium     | HIGH   | ADR-4 explicit `CONSTRAINT_DIMENSION_UNAVAILABLE` records; fixture cases prove the record exists whenever the dimension is unavailable                                                |
| Information-value aid leaks into deterministic ranking                  | Low        | HIGH   | structural no-learned-input test + ADR-3/ADR-5 refusal paths; AC-154 negative proves the refusal mechanically                                                                         |
| Migration registry/telemetry parity suite drift                         | Medium     | LOW    | both central suites extended in the same package (plan-level decisions 1 and 4); seed/checksum-pinned entries                                                                         |
| PGlite suites accumulate instances (OOM law)                            | Low        | HIGH   | all new suites run only through the coordinator (`pnpm test:all` / per-workload scripts); colocated targeted suites used during development (test runtime contract in CLAUDE.md)      |

## Non-goals reaffirmed (must not creep into tasks.md)

No trading/custody/signing/transaction-submission surfaces (permanent, INV-001);
no wallet/developer-graph features (FR-SIG-007, G5); no social lead-lag features
(FR-SIG-008, G5); no calibrated challenger MODEL implementation (FR-SIG-010,
G6 — only the disabled-until-proven seam lands here); no outcome maturity
statistics, promotion metrics, weighted estimators, or Missed Opportunity
Analyzer (g1-outcome-evaluation); no shadow portfolios, utility decomposition,
or objective constraints (g1-objective-governance); no discovery coverage
measurement (g1-discovery-coverage); no execution simulation, pool math, or
adapter work (g1-execution-simulation — H.14–H.16 consumed, never computed
here); no data-truth/acquisition/dependence edge computation (g1-data-truth-
extensions — H.13 consumed, never recomputed here); no capacity contracts,
admission, or degradation order (g1-capacity-contracts — protected reserve
allocations are recorded, the reserve machinery is not reimplemented); no
telemetry emitter wiring (G2); no `docs/generated/**` regeneration
(`docs/generated/sig-surfaces.json` already maps FR-SIG-001…010 — milestone
plan-level decision 2); no wallet/social/narrative upstream data fabrication
for diversity dimensions.

## Validation

```bash
node scripts/automation/package-plan-complete.mjs \
  --package g1-signal-registry --artifacts-dir <run artifacts dir>

# Package gate at the pushed HEAD (milestone verificationCommands):
test -d packages/signal-intelligence && pnpm --filter @foresift/signal-intelligence test

# Overall gates at the pushed HEAD (not planning-only):
pnpm verify
pnpm spec:verify
```
