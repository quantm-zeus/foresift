# Tasks: g2-production-readiness

**Input**: `specs/g2-production-readiness/spec.md`, `specs/g2-production-readiness/plan.md`
**Traceability rule**: every task cites at least one assigned requirement
(FR-PROD-001…006) or an acceptance criterion of those requirements.
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
specs for every acceptance criterion this package touches (AC-144,
AC-150…154, AC-272…279). All 14 of those ACs are SHARED with other
families whose base `tests/acceptance` / `tests/negative` files already
exist on `main`; this package adds the prod-scoped assertions additively
and preserves the landed family assertions (it never re-homes them).

Plan-sanctioned scope exceptions recorded per the milestone plan-level
decisions (1 and 2) and ADR-0019/ADR-0022 duty, named by exact path:
`packages/persistence/src/migrator.ts` (family-list extension with `prod`,
product-owned T010), `packages/persistence/src/generated/schema.ts`
(ADR-001 mirror catch-up, product-owned T011),
`packages/persistence/test/migrator.spec.ts` (central expected-script
registry, test-owned T012), `tests/telemetry-catalog.spec.ts` (central
telemetry parity suite, test-owned T031), and
`docs/generated/prod-surfaces.json` (implementation-mapping
reconciliation because `docs/generated/**` is deliberately outside the
package writeScopes, product-owned T029) are extended by this package even
though they sit outside the listed writeScopes.

Staging order mirrors PRD §40/§69 and the plan's architecture decisions:
governed-state vocabularies and shared schemas first, then persistence
(`prod` schema), then the capability registry and activation gate, then the
SLA/best-effort declaration, then the MCP compatibility matrix, then the
bounded-precomputation/trust boundary, then release-conformance rules,
generated surfaces and telemetry, then fixtures and the AC suites, then
cross-artifact convergence.

## Phase 1 — Foundations: governed-state vocabularies and shared schemas

- [x] T001 [P] Create `packages/domain/src/prod.ts`: the nine governed
      `ModuleLifecycleState`s (IMPLEMENTED, AVAILABLE, SHADOW, PROVEN,
      ACTIVE, DEGRADED, PAUSED, RETIRED, DISABLED) seeded from
      `NOT_IMPLEMENTED`; `OperationalReadiness` (NOT_READY,
      READY_FOR_COLLECTION, READY_FOR_SHADOW_RESEARCH,
      READY_FOR_SHADOW_ALERTS, READY_FOR_ACTIVE_PROFILE);
      `DistributionReadiness` (PRIVATE_ONLY, WORKSPACE_TECHNICALLY_READY,
      WORKSPACE_AUTHORIZED, PUBLIC_TECHNICALLY_READY, PUBLIC_AUTHORIZED);
      `DeploymentPosture` (SLA_BACKED, FREE_TIER_BEST_EFFORT);
      `ActivationGateKind`; `ChangeClassification` (NON_MATERIAL_COMPATIBLE,
      MATERIAL_OPERATIONAL, MATERIAL_EVALUATION,
      MATERIAL_SECURITY_OR_RIGHTS — §69.12); `ContainmentAction` (DEGRADED,
      PAUSED, DISABLED); `McpRevisionChannel` (STABLE, DRAFT); and
      `ProtectedDimension` (identity, point_in_time, audit,
      duplicate_prevention, security, execution_semantics, capacity,
      critical_risk_monitoring, claim_boundaries); fail-closed parsers
      throwing typed errors with stable `ProdErrorCode`s; plus the pure laws
      `isIndependentLifecycleState(state)` (IMPLEMENTED/AVAILABLE/PROVEN
      mutually independent), `requiredStatesForActivation(scope, gates)`
      total and ordered with PROVEN required only when the scope specifies it
      (§69.5), `bestEffortWeakensOnlyAllowedDimensions(declaration)` (refuses
      any intersection with `ProtectedDimension`), and
      `changeClassificationRequiresShadow(classification)`. Colocated unit
      tests are authored by the test-owned task T005 (ownership law:
      implementation lanes carry product work only). Traces: FR-PROD-001,
      FR-PROD-002, FR-PROD-003, FR-PROD-004, FR-PROD-005.
- [x] T002 [serial-reason: SHARED_FILE] Extend
      `packages/domain/src/index.ts` exports for the new `prod` module.
      Traces: FR-PROD-001…006.
- [x] T003 [P] Create `packages/shared-schemas/src/prod.ts`: Zod mirrors of
      every T001 vocabulary (compile-linked domain enums, never restated),
      all envelope objects `.strict()`, plus row schemas for the append-only
      scope-exact module state (module id, `artifact_set_hash sha256:<hex>`,
      scope object with profile/policy/regime/execution/delay/population
      fields, lifecycle state, operational/distribution readiness,
      activation event ref, superseded-by), the state transition
      (change classification, reason, actor, gate ref), the immutable
      activation-gate evaluation (scope hash, gate kind, verdict, failing
      gate, evidence refs, capacity contract ref, expiry), the containment
      event (`auto_reactivation_allowed` fixed false) and rollback event
      (`history_preserved` fixed true, new activation event, candidate
      re-evaluation ref), the dependency-group row, the critical-dependency
      register and SLA row, the best-effort declaration (protected-dimension
      refinement), the MCP revision/client/compatibility-matrix/conformance
      rows (channel, transport, Origin policy, auth mode, fixture ref,
      live-test date, result), and the precomputed-alpha bound / live-read /
      boundary-assertion rows. Validation refuses unknown keys, malformed
      hashes, unknown states, a draft revision marked default, a bound
      without ceilings, and a best-effort declaration listing a protected
      dimension. Colocated schema tests are authored by T005. Traces:
      FR-PROD-001, FR-PROD-002, FR-PROD-003, FR-PROD-004, FR-PROD-005,
      FR-PROD-006, AC-144, AC-152, AC-153, AC-278, AC-279.
- [x] T004 [serial-reason: SHARED_FILE] Extend
      `packages/shared-schemas/src/index.ts` exports for the new `prod`
      module. Traces: FR-PROD-001…006.
- [x] T005 [executor: TEST] [P] Colocated unit tests for T001 pure laws
      (the nine-state lattice with NOT_IMPLEMENTED seeding; operational and
      distribution readiness separation; IMPLEMENTED/AVAILABLE/PROVEN
      independence; ordered activation prerequisites incl. conditional
      PROVEN; best-effort protected-dimension refusal; change classification
      shadow requirement; fail-closed parse on every unknown literal) and
      T003 schema round-trips (accept exact §69.2/§69.3/§69.7/§69.12 shapes;
      refuse unknown keys, malformed hashes, draft-as-default, ceiling-less
      precomputed bounds, weakening declarations, non-strict payloads).
      Traces: FR-PROD-001, FR-PROD-002, FR-PROD-003, FR-PROD-004,
      FR-PROD-005, FR-PROD-006.

## Phase 2 — Persistence: prod schema migrations and registry duty

- [x] T006 [serial-reason: ORDERED_MIGRATION] Write
      `migrations/g2_prod_0001_module_registry.sql`: `prod` schema;
      `prod.module_states` (append-only scope-exact rows; no UPDATE path for
      scope/state — supersede via new row); `prod.state_transitions`
      (append-only, change classification CHECK); and
      `prod.activation_gate_evaluations` (immutable; verdict/failing-gate
      CHECK). All tables live under `prod`, never `public` (ADR-G2PROD-1
      proposal keeps the landed AC-261 `public`-schema probe green).
      Traces: FR-PROD-001, FR-PROD-002, AC-152.
- [x] T007 [serial-reason: ORDERED_MIGRATION] Write
      `migrations/g2_prod_0002_dependency_posture.sql`:
      `prod.containment_events` (action CHECK; `auto_reactivation_allowed`
      pinned false), `prod.rollback_events` (restored immutable artifact-set
      hash, new activation event UNIQUE, `history_preserved` pinned true,
      candidate re-evaluation ref), `prod.dependency_groups`,
      `prod.critical_dependencies`, `prod.sla_register`, and
      `prod.best_effort_declarations` (CHECK that the declared posture and
      weakened set never intersect `ProtectedDimension`). Traces:
      FR-PROD-003, FR-PROD-004, AC-153, AC-278, AC-279.
- [x] T008 [serial-reason: ORDERED_MIGRATION] Write
      `migrations/g2_prod_0003_mcp_compat.sql`: `prod.mcp_revisions`
      (channel CHECK STABLE/DRAFT; at most one default, and no draft may be
      default), `prod.mcp_target_clients`, `prod.mcp_compatibility_matrix`
      (unique `(revision, client_id)`; result CHECK; fixture + live-test
      date), and `prod.mcp_conformance_runs`. Traces: FR-PROD-005, AC-144.
- [x] T009 [serial-reason: ORDERED_MIGRATION] Write
      `migrations/g2_prod_0004_alpha_boundary.sql`:
      `prod.precomputed_alpha_bounds` (artifact-set hash, candidate/row/edge/
      latency/cost ceilings all non-null and positive, dataset cutoff,
      expiry), `prod.live_path_alpha_reads`, and
      `prod.artifact_boundary_assertions` (assertion-kind CHECK; references
      `sec.import_artifacts` by id, duplicating no import tables). Additive
      only; no ALTER of foreign families. Traces: FR-PROD-006, AC-279.
- [x] T010 [serial-reason: SHARED_FILE] Extend the fail-closed family list
      in `packages/persistence/src/migrator.ts` with `prod`
      (plan-sanctioned scope exception, exact path). Traces: FR-PROD-001.
- [x] T011 [serial-reason: SHARED_FILE] Catch the hand-maintained ADR-001
      Drizzle mirror (`packages/persistence/src/generated/schema.ts`) up to
      the T006–T009 SQL truth (plan-sanctioned scope exception, exact path)
      so the schema-parity gate passes. Traces: FR-PROD-001.
- [x] T012 [executor: TEST] [P] Extend the central expected-script registry
      (`packages/persistence/test/migrator.spec.ts`, exact path —
      plan-sanctioned scope exception) with the four `g2_prod_*` scripts in
      lexicographic order. Traces: FR-PROD-001.
- [x] T013 [executor: TEST] [P] PGlite migration-shape tests for the `prod`
      family: all four scripts apply cleanly on a fresh database; SQL CHECKs
      refuse an in-place module-state mutation, an ACTIVE row without a gate
      evaluation, a draft revision marked default, a precomputed bound without
      ceilings, a best-effort declaration listing a protected dimension, and a
      containment row allowing auto-reactivation; `prod` tables are absent
      from `public`. Traces: FR-PROD-001, FR-PROD-002, FR-PROD-004,
      FR-PROD-005, FR-PROD-006, AC-152, AC-153, AC-278.

## Phase 3 — Capability registry and activation gate

- [x] T014 [P] Create `packages/capability-registry/src/module-states.ts`:
      the scope-exact, append-only registry read/write model over
      `prod.module_states`/`prod.state_transitions`; transitions supersede
      via new rows (never UPDATE); `advanceState` refuses a transition that
      crosses the activation gate, refuses an unknown or mismatched scope,
      and refuses an in-place mutation; `statesFor(module, scope)` reports
      the three independent dimensions (implemented/available/proven)
      separately so a deployed-but-unavailable module can exist (AC-152).
      Traces: FR-PROD-001, FR-PROD-002, AC-152.
- [x] T015 [P] Create `packages/capability-registry/src/activation-gate.ts`:
      the §69.4/§69.5/§69.9 gate set as one total ordered pure function —
      IMPLEMENTED present, AVAILABLE evidence (data/rights/capability/source
      coverage/pool adapter/cost/capacity/freshness), PROVEN present when the
      scope specifies it, exact-scope match of registered statistical
      evidence including the §31/§39 negative controls (AC-150) and clustered
      intervals (AC-151), calibration maturity before expected-net-utility
      ranking influence (AC-154), verified gate evidence through
      `@foresift/release-conformance` `evaluateGateEvidence`, a passing
      capacity contract consumed from `@foresift/capacity-planner`, current
      workspace/public rights/claims/isolation evidence (AC-272, AC-273,
      AC-275, AC-276, AC-277), and no open containment. Each condition
      returns PASS or a typed refusal naming the gate; missing inputs fail
      closed; the function consumes foreign results and never recomputes
      statistics, capacity, security, rights, or claims logic. Traces:
      FR-PROD-001, FR-PROD-002, FR-PROD-004, FR-PROD-005, AC-144, AC-150,
      AC-151, AC-152, AC-154, AC-272, AC-273, AC-275, AC-276, AC-277.
- [x] T016 [P] Create `packages/capability-registry/src/dependency-groups.ts`:
      the build/test ordering view over `@foresift/requirement-manifest`
      `dependencyGroups` (G0…G7 DAG, acyclicity via
      `checkDependencyDagAcyclicity`, group status persisted in
      `prod.dependency_groups`), exposing the §40 separation that group
      completion means production-ready code and never automatic opportunity
      activation; re-uses release-conformance's `DEPENDENCY_GATE_NOT_OPEN`
      premature rule as the enforcement point and refuses to re-derive
      requirement→group mapping (FR-PROD-003). Traces: FR-PROD-003, AC-152.
- [x] T017 [P] Create `packages/capability-registry/src/containment.ts`:
      `containForFailedGate` maps a failed critical gate (security, parity,
      leakage, rights, capacity, recovery, calibration, adversarial, claims)
      to DEGRADED/PAUSED/DISABLED on the smallest affected scope, records the
      reason, and refuses any automatic reactivation — only an explicit
      revalidation event advances it (AC-278); `rollbackToApproved` restores a
      previously approved immutable configuration/artifact set, appends a new
      activation event, preserves all historical decisions, and blocks alert
      resumption until currently actionable candidates are re-evaluated
      (AC-279). Traces: FR-PROD-002, AC-278, AC-279.
- [x] T018 [serial-reason: SEMANTIC_DEPENDENCY] Create
      `packages/capability-registry/src/index.ts` barrel plus package
      scaffold (`package.json` `@foresift/capability-registry`, tsconfig
      extending the base, `bun test` script, workspace dependencies on
      domain, shared-schemas, persistence, release-conformance,
      capacity-planner, and requirement-manifest) following the G0/G1/G2
      package pattern. Traces: FR-PROD-001.
- [x] T019 [executor: TEST] [P] Registry/activation unit tests on PGlite:
      the nine-state lattice and IMPLEMENTED/AVAILABLE/PROVEN independence;
      every activation gate refusal reachable and typed by gate name;
      missing/stale/mismatched-scope input fails closed; draft/immature
      calibration cannot activate; capacity-contract failure refuses;
      containment selects the smallest scope, records the reason, and cannot
      auto-reactivate; rollback appends a new activation event and preserves
      history pending candidate re-evaluation. Traces: FR-PROD-001,
      FR-PROD-002, FR-PROD-003, FR-PROD-004, FR-PROD-005, AC-144, AC-150,
      AC-151, AC-152, AC-154, AC-272, AC-273, AC-275, AC-276, AC-277,
      AC-278, AC-279.

## Phase 4 — SLA / best-effort declaration

- [x] T020 [P] Create `packages/capability-registry/src/deployment-posture.ts`:
      the critical-external-dependency register and SLA evaluation over
      `prod.critical_dependencies`/`prod.sla_register`; posture is SLA_BACKED
      only when every critical dependency has an applicable unexpired SLA,
      otherwise FREE_TIER_BEST_EFFORT with an explicit degraded scope and
      reason; `assertBestEffortPreservesProtectedDimensions` refuses any
      declaration that weakens identity, point-in-time, audit, duplicate
      prevention, security, execution semantics, capacity enforcement,
      critical risk monitoring, or claim boundaries; a capacity/quota failure
      degrades breadth/depth/opportunity availability only; consumes the
      capacity-planner contract rather than bypassing it (FR-PROD-004).
      Traces: FR-PROD-004, AC-153.
- [x] T021 [executor: TEST] [P] Posture unit tests: all-critical-SLA yields
      SLA_BACKED; one missing/expired/non-applicable SLA yields an explicit
      FREE_TIER_BEST_EFFORT declaration; a declaration weakening any
      protected dimension is refused at both law and SQL level; a simulated
      quota/capacity degradation still asserts integrity, audit,
      duplicate prevention, capacity enforcement, and critical risk
      monitoring. Traces: FR-PROD-004, AC-153.

## Phase 5 — MCP compatibility matrix

- [x] T022 [P] Create `packages/capability-registry/src/mcp-compat.ts`: the
      §69.7 matrix resolver over `prod.mcp_revisions` /
      `prod.mcp_target_clients` / `prod.mcp_compatibility_matrix`; the
      default is the latest mutually tested stable revision (baseline
      `2025-11-25`); a revision×client cell is usable only with a passing
      conformance run and a non-stale live-test date; draft/RC revisions are
      explicit opt-in and can never be the default; missing/unsupported
      protocol-version follows the declared compatibility policy; consumes
      the existing `McpProtocolGuard` allow-list instead of reimplementing
      transport validation. Traces: FR-PROD-005, AC-144.
- [x] T023 [executor: TEST] [P] MCP compatibility unit tests: baseline
      stable revision × every supported target client resolves through
      passing cells; a draft revision used as the default, an untested cell,
      and a missing revision outside the declared policy are refused; a
      stale live-test date marks the cell unusable. Traces: FR-PROD-005,
      AC-144.

## Phase 6 — Precomputation and trust boundary

- [x] T024 [P] Create `packages/capability-registry/src/precomputed-alpha.ts`:
      the bounded live-path contract over `prod.precomputed_alpha_bounds` /
      `prod.live_path_alpha_reads`; serves only versioned precomputed lookups
      with declared candidate/row/edge/latency/cost ceilings and freshness;
      refuses an unbounded, expired, or unknown-artifact request instead of
      truncating it into a different claim; records served/refused per read
      (§33.7). Traces: FR-PROD-006.
- [x] T025 [P] Create `packages/capability-registry/src/trust-boundary.ts`:
      export/import confinement assertions over
      `prod.artifact_boundary_assertions` — heavy Alpha Lab mining,
      cross-fitting, replay, and adversarial sweeps never run on a live path;
      imports flow only through `packages/security` `ImportGate` and
      `sec.import_artifacts`; imported artifacts land in VALIDATING/SHADOW and
      never ACTIVE; no live-path request carries provider, import, or
      decryption access (§10.3, §35.14). Traces: FR-PROD-006, AC-279.
- [x] T026 [executor: TEST] [P] Precomputation/boundary unit tests: a
      bounded fresh lookup is served and a bound-exceeded, expired, or
      unbounded request is refused with a typed reason; a live path that
      references a heavy Alpha Lab job, an artifact import, or a provider
      call fails its boundary assertion; an imported artifact reaches SHADOW
      only and has no direct-activation path. Traces: FR-PROD-006, AC-279.

## Phase 7 — Release-conformance rules, generated surfaces, telemetry

- [x] T027 [P] Create `packages/release-conformance/src/prod-rules.ts`: the
      PROD-facing rules layered over the existing `CONFORMANCE_RULES`
      (`NORMATIVE_MAPPING_COMPLETE`, `ACTIVE_IMPLEMENTATION_PATH_EXISTS`,
      `DEPENDENCY_GATE_NOT_OPEN`, `GENERATED_DOCUMENT_DRIFT` retained
      unchanged) — activation-without-evidence, posture-weakening,
      MCP-compatibility drift, live-path precomputation violation, and
      public-authorization-without-gate-evidence — reusing
      `resolveMappings`, `implementationPath`, and the existing
      finding/report shape rather than rewriting the rule engine (D8).
      Traces: FR-PROD-001, FR-PROD-002, FR-PROD-003, FR-PROD-004,
      FR-PROD-005, FR-PROD-006, AC-144, AC-152, AC-272, AC-273, AC-275,
      AC-276, AC-277, AC-278, AC-279.
- [x] T028 [serial-reason: SHARED_FILE] Extend the
      `packages/release-conformance/src/index.ts` barrel with the prod rules
      so the package's public surface exposes them. Traces: FR-PROD-001.
- [x] T029 [serial-reason: SHARED_FILE] Reconcile
      `docs/generated/prod-surfaces.json` with the new implementation paths
      introduced by T014–T027 (plan-sanctioned scope exception, exact path;
      milestone plan-level decision 2) so the generated-docs drift rule
      passes without editing `docs/spec/**`. Traces: FR-PROD-001.
- [x] T030 [P] Create `telemetry/prod.catalog.json`: the declarative event
      and metric catalog mirroring `packages/shared-schemas/src/prod.ts`
      exactly (module state transition per dimension; activation gate
      passed/refused per gate kind; containment/rollback; posture declared and
      SLA missing/expired; MCP conformance pass/fail per revision×client;
      precomputed lookup served/refused; import boundary assertion
      pass/fail), with per-event requirement refs and the critical-metadata
      recovery tier. Traces: FR-PROD-001, FR-PROD-002, FR-PROD-003,
      FR-PROD-004, FR-PROD-005, FR-PROD-006.
- [x] T031 [executor: TEST] [serial-reason: SHARED_FILE] Extend the central
      telemetry parity suite (`tests/telemetry-catalog.spec.ts`, exact path —
      plan-sanctioned scope exception) with the `prod` catalog.
      Traces: FR-PROD-001.
- [x] T032 [executor: TEST] [P] Release-conformance prod-rule tests: each new
      rule detects its violation (active module without a passing gate,
      best-effort declaration weakening a protected dimension, default draft
      revision or stale matrix cell, live path reaching a heavy job/import,
      workspace/public authorization missing evidence) and accepts
      compliant input; the four pre-existing rules still pass unchanged.
      Traces: FR-PROD-001, FR-PROD-002, FR-PROD-003, FR-PROD-004,
      FR-PROD-005, FR-PROD-006, AC-144, AC-152, AC-272, AC-273, AC-275,
      AC-276, AC-277, AC-278, AC-279.

## Phase 8 — Fixtures and acceptance suites

- [x] T033 [executor: TEST] [P] Create `tests/fixtures/prod/`: canonical
      module-state rows for every governed state and readiness dimension,
      full activation-gate pass/fail matrices (including conditional PROVEN
      and scope mismatch), dependency-group DAG fixtures, SLA register and
      best-effort declarations (compliant + weakening), MCP revision/client
      matrix fixtures (stable, draft, untested, stale), precomputed-bound and
      boundary-assertion fixtures (bounded, unbounded, import-referencing),
      and containment/rollback fixtures. Traces: FR-PROD-001, FR-PROD-002,
      FR-PROD-003, FR-PROD-004, FR-PROD-005, FR-PROD-006.
- [x] T034 [executor: TEST] [P] Author the prod-scoped additions to
      `tests/acceptance/AC-144.spec.ts` +
      `tests/negative/AC-144.negative.spec.ts`: default stable revision
      `2025-11-25` passes for every supported target client / draft revision
      as default, untested cell, and missing revision outside policy are
      refused. Traces: FR-PROD-005, AC-144.
- [x] T035 [executor: TEST] [P] Author the prod-scoped additions to the
      AC-150/AC-151/AC-154 positive and negative suites: registered
      permutation/feature-time-shift/synthetic-null/delayed-provider controls
      and clustered-interval evidence gate PROVEN/ACTIVE / unexplained lift
      or naive intervals refuse, and expected-net-utility ranking stays
      disabled before mature calibration, cannot override hard gates, and
      auto-degrades on drift. Traces: FR-PROD-001, FR-PROD-002, AC-150,
      AC-151, AC-154.
- [x] T036 [executor: TEST] [P] Author the prod-scoped additions to the
      AC-152/AC-153 positive and negative suites: a deployed IMPLEMENTED or
      shadow-only module cannot support alert claims and promotion reaches
      ACTIVE only with AVAILABLE (and PROVEN when specified) / ACTIVE from
      IMPLEMENTED alone and claims from a non-AVAILABLE module are refused;
      a free-tier best-effort declaration preserves integrity, audit,
      duplicate prevention, and critical risk monitoring / weakening any
      protected dimension is refused. Traces: FR-PROD-001, FR-PROD-002,
      FR-PROD-004, AC-152, AC-153.
- [x] T037 [executor: TEST] [P] Author the prod-scoped additions to the
      AC-272/AC-273/AC-275/AC-276/AC-277 positive and negative suites:
      workspace/public authorization requires the full evidence set for the
      exact release and a rights change contains the affected scope while
      listing artifacts for quarantine / technically ready without evidence
      stays unauthorized; isolation, claims-language, and public-redaction
      gate evidence is mandatory. Traces: FR-PROD-002, FR-PROD-004,
      AC-272, AC-273, AC-275, AC-276, AC-277.
- [x] T038 [executor: TEST] [P] Author the prod-scoped additions to the
      AC-274/AC-278/AC-279 positive and negative suites: high-impact
      activation/rollback/import actions require fresh phishing-resistant
      step-up, exact authorization, CSRF, idempotency key, reason, and audit
      (TOTP-only insufficient); a failed critical gate pauses the smallest
      scope with a recorded reason and no auto-reactivation; rollback
      restores a previously approved immutable set, creates a new activation
      event, preserves history, and blocks alert resumption until actionable
      candidates are re-evaluated. Traces: FR-PROD-002, FR-PROD-006,
      AC-274, AC-278, AC-279.

## Phase 9 — Convergence

- [x] T039 [serial-reason: COORDINATOR_BOUNDARY] Run cross-artifact
      consistency analysis per the speckit-analyze methodology across
      spec.md, plan.md, and tasks.md (requirement coverage of all six
      FR-PROD IDs and all fourteen ACs; no out-of-scope requirement tracing;
      no orphaned modules; interface-seam alignment with the durable
      engine, alert lifecycle, admin rendering, recovery drills,
      capacity-planner, requirement-manifest, and security import/MCP
      guards documented without implementing their logic) and repair every
      finding inside this package's scope; record anything outside scope in
      the run's out-of-scope notes instead of planning it. Traces:
      FR-PROD-001, FR-PROD-002, FR-PROD-003, FR-PROD-004, FR-PROD-005,
      FR-PROD-006.
