# Implementation Plan: g2-production-readiness

**Package**: `g2-production-readiness` | **Date**: 2026-09-13 | **Spec**: `specs/g2-production-readiness/spec.md` (scoped derivative of PRD §38.19/§40/§69 in full, §9.5, §17/§18, §31/§33, §36–§40, §64.12 + manifest FR-PROD-001…006)
**Authority**: PRD wins over every word below; material decisions are recorded as proposed ADR texts in this file.

## Summary

Deliver production-readiness governance as ONE new governed-state package
(`packages/capability-registry`) plus additive extensions to the
already-landed `packages/release-conformance` (G1), consuming — never
rewriting — `packages/capacity-planner` (capacity contracts, degrade
order), `packages/requirement-manifest` (manifest + dependency-group DAG),
`packages/security` (`ImportGate`, quarantine state machine,
`McpProtocolGuard`, `ActionGate`), and `packages/workflow-runtime` /
`packages/alerts` (engine commit boundary, alert classes):

1. **Independent module-state lattice + activation gate (FR-PROD-001,
   FR-PROD-002, AC-152).** The nine governed states `IMPLEMENTED`,
   `AVAILABLE`, `SHADOW`, `PROVEN`, `ACTIVE`, `DEGRADED`, `PAUSED`,
   `RETIRED`, `DISABLED` (seeded from PRD §69.2 `NOT_IMPLEMENTED`) are
   independent, scope-exact, append-only module/artifact states. An
   explicit, total, fail-closed activation gate decides advancement:
   `ACTIVE` requires `AVAILABLE` and — when the scope specifies it —
   `PROVEN`; `IMPLEMENTED` alone can never support an alert claim. The
   complete codebase deploys while insufficient modules remain
   `DISABLED`/partial/`SHADOW`-only, because deployment is not activation.
2. **Dependency groups as build/test ordering (FR-PROD-003).** The G0…G7
   groups are implementation/migration/fixture/build/test ordering over
   the authoritative manifest DAG (§40), not a throwaway MVP feature
   sequence. Group completion means production-ready code, never automatic
   opportunity activation; the capability registry records group status and
   re-uses `release-conformance`'s `DEPENDENCY_GATE_NOT_OPEN` premature
   rule rather than re-deriving requirement mapping.
3. **Declared best-effort free-tier operation (FR-PROD-004, AC-153).**
   Deployment posture is `SLA_BACKED` only when every critical external
   dependency carries an applicable, unexpired SLA; otherwise it is
   `FREE_TIER_BEST_EFFORT` with an explicit degraded scope. Best-effort may
   relax freshness, breadth, and alert availability only; it can never
   weaken identity, point-in-time semantics, audit, duplicate prevention,
   security, execution semantics, capacity enforcement, critical risk
   monitoring, or claim boundaries (§69.6, §34.3).
4. **MCP protocol-revision/target-client compatibility matrix (FR-PROD-005,
   AC-144).** A data-backed matrix of protocol revision × SDK/package
   version × transport × Origin policy × target client × auth mode ×
   conformance fixture × live-test date × result; the server defaults to
   the latest mutually tested stable revision (baseline `2025-11-25`), and
   draft/RC revisions remain explicit opt-in (§17.1, §69.7).
5. **Bounded precomputed alpha matching + isolated import boundary
   (FR-PROD-006).** Production live paths may read only versioned,
   bounded precomputed lookups with declared latency/capacity budgets;
   heavy Alpha Lab jobs and artifact imports execute in the isolated
   export/import trust boundary, enter `VALIDATING`/`SHADOW` through
   `sec.import_artifacts`, and can never activate policy directly (§10.3,
   §33.7, §35.14).
6. **Containment, rollback, and governance gates (AC-272…279).** A failed
   critical gate pauses the smallest affected scope, records the reason,
   and never auto-reactivates; rollback restores a previously approved
   immutable configuration/artifact set, creates a new activation event,
   preserves history, and re-evaluates actionable candidates before alerts
   resume (§69.9–§69.12).

Existing packages keep their ownership: `packages/release-conformance`
already computes the mapping-completeness, active-path, premature-
implementation, and generated-doc-drift rules and this package extends its
rule set (no rewrite); `packages/capacity-planner` owns capacity contracts
and degrade ordering and is consumed as the capacity gate input;
`packages/requirement-manifest` owns requirement→group mapping and DAG
acyclicity; `packages/security` owns import quarantine, MCP protocol
guarding, and high-impact action gating.

Strictly read-only (INV-001): no trading, custody, wallet-signing,
private-key, or transaction-submission capability anywhere in the package,
migrations, gate, matrix, or tests.

## Technical Context

- **Language/runtime**: TypeScript (ESM, strict, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`) in the existing pnpm workspace; Bun Test is
  the repository test authority. New package `packages/capability-registry`
  (`@foresift/capability-registry`) follows the G0/G1/G2 scaffold pattern:
  workspace `*` dependencies on `@foresift/domain`,
  `@foresift/shared-schemas`, `@foresift/persistence`,
  `@foresift/release-conformance`, `@foresift/capacity-planner`, and
  `@foresift/requirement-manifest`; `bun test` script; tsconfig extending
  `tsconfig.base.json`; no per-package runner config.
- **Storage**: PostgreSQL via `@foresift/persistence` (`DatabaseEngine`
  seam); tests run on PGlite per ADR-0014. Migrations are the SQL source of
  truth in a dedicated `prod` schema (mirroring the landed `wf`/`alert`
  precedents and keeping the AC-261 `public`-schema absence probe green).
  New migration family `prod` — `g2_prod_*.sql`, additive only; the
  fail-closed family list in `packages/persistence/src/migrator.ts` is
  extended with `prod` and the central expected-script registry
  (`packages/persistence/test/migrator.spec.ts`) is extended in the same
  package (plan-sanctioned scope exception, milestone plan-level
  decision 1 / ADR-0019·ADR-0022 duty). The hand-maintained ADR-001
  Drizzle mirror (`packages/persistence/src/generated/schema.ts`) catches
  up to SQL truth in the same package — the schema-parity gate enumerates
  tables and fails on any gap.
- **Validation**: Zod schemas authoritative in `packages/shared-schemas`
  (ADR-0013). Closed vocabularies (module lifecycle state, operational and
  distribution readiness, deployment posture, activation gate kind, change
  classification, containment action, MCP revision channel, precomputed
  bound units) live in `packages/domain` and are imported, never restated,
  by `packages/shared-schemas` (milestone plan-level decision 3). Every
  envelope object is `.strict()`.
- **Gate evidence seam**: activation, promotion, rollback, and
  public/workspace authorization consume
  `@foresift/release-conformance`'s `evaluateGateEvidence` /
  `computeGateEvidenceSignature` (immutable, hash- and signature-verified
  evidence). The capability registry never re-implements evidence
  signing/verification or requirement mapping.
- **Capacity seam**: the activation gate consumes
  `@foresift/capacity-planner` contracts and degrade order as data
  (`SustainableCapacityContract` via `@foresift/domain`) — it enforces the
  contract, and the best-effort declaration can never bypass it (§69.6).
- **Trust-boundary seam**: `packages/security`'s `ImportGate` and the
  `sec.import_artifacts` state machine own import intake and quarantine;
  the capability registry records boundary assertions referencing the
  quarantine artifact id and refuses any live path that reaches a heavy
  job or an import.
- **Test runtime**: PGlite-backed suites only; the full Bun suite runs
  exclusively through the coordinator (`pnpm test:all` or per-workload
  scripts) per the test-runtime contract — never a bare full-tree run.

## Constitution check

- **I (contract authority)**: every task traces to FR-PROD-001…006 or one
  of the 14 attached ACs; `docs/spec/**` untouched; spec.md keeps seeded
  normative quotes intact.
- **III (simplicity / modular monolith)**: one governed-state package plus
  additive release-conformance rules, vocabularies, schemas, migrations,
  and telemetry — no new services, no second control plane, no
  orchestration framework; existing owners are consumed as interfaces.
- **IV (read-only)**: no execution/custody/signing surface; negative
  suites assert its absence and no `prod` table models an order, transfer,
  or signature.
- **V/VI (time correctness)**: activation, containment, rollback, and
  matrix live-test dates are event-time records; state transitions are
  append-only and never backdated; precomputed lookups carry freshness and
  expiry.
- **VII (provenance)**: every module state carries its exact scope hash,
  evidence refs, artifact-set hash, and supersession link; matrix rows
  carry fixture and live-test provenance; rollback creates a new activation
  event rather than editing history.
- **VIII (fail-closed)**: a missing, stale, mismatched-scope, or
  unverifiable gate input refuses advancement with a typed error; unknown
  states/revisions/bound units refuse.
- **IX (abstraction)**: MCP guard, import gate, capacity planner, and gate
  evidence are consumed as ports/pure functions, never vendor SDKs or
  duplicate logic.
- **X (traceability)**: release-conformance rule findings name requirement
  and path; every module state links its requirement set.
- **XI/XII (deterministic + failure-path)**: every authored AC gets both
  positive and negative suites; refusals, containment, no-auto-reactivation,
  and rollback are deterministic.
- **XIII/XIV (replay, durability)**: state, transitions, gate evaluations,
  containment, and activation events are persisted and replayable; planning
  state itself lives on disk/git.
- **XV (least privilege)**: no credentials or provider secrets; import
  boundary keeps producer keys, signing keys, and provider secrets outside
  live paths.

## Project structure (files inside writeScopes)

```text
packages/domain/src/prod.ts              # governed-state vocabularies + pure laws (NEW)
packages/domain/src/index.ts             # barrel export (EXTEND)
packages/shared-schemas/src/prod.ts      # Zod mirrors + row/gate envelopes (NEW)
packages/shared-schemas/src/index.ts     # barrel export (EXTEND)
packages/capability-registry/            # governed-state package (NEW)
  src/module-states.ts                   # nine-state lattice, scope-exact append-only registry
  src/activation-gate.ts                 # total ordered fail-closed activation gate
  src/dependency-groups.ts               # build/test ordering view over the manifest DAG
  src/deployment-posture.ts              # SLA-backed vs best-effort declaration + protected dimensions
  src/mcp-compat.ts                      # protocol-revision × target-client matrix + conformance gate
  src/precomputed-alpha.ts               # bounded live-path precomputed matching contract
  src/trust-boundary.ts                  # export/import confinement assertions (consumes security ImportGate)
  src/containment.ts                     # smallest-scope pause/disable + rollback + new activation event
  src/index.ts
packages/release-conformance/src/prod-rules.ts # PROD-facing conformance rules (NEW)
packages/release-conformance/src/index.ts      # barrel export (EXTEND)
migrations/g2_prod_0001_module_registry.sql    # prod schema: states, transitions, gate evaluations
migrations/g2_prod_0002_dependency_posture.sql # groups, critical dependencies, SLA register, posture
migrations/g2_prod_0003_mcp_compat.sql         # revisions, target clients, compatibility matrix, runs
migrations/g2_prod_0004_alpha_boundary.sql     # precomputed bounds, live reads, boundary assertions
telemetry/prod.catalog.json                    # declarative event + metric catalog (NEW)
tests/fixtures/prod/                           # state/gate/posture/matrix/boundary fixtures (NEW)
tests/acceptance/AC-144, AC-150…154, AC-272…279 # prod-scoped extends (EXTEND)
tests/negative/AC-144, AC-150…154, AC-272…279   # prod-scoped extends (EXTEND)
```

Plan-sanctioned scope exceptions (exact paths only, named so the
task-graph builder records them): `packages/persistence/src/migrator.ts`
(family-list extension with `prod`), `packages/persistence/src/generated/
schema.ts` (ADR-001 mirror catch-up), `packages/persistence/test/
migrator.spec.ts` (central expected-script registry),
`tests/telemetry-catalog.spec.ts` (central telemetry parity suite), and
`docs/generated/prod-surfaces.json` (milestone plan-level decision 2:
`docs/generated/**` is deliberately excluded from writeScopes, so
implementation-mapping reconciliation for the PROD surfaces is done here
by the `release-conformance` owner so the generated-docs drift rule
passes).

Fixture-path note: the manifest `fixtureRefs` say `tests/fixtures/prod/`
and the milestone grants `tests/fixtures/prod/**`; they agree, and all
fixtures are written under that single path.

The 14 assigned ACs (AC-144, AC-150…154, AC-272…279) are *shared*: every
one is also attached to another family's requirements, and each base
`tests/acceptance` / `tests/negative` file already exists on `main` with
that family's assertions. This package authors the **prod-scoped
additions** into those exact files (writeScoped `tests/acceptance/**` and
`tests/negative/**`), preserving the landed base assertions; it never
re-homes or rewrites another family's suite.

## Architecture decisions

**D1. Module state is an independent, scope-exact lattice, and deployment
is not activation.** `IMPLEMENTED`, `AVAILABLE`, and `PROVEN` are
independent states (FR-PROD-001); a module may be `IMPLEMENTED` and even
deployed while `DISABLED`, `SHADOW`-only, or partial (FR-PROD-002). Each
state row is keyed by the exact scope from §69.5 — profile version,
policy/ranking version, regime scope, execution scenario and delay policy,
population claim, and artifact set hash — so advancement in one scope
never implies another. Rows are append-only; a change is a new row with a
`superseded_by` link (ADR-0019 immutability duty), and `module-states.ts`
refuses in-place mutation.

**D2. The activation gate is total, ordered, fail-closed, and
scope-matching.** `activation-gate.ts` evaluates named gates in order and
returns `PASS` or a typed refusal naming the failing gate: `IMPLEMENTED`
present; `AVAILABLE` present (data, rights, capability, source coverage,
pool adapter, cost, capacity, freshness); `PROVEN` present when the scope
specifies it (AC-152); exact-scope match of registered statistical
evidence including the §31/§39 negative controls and clustered-interval
method (AC-150, AC-151); calibration maturity before any expected-net-
utility ranking influence (AC-154); verified gate evidence via
`evaluateGateEvidence`; passing capacity contract from
`@foresift/capacity-planner`; current rights/claims/isolation evidence for
workspace/public distribution (AC-272, AC-273, AC-275, AC-276, AC-277);
no open containment. Any unavailable required input fails closed; the gate
consumes foreign results and never recomputes statistics, capacity,
security, or rights logic.

**D3. Dependency groups are build/test ordering, not a reduced MVP.**
`dependency-groups.ts` exposes the authoritative G0…G7 DAG and status from
`@foresift/requirement-manifest` (acyclicity enforced by
`checkDependencyDagAcyclicity`) plus the §40 activation rule: group
completion means code, migrations, tests, observability, diagnostics,
runbooks, conformance, and recovery are production-ready; it does not
activate opportunity alerts. The `release-conformance`
`DEPENDENCY_GATE_NOT_OPEN` premature rule stays the enforcement point, now
also consuming `prod.dependency_groups` and module states. No feature is
deferred behind a throwaway MVP architecture (§40: "one production
product").

**D4. Deployment posture is declared, and best-effort is bounded by
protected dimensions.** `deployment-posture.ts` computes `SLA_BACKED` only
when every entry in the critical-external-dependency register carries an
applicable, unexpired SLA; otherwise it declares
`FREE_TIER_BEST_EFFORT` with an explicit degraded scope and reason. A
declaration that lists any protected dimension — identity, point-in-time,
audit, duplicate prevention, security, execution semantics, capacity
enforcement, critical risk monitoring, claim boundaries — as weakened is
refused; a capacity/quota failure degrades research
breadth/depth/opportunity availability only and never authorizes paid
fallback or stale overclaim (§69.6, §34.3, AC-153).

**D5. The MCP compatibility matrix is data with a conformance gate, and
stable is the default.** `mcp-compat.ts` resolves the active revision from
`prod.mcp_revisions`/`prod.mcp_target_clients`/`prod.mcp_compatibility_matrix`:
the default is the latest mutually tested stable revision (baseline
`2025-11-25`), a revision×client cell is usable only with a passing
conformance run, draft/RC revisions are explicit opt-in, and an unknown or
unsupported revision follows the declared compatibility policy rather than
an accidental allow. It consumes the existing `McpProtocolGuard`
allow-list instead of reimplementing transport validation (§17.1, §69.7).

**D6. Live alpha matching is bounded and precomputed; heavy work and
imports stay behind the isolated trust boundary.**
`precomputed-alpha.ts` serves live paths only through versioned lookups
with declared candidate/row/edge/latency/cost bounds and freshness; an
unbounded or expired request is refused, not truncated into a different
claim. `trust-boundary.ts` asserts that heavy Alpha Lab mining,
cross-fitting, replay, and adversarial sweeps never run on a live path,
that imports flow only through `sec.import_artifacts` (`ImportGate`), that
imports land in `VALIDATING`/`SHADOW` and never `ACTIVE`, and that no
live-path request carries provider/import/decryption access (§10.3,
§33.7, §35.14, AC-279).

**D7. Containment is smallest-scope, reason-recording, and
non-auto-reactivatable; rollback is additive.** `containment.ts` maps a
failed critical gate (security, parity, leakage, rights, capacity,
recovery, calibration, adversarial, claims) to `DEGRADED`, `PAUSED`, or
`DISABLED` on the smallest affected scope, records the reason, and refuses
any automatic reactivation — only an explicit revalidation/approval
advances it (AC-278). Rollback restores a previously approved immutable
configuration/artifact set, creates a **new** activation event, preserves
all historical decisions, and requires currently actionable candidates to
be re-evaluated before alerts resume (AC-279).

**D8. Release-conformance is extended, not rewritten.** `prod-rules.ts`
adds rules over the existing `CONFORMANCE_RULES` (`NORMATIVE_MAPPING_COMPLETE`,
`ACTIVE_IMPLEMENTATION_PATH_EXISTS`, `DEPENDENCY_GATE_NOT_OPEN`,
`GENERATED_DOCUMENT_DRIFT`): activation-without-evidence,
posture-weakening, MCP-compatibility drift, live-path precomputation
violation, and public-authorization-without-gate-evidence. Existing rule
semantics and consumers are unchanged; the new rules reuse
`resolveMappings`, `implementationPath`, and the existing reporting shape.

**D9. Governed production state lives in a dedicated `prod` schema.**
Mirroring ADR-G2WF-1 and ADR-G2ALERT-1, `prod.*` tables are additive in
their own schema; no unqualified production table is created in `public`
(keeps the AC-261 probe green and gives the admin and recovery packages
stable qualified names). Cross-family evidence tables are referenced by
id, never duplicated.

## Data model (prod schema; additive tables only)

- `prod.module_states` (state_row_id PK, module_id, artifact_set_hash
  `sha256:<hex>`, scope JSONB `{profile_version, policy_version,
  regime_scope, execution_scenario, delay_policy, population_claim}`,
  lifecycle_state CHECK over the nine governed states,
  operational_readiness CHECK `NOT_READY…READY_FOR_ACTIVE_PROFILE`,
  distribution_readiness CHECK `PRIVATE_ONLY…PUBLIC_AUTHORIZED`,
  activation_event_ref, superseded_by, created_at; no UPDATE path for
  scope/state — supersede via new row).
- `prod.state_transitions` (transition_id PK, state_row_id, from_state,
  to_state, change_classification CHECK
  `NON_MATERIAL_COMPATIBLE|MATERIAL_OPERATIONAL|MATERIAL_EVALUATION|
  MATERIAL_SECURITY_OR_RIGHTS`, gate_evaluation_ref, reason, actor_ref,
  created_at; append-only).
- `prod.activation_gate_evaluations` (evaluation_id PK, scope_hash
  `sha256:<hex>`, gate_kind CHECK, verdict CHECK `PASS|REFUSE`, failing_gate
  nullable, evidence_refs JSONB, capacity_contract_ref, evaluated_at,
  expires_at; immutable).
- `prod.containment_events` (containment_id PK, module_id, scope_hash,
  action CHECK `DEGRADED|PAUSED|DISABLED`, trigger_gate_kind, reason,
  auto_reactivation_allowed boolean CHECK = false, cleared_by_event_ref,
  created_at).
- `prod.rollback_events` (rollback_id PK, module_id, restored_artifact_set_hash,
  prior_activation_event_ref, new_activation_event_ref UNIQUE, history_preserved
  boolean CHECK = true, candidate_reevaluation_ref, created_at).
- `prod.dependency_groups` (group_id PK, depends_on JSONB, status,
  manifest_requirement_count, evidence_refs JSONB, updated_at).
- `prod.critical_dependencies` (dependency_id PK, kind CHECK
  `PROVIDER|SCHEDULER|OBJECT_STORE|DATABASE|MCP_CLIENT|OTHER`,
  owner, critical boolean).
- `prod.sla_register` (sla_id PK, dependency_id, applicable boolean,
  sla_ref, verified_at, expires_at).
- `prod.best_effort_declarations` (declaration_id PK, posture CHECK
  `SLA_BACKED|FREE_TIER_BEST_EFFORT`, degraded_scope JSONB,
  missing_sla_refs JSONB, protected_dimensions JSONB, reason, declared_at;
  CHECK that `protected_dimensions` never intersects the weakened set).
- `prod.mcp_revisions` (revision PK, channel CHECK `STABLE|DRAFT`,
  sdk_version, transport, origin_policy_ref, is_default boolean,
  superseded_by, created_at).
- `prod.mcp_target_clients` (client_id PK, client_name, version,
  capabilities JSONB, auth_mode).
- `prod.mcp_compatibility_matrix` (cell_id PK, revision, client_id,
  conformance_fixture_ref, live_test_date, result CHECK `PASS|FAIL`,
  notes; unique `(revision, client_id)`).
- `prod.precomputed_alpha_bounds` (bound_id PK, live_path, artifact_ref,
  artifact_set_hash `sha256:<hex>`, max_candidates, max_rows, max_edges,
  max_latency_ms, max_cost_usd, dataset_cutoff, verified_at, expires_at).
- `prod.live_path_alpha_reads` (read_id PK, live_path, bound_id,
  request_hash `sha256:<hex>`, served boolean, refusal_reason, latency_ms,
  read_at).
- `prod.artifact_boundary_assertions` (assertion_id PK, live_path,
  assertion_kind CHECK `NO_HEAVY_JOB|NO_IMPORT|NO_PROVIDER_CALL|
  IMPORT_SHADOW_ONLY`, import_artifact_ref references `sec.import_artifacts`
  by id, verdict, asserted_at).

## Verification strategy per acceptance criterion

- **AC-144** (MCP compatibility for the configured stable revision and each
  supported target client; draft revisions opt-in): positive — the matrix
  resolves the baseline stable revision `2025-11-25` for every supported
  target client only through passing conformance cells, the default is the
  latest mutually tested stable revision, and a draft revision is usable
  only after explicit opt-in; negative — a draft revision used as the
  default, an untested revision×client cell, or a missing/unsupported
  revision outside the declared policy is refused by the compatibility
  gate. Base MCP transport assertions already on `main` stay green.
- **AC-150** (permutation/feature-time-shift/synthetic-null/delayed-
  provider controls show no unexplained material lift): positive — the
  activation gate consumes the registered control results and advances only
  when all four controls pass for the exact scope; negative — a `PROVEN`
  claim whose registered control shows unexplained lift cannot reach
  `ACTIVE`.
- **AC-151** (cluster/block bootstrap differs appropriately from naive
  intervals on correlated fixtures): positive — the gate requires the
  clustered-interval method for the exact scope and consumes the registered
  comparison; negative — naive independent-token intervals are insufficient
  evidence for `PROVEN`/`ACTIVE` and refuse.
- **AC-152** (a module may deploy `IMPLEMENTED` but cannot support alert
  claims until `AVAILABLE`; promotion additionally requires `PROVEN` when
  specified): positive — an `IMPLEMENTED`-only or `AVAILABLE`-but-unproven
  module deploys and runs shadow/collection without supporting any alert
  claim, and promotion reaches `ACTIVE` only with `AVAILABLE` plus, when
  specified, `PROVEN`; negative — `ACTIVE` from `IMPLEMENTED` alone, a
  claim rendered from a non-`AVAILABLE` module, and a scope-mismatched
  `PROVEN` evidence row are each refused with a typed failing-gate name.
- **AC-153** (best-effort free-tier degradation preserves data integrity,
  audit, duplicate prevention, and critical risk monitoring): positive — a
  deployment missing an SLA on a critical dependency declares
  `FREE_TIER_BEST_EFFORT` with an explicit degraded scope while integrity,
  audit-chain, idempotency/duplicate prevention, capacity enforcement, and
  critical risk monitoring remain asserted; negative — a declaration that
  weakens any protected dimension is refused at schema and gate level, and
  a quota/capacity failure degrades breadth/depth/opportunity availability
  only, never those dimensions.
- **AC-154** (expected-net-utility ranking disabled before mature
  calibration; when enabled it cannot override hard gates and auto-degrades
  on calibration/regime drift): positive — ranking influence stays disabled
  before mature calibration, and once enabled it still loses to every hard
  gate; negative — enabling ranking on immature calibration, or letting it
  override a hard gate, is refused, and calibration/regime drift produces
  `DEGRADED`/`MOVE_TO_SHADOW` rather than continued influence.
- **AC-272** (workspace/public activation blocked until OAuth, tenant
  isolation, rights, redistribution/export, jurisdiction, disclosures,
  privacy, claims, support, and abuse evidence all pass for the exact
  release): positive — `WORKSPACE_AUTHORIZED`/`PUBLIC_AUTHORIZED` require
  all listed evidence for the exact release; negative — technically ready
  but any missing evidence leaves `*_TECHNICALLY_READY` and unauthorized.
- **AC-273** (a rights change immediately blocks newly prohibited cache,
  raw retention, export, redistribution, and model-use paths and identifies
  affected artifacts for quarantine): positive — a rights change transitions
  the affected scopes to `DEGRADED`/`PAUSED` and emits the affected-artifact
  list for quarantine within the same evaluation; negative — a path that
  continues serving a newly prohibited use is refused and contained.
- **AC-274** (high-impact admin actions fail without fresh phishing-
  resistant step-up, exact authorization, CSRF protection, idempotency key,
  reason, and audit; TOTP-only is insufficient): positive — activation,
  promotion, containment-clear, rollback, and import actions pass only
  through the security `ActionGate` with the full evidence set; negative —
  a TOTP-only, stale-step-up, missing-CSRF, missing-idempotency, or
  missing-reason request is refused and audited.
- **AC-275** (cross-tenant row, artifact, cache, queue, session, quota, log,
  metric, signed-URL, and model-context fixtures prove isolation before
  workspace/public readiness): positive — the public/workspace gate requires
  the isolation fixture evidence set for the exact release; negative —
  missing or failing isolation evidence blocks authorization.
- **AC-276** (marketing/UI/API/export text with guaranteed-profit,
  risk-free, universal-recall, calibration-without-calibration, or
  unsupported-performance language fails content-policy validation):
  positive — public-authorization evidence includes the claims review and
  compliant text passes; negative — banned language in UI/API/export text
  fails validation and blocks authorization.
- **AC-277** (public output exposes evidence, timestamps, execution
  assumptions, limitations, and disclaimer but redacts protected detector
  thresholds and sensitive entity details that could enable evasion or
  abuse): positive — the public surface renders required disclosure and
  redaction; negative — an output missing disclosure or leaking a protected
  threshold/entity detail is refused as a gate failure.
- **AC-278** (a failed critical security/parity/leakage/rights/capacity/
  recovery/calibration/adversarial/claims gate pauses only the smallest
  affected scope, records the reason, and does not auto-reactivate):
  positive — each gate failure maps to the smallest scope and a persisted
  reason, and an explicit revalidation is required to advance; negative —
  automatic reactivation, a widened scope, or an unrecorded reason is
  refused.
- **AC-279** (rollback restores a previously approved immutable
  configuration/artifact set, creates a new activation event, preserves all
  historical decisions, and re-evaluates currently actionable candidates
  before resuming alerts): positive — rollback restores the prior approved
  immutable set, appends a new activation event, keeps every historical
  decision resolvable, and blocks alert resumption until candidate
  re-evaluation completes; negative — mutating history in place, reusing an
  activation-event id, or resuming alerts before re-evaluation is refused.
  The import-boundary half of FR-PROD-006 is asserted here too: an imported
  artifact can reach `SHADOW` only.

## Risks and mitigations

- State conflation (deployed = available = proven = active): every
  dimension is a separate persisted column/table, the gate is total and
  typed, and AC-152 exercises the independence mechanically rather than as
  documentation.
- Activation-gate weakening under partial evidence: the gate is fail-closed
  and scope-exact; a mismatched, missing, or expired input refuses with the
  failing gate named, and telemetry records every refusal.
- Best-effort overclaim: the declaration cannot intersect its weakened set
  with protected dimensions (SQL CHECK plus pure law), and AC-153 asserts
  integrity/audit/duplicate-prevention/risk monitoring survive degradation.
- Matrix rot (untested revision or client silently served): the default is
  the latest mutually tested stable revision; a cell without a passing
  conformance run or with a stale live-test date is unusable, and drift is a
  conformance finding.
- Hidden heavy work on live paths: bounded precomputed lookups are
  data-driven with declared ceilings; unbounded requests refuse, and both a
  conformance rule and negative tests fail any live path that reaches a
  heavy job, import, or provider call.
- Scope bleed into recovery/admin logic: this package publishes governed
  state, containment, and rollback primitives; drill measurement and
  post-recovery reconciliation stay with `g2-recovery-continuity`, and
  rendering stays with `g2-admin-control`. Gaps go to
  `out-of-scope-notes.md`.
- Conflicting edits to shared AC files: all 14 suites are extended
  additively; the landed family assertions are preserved, and the package
  runs serialized (`parallelizable: false`) because
  `packages/release-conformance/**` and the AC files are shared with the
  recovery package.

## ADR texts (proposed; accepted under `docs/adr/0026-production-readiness-laws.md`)

**ADR-G2PROD-1 — `prod`-schema table home for governed production state.**
Module states, transitions, activation-gate evaluations, containment,
rollback, dependency-group/SLA/posture declarations, the MCP compatibility
matrix, and precomputed-alpha bounds live in a dedicated `prod` PostgreSQL
schema (not `public`), mirroring the `wf`/`alert` precedents. Rationale:
the landed AC-261 probe asserts absence of unqualified tables on clean
restores, and the admin/recovery packages get stable qualified names.
Future packages MUST NOT create unqualified production tables in `public`.

**ADR-G2PROD-2 — module states are independent and activation is an
explicit fail-closed gate.** `IMPLEMENTED`, `AVAILABLE`, and `PROVEN` are
independent, scope-exact, append-only states; `ACTIVE` additionally
requires the exact-scope activation gate to pass, and no module may
self-promote. Deployment of the complete codebase never activates an
insufficient module. Rationale: formalizes FR-PROD-001/002 and AC-152 and
prevents deployment/data/proof/activation conflation.

**ADR-G2PROD-3 — best-effort is a declared posture with protected
dimensions.** A free-tier deployment is `FREE_TIER_BEST_EFFORT` unless
every critical external dependency has an applicable unexpired SLA; a
best-effort declaration may relax freshness, breadth, and alert
availability only and can never weaken identity, point-in-time, audit,
duplicate prevention, security, execution semantics, capacity enforcement,
critical risk monitoring, or claim boundaries. Rationale: formalizes
FR-PROD-004/§69.6 so capacity pressure cannot be used to weaken safety.

**ADR-G2PROD-4 — the MCP compatibility matrix defaults to the latest
mutually tested stable revision.** Protocol revision, SDK/package version,
transport, Origin policy, target client, auth mode, conformance fixture,
live-test date, and result are data; stable is the default, draft/RC is
explicit opt-in, and an untested cell is unusable. Rationale: FR-PROD-005/
§69.7 keep protocol drift observable and tested rather than implicit.

**ADR-G2PROD-5 — live alpha matching is bounded/precomputed and imports
enter only through the isolated trust boundary.** Live paths may read only
versioned bounded precomputed lookups; heavy Alpha Lab jobs and artifact
imports stay outside live request paths and enter `VALIDATING`/`SHADOW`
through `sec.import_artifacts`, never `ACTIVE`. Rationale: FR-PROD-006/
§33.7/§35.14 prevents latency-sensitive claims from depending on
unbounded or unvalidated computation.

## Verification commands (package scope)

```bash
test -d packages/release-conformance && pnpm --filter @foresift/release-conformance test
test -d packages/capability-registry && pnpm --filter @foresift/capability-registry test
bun test tests/acceptance/AC-144.spec.ts tests/acceptance/AC-152.spec.ts tests/acceptance/AC-153.spec.ts
```

plus `pnpm verify` and `pnpm spec:verify` at the pushed HEAD per the
completion standard (run by the implementation loop, not this plan).
