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
