# Tasks: g2-production-readiness

> **EMERGENCY CORRECTION — proof REOPENED then RE-PROVEN (third round,
> 2026-09-13).** The re-PROVEN flip `8f7b5d9` (PR #295) was revoked by a fresh
> independent verification that reproduced **three HIGH fail-opens on `main`**:
> (1) the activation-gate evaluations were only shallow-frozen, so a caller
> could mutate a recorded pass's nested evaluation and defeat the `advanceState`
> persisted-dimension cross-check; (2) `ACTIVATION_WITHOUT_EVIDENCE` accepted an
> ACTIVE claim whose `activationEventRef` was omitted or empty; (3) the
> PUBLIC/WORKSPACE authorization rule substring-matched a string `scopeRefs`
> and accepted foreign-release evidence. Phase 11 closed those (`8793dd4`),
> hardened the rules (`8a0b5f7`), and closed the convergence-audit findings —
> the §69.9 distribution gate SQL bug that made every WORKSPACE/PUBLIC ACTIVE
> insert abort (`g2_prod_0009`) and the prod telemetry-catalog drift
> (`0bc79f5`). The correction landed as PR #296 (squash `b1611b9`). PROVEN is
> restored only because **two new fresh-context independent convergence audits
> at `0bc79f5` both reported "NO CRITICAL/HIGH FINDINGS — READY FOR PROVEN"**,
> the full prescribed gates passed, and exact-SHA CI run `34755822334` was
> green. No history or evidence is deleted: the reopen (`2a909d4`) and every
> prior flip remain in history.
>
> Earlier correction history is preserved: the original PROVEN flip
> `e5fcc06` (PR #292) was revoked after the audit found 3 CRITICAL + 10 HIGH;
> PR #294 (squash `e782ce7`) closed them and PR #295 (squash `8f7b5d9`)
> restored PROVEN. Phase 10 tasks `T040`–`T052` remain checked as landed
> evidence and are not rewritten.
>
> Accepted residual MEDIUMs (recorded in `DECISIONS.md` D013/D014/D015 and
> `emergency-correction.md`): `clearContainment` step-up/actor/reason +
> ActionGate, SQL/Drizzle parity for defaults/constraints/indexes/triggers,
> AC-150/151/153 fixture-echo positives, the evidence trust boundary
> (caller-supplied statistical verdicts), module binding for evaluation rows,
> the declarative-only release-gate live-path boundary rule, the raw-writer
> PROVEN-insert trust boundary, and an explicit
> `evaluateConformance({milestone:'G0'|'G1'})` override selecting a non-PROD
> group. Two-way telemetry parity was closed by T064.

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
though they sit outside the listed writeScopes. The third-round correction
(Phase 11) additionally extends
`scripts/verify-release-conformance/cli.mjs` and
`scripts/verify-release-conformance/prod-conformance-gate.ts` (the
deterministic release-gate bridge and CLI, product-owned by T043) so a
non-canonical repository milestone cannot silently skip the PROD block; both
paths are named exactly and carry no product-source behavior change beyond
the milestone validation. The fifth-round correction (Phase 13, R11)
additionally extends `packages/security/src/mcp-protocol-guard.ts` (the
FR-PROD-003 MCP revision allow-list enforcement point, product-owned by
T074) exactly once, replacing a shadowable `Array.prototype.includes`
membership test with a numeric walk; the change is behavior-preserving on
unshadowed input and is the authoritative fix for the arbitrary-revision
ALLOW, so it is recorded here rather than re-homed.

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

## Phase 10 — Emergency correction (reopened proof)

Each task below closes one audited defect and lands a direct negative
regression (exploit) test; `specs/g2-production-readiness/emergency-correction.md`
carries the finding-to-task map and the verbatim reproductions.

- [x] T040 [serial-reason: SHARED_FILE] Persist and bind the activation kind:
      `activation_kind` on `prod.activation_gate_evaluations` and
      `prod.module_states`, `NOT_APPLICABLE` (not `PASS`) for gates outside
      the requested kind's required set, kind-filtered
      `requirePersistedActivationEvidence`, the SQL trigger's per-kind
      required-gate set, and a branded-kind cross-check in `advanceState`.
      Negative: record OPERATIONAL, then attempt OPPORTUNITY/WORKSPACE/PUBLIC
      ACTIVE — must refuse. Closes C1, H5. Traces: FR-PROD-001, FR-PROD-002,
      AC-152, AC-154.
- [x] T041 [serial-reason: ORDERED_MIGRATION] SQL fail-closed on the empty
      activation-event reference: `length(activation_event_ref) > 0` CHECK on
      `prod.module_states` and removal of the `''` early return in the
      evidence trigger. Negative: raw ACTIVE INSERT with `''` and zero
      evaluation rows must refuse. Closes C2. Traces: FR-PROD-001,
      FR-PROD-002, AC-152.
- [x] T042 [serial-reason: SHARED_FILE] Resolve MCP opt-ins only through the
      registered compatibility matrix: each `optInRevisions` entry must be
      registered, `DRAFT`, and mutually tested, else refuse. Negative:
      unregistered `2099-01-01-evil` opt-in must refuse. Closes C3. Traces:
      FR-PROD-003, AC-144.
- [x] T043 Wire the five PROD conformance rules into the authoritative
      release gate through a repo-backed bridge and make
      `evaluateProdConformance` fail closed on omitted input, empty required
      gate sets, and unknown readiness strings; negative: `{}`,
      `requiredGateKinds: []`, and unrecognized readiness all FAIL. Closes
      H1, H2. Traces: FR-PROD-001, FR-PROD-002, FR-PROD-004, AC-272.
- [x] T044 [serial-reason: SHARED_INVARIANT] Give an upgraded database a
      valid additive migration path without weakening the out-of-order
      invariant: scope the refusal to an already-applied family and prove a
      pre-prod-main database (all `g0_*`/`g1_*`/`g2_wf_*` applied, no
      `g2_prod_*`) converges to the same schema fingerprint as a fresh apply.
      Closes H3. Traces: FR-PROD-001…006.
- [x] T045 Resolve every `IMPORT_SHADOW_ONLY` boundary assertion through the
      real `ImportGate` and require `VALIDATING`/`SHADOW_ELIGIBLE`; negative:
      a live path referencing a `RECEIVED`/`REJECTED` artifact must refuse.
      Closes H4. Traces: FR-PROD-006, AC-275.
- [x] T046 Persist every activation-gate evaluation, PASS and REFUSE, with a
      batch identity so a newer refusal invalidates older PASS evidence.
      Negative: PASS then REFUSE for the same event refuses ACTIVE. Closes
      H6. Traces: FR-PROD-002, AC-154.
- [x] T047 Require a genuinely previously `ACTIVE`/authorized row with a
      matching non-null activation event for rollback and repair the hollow
      AC-279 path; negative: fabricated prior event and IMPLEMENTED/NULL-event
      rows must refuse. Closes H7. Traces: FR-PROD-006, AC-279.
- [x] T048 Require ≥1 critical dependency and a passing capacity contract
      before `SLA_BACKED`; negative: empty critical register cannot declare
      `SLA_BACKED`. Closes H8. Traces: FR-PROD-004.
- [x] T049 Derive dependency-group `dependsOn` from the manifest-backed order
      view and refuse caller disagreement; negative: `dependsOn: []` cannot
      mark G7 COMPLETE while G0…G6 are OPEN. Closes H9. Traces: FR-PROD-005.
- [x] T050 MCP conformance provenance/staleness: require the newest in-window
      run whose `fixture_ref` equals the cell's, clamp the caller staleness
      override, and bind the precomputed-alpha request to the expected
      `artifactSetHash`. Closes H10. Traces: FR-PROD-003, FR-PROD-006.
- [x] T051 [serial-reason: SHARED_INVARIANT] Correct the cheap MEDIUM defects
      the correction touches: Zod parity for the new/0005 columns,
      `scope_hash` immutability and open-containment enforcement in SQL, and
      drop `SHADOW` from `ESTABLISHES_AVAILABLE`. Traces: FR-PROD-001,
      FR-PROD-002.
- [x] T052 [serial-reason: COORDINATOR_BOUNDARY] Fresh-context adversarial
      re-review of the correction diff, exploit-suite replay, full prescribed
      gates and exact-SHA CI; restore PROVEN only when the new convergence
      audit reports no CRITICAL/HIGH finding. Traces: FR-PROD-001…006.

## Phase 11 — Third-round emergency correction (reopened proof)

Each task closes one independently reproduced HIGH/MEDIUM defect and lands a
direct negative regression (exploit) test that fails against the pre-correction
revision. `specs/g2-production-readiness/emergency-correction.md` carries the
third-round finding-to-task map and the verbatim reproductions.

- [x] T053 [serial-reason: SHARED_FILE] Deep-freeze every
      `GateConditionEvaluation` element (and the condition it spreads) so a
      caller cannot mutate a recorded pass's nested evaluation and defeat the
      `advanceState` persisted-dimension cross-check, and derive the
      IMPLEMENTED/AVAILABLE/PROVEN claim check from the **persisted** evidence
      rows returned by `requirePersistedActivationEvidence` rather than the
      in-memory `gateResult.evaluations`. Negative: mutate
      `bound.evaluations[AVAILABLE_EVIDENCE].verdict` to `NOT_APPLICABLE`, then
      cross into ACTIVE — must refuse. Closes the H5 binding bypass. Traces:
      FR-PROD-001, FR-PROD-002, AC-152.
- [x] T054 [serial-reason: SHARED_FILE] Align the TypeScript persisted-evidence
      guard with the SQL trigger: `requirePersistedActivationEvidence` must
      refuse when **any** persisted row for the exact scope/kind/event is a
      `REFUSE`, not only when the newest `evaluated_at` batch refuses, so a
      backdated refusal cannot be ignored. Negative: record PASS then a
      backdated REFUSE for the same event — the exported guard must refuse.
      Traces: FR-PROD-002, AC-154.
- [x] T055 Fail the `ACTIVATION_WITHOUT_EVIDENCE` conformance rule closed on an
      ACTIVE claim whose `activationEventRef` is omitted, empty, non-string, or
      whitespace, whose `requiresProven` is not a boolean, or whose
      `lifecycleState` is not a known governed position. Negative: the omitted
      and empty-string exploits (and an unknown lifecycle position) must
      produce findings and `overall === 'FAILED'`. Closes the H2 residual.
      Traces: FR-PROD-001, FR-PROD-002, AC-152.
- [x] T056 Fail the PUBLIC/WORKSPACE authorization rule closed on malformed
      evidence shape: `scopeRefs` must be an array of release refs (never a
      substring-matched string), `requiredGateKinds`/`gateEvidence` must be
      arrays, and a malformed shape is a finding. Negative: a foreign release
      named only inside a `scopeRefs` string must NOT authorize. Closes the H2
      residual. Traces: FR-PROD-002, FR-PROD-004, AC-272, AC-273.
- [x] T057 [serial-reason: SHARED_FILE] Make the active-milestone resolution in
      `evaluateConformance` reject a non-canonical / out-of-range id exactly as
      the explicit override does (`G0`…`G7`), so a malformed
      `current-milestone.json` cannot silently skip the PROD block. Traces:
      FR-PROD-001…006.
- [x] T058 [executor: TEST] Repair the hollow AC-279 acceptance path: drive a
      genuine A→B→A restore (current set B, prior approved set A under the exact
      event) instead of the no-op same-set restore, and keep the fabricated
      prior-event / never-approved-set negatives. Closes the H7 test residual.
      Traces: FR-PROD-006, AC-279.
- [x] T059 [serial-reason: SHARED_INVARIANT] Restore the cross-generation
      out-of-order invariant in the migrator: key the applied-family high-water
      on the `_<family>_` token (not `g<generation>_<family>`) so a
      later-generation latecomer (`g1_data_0009` after an applied
      `g2_data_0001`) is refused as a same-family gap, while a wholly-new family
      (`prod` after `wf`) still applies additively. Negative: the cross-generation
      latecomer must refuse and must not create its table. Traces: FR-PROD-001…006.
- [x] T062 [serial-reason: SHARED_FILE] In-process hardening of the PROD
      rules against caller-owned array method shadowing (`filter`/`some`/
      `includes`/`entries`/`Symbol.iterator`), a boxed/coercible explicit
      milestone (`new String('G2')`), and a degenerate `releaseRef`: every
      decision loop reads numeric indices and object properties directly, the
      explicit milestone requires `typeof === 'string'`, and `releaseRef` must
      be a non-empty string. Negative: shadowed `filter`/`includes`, a boxed
      milestone, and an empty `releaseRef` must all refuse. Traces:
      FR-PROD-001, FR-PROD-002.
- [x] T063 [serial-reason: ORDERED_MIGRATION] Fix the §69.9 distribution gate
      set in the evidence trigger: `g2_prod_0006` wrote
      `required_gates || 'DISTRIBUTION_EVIDENCE'`, which PostgreSQL resolves as
      `anyarray || anyarray` and aborts every WORKSPACE/PUBLIC ACTIVE insert
      with `malformed array literal`. `g2_prod_0006` is already applied, so the
      corrected function body lands as a new later-sorting
      `g2_prod_0009_fix_distribution_gate_set.sql` using `array_append`.
      Positive regression: a genuine WORKSPACE and PUBLIC activation now
      persists ACTIVE (previously untested). Closes the open convergence HIGH.
      Traces: FR-PROD-002, AC-272, AC-273.
- [x] T064 [serial-reason: SHARED_FILE] Restore telemetry parity: the C1
      correction added `scopeHash`/`activationKind`/`activationEventRef` to the
      prod row schemas, but `telemetry/prod.catalog.json` was never updated and
      the parity suite only checked catalog ⊆ schema. Add the missing fields and
      make the prod parity assertion two-way (set equality), so a future schema
      field cannot be silently absent from the CRITICAL_METADATA catalog.
      Traces: FR-PROD-001, FR-PROD-002.
- [x] T060 [serial-reason: COORDINATOR_BOUNDARY] Fresh-context adversarial
      re-review of the third-round diff, direct exploit replay (nested
      mutation, omitted/empty activation event, substring scopeRefs,
      backdated refusal, cross-generation gap, distribution activation),
      full prescribed gates and exact-SHA CI. Traces: FR-PROD-001…006.
- [x] T061 [serial-reason: COORDINATOR_BOUNDARY] New independent convergence
      audit at the pre-merge head; restore PROVEN only when it reports no
      CRITICAL/HIGH finding and the tracked residual MEDIUMs are recorded.
      Traces: FR-PROD-001…006.

## Phase 12 — Fourth-round correction (R4–R9; reopen `97b244a`)

- [x] T065 [serial-reason: SEMANTIC_DEPENDENCY] Close R4 (audit H2): stop trusting
      the caller's `requiredGateKinds`. Validate every declared kind against the
      authoritative closed `GATE_KINDS` vocabulary, require the declaration to
      cover the complete mandatory distribution gate set, and evaluate evidence
      against that authoritative set. Add the exploit regression: a
      `PUBLIC_AUTHORIZED` claim declaring only `['DISTRIBUTION_EVIDENCE']` (or
      `['TOTALLY_FAKE_GATE']`) with matching in-scope evidence must FAIL.
      Traces: FR-PROD-002, FR-PROD-004, AC-272, AC-273.
- [x] T066 [serial-reason: SHARED_INVARIANT] Close R5 (audit H5): bind the
      `SHADOW → PROVEN` promotion to the exact scope's governed history. Before
      writing a PROVEN row, require the persisted dimensions to have genuinely
      established `AVAILABLE`, and apply the same persisted-evidence dimension
      cross-check used on the ACTIVE edge (excluding the PROVEN claim being
      established). Add the exploit regression: a scope whose history never
      established AVAILABLE must refuse a PROVEN promotion even when a persisted
      OPPORTUNITY batch claims `available:true`/`proven:true`. Traces:
      FR-PROD-001, FR-PROD-002, AC-152.
- [x] T067 [serial-reason: SHARED_INVARIANT] Close R6: fence `rollbackToApproved`
      on an open containment for the exact scope exactly as the ACTIVE edge does,
      so a `DISABLED` containment can never be silently de-escalated to `PAUSED`.
      Add the regression: a rollback attempted while a `DISABLED` containment is
      open must refuse with the containment/higher-severity reason. Traces:
      FR-PROD-006, AC-278, AC-279.
- [x] T068 [serial-reason: SEMANTIC_DEPENDENCY] Close R7: make the release-gate
      live-path rule refuse an `IMPORT_SHADOW_ONLY` assertion that does not carry
      an explicit import-artifact state from the authoritative closed vocabulary
      in `VALIDATING`/`SHADOW_ELIGIBLE`, so a claim naming a
      `RECEIVED`/`REJECTED`/nonexistent artifact fails closed. Add the
      regression. Traces: FR-PROD-004, FR-PROD-005, AC-275, AC-276, AC-277.
- [x] T069 [serial-reason: ORDERED_MIGRATION] Close R8: tighten the
      `g2_prod_0008` `activation_event_ref` nonblank invariant so tabs, newlines,
      form feeds and Unicode blanks are refused, not only ASCII spaces. Land it
      as a new later-sorting migration (`g2_prod_0010`) that replaces the CHECK,
      with a positive regression for space and a negative regression for each
      sampled whitespace class. Traces: FR-PROD-001, AC-152.
- [x] T070 [serial-reason: SEMANTIC_DEPENDENCY] Close R9: persist the _applied_
      containment action on the containment row so `openContainments()` and the
      gate refusal message never understate a `DISABLED` stop. Add the
      regression contrasting `requestedAction` with the persisted action for the
      `CAPACITY`/`PARITY` fallback paths. Traces: FR-PROD-006, AC-278.
- [x] T071 [executor: TEST] Exploit/regression suite for T065–T070 authored as
      NEW discriminating tests that fail against `97b244a` (not re-labelled
      existing assertions), plus the upgrade-path re-run from a database migrated
      to pre-prod `main`. Traces: FR-PROD-001…006, AC-272, AC-273, AC-278, AC-279.
- [x] T072 [serial-reason: COORDINATOR_BOUNDARY] Fresh-context adversarial review
      of the fourth-round diff, full prescribed gates, exact-SHA CI, and a NEW
      independent convergence audit at the pre-merge head before PROVEN is
      restored. Traces: FR-PROD-001…006.

## Phase 13 — Fifth-round emergency correction (R10–R12; reopen `53f737d`)

> A new session ran four fresh-context adversarial verifiers against
> `origin/main` `53f737d`. They re-confirmed the whole earlier chain as closed
> and reproduced three HIGH residuals of the `Array.prototype` shadowing class
> the fourth round claimed to have removed, plus a latent flaky release-gate
> test. State: PROVEN → RUNNING. Admin-control and recovery-continuity promotion
> stays frozen until the correction re-proves.

- [x] T073 [serial-reason: SEMANTIC_DEPENDENCY] Close R10: build the
      `activationGateEvaluationsFor` `WHERE` clause with `numericJoin` (never
      `Array.prototype.join`) and make `requirePersistedActivationEvidence`
      refuse a row whose `scopeHash` differs from the requested scope, so a
      shadowed `join` cannot admit foreign-scope evidence into a PROVEN
      promotion. Add a discriminating `Array.prototype.join` shadow regression.
      Traces: FR-PROD-001, FR-PROD-002, AC-152.
- [x] T074 [serial-reason: SEMANTIC_DEPENDENCY] Close R11: make the MCP
      protocol-revision membership test numeric at both the guard
      (`packages/security/src/mcp-protocol-guard.ts`, recorded write-scope
      exception) and the FR-PROD-003 surface (`resolveProtocolRevision`), so a
      shadowed `Array.prototype.includes` cannot ALLOW an arbitrary revision.
      Add the shadow regression. Traces: FR-PROD-003, AC-144.
- [x] T075 [serial-reason: SEMANTIC_DEPENDENCY] Close R12: build
      `SHADOW_ONLY_IMPORT_ARTIFACT_STATES` with a numeric selection (never
      `Array.prototype.filter`) and freeze it, so a shadow installed before the
      lazily imported `prod-rules.ts` module initializes cannot widen the
      authoritative import-shadow state set. Add the shadow regression that
      would re-open R7/H4. Traces: FR-PROD-004, FR-PROD-005, AC-275, AC-277.
- [x] T076 [executor: TEST] Give the NEW-N2 shadow regression an explicit
      bounded timeout (measured 4983 ms against bun's 5000 ms default), so the
      release gate cannot red non-deterministically under load.
- [x] T077 [executor: TEST] Exploit/regression suite for T073–T075 authored as
      NEW discriminating tests that fail against `53f737d` (each shadow is
      installed surgically and restored in `finally`), plus a re-run of the
      upgrade-path test from a database migrated to pre-prod `main`.
- [x] T078 [serial-reason: COORDINATOR_BOUNDARY] Fresh-context adversarial review
      of the fifth-round diff, full prescribed gates, exact-SHA CI, and a NEW
      independent convergence audit at the pre-merge head before PROVEN is
      restored. Traces: FR-PROD-001…006.
- [x] T079 [serial-reason: SEMANTIC_DEPENDENCY] Close R13: add
      `packages/security/src/shadow-safe.ts` (numeric-index helpers) and convert
      every decision-time authority operation in `packages/security/src/**` off
      shadowable `Array.prototype` methods — the egress SSRF allowlist and
      DNS-rebind pin comparison, the ActionGate step-up/scope checks, OAuth
      redirect-URI and scope-widening checks, MCP credential IP/scope checks,
      webhook endpoint allowlist, untrusted-content host allowlists, secret
      export-prohibition, MCP origin scheme/host matching, import format and
      state-transition checks, the prohibited-capability detector, and claim
      redaction — with discriminating shadow regressions; and close the
      schema-library-internals residual by routing every security decision
      return through `parseDecision`, so a shadowed `push`/`Symbol.iterator` that
      makes zod's `.parse` return `{}` cannot authorize. Exact paths are
      recorded in `packages/security/**`, outside this package's writeScopes, so
      this is a named scope exception (product-owned by T079).
      Traces: FR-SEC-001, FR-PROD-003, FR-PROD-005, AC-251.
- [x] T080 [executor: TEST] Exploit/regression suite for T073–T079 authored as
      NEW discriminating tests that fail against `53f737d` (each shadow
      installed surgically and restored in `finally`), plus the R10b isolated
      scope-binding regression proving the defence-in-depth check independently.
- [x] T081 [serial-reason: COORDINATOR_BOUNDARY] Fresh-context adversarial review
      of the R13 security diff, full prescribed gates, exact-SHA CI, and a NEW
      independent convergence audit at the pre-merge head before PROVEN is
      restored. Traces: FR-PROD-001…006, FR-SEC-001.

## Phase 14 — Sixth-round independent verification and bounded hardening (reopen `29f1841`)

Reopen: `29f1841` (PR #301 fifth-round PROVEN) → RUNNING, schema-legal, history
preserved. Three fresh-context adversarial verifiers plus the coordinator's own
directed gates against `29f1841` re-confirmed every C1–C3/H1–H10/R10–R13 finding
as NOT-REPRODUCED and surfaced three bounded defects (V6-1/V6-2/V6-3). No
CRITICAL/HIGH remained open.

- [x] T082 [serial-reason: SEMANTIC_DEPENDENCY] V6-1: make `cellUsability`
      fail closed on a FUTURE-dated conformance run and on a malformed `now`
      (the future run satisfied provenance; a malformed instant escaped as a
      domain throw and now returns a typed `CELL_NOT_USABLE`). Traces:
      FR-PROD-005, AC-144.
- [x] T083 [serial-reason: SEMANTIC_DEPENDENCY] V6-2: require a non-blank
      declared `conformanceFixtureRef` and a non-blank run `fixtureRef` so
      `'' === ''` cannot satisfy H10 provenance; refuse non-string/trim-blank
      fixture refs at both write sites before any query. Traces: FR-PROD-005,
      AC-144.
- [x] T084 [serial-reason: SEMANTIC_DEPENDENCY] V6-3: require
      `weakenedDimensions`/`protectedDimensions` to be arrays in
      `checkProdConformanceInputsPresent`, so a `{length:0}` object cannot drive
      a PASSED posture report. Traces: FR-PROD-004, AC-153.
- [x] T085 [executor: TEST] Discriminating regressions for T082–T084 that FAIL
      against `29f1841` and PASS at the fix head (future-dated run, malformed
      `now`, blank fixture provenance read + both write sites, non-array posture
      dimensions), plus no-over-refusal controls that pass at both revisions.
      Strengthened in `cdc25b2` after the first convergence review found the
      initial V6-3 fixtures non-discriminating and the write-site test
      FK-confounded; re-verified in a temporary base worktree at `29f1841`
      (4 MCP failures + 1 V6-3 failure) and at the fix head (0 failures).
- [x] T086 [serial-reason: COORDINATOR_BOUNDARY] Fresh-context convergence
      review of the sixth-round fix head, full prescribed gates, exact-SHA CI,
      and a NEW independent audit before PROVEN is restored. Two reviews
      returned `READY FOR PROVEN — no CRITICAL/HIGH` (the second covering the
      `cdc25b2` test hardening); `pnpm verify` green at `5e6c6cd`; exact-SHA CI
      `34805726567` (`5e6c6cd`) and `34808344651` (`cdc25b2`) green. Traces:
      FR-PROD-001…006.
- [ ] T087 [deferred: BOUNDED_SLICE] Register statistical evidence keyed by
      `(scope_hash, evidence_ref)` with dataset/holdout provenance and require
      the persisted evaluation batch to resolve each row to a registered,
      unexposed slice (re-confirmed MEDIUM trust boundary; owner is the G1
      evaluation registry). Traces: FR-PROD-001, FR-PROD-002, PRD §35.
- [ ] T088 [deferred: BOUNDED_SLICE] Add an exact-key CHECK on
      `prod.module_states.scope` (or make `foresift_prod_scope_hash` refuse
      extra keys) so the scope hash is injective over the canonical seven keys.
      Traces: FR-PROD-001, AC-152.
