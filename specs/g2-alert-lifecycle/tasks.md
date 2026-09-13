# Tasks: g2-alert-lifecycle

**Input**: `specs/g2-alert-lifecycle/spec.md`, `specs/g2-alert-lifecycle/plan.md`
**Traceability rule**: every task cites at least one assigned requirement
(FR-ALERT-001…005) or an acceptance criterion of those requirements.
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
specs for every acceptance criterion this package authors (AC-140, AC-141)
plus alert-scoped extends of the shared AC-142/AC-143 suites (owned by the
FR-SOC/G5 social family) and the shared AC-245…249 suites (owned by the
G0/G1 core/data/eval/mat/obj families; their
`tests/acceptance/AC-245…249.spec.ts` and negative files already exist on
`main` and stay green). FR-ALERT-005 additionally requires per-class metric
and denominator separation, exercised by the metrics unit task T026 and the
AC-140 suites.
Plan-sanctioned scope exceptions recorded per the milestone plan-level
decisions (1 and 3) and ADR-0019/ADR-0022 duty, named by exact path:
`packages/persistence/src/migrator.ts` (family-list extension with `alert`,
product-owned T008), `packages/persistence/src/generated/schema.ts`
(ADR-001 mirror catch-up, product-owned T009),
`packages/persistence/test/migrator.spec.ts` (central expected-script
registry, test-owned T010), and `tests/telemetry-catalog.spec.ts` (central
telemetry parity suite, test-owned T025) are extended by this package even
though they sit outside the listed writeScopes.

Staging order mirrors the PRD §26 pipeline and the engine boundary: domain
vocabularies and shared schemas first, then persistence (`alert` schema),
then the classification/policy engine (policies → gates → classification →
content → engine-boundary commit adapter), then the update/expiry lifecycle
(fingerprints → updates → monitoring → tests), then metrics and telemetry,
then fixtures and the AC suites, then cross-artifact convergence.

## Phase 1 — Foundations: alert vocabularies and shared schemas

- [x] T001 [P] Create `packages/domain/src/alert.ts`: the §26.2
      `AlertClass` vocabulary (EARLY_WATCH, CONFIRMED_OPPORTUNITY,
      THESIS_STRENGTHENING, THESIS_WEAKENING, OPPORTUNITY_EXPIRED,
      RISK_ALERT), `AlertUpdateKind` (MATERIAL_DETERIORATION, CANCELLATION,
      EXPIRY, RISK), `ActionabilityState`, alert lifecycle/risk states,
      `SocialCapabilityState` (§67.2 six states), and latency-budget
      outcome states; fail-closed parsers throwing typed errors with stable
      `AlertErrorCode`s; plus the pure laws `alertPolicyFor(class)`
      (total over the six classes: `ttl_seconds`, `cooldown_seconds`,
      `high_conviction_allowed`, confirmed-denominator membership,
      material-change thresholds), `defaultTtlSeconds(class)` with the
      EARLY_WATCH-shorter-than-CONFIRMED invariant,
      `fingerprintOf(§26.4 fields)`, `materialChangeExceeds(prior, next)`,
      `actionabilityFor(validUntil, cancellation, now)`, and
      `socialIsUnknownCoverage(state)` (SOCIAL_UNAVAILABLE cannot be a
      negative feature or organic confirmation). Colocated unit tests are
      authored by the test-owned task T005 (ownership law: implementation
      lanes carry product work only). Traces: FR-ALERT-001, FR-ALERT-002,
      FR-ALERT-003, FR-ALERT-004, FR-ALERT-005.
- [x] T002 [serial-reason: SHARED_FILE] Extend
      `packages/domain/src/index.ts` exports for the new alert module.
      Traces: FR-ALERT-001…005.
- [x] T003 [P] Create `packages/shared-schemas/src/alert.ts`: Zod mirrors
      of every T001 vocabulary (compile-linked domain enums, never
      restated), all envelope objects `.strict()`, plus row schemas for the
      immutable per-class policy (config hash `sha256:<hex>`, ttl/cooldown,
      denominator-membership flag, thresholds), the §26.4 alert record and
      fingerprint (decision/run refs, lifecycle/risk state, severity,
      actionability, `valid_until`, execution assumptions, evidence refs,
      content hash, supersedes ref), the update-notification row
      (idempotency key, prior-alert ref, update kind, fingerprint), the
      alert-classification input envelope (gate inputs, social capability
      state, prior-alert ref), the opportunity content envelope
      (`valid_until`, `actionability_state`, configured notional, modeled
      entry/exit impact, cancellation state, evidence timestamp, evidence
      links, missing data), and the per-class metric observation
      (metric_key, numerator, denominator, sample_size, window). Validation
      refuses unknown keys, malformed hashes, unclassifiable classes, and
      any attempt to express a metric without a class. Colocated schema
      tests are authored by T005. Traces: FR-ALERT-001, FR-ALERT-002,
      FR-ALERT-003, FR-ALERT-004, FR-ALERT-005, AC-140, AC-141.
- [x] T004 [serial-reason: SHARED_FILE] Extend
      `packages/shared-schemas/src/index.ts` exports for the new alert
      module. Traces: FR-ALERT-001…005.
- [x] T005 [executor: TEST] [P] Colocated unit tests for T001 pure laws
      (policy totality over the six classes; EARLY_WATCH short-TTL
      invariant; fingerprint determinism and §26.4 field coverage;
      material-change thresholds; actionability/expiry; social unknown
      coverage; fail-closed parse on every unknown literal) and T003
      schema round-trips (accept exact §26.4/§26.2 shapes; refuse unknown
      keys, malformed hashes, class-less metrics, and non-strict update
      payloads). Traces: FR-ALERT-001, FR-ALERT-002, FR-ALERT-003,
      FR-ALERT-004, FR-ALERT-005.

## Phase 2 — Persistence: alert schema migrations and registry duty

- [x] T006 [serial-reason: ORDERED_MIGRATION] Write
      `migrations/g2_alert_0001_alert_state.sql`: `alert` schema;
      `alert.alert_policies` (immutable `(alert_class, version)` rows,
      config hash, TTL/cooldown, denominator-membership flag, thresholds;
      no UPDATE path — supersede via new row); `alert.alert_records`
      (decision/run refs, class, §26.4 fingerprint, thesis version,
      lifecycle/risk state, severity, actionability, `valid_until`,
      execution assumptions JSONB, evidence refs JSONB, content hash,
      supersedes ref); `alert.alert_fingerprints` (fingerprint PK, class,
      last alert/severity/thesis/evidence hash, cooldown_until). All tables
      live under `alert`, never `public` (ADR-G2ALERT-1 proposal keeps the
      landed AC-261 probe green). Traces: FR-ALERT-001, FR-ALERT-004,
      AC-141.
- [x] T007 [serial-reason: ORDERED_MIGRATION] Write
      `migrations/g2_alert_0002_updates_metrics.sql`:
      `alert.alert_updates` (prior-alert ref, update-kind CHECK
      MATERIAL_DETERIORATION/CANCELLATION/EXPIRY/RISK, fingerprint,
      idempotency_key UNIQUE, alert/outbox refs); and
      `alert.alert_metric_observations` (class-scoped metric_key,
      numerator, denominator, sample_size, window bounds, observed_at;
      CHECKs keeping denominators non-negative and class-scoped). Numbers
      after T006; additive only, no ALTER of foreign families.
      Traces: FR-ALERT-004, FR-ALERT-005, AC-140, AC-141.
- [x] T008 [serial-reason: SHARED_FILE] Extend the fail-closed family
      list in `packages/persistence/src/migrator.ts` with `alert`
      (plan-sanctioned scope exception, exact path). Traces: FR-ALERT-001.
- [x] T009 [serial-reason: SHARED_FILE] Catch the hand-maintained
      ADR-001 Drizzle mirror
      (`packages/persistence/src/generated/schema.ts`) up to the T006/T007
      SQL truth (plan-sanctioned scope exception, exact path) so the
      schema-parity gate passes. Traces: FR-ALERT-001.
- [x] T010 [executor: TEST] [P] Extend the central expected-script
      registry (`packages/persistence/test/migrator.spec.ts`, exact path —
      plan-sanctioned scope exception) with the two `g2_alert_*` scripts
      in lexicographic order. Traces: FR-ALERT-001.
- [x] T011 [executor: TEST] [P] PGlite migration-shape tests for the
      `alert` family: both scripts apply cleanly on a fresh database; SQL
      CHECKs refuse an in-place policy mutation, a duplicate
      `(alert_class, version)`, a duplicate update idempotency key, and a
      class-less metric observation; `alert` tables are absent from
      `public`. Traces: FR-ALERT-001, FR-ALERT-004, FR-ALERT-005, AC-140,
      AC-141.

## Phase 3 — Classification and policy engine

- [x] T012 [P] Create `packages/alerts/src/policies.ts`: the immutable
      per-class policy registry resolving `alertPolicyFor(class)` from
      `alert.alert_policies` with an in-code fallback default; separate
      TTL, cooldown, thresholds, content policy, and denominator
      membership for each of the six classes; EARLY_WATCH TTL asserted
      strictly shorter than CONFIRMED_OPPORTUNITY; unknown class or
      unmapped policy version refuses with a typed error. Traces:
      FR-ALERT-001, FR-ALERT-002, FR-ALERT-005, AC-140.
- [x] T013 [P] Create `packages/alerts/src/gates.ts`: the §26.3
      confirmed-opportunity gate set as one total ordered pure function —
      decision ALERT, no critical risk, active-profile eligibility,
      minimum data coverage, minimum independent evidence groups, market/
      security/holder freshness, semantic validation, unresolved-conflict
      threshold, fingerprint/cooldown, daily/schedule budget, execution-
      aware tradability for the configured notional and delay, expiry /
      `valid_until` actionability, deterministic Solana security checks or
      an approved profile fallback, and `STRICT_FREE` cost policy. Each
      condition returns PASS or a typed refusal naming the gate; missing
      inputs fail closed; the function consumes gate results as inputs and
      never recomputes execution/security/cost logic owned elsewhere.
      Traces: FR-ALERT-003, FR-ALERT-004, AC-140, AC-141, AC-245,
      AC-246, AC-247, AC-248, AC-249.
- [x] T014 [P] Create `packages/alerts/src/classification.ts`: classify a
      Zod-validated decision+evidence input into exactly one §26.2 class
      (or an explicit suppression outcome) by composing T012 policies and
      T013 gates; route strengthening/weakening vs expiry vs risk from
      lifecycle/risk state; treat an absent social capability as
      `SOCIAL_UNAVAILABLE` unknown coverage (never negative evidence,
      never organic confirmation); refuse an unauthorized scraping/private
      endpoint capability referenced by input; refuse a CONFIRMED_
      OPPORTUNITY classification when gate inputs are unavailable
      (§34.3 fail-closed). Traces: FR-ALERT-001, FR-ALERT-002,
      FR-ALERT-003, FR-ALERT-004, AC-140, AC-142, AC-143.
- [x] T015 [P] Create `packages/alerts/src/content.ts`: class-templated
      renderer. EARLY_WATCH template lists explicit missing data and runs
      a deterministic high-conviction/buy-language check that refuses
      offending content; opportunity templates require `valid_until`,
      `actionability_state`, configured notional, modeled entry/exit
      impact, cancellation state, evidence timestamp, execution
      assumptions, and the frozen run/evidence link; a positive headline
      is suppressed when the body carries a critical contradiction or a
      failed required delay/stress scenario (§26.8); renders
      `SOCIAL_UNAVAILABLE` as missing data. Traces: FR-ALERT-001,
      FR-ALERT-002, FR-ALERT-003, AC-140, AC-142.
- [x] T016 [serial-reason: SEMANTIC_DEPENDENCY] Create
      `packages/alerts/src/commit.ts`: thin adapter over the landed engine
      boundary — validate the classified alert plus rendered payload,
      derive the idempotent fingerprint/update key, then call
      `commitDecisionWithOutbox` with the `OPPORTUNITY_NOTIFICATION`
      influence and return the engine result unchanged; never open its own
      transaction, write outbox rows directly, or reimplement delivery/
      retry/channel logic (durable-workflow plan D1). Traces:
      FR-ALERT-001, FR-ALERT-004, AC-141.
- [x] T017 [serial-reason: SHARED_FILE] Create
      `packages/alerts/src/index.ts` barrel plus package scaffold
      (`package.json` `@foresift/alerts`, tsconfig extending the base,
      `bun test` script, workspace dependencies on domain, shared-schemas,
      persistence, and workflow-runtime) following the G0/G1/G2 package
      pattern. Traces: FR-ALERT-001.
- [x] T018 [executor: TEST] [P] Classification/policy/content unit tests
      on PGlite with the fake channel: six-class policy totality and
      separate TTL/cooldown; every §26.3 gate refusal reachable and typed;
      unknown gate input fails closed; EARLY_WATCH high-conviction content
      refused while a compliant watch record passes; opportunity content
      completeness check; SOCIAL_UNAVAILABLE never lowers score or claims
      organic confirmation; classification+content+commit path adds
      bounded internal overhead and a budget-exceeded alert is
      expired/suppressed rather than delivered late (§33.1/§33.9).
      Traces: FR-ALERT-001, FR-ALERT-002, FR-ALERT-003, AC-140, AC-142,
      AC-143.

## Phase 4 — Update and expiry lifecycle

- [x] T019 [P] Create `packages/alerts/src/fingerprints.ts`: §26.4
      fingerprint construction over the exact field list; material-change
      evaluation against the per-class thresholds; the fingerprint/
      cooldown ledger read/write over `alert.alert_fingerprints`; repeat
      suppression decision (severity, thesis, or material evidence must
      change beyond threshold for a repeat to be allowed). Traces:
      FR-ALERT-001, FR-ALERT-004, AC-141.
- [x] T020 [P] Create `packages/alerts/src/lifecycle.ts`: evaluation of
      prior actionable alerts — material deterioration, cancellation,
      expiry, and risk events each build an update/cancellation
      notification with a deterministic idempotency key
      `(prior_alert, update_kind, fingerprint, thesis_version)`; commits
      through T016; below-threshold changes and non-actionable priors emit
      nothing; duplicate updates inside cooldown collapse to one.
      Traces: FR-ALERT-004, FR-ALERT-005, AC-141.
- [x] T021 [P] Create `packages/alerts/src/monitoring.ts`: deterministic
      expiry/deterioration sweep entry point that selects prior actionable
      alerts due for reassessment (bounded batch, injected clock), applies
      T019/T020, and records per-class outcomes; an alert whose
      actionability budget is exceeded transitions to expired/suppressed
      and never reaches the delivery path late. Traces: FR-ALERT-004,
      AC-141.
- [x] T022 [executor: TEST] [P] Lifecycle unit tests on PGlite with the
      fake channel: material deterioration/cancellation/expiry each yield
      exactly one idempotent update; replayed update and crashed delivery
      re-send exactly once through the engine; immaterial change and
      non-actionable prior yield no update; cooldown collapse; expiry
      sweep marks budget-exceeded alerts expired without delivery.
      Traces: FR-ALERT-004, FR-ALERT-005, AC-141.

## Phase 5 — Metrics and telemetry

- [x] T023 [P] Create `packages/alerts/src/metrics.ts`: per-class metric
      and denominator computation over `alert.alert_metric_observations`
      with explicit numerator, denominator, and sample size; declared
      per-class metric keys; EARLY_WATCH excluded from the
      confirmed-opportunity precision/recall denominator; a pooled
      cross-class denominator request is refused (FR-ALERT-005, AC-140).
      Traces: FR-ALERT-005, AC-140.
- [x] T024 [P] Create `telemetry/alert.catalog.json`: declarative event
      and metric catalog mirroring `packages/shared-schemas/src/alert.ts`
      exactly (classification decided/suppressed per class; each §26.3
      gate passed/refused; content rendered/language-refused;
      `SOCIAL_UNAVAILABLE` observed; fingerprint/cooldown suppress;
      update committed/deduplicated/expired; per-class metric observation
      with numerator/denominator/sample size), with per-event requirement
      refs and the critical-metadata recovery tier. Traces: FR-ALERT-001,
      FR-ALERT-002, FR-ALERT-003, FR-ALERT-004, FR-ALERT-005.
- [x] T025 [executor: TEST] [serial-reason: SHARED_FILE] Extend the
      central telemetry parity suite (`tests/telemetry-catalog.spec.ts`,
      exact path — plan-sanctioned scope exception) with the `alert`
      catalog. Traces: FR-ALERT-001.
- [x] T026 [executor: TEST] [P] Metrics unit tests: each class emits its
      own numerator/denominator with sample size; EARLY_WATCH is absent
      from the confirmed denominator under a mixed-class population; a
      pooled metric or a class-less observation is refused.
      Traces: FR-ALERT-005, AC-140.

## Phase 6 — Fixtures and acceptance suites

- [x] T027 [executor: TEST] [P] Create `tests/fixtures/alerts/`: canonical
      classification inputs (each class), full §26.3 gate pass/fail
      matrices, EARLY_WATCH short-TTL + explicit-missing-data +
      high-conviction-language fixtures, CONFIRMED_OPPORTUNITY full gate
      set fixtures, deterioration/cancellation/expiry prior-alert
      fixtures, fingerprint/cooldown fixtures, `SOCIAL_UNAVAILABLE`
      fixtures, unauthorized-adapter-reference fixtures, and per-class
      metric population fixtures. Traces: FR-ALERT-001, FR-ALERT-002,
      FR-ALERT-003, FR-ALERT-004, FR-ALERT-005.
- [x] T028 [executor: TEST] [P] Author `tests/acceptance/AC-140.spec.ts` + `tests/negative/AC-140.negative.spec.ts`: EARLY_WATCH and
      CONFIRMED_OPPORTUNITY have separate policies, content, TTL, metrics,
      and denominators / unknown class, misapplied template, and pooled
      cross-class denominator refused. Traces: FR-ALERT-001, FR-ALERT-002,
      FR-ALERT-003, FR-ALERT-005, AC-140.
- [x] T029 [executor: TEST] [P] Author `tests/acceptance/AC-141.spec.ts` + `tests/negative/AC-141.negative.spec.ts`: material invalidation or
      expiry of an actionable prior alert creates an idempotent
      update/cancellation notification / below-threshold change,
      non-actionable prior, and within-cooldown duplicate produce no
      second notification. Traces: FR-ALERT-001, FR-ALERT-004, AC-141.
- [x] T030 [executor: TEST] [P] Alert-scoped extends of the shared suites
      whose base files stay with their owners: AC-142/AC-143 (FR-SOC/G5) —
      `SOCIAL_UNAVAILABLE` is explicit missing data that cannot become a
      negative social feature, organic confirmation, or a block without an
      approved fallback, and an unauthorized scraping/private-endpoint
      adapter cannot be enabled by alert configuration or model request;
      AC-245…249 (existing G0/G1 `tests/acceptance/AC-24*.spec.ts` and
      negative files stay green) — a confirmation whose evidence groups
      are empirically dependent, whose gate depends on duplicated lineage,
      whose retrospective dependence estimate would alter a frozen
      historical evidence count, whose mature counts/effective sample size
      are below threshold, or whose placebo/leakage controls show
      unexplained lift cannot be classified CONFIRMED_OPPORTUNITY.
      Traces: FR-ALERT-001, FR-ALERT-003, AC-142, AC-143, AC-245, AC-246,
      AC-247, AC-248, AC-249.

## Phase 7 — Convergence

- [x] T031 [serial-reason: COORDINATOR_BOUNDARY] Run cross-artifact
      consistency analysis per the speckit-analyze methodology across
      spec.md, plan.md, and tasks.md (requirement coverage of all five
      FR-ALERT IDs and all nine ACs; no out-of-scope requirement tracing;
      no orphaned modules; interface-seam alignment with the durable
      engine boundary, the admin renderer, the social/G5 capability owner,
      and the recovery package documented without implementing their
      logic) and repair every finding inside this package's scope; record
      anything outside scope in the run's out-of-scope notes instead of
      planning it. Traces: FR-ALERT-001, FR-ALERT-002, FR-ALERT-003,
      FR-ALERT-004, FR-ALERT-005.
