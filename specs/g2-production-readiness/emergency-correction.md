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
