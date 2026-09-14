# g2-production-readiness — emergency correction ledger

Status: **RUNNING / REOPENED** (2026-09-13). The PROVEN flip `e5fcc06`
(PR #292) is revoked. History is preserved: the flip commit, its evidence and
every prior review remain in the repository; this document records why the
proof was withdrawn and binds each defect to a correction task in `tasks.md`
Phase 10.

Independent adversarial audit: `.deepseek-handoff/ACCELERATOR_PROD_AUDIT.md`
(review section, `origin/main` `e5fcc06` vs the landed package `3a5a6e6`).
Every finding below was re-verified against `main` before being accepted as
a defect; the reproduction column names the exact observable failure.

## CRITICAL

| ID  | Defect (re-verified on `main`)                                                                                                                                                                                                                                                                                                                                                            | Reproduction                                                                                                                                                                                                                                                                                                 | Correction |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| C1  | `evaluateActivationGate` pushes a real-looking `PASS` for every gate not required by the requested activation kind (`activation-gate.ts:754-756`), the persisted rows carry **no** `activation_kind`, and `requirePersistedActivationEvidence` re-derives admissibility from those placeholder rows (`:1113-1131`). `advanceState` never brand-checks the gate object and stores no kind. | An OPERATIONAL evaluation writes `PASS` rows for `STATISTICAL_EVIDENCE_SCOPE`, `NEGATIVE_CONTROLS`, `CLUSTERED_INTERVALS`, `CALIBRATION_MATURITY`, `DISTRIBUTION_EVIDENCE`; an OPPORTUNITY/PUBLIC `advanceState` for the same scope+event therefore finds a "complete all-PASS set" and crosses into ACTIVE. | T040       |
| C2  | `g2_prod_0005`'s trigger returns early when `activation_event_ref = ''` (`0005:96-98`) while `g2_prod_0001` only constrains the column to `IS NOT NULL` (`0001:49,66-68`).                                                                                                                                                                                                                | Raw `INSERT INTO prod.module_states (..., lifecycle_state, activation_event_ref, scope_hash) VALUES (..., 'ACTIVE', '', 'sha256:…')` commits with zero evaluation rows.                                                                                                                                      | T041       |
| C3  | `resolveProtocolRevision` injects the caller's `optInRevisions` straight into the guard allow-list (`mcp-compat.ts:542-573`) with no registration/channel/testing validation.                                                                                                                                                                                                             | `resolveProtocolRevision(engine, { requestedRevision: '2099-01-01-evil', policy: 'OPT_IN_ONLY', optInRevisions: ['2099-01-01-evil'], now })` returns `ALLOW`.                                                                                                                                                | T042       |

## HIGH

| ID  | Defect                                                                                                                                                                                                                                             | Reproduction                                                                                                                                | Correction |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| H1  | The five PROD conformance rules are dead code: `evaluateProdConformance` is referenced only by its own spec and the barrel; `evaluateConformance` (release gate) still runs only the four pre-existing rules.                                      | A live tree that violates every PROD rule still passes the release conformance gate.                                                        | T043       |
| H2  | `evaluateProdConformance` defaults every input to `[]` and skips the MCP rule when omitted; `requiredGateKinds: []` authorizes, unknown readiness is silently ignored.                                                                             | `evaluateProdConformance({}).overall === 'PASSED'`.                                                                                         | T043       |
| H3  | All five `g2_prod_*` ids sort before the already-applied `g2_wf_0005` (`'p' < 'w'`), so on any database migrated to pre-prod `main` every prod migration is refused `MIGRATION_OUT_OF_ORDER_REFUSED`. The same latent defect affects `g2_alert_*`. | Apply `main` migrations only, then `applyMigrations` with the branch tree → typed refusal; no upgrade-path test existed.                    | T044       |
| H4  | `assertLivePathBoundaryHolds` validates only set-completeness and ref non-nullness from caller `verdict:'PASS'` rows; it never resolves the referenced import through `ImportGate`.                                                                | A live path whose `IMPORT_SHADOW_ONLY` assertion references a `RECEIVED`/`REJECTED` artifact passes.                                        | T045       |
| H5  | `implemented`/`available`/`proven` are caller booleans unbound to `prod.module_states`, and `crossesActivationGate` only fires for `ACTIVE`, so the `SHADOW → PROVEN` edge is ungated.                                                             | `advanceState(..., toState:'PROVEN')` succeeds with no statistical evidence.                                                                | T040       |
| H6  | `recordActivationGateResult` returns REFUSE results unrecorded (`activation-gate.ts:988`), so the 0005 REFUSE-invalidation query is inert and an older PASS outlives a later failure.                                                              | Record PASS, then a REFUSE for the same scope+event; the PASS rows remain the only persisted evidence.                                      | T046       |
| H7  | `APPROVED_RESTORE_STATES` includes `IMPLEMENTED`/`AVAILABLE`/`SHADOW`/`PROVEN`, the prior-event comparison is skipped for NULL-event rows, and the AC-279 fixture rolls back to the _same_ artifact set.                                           | A rollback with a never-persisted `priorActivationEventRef` matches a PROVEN row with a NULL event and "succeeds".                          | T047       |
| H8  | `SLA_BACKED` is returned when the critical register is empty, and `evaluateDeploymentPosture` has no capacity-contract input; `assertCapacityContractBacksPosture` has no consumers.                                                               | `evaluateDeploymentPosture` with zero critical dependencies yields `SLA_BACKED`.                                                            | T048       |
| H9  | `upsertDependencyGroupStatus` evaluates the premature-dependency gate against the **caller's** `dependsOn`.                                                                                                                                        | `{ id: 'G7', dependsOn: [] }` marks G7 `COMPLETE` while G0…G6 are `OPEN`.                                                                   | T049       |
| H10 | MCP `cellUsability` never compares `ran_at`/`fixture_ref` to the cell, `maxAgeSeconds` is caller-overridable, and `findPrecomputedAlphaBound` selects by `(live_path, artifact_ref)` only.                                                         | A stale/different-fixture run satisfies a cell; a `1e12` override keeps stale cells usable; a bound for artifact set A is served for set B. | T050       |

## Cheaper MEDIUM defects folded into the correction

Zod parity for the 0005 columns and the new `activation_kind`; `scope_hash`
mutability by the one legal UPDATE; open containment not enforced in SQL;
`SHADOW` counted as establishing `AVAILABLE` — T051.

## Proof restoration bar

PROVEN is restored only when: (a) every C/H row above has a landed fix and a
direct negative regression that fails against the pre-correction revision;
(b) the upgrade-path test in (c) passes from a database migrated to pre-prod
`main`; (c) the full prescribed gates and exact-SHA CI are green; (d) a
**new**, fresh-context independent convergence audit reports no CRITICAL/HIGH
finding. Admin-control and recovery-continuity promotion stays frozen until
then.

## Adversarial review rounds (fresh context, read-only, exploits attempted)

1. Round 1 (two independent reviewers, `0f46560`) found and this correction
   then closed: the OPERATIONAL kind skipped a scope-declared `requires_proven`
   precondition (`requiredGatesForActivation` + the SQL trigger + an explicit
   `advanceState` dimension check); `provenEvidenceRef` was an unverified content
   address (now resolved against a persisted, complete, unexpired OPPORTUNITY
   batch plus its activation event); `checkMcpCompatibilityDrift` honoured a
   caller `maxAgeSeconds` (now clamped); `null` mandatory inputs slipped the
   fail-closed check (now refused); `rollbackToApproved` admitted a forged
   `DEGRADED`/`PAUSED` row (now requires a genuine `ACTIVE` row); an expired or
   law-violating capacity contract backed `SLA_BACKED` (now validated with the
   authoritative capacity law); `upsertDependencyGroupStatus` had an injectable
   `orderView` (removed); and the deterministic release CLI never ran the PROD
   rules (now runs the repo-backed surface rule scoped to the active milestone
   plus, with `--prod-claims`, the five claim rules, and
   `--require-prod-claims` fails closed on omission).
2. Round 2 (`1aaae66` / `42a4be9`) re-verified every round-1 item and closed the
   remaining malformed-input bypass (`Array.isArray` shape checks), advertised
   only the rules an invocation can emit and made the
   `TRACEABILITY_FULL_CONVERGENCE` profile pass `--require-prod-claims`, added a
   bridge timeout, and added the SQL-level `requires_proven` → persisted PROVEN
   row check.

## Accepted residual MEDIUMs (recorded, not silently dropped)

- The evidence trust boundary is unchanged and documented: the gate consumes
  caller-supplied statistical verdicts, so a caller with evaluator access can
  mint the OPPORTUNITY batch that a PROVEN promotion then resolves. What the
  correction guarantees is that PROVEN/ACTIVE can never rest on a fabricated
  _reference_ or on unpersisted evidence.
- Evaluation rows are keyed by `scope_hash` only; two modules sharing the exact
  §69.5 scope JSON share evidence. Binding module/artifact into the evidence key
  is a schema change deferred to the next bounded slice (D013).
- A wholly-new migration family is trusted to own a new namespace; the migrator
  cannot verify that statically (D008).
- `clearContainment` step-up/actor/reason + ActionGate, SQL/Drizzle parity for
  defaults/constraints/indexes/triggers, two-way telemetry parity, and the
  AC-150/151/153 fixture-echo positives remain open (D013).
- The CLI's claim rules need an explicit `--prod-claims` artifact: runtime
  governance state is not derivable from the repository, so the file-based CLI
  cannot synthesise it. The authoritative prod-capable gate is
  `evaluateConformance`, which CI exercises with violating and compliant claim
  corpora.

## Closure (2026-09-13)

The correction landed as PR #294 (squash `e782ce7`). Three fresh-context
adversarial review rounds and two independent convergence audits were run
against the branch. The final audit, on pre-merge head `c704320`, reported
`NO CRITICAL/HIGH FINDINGS — READY FOR PROVEN` after independently reproducing
every round-1/round-2 exploit (activation-kind forgery, empty-event SQL bypass,
MCP opt-in bypass, conformance wiring, migration upgrade path, quarantine
resolution, dimension/kind binding, refusal persistence, rollback approval,
SLA_BACKED, dependency-order bypass, MCP staleness, alpha set binding) and the
four round-2 HIGHs (raw-SQL replay, `scope_hash`/containment evasion,
`evaluateConformance` milestone downgrade, caller-controlled persisted expiry).

Exact-SHA evidence at `c704320`: `pnpm spec:verify`, `pnpm format:check`,
`pnpm lint`, `pnpm typecheck`, the coordinated `pnpm test:all`
(`{"ok":true,"groups":39}`) and CI run `34749869829` (Fast Gates, Pure,
Process/Meta-Gate, Database PGlite, Verify) are all green.

The one residual design observation the final audit recorded — an in-process
`evaluateConformance({milestone: 'G0' | 'G1'})` override legitimately selects a
group that owns no FR-PROD requirement, so a violating claim corpus supplied to
that call passes — is documented rather than "fixed": AC-266 depends on the
explicit G0 override, and the production CLI/bridge never overrides the
milestone. It is recorded in `DECISIONS.md` D013.

## Third-round reopen (2026-09-13) — conformance + activation nested-mutation fail-opens

The re-PROVEN flip `8f7b5d9` (PR #295) is **revoked**. A fresh independent
verification at `d44de1a` (three read-only adversarial reviewers plus direct
runtime probes) reproduced three HIGH fail-opens that the second-round
convergence audit missed. The state is RUNNING/REOPENED again; `8f7b5d9` and all
prior evidence remain in history.

| ID  | Defect (reproduced at `d44de1a`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Reproduction                                                                                                                                                                                                                                                                                                                                                                      | Correction |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| R1  | **HIGH — activation-gate H5 binding bypass.** `evaluateActivationGate` freezes only the `evaluations` **array**, not the elements (`activation-gate.ts:879,902`); `recordActivationGateResult` shallow-spreads (`:1181`), sharing the mutable elements. `advanceState` reads those in-memory elements for the IMPLEMENTED/AVAILABLE/PROVEN cross-check (`module-states.ts:743-757`), while the authoritative guard reads DB rows, so a post-recording mutation changes only the TypeScript dimension gate. | Ladder IMPLEMENTED→SHADOW→PAUSED on a `requires_proven:false` scope (history `available=false`); record a genuine OPERATIONAL PASS claiming `available:true`; mutate `bound.evaluations.find(e=>e.gateKind==='AVAILABLE_EVIDENCE').verdict='NOT_APPLICABLE'`; `advanceState(..., toState:'ACTIVE')` **succeeds**. Control without the mutation refuses `GATE_DIMENSION_MISMATCH`. | T053       |
| R2  | **HIGH — `ACTIVATION_WITHOUT_EVIDENCE` accepts a missing/empty activation event.** `prod-rules.ts:156` tested only `=== null`, and the element-presence check required only `moduleId`/`lifecycleState`, so `activationEventRef` omitted or `''` passed. `requiresProven` omitted was treated as `false`.                                                                                                                                                                                                  | `checkActivationWithoutEvidence([{moduleId:'m',lifecycleState:'ACTIVE',implemented:true,available:true,proven:true,requiresProven:true,gateVerdict:'PASS'}]).passed === true` (and with `activationEventRef:''`), so `overall === 'PASSED'` and the bridge returns `{"findings":[]}`.                                                                                             | T055       |
| R3  | **HIGH — foreign-release evidence accepted by substring match.** `prod-rules.ts:524` used `evidence.scopeRefs.includes(claim.releaseRef)`; when `scopeRefs` is a string this is a substring match, and no shape check required it to be an array.                                                                                                                                                                                                                                                          | `releaseRef:'rel'` with `scopeRefs:'foreign-release-rel'` and `valid:true` → `evaluateDistributionAuthorization().authorized === true`.                                                                                                                                                                                                                                           | T056       |

Bounded MEDIUM residuals closed in the same slice: the TypeScript
persisted-evidence guard ignored a **backdated** `REFUSE` because it ordered
batches by `evaluated_at` while SQL refuses on any `REFUSE` (T054); the
active-milestone resolver accepted `/^G\d+$/` while the explicit override
rejected anything outside `G0…G7` (T057); the AC-279 acceptance artifact was
still a no-op same-set restore even though the unit suite had a genuine
A→B→A case (T058); and the migrator's applied-family key included the
generation, so a later-generation member of an already-applied family
(`g1_data_0009` after `g2_data_0001`) was misclassified as a wholly-new family
and applied out of order (T059).

Re-verification bar (unchanged): every R-row has a landed fix and a direct
exploit regression that fails against the pre-correction revision; a **new**
fresh-context convergence audit reports no CRITICAL/HIGH finding; the full
prescribed gates and exact-SHA CI are green. Admin-control and
recovery-continuity promotion stays frozen until then.

### Convergence-audit follow-ups (T063/T064) and accepted residual

The new convergence audit reproduced two further defects that all earlier
rounds missed, and both are corrected here:

- **T063 — §69.9 distribution activation was inoperable.** The `g2_prod_0006`
  evidence trigger appended the distribution gate with
  `required_gates || 'DISTRIBUTION_EVIDENCE'`; PostgreSQL resolves
  `text[] || unknown` as `anyarray || anyarray`, so every ACTIVE insert with
  `activation_kind` WORKSPACE/PUBLIC aborted with
  `ERROR: malformed array literal: "DISTRIBUTION_EVIDENCE"`. Since `0006` is
  already applied on canonical `main`, the corrected trigger function lands as
  the later-sorting `migrations/g2_prod_0009_fix_distribution_gate_set.sql`
  (`array_append`), and a new regression persists a genuine WORKSPACE **and**
  PUBLIC ACTIVE — a path no earlier test exercised.
- **T064 — prod telemetry catalog drift.** The C1 correction added `scopeHash`
  and `activationKind` to `ModuleStateRowSchema` and `activationEventRef`/
  `activationKind` to `ActivationGateEvaluationRowSchema`, but
  `telemetry/prod.catalog.json` was never updated and the parity suite checked
  only catalog ⊆ schema. The five affected events now carry the fields and the
  prod parity assertion is two-way (set equality), so a future schema field
  cannot be silently absent from the CRITICAL_METADATA recovery contract.

**Accepted residual (not silently dropped).** A raw SQL writer can insert a
`PROVEN` `prod.module_states` row directly (no trigger guards the PROVEN
transition; only ACTIVE is guarded), and can also insert the forged
`activation_gate_evaluations` PASS rows that the ACTIVE trigger requires. The
governed `advanceState` path refuses this — a PROVEN promotion requires a
persisted OPPORTUNITY batch, and ACTIVE requires the exact kind-bound evidence
— so the residual is the same raw-writer evidence-fabrication trust boundary
that C1 already records (D013/D014): a writer who can INSERT evaluation rows
can fabricate any activation. Binding PROVEN at SQL would raise the bar but not
close it (the batch rows are equally insertable), so it is recorded rather than
claimed as closed.

## Third-round closure (2026-09-13)

The correction landed as PR #296 (squash `b1611b9`). Evidence at the pre-merge
head `0bc79f5`:

- **Two new fresh-context independent convergence audits**, run separately,
  both returned **"NO CRITICAL/HIGH FINDINGS — READY FOR PROVEN"** after
  reproducing the T063/T064 fixes, the raw-writer residual, and the original
  C1–C3/H1–H10/R1–R3 paths. Both classified the raw-SQL PROVEN insert as the
  accepted raw-writer trust boundary (MEDIUM), not a fail-open: a writer who can
  forge the evaluation batch can already reach ACTIVE, and a writer who cannot
  cannot reach ACTIVE at all.
- **Full prescribed gates at `0bc79f5`:** `pnpm verify` (602 bun test files,
  node-runtime-compat), coordinated `pnpm test:all` (`{"ok":true,"groups":39}`),
  `pnpm spec:verify`, format, lint, typecheck; focused suites capability-registry
  94, release-conformance 105, persistence migrator 16, telemetry-catalog 123,
  AC-279 acceptance + negative.
- **Exact-SHA CI** run `34755822334` at `0bc79f5` (Fast Gates, Pure,
  Process/Meta-Gate, Database PGlite, Verify) green.

State change: g2-production-readiness RUNNING → PROVEN (schema-legal
RUNNING→PROVEN), restored only after the above. Phase 11 tasks `T053`–`T064` are
checked; history is preserved and nothing was rewritten.

## Fourth-round reopen (2026-09-13) — release-gate completeness and the PROVEN edge

The re-PROVEN flip `97b244a` (PR #297) is **revoked**. A **new** session ran four
fresh-context adversarial verifiers against `origin/main` `97b244a`. They wrote
NEW probes (never reusing the landed regression specs as proof) under
`flock /tmp/deepseek-global-heavy-gate.lock`, and reproduced release-blocking
fail-opens that all three earlier rounds missed. The state returns to
RUNNING/REOPENED; PR #297 and every prior evidence artifact remain in history.

| ID  | Defect (reproduced at `97b244a`)                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Reproduction                                                                                                                                                                                                                                                                                                                                         | Correction |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| R4  | **HIGH — the PUBLIC/WORKSPACE authorization rule trusts the caller's gate set (audit H2 not closed).** `evaluateDistributionAuthorization` reads `requiredGateKinds` straight off the claim, so the H2 remedy ("derive the required distribution gates from the authoritative law") was never implemented. Only the _empty_ case was closed.                                                                                                                                                 | `PUBLIC_AUTHORIZED` with `requiredGateKinds: ['TOTALLY_FAKE_GATE']` (or `['DISTRIBUTION_EVIDENCE']`, 1 of 10 authoritative gates) plus one matching in-scope `valid:true` record → `authorized === true`, `evaluateProdConformance(...).overall === 'PASSED'`, zero findings.                                                                        | T065       |
| R5  | **HIGH — the `PROVEN` promotion edge is not bound to governed history (audit H5 not closed).** `advanceState`'s dimension cross-check runs only when `crossesActivationGate` is true, i.e. only for `ACTIVE`. A `SHADOW → PROVEN` promotion validates only that _some_ persisted OPPORTUNITY batch exists — a batch whose `AVAILABLE_EVIDENCE`/`PROVEN_PRESENT` PASS rows came from caller-supplied booleans.                                                                                | Scope `requires_proven=true`; ladder `IMPLEMENTED → SHADOW` (governed history `available=false, proven=false`); record an OPPORTUNITY batch evaluated with fabricated `available=true, proven=true`; `advanceState(toState:'PROVEN')` **succeeds**, then `advanceState(toState:'ACTIVE')` **succeeds** for a scope that never established AVAILABLE. | T066       |
| R6  | **HIGH — an open `DISABLED` containment is de-escalated by rollback.** The containment-open fence lives only on the `ACTIVE` edge; `rollbackToApproved` targets `PAUSED`, so a rollback proceeds while a `DISABLED` containment is open and leaves the scope `PAUSED` with the containment still open — contradicting §69.11 determinism and the code's own `DISABLED > PAUSED` escalation law.                                                                                              | Ladder to ACTIVE → `containForFailedGate(SECURITY)` → state+action `DISABLED` → `rollbackToApproved({prior event that genuinely reached ACTIVE})` → **ACCEPTED**, `statesFor() === 'PAUSED'`, `openContainments()` still lists the `DISABLED` containment.                                                                                           | T067       |
| R7  | **HIGH — the release gate's live-path rule never resolves the import quarantine state (audit H4 root cause on the authoritative gate surface).** `checkLivePathPrecomputationViolation` uses the state-blind `artifactBoundaryHolds`, so a `prod-claims` file whose `IMPORT_SHADOW_ONLY` assertion carries `verdict:'PASS'` for a `REJECTED`/nonexistent artifact drives `evaluateProdConformance` to `PASSED`. The DB-backed `assertLivePathBoundaryHolds` is closed; this surface was not. | `evaluateProdConformance({activationClaims:[],postureDeclarations:[],mcpCompatibility:<valid>,livePaths:[<IMPORT_SHADOW_ONLY PASS refs 'artifact-received-state' and 'artifact-does-not-exist-at-all'>],distributionAuthorizations:[]})` → `{"overall":"PASSED","findings":[]}`.                                                                     | T068       |
| R8  | **MEDIUM — the `g2_prod_0008` "nonblank" CHECK uses `btrim(text)` (ASCII spaces only).** Tab/LF/CR/VT/FF/NBSP/BOM event refs satisfy `length(btrim(...)) > 0` while TypeScript `.trim()` treats them as blank, so the raw-write invariant and its comment diverge. Not an evidence bypass (the all-PASS evidence trigger still applies).                                                                                                                                                     | With a complete all-PASS OPPORTUNITY set supplied, `activation_event_ref='\t'` (and `'\n'`, `'\r'`, `'\v'`, `'\f'`, NBSP, BOM) is `ACCEPTED`; `' '` is refused by the same CHECK.                                                                                                                                                                    | T069       |
| R9  | **MEDIUM — `containForFailedGate` persists a weaker action than it applies.** The containment row stores `requestedAction` while the state row uses the `DISABLED` fallback, so `openContainments()`/`loadContainmentFacts()` report `DEGRADED`/`PAUSED` for a scope that is actually `DISABLED`, and the activation refusal message understates the stop.                                                                                                                                   | `containForFailedGate({criticalGate:'CAPACITY'})` on a `SHADOW` scope → `containment.action='DEGRADED'` while the persisted state is `DISABLED`.                                                                                                                                                                                                     | T070       |

### Accepted residuals (recorded, not silently dropped)

- **Raw-writer trust boundary** (unchanged from D013/D014): a writer who can
  `INSERT` into `prod.module_states` and `prod.activation_gate_evaluations` can
  forge any activation, including `PROVEN`. Binding `PROVEN` at SQL would not
  raise the bar because the batch rows are equally insertable.
- **Caller-supplied governance claims** (`prodClaims`) remain the release gate's
  trust boundary: the file-based CLI cannot verify signed evidence without the
  server-side pepper. R4/R7 require the gate to enforce the _closed, authoritative
  completeness law_ over those claims (no truncation, no unknown gate kinds, and
  an explicit import-state in the closed vocabulary), which is what the gate can
  genuinely enforce.
- **`McpProtocolWiring` config lists** (`apps/api/src/mcp/protocol-wiring.ts`)
  admit caller-supplied draft revisions without the registered compatibility
  matrix. Impact is limited to config trust (no remote request path); a follow-up
  bounded slice will route it through `resolveProtocolRevision`.
- **`evaluateConformance({milestone:'G0'|'G1'})`** legitimately selects a group
  that owns no FR-PROD requirement, so a violating claim corpus supplied to that
  in-process call skips the PROD block. The production CLI has no milestone
  option and reads the repository milestone; AC-266 itself uses the `G0` override.
- **Post-containment-clear evidence freshness** (M3): the same pre-clear
  unexpired evidence batch is still accepted after `clearContainment`. Recorded
  as a bounded MEDIUM; the fix requires binding evidence `evaluated_at` to the
  clear event.

### Re-verification bar (unchanged)

Every R-row has a landed fix and a direct exploit regression that fails against
`97b244a`; the full prescribed gates and exact-SHA CI are green; and a **new**
fresh-context convergence audit reports no CRITICAL/HIGH finding. Admin-control
and recovery-continuity promotion stays frozen until then.

## Fourth-round closure (2026-09-13)

The correction landed as PR #298 (squash `32e7af7`). The bar above is met at the
pre-merge head `a6c2395` (merged tree byte-identical):

- **Fresh adversarial reviews/audits** (all new probes, never the landed specs as
  proof): review of `97b244a..0e2eb11` = NO CRITICAL/HIGH; re-review of
  `0e2eb11..fab1a48` = NO CRITICAL/HIGH; convergence audit at `fab1a48` = NEW-H1
  HIGH (unfrozen `GATE_KINDS`) fixed `b5512d4`; audit at `a58d4c7` = NEW-H2 HIGH
  (unfrozen `ALL_ARTIFACT_BOUNDARY_ASSERTION_KINDS`) plus NEW-M4/M5 fixed
  `f08ace0`; audit at `5486938` = HIGH (`Array.prototype[Symbol.iterator]` and
  `.includes` shadowing of the gate decisions) fixed `0623736`/`a7dfbf0`/
  `af0cc89`/`4c68856`; audit at `4c68856` = **NO CRITICAL/HIGH WITHIN THE D018
  MODEL — READY FOR PROVEN**, with N1 (unfrozen capacity vocabularies) and N2
  (settled-result destructuring) fixed `22c4f36`/`daf309d`; re-review at
  `daf309d` reopened N2 via the `Promise.all` ARGUMENT array, fixed `a6c2395`;
  re-verification at `a6c2395` = **NO CRITICAL/HIGH FINDINGS WITHIN THE D018
  THREAT MODEL**.
- **In-scope hardening:** every fail-closed decision/aggregation path in
  `@foresift/domain`, `@foresift/release-conformance` and
  `@foresift/capability-registry` now walks arrays by numeric index and uses the
  numeric `isOneOf` helper instead of `for…of`/spread/`.map/.filter/.some/.find/
.includes/.indexOf/.forEach/.reduce/.push`/`new Set(array)`, the authority
  arrays are `Object.freeze`d, `promiseAllNumeric`/`numericFromEntries` close the
  `Promise.all` argument-iterator vector, and the shadow-safe helpers never touch
  `Array.prototype`. This also closed real fail-opens found on the way:
  `canonical-json` collapsing distinct objects to the same hash, capacity
  envelope/reserve laws skipped by an empty iterator, and the `Promise.all`
  argument/result forgeries in `evaluateConformance`, `buildReleaseReport`,
  `hashFiles` and orphan detection. The explicit threat-model boundary is
  recorded in `.deepseek-handoff/DECISIONS.md` D018 (non-Array intrinsics and
  pre-import shadowing are out of scope; process/realm isolation is the
  compensating control).
- **Full prescribed gates at `a6c2395`:** `pnpm verify` green — `spec:verify`
  13 checks, format, lint, typecheck, coordinated bun suite
  `{"authority":"BUN_TEST","bunFiles":602,"passed":true}`, node-runtime-compat;
  `docs/generated` clean (60 files); coordinator manifest 602/602 hashes.
- **Exact-SHA CI green** at `0e2eb11` (`34763237367`), `fab1a48` (`34764208186`),
  `a58d4c7` (`34765466174`), `5486938` (`34767823427`), `4c68856` (`34771097938`)
  and `a6c2395` (`34774582796`).

State change: g2-production-readiness RUNNING → PROVEN (schema-legal), restored
only after the above. Phase 12 tasks `T065`–`T072` are checked; history is
preserved and nothing was rewritten. `g2-admin-control` and
`g2-recovery-continuity` promotion is unblocked.

## Fifth-round reopen (2026-09-13) — in-process shadow residuals on the authority paths

The re-PROVEN flip `53f737d` (PR #299) is **revoked**. A **new** session ran four
fresh-context adversarial verifiers against `origin/main` `53f737d` (read-only,
static; each given a disjoint finding set and instructed to re-derive every
claim from current code, never from comments or the landed specs). They
independently re-confirmed the whole C1–C3/H1–H10/R1–R9 chain as closed, then
reproduced **three HIGH residuals of the `Array.prototype` shadowing class**:
R10/R11 are decision-time shadows inside the recorded D018 model; R12 is a
module-initialization shadow of the lazily imported `prod-rules.ts` (D018's
letter excludes shadows installed _before a guard module is imported_, but the
dynamic import makes that window reachable from an in-process caller at
`evaluateConformance` time, so it is fixed as bounded hardening rather than
recorded). The state returns to RUNNING/REOPENED; PR #299 and every prior
flip/evidence artifact remain in history.

| ID  | Defect (reproduced at `53f737d`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Reproduction                                                                                                                                                                                                                                                                                                                                          | Correction |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| R10 | **HIGH — the persisted-evidence authority query is built with a shadowable `.join`.** `activationGateEvaluationsFor` assembles its `WHERE` with `clauses.join(' AND ')` (`packages/capability-registry/src/activation-gate.ts:1341`) although the module already imports `numericJoin` (`:59`, used at `:843`). `requirePersistedActivationEvidence` verifies kind/event/gate/expiry but never compares the returned `row.scopeHash` to `input.scopeHash` (`:1469-1551`). Shadowing `Array.prototype.join` lets the query return foreign-scope rows; the caller recomputes `activationEvidenceSetRef` over those rows and `advanceState(toState:'PROVEN')` writes a governed PROVEN state for a scope that never earned it. The ACTIVE INSERT stays refused by the independent SQL trigger (`g2_prod_0009:103-164`), so the flip is a forged PROVEN, which a `requires_proven` scope then relies on.                                                                                                                                                                                                                                                                                                                                                                                                              | Shadow `Array.prototype.join` to drop/replace the `scope_hash = $1` predicate, resolve a genuine all-PASS batch from any other scope for the same kind+event, then `advanceState(..., 'PROVEN', {provenEvidenceRef: activationEvidenceSetRef(foreignRows)})` succeeds. The shadow suite omits `join`.                                                 | T073       |
| R11 | **HIGH — the MCP protocol-revision allow-list membership test is a shadowable `.includes`.** `McpProtocolGuard.inspect` refuses unless `allowedRevisions.includes(input.protocolRevision)` (`packages/security/src/mcp-protocol-guard.ts:70-75`). `resolveProtocolRevision` funnels opt-ins through the validated matrix, but then trusts the guard's verdict with no numeric re-check (`packages/capability-registry/src/mcp-compat.ts:712-720`). Shadowing `Array.prototype.includes` to return `true` makes the guard ALLOW any requested revision, including `2099-01-01-evil`, re-opening audit C3 at the FR-PROD-003 surface.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `Array.prototype.includes = () => true`, then `resolveProtocolRevision(engine, {requestedRevision:'2099-01-01-evil', policy:'OPT_IN_ONLY', now})` returns `decision:'ALLOW'`.                                                                                                                                                                         | T074       |
| R12 | **HIGH — the release-gate import-shadow authority is built with a shadowable `.filter` in a lazily imported module.** `prod-rules.ts:507` computes `SHADOW_ONLY_IMPORT_ARTIFACT_STATES` with `ALL_IMPORT_ARTIFACT_STATES.filter(...)` at module initialization, but `conformance.ts:688` imports the module **dynamically at call time**. A shadow installed before `evaluateConformance` runs therefore controls the constructor: `Array.prototype.filter = function () { return this; }` widens the authority to every persisted state, so an `IMPORT_SHADOW_ONLY` live-path assertion naming a `RECEIVED`/`REJECTED` import passes the release gate — re-opening audit H4/R7.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `Array.prototype.filter = function () { return this; }` then `evaluateConformance({... livePaths:[{assertionKind:'IMPORT_SHADOW_ONLY', verdict:'PASS', importArtifactState:'REJECTED'}]})` → `overall:'PASSED'`.                                                                                                                                      | T075       |
| R13 | **HIGH — `@foresift/security` decision-time authority gates still rely on shadowable `Array.prototype` operations.** The fifth-round review swept the sibling package and found the same D018 class: `egress.ts` `authorize` allowlist `.some` (`:256`, shadow→false bypasses the deny-by-default host allowlist ⇒ SSRF), `verifyPin` `[...].sort().join(',')` pin comparison (`:326`, shadow→ALLOW after DNS rebinding), allowed-content-type `.includes` (`:400`); `action-gate.ts` `PHISHING_RESISTANT_CLASSES`/`authorizedScopes` `.includes` (`:80,87,116`, step-up and scope-mismatch bypass); `oauth-binding.ts` registered-redirect-URI `.includes` and scope-widening `.filter` (`:64,95`); `mcp-credentials.ts` IP-constraint `.includes` and requested-scope `.filter` (`:219,237`); `webhook-integrity.ts` endpoint `.includes` (`:164`); `untrusted-content.ts` trusted-image/link-host `.includes` and exfil-hint `.some` (`:310,350,358`); `secrets-policy.ts` export-prohibition `.includes` (`:100`); `mcp-origin.ts` scheme `.includes` and host-label `join` (`:101,137`); `import-gating.ts` format/transition `.includes` (`:136,324`); `negative-capability.ts` forbidden-verb detection; `claims-policy.ts` redaction `.includes`; `abuse-controls.ts`/`supply-chain.ts` validation gates. | `Array.prototype.some = () => false` → `authorize` ALLOWs a non-allowlisted host (SSRF); `Array.prototype.join = () => 'X'` → `verifyPin` ALLOWs after DNS rebinding; `Array.prototype.includes = () => true` → action-gate step-up / scope and OAuth redirect-URI bypasses; `filter = () => []` → scope widening and credential-scope excess hidden. | T079       |

### R13 review follow-ups (same correction, second adversarial pass)

A fresh review of the R13 slice found and this correction closed:

- **R13a (HIGH) — schema-library internals.** zod's `ObjectType._parse` walks
  `for (const key of shapeKeys)` and appends with `push`, so an in-scope
  `Array.prototype[Symbol.iterator]`/`push` shadow made `Schema.parse(literal)`
  return `{}`. Every consumer compares against a NEGATIVE discriminant
  (`decision === 'REFUSE'`, `verdict === 'REFUSED'`, `outcome`), so a bare `{}`
  silently authorized: an egress allowlist bypass via
  `packages/providers/src/adapter-contract.ts` `requireEgress`, a caps bypass in
  `packages/tool-core/src/stages/dispatch.ts`, an MCP protocol bypass in
  `apps/api/src/mcp/protocol-wiring.ts`, and a claims-compliance bypass in
  `assertClaimsCompliant`. Fix: `parseDecision` in
  `packages/security/src/shadow-safe.ts` returns the package-constructed literal
  (frozen) whenever the parsed result does not carry the SAME discriminant, and
  every decision return in `egress.ts` (12), `mcp-protocol-guard.ts` (2),
  `mcp-origin.ts` (4), `claims-policy.ts` (6) and `action-gate.ts` (1) now routes
  through it. The consumers therefore always receive a real verdict; two
  discriminating regressions shadow `push` and assert a real REFUSE/REFUSED.
- **R13b (MEDIUM) — fence parser.** `parseStructuredExtractionFence` still used
  `lines.slice(1,-1)` / `contentLines.slice(1).join('\n')`; a shadowed `slice`
  could fabricate the mandatory data-only preamble and flip the documented
  fail-closed parser to ACCEPT. Now `numericSlice`/`numericJoin`.
- **R13c (MEDIUM) — redaction.** `claims-policy.ts` `.split(...).join(...)`
  redaction now uses `numericJoin`, and the `[...classes]` Set spread became a
  numeric collection.
- **R13d (MEDIUM) — abuse controls.** `recordBurst` in-place numeric compaction
  (no `shift`/`push`), `coordinationScore` `numericFilter` + numeric loop, and
  Map destructuring loops became `Map.forEach`.
- **R13e (LOW) — audit-chain.** `.map`/`new Set(entries.map(...))` became
  `numericMap`/`numericIncludes`; classification outcomes are unchanged
  (`numericIncludes` is SameValueZero-equivalent to `Set.has`). `numericSlice`
  now treats `NaN` as the builtin `ToIntegerOrInfinity` does.

Remaining third-party boundary recorded: any `.parse` site outside these
decision returns (lifecycle/incident/audit record schemas) still relies on the
schema library, but its consumers do not authorize on a negative discriminant,
so a `{}` there fails closed. The repo cannot harden dependency internals;
realm isolation remains the compensating control (D018/D021).

### Proof-integrity defect closed in the same slice

`packages/release-conformance/test/prod-rules.spec.ts` NEW-N2
(`does not let forged verdicts flip a trace-violating corpus to PASSED`) runs two
full `evaluateConformance` calls against bun's 5000 ms default. It measured
**4983 ms under concurrent load** (and timed out at 5000 ms on a contended run)
against 886 ms on an idle host — a latent flake that can red the release gate
non-deterministically. It gains an explicit bounded timeout (T076).

### Re-verification bar (unchanged)

Every R-row has a landed fix and a direct shadow regression that fails against
`53f737d`; the full prescribed gates and exact-SHA CI are green; and a **new**
fresh-context convergence audit reports no CRITICAL/HIGH finding. Admin-control
and recovery-continuity promotion stays frozen until then.

### Accepted residuals (recorded, not silently dropped)

The previously recorded residuals stand unchanged (raw-writer trust boundary,
caller-supplied `prodClaims`/statistical verdicts, `McpProtocolWiring` config
draft lists, the `evaluateConformance` non-PROD milestone override used by
AC-266, post-clear evidence freshness, `clearContainment` governance/ActionGate,
unwired `evaluateDeploymentPosture`/`assertLivePathBoundaryHolds`). This round
adds no new residual in the PROD packages: R10–R12 are fixed, not accepted.
R10/R11 are decision-time shadows inside the D018 model; R12 is a
module-initialization shadow (see above). The fifth-round adversarial review
also confirmed a systemic sibling class in `@foresift/security` (R13), which is
fixed in the same correction rather than deferred.

## Fifth-round closure (2026-09-13)

The correction landed as PR #300 (squash `b2c08fc`) on `main`; the fix head was
`66a750d`. The re-verification bar is met:

- **Independent convergence audit** (fresh context, read-only, NEW probes): the
  auditor reconstructed the base with `git archive 53f737d` and compared it with
  `89f2145`. It reproduced every R-row on the base and showed it closed at the
  fix head — R10 (shadowed `join` dropped the `scope_hash` predicate and
  foreign-scope rows were accepted on the base; the head keeps the predicate and
  refuses `EVIDENCE_SET_SCOPE_MISMATCH`), R11 (base guard/`resolveProtocolRevision`
  ALLOW `2099-01-01-evil`; head REFUSE/`REVISION_NOT_AUTHORIZED`), R12 (base
  pre-import `filter` shadow widened the release-gate authority to six states and
  passed a `REJECTED` import; head stays
  `["VALIDATING","SHADOW_ELIGIBLE"]` and fails it), and R13 (base
  `some`/`join`/`push` shadows bypassed the egress allowlist, the DNS-rebind pin,
  and made every security verdict a bare `{}`; head returns real
  REFUSE/ALLOW/REFUSED verdicts, including under a schema-library `push` shadow).
  Verdict: **`CONVERGENCE: READY FOR PROVEN — no CRITICAL/HIGH`**.
- **Convergence-audit M1 closed** in `66a750d`: the release-gate finding
  messages still used `Array.prototype.join`, so a `join` shadow could turn a
  clean FAILED verdict into an uncaught throw; every finding message now uses
  `numericJoin`, with a discriminating regression.
- **Manifest / generated docs independently reproduced:** coordinator manifest
  byte-identical 602/602, `docs/generated` 60 files clean, `spec:verify` 13
  checks, 112/112 security PURE and 66/66 prod-release-rules specs pass.
- **Local full gate:** `pnpm verify` green at `66a750d`
  (`{"authority":"BUN_TEST","bunFiles":602,"passed":true}` and
  node-runtime-compat).
- **Exact-SHA CI:** run `34789731516` at `66a750d` (Fast Gates, Pure,
  Process/Meta-Gate, Database PGlite, Verify) all green; PR #300 merged as
  `b2c08fc`.

State change: g2-production-readiness RUNNING → PROVEN (schema-legal), restored
only after the above. Phase 13 tasks `T073`–`T081` are checked; history is
preserved (reopen `88a915e`, fixes `89f2145`/`66a750d`) and nothing was rewritten.
`g2-admin-control` and `g2-recovery-continuity` promotion is unblocked, subject
to `g2-admin-control` absorbing the fifth-round correction.

## Sixth-round independent verification (2026-09-13) — C/H set confirmed closed; bounded hardening

The re-PROVEN flip `29f1841` (PR #301) is **not** revoked for any CRITICAL/HIGH:
a brand-new session ran three fresh-context adversarial verifiers (disjoint
finding sets, read-only, instructed to re-derive every claim from current code)
plus the coordinator's own directed gate runs against `origin/main` `29f1841`.
Every audit finding below was re-probed with a live exploit and **did not
reproduce** (NOT-REPRODUCED); the one new HIGH a verifier proposed is the
already-documented evaluator trust boundary and is graded MEDIUM (below).

### Re-verified closed (live probes against `29f1841`)

| Finding                           | Verdict        | Independent evidence                                                                                                                                                                                                                                              |
| --------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 activation-kind/skip integrity | NOT-REPRODUCED | OPPORTUNITY claim over OPERATIONAL rows refused `EVIDENCE_SET_EMPTY` (TS) and `missing gate IMPLEMENTED_PRESENT` (raw SQL); skipped gates persist `NOT_APPLICABLE`; hand-built and spread PASS refused `ACTIVATION_RESULT_UNBRANDED`.                             |
| C2 SQL empty-event ACTIVE         | NOT-REPRODUCED | raw ACTIVE `activation_event_ref=''` refused `23001`; `' '`/`'\t'`/NBSP/BOM/U+3000 refused by the `g2_prod_0010` CHECK; NULL refused by `g2_prod_0001`; zero rows committed.                                                                                      |
| C3 MCP opt-in bypass              | NOT-REPRODUCED | `2099-01-01-evil` opt-in throws `PROD_MCP_REVISION_CHANNEL_UNKNOWN`; unregistered → `REVISION_NOT_AUTHORIZED`; registered-but-untested DRAFT → `CELL_NOT_USABLE`.                                                                                                 |
| H1 prod rules wired               | NOT-REPRODUCED | `evaluateConformance` (G2) emits `ACTIVATION_WITHOUT_EVIDENCE`/`MCP_COMPATIBILITY_DRIFT`; omitted `prodClaims` → `PROD_CONFORMANCE_INPUT_MISSING`; violating CLI corpus → `FAILED`.                                                                               |
| H2 conformance fail-closed        | NOT-REPRODUCED | `evaluateProdConformance({})` → `FAILED` (5 findings); empty `requiredGateKinds`, unknown readiness, truncated gate-kind sets all refuse.                                                                                                                         |
| H3 migration upgrade path         | NOT-REPRODUCED | pre-prod-main DB (76 files) upgrades by applying exactly the 10 `g2_prod_*` ids with no `MIGRATION_OUT_OF_ORDER_REFUSED`; upgraded fingerprint == fresh fingerprint (verified including trigger-function bodies).                                                 |
| H4 live-path quarantine           | NOT-REPRODUCED | DB-backed `assertLivePathBoundaryHolds` refuses a REJECTED import (`PROD_TRUST_BOUNDARY_VIOLATION`), passes VALIDATING; unknown refs are FK-blocked.                                                                                                              |
| H5 PROVEN/dimension binding       | NOT-REPRODUCED | `advanceState(PROVEN)` refuses missing ref (`PROVEN_EVIDENCE_REQUIRED`), fabricated ref (`EVIDENCE_SET_EMPTY`), OPERATIONAL batch; `requires_proven` without a persisted PROVEN row refused.                                                                      |
| H6 refusal persistence            | NOT-REPRODUCED | PASS then later same-(scope,kind,event) REFUSE → `EVIDENCE_SET_NOT_PASS`; raw SQL ACTIVE refused.                                                                                                                                                                 |
| H7 rollback approval              | NOT-REPRODUCED | fabricated prior event, never-ACTIVE set, forged pre-ACTIVE row, and gate-less ACTIVE all refuse; the approval query requires `ACTIVE` + exact non-null event; `AC-279.spec.ts` re-derived as a genuine A→B→A test.                                               |
| H8 `SLA_BACKED` vacuity           | NOT-REPRODUCED | empty register and missing/FAIL/expired/bare contract → `FREE_TIER_BEST_EFFORT`; only covered register + valid contract → `SLA_BACKED`.                                                                                                                           |
| H9 dependency-group bypass        | NOT-REPRODUCED | `G7 dependsOn:[] COMPLETE` refused against the authoritative manifest; open prerequisites refuse.                                                                                                                                                                 |
| H10 MCP staleness/alpha set       | NOT-REPRODUCED | fixture mismatch/stale/revision/client mismatches unusable; `maxAgeSeconds` clamped at cell and rule level; `(live_path, artifact_ref, artifact_set_hash)` binding enforced in lookup and serve.                                                                  |
| R10/R11/R12/R13 shadow class      | NOT-REPRODUCED | `numericJoin` clause builder + explicit `scopeHash` guard; numeric MCP membership survives `includes` shadow; module-init `filter` shadow leaves the import-state authority exact; `@foresift/security` returns real verdicts under `push`/`some`/`join` shadows. |

Targeted executed gates at `29f1841` (coordinator, `flock
/tmp/deepseek-global-heavy-gate.lock`): capability-registry + prod AC/negative
821 tests 0 fail; `@foresift/security` 355 tests 0 fail; release-conformance 130
tests 0 fail; `packages/persistence/test/migrator.spec.ts` 16/16; `spec:verify`
13 checks; `format:check`, `lint`, `typecheck` green.

### Sixth-round bounded defects found and fixed in this slice

| ID   | Severity     | Defect (reproduced at `29f1841`)                                                                                                                                                                                                                                                                                                                                                                                                     | Correction                                                                                                                                                                              |
| ---- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V6-1 | MEDIUM + LOW | `cellUsability` counted a **future-dated** conformance run (`ranAt` after `now`) as fresh, so a test that has not happened satisfied provenance/staleness (MEDIUM). Separately, a malformed `now` escaped `cellUsability` as a domain `TIMESTAMP_INVALID` **throw** from `mcpCompatibilityCellUsable` rather than a typed verdict (LOW — the throw is itself fail-closed, but a caller must catch a domain exception to observe it). | Skip any run whose `ranAt` is non-finite or after `now`; return a typed `CELL_NOT_USABLE` refusal for a non-finite `now` instead of throwing.                                           |
| V6-2 | MEDIUM       | empty `conformanceFixtureRef`/`fixtureRef` satisfied the H10 provenance equality (`'' === ''`), and the writers accepted whitespace-only fixture refs (the DB `length(...) > 0` CHECK rejects only the empty string, so the DB-reachable form was whitespace).                                                                                                                                                                       | Require a non-blank declared fixture reference and a non-blank run fixture reference at read; refuse non-string/trim-blank fixture refs at both write sites before any query is issued. |
| V6-3 | LOW          | `checkProdConformanceInputsPresent` required `weakenedDimensions`/`protectedDimensions` to be present but not to be arrays, so `weakenedDimensions:{length:0}` (and array-likes such as `{0:'freshness',length:1}`) were read by the numeric scan as declarations and drove a PASSED report.                                                                                                                                         | Require both to be arrays (the numeric scan already prevented any dimension being hidden).                                                                                              |

Each V6 row carries a discriminating regression that fails against `29f1841`:
the future-dated run, the malformed-`now` throw→refusal, the blank-to-blank
provenance read, both write-site refusals, and the `{length:0}` posture report.
The well-shaped controls (`recent` run, `['freshness']` + every protected
dimension) pass at both revisions, proving no over-refusal. Verified by running
the strengthened tests in a temporary base worktree at `29f1841` (4 MCP
failures, 1 V6-3 failure) and at the fix head (0 failures).

### Re-confirmed residuals (recorded, not silently dropped)

- **Statistical-evidence registration (re-confirmed MEDIUM; proposed HIGH by one verifier).**
  `RegisteredStatisticalEvidence` is matched by `scopeHash` inside a
  caller-supplied array; `evidenceRef`, negative-control/interval/calibration
  verdicts are self-declared and no row is resolved against
  `evaluation_datasets`/holdout provenance. This is the evaluator trust boundary
  recorded in the first-round accepted residuals (and D013): the gate's caller is
  the trusted statistical-evaluation subsystem, D018's compensating control is
  process/realm isolation, and the surface has no production consumer. It is
  graded MEDIUM, not a release blocker. The bounded follow-up (register evidence
  keyed by `(scope_hash, evidence_ref)` with dataset/holdout provenance and
  require the persisted batch to resolve each row) is recorded as T087.
- **SQL `scope_hash` is not injective over extra keys.** `foresift_prod_scope_hash`
  hashes the seven canonical keys and ignores extras while the scope shape CHECK
  only requires those keys present; a raw row can carry an extra dimension with a
  base-scope hash. Bounded: `parseModuleStateScope` refuses extra keys and
  `stateRowsFor` matches `scope = $2::jsonb` exactly, so the row is invisible to
  governed reads and grants no authority. Exact-key CHECK recorded as T088.
- **Migrator DDL-namespace ownership is a convention after the H3 fix.** The
  out-of-order refusal is per-family (R5 in-family gap-fill still refused,
  including a later-generation same-family latecomer); a new family can therefore
  alter another family's schema if a repo author commits such SQL. This is the
  documented D014 resolution of the H3 upgrade-path requirement, requires repo
  write access, and is not a runtime fail-open.
- **Intrinsic-shape statics are outside D018's in-scope class.** The sixth-round
  convergence review recorded (LOW/boundary) that a deliberate reassignment of
  `Array.isArray` (an `Array` **static**, not an `Array.prototype` method or
  iterator) re-opens the V6-3 shape guard, exactly as D018 already names
  `Object.freeze`/`Object.keys`/`JSON.stringify`/the `Map`/`Set` prototypes as
  outside the model. There is no intrinsic-free way to distinguish a genuine
  `Array` from an array-like in one realm, so the compensating control is the
  same as D018/D021's: process/realm isolation, plus the requirement that the
  guard is not handed untrusted in-process code. The IN-scope class remains
  decision-time `Array.prototype` methods and iterators on the authority path
  (R10–R13), which are closed. Recorded here rather than re-opened as a defect.
- Previously recorded residuals stand: raw-writer trust boundary, caller-supplied
  `prodClaims`, `clearContainment` governance/ActionGate (D013), SQL/Drizzle
  parity breadth, two-way telemetry parity, AC-150/151/153 fixture-echo positives,
  and precomputed-alpha caller `latencyMs`/`servedAt`.

### Re-verification bar (unchanged)

PROVEN is restored only after: (a) every V6 row has a landed fix and a
discriminating regression failing against `29f1841`; (b) the upgrade-path test
passes from a database migrated to pre-prod `main`; (c) the full prescribed gates
and exact-SHA CI are green; (d) a **new** fresh-context convergence review of the
fix head reports no CRITICAL/HIGH. History is preserved (`29f1841` and the whole
five-round chain remain); nothing is rewritten.
