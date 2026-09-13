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
