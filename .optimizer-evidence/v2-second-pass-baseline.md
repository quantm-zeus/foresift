# Second-pass optimization — factual baseline at V2 start

- Date: 2026-08-23 (UTC)
- Baseline HEAD: `084d21be94c7b75ebd5002b01b544d446a42876a` (= `origin/main`, PR #20)
- Method: direct code inspection of the OPTIMIZED lane + run-log measurements from
  the first-pass evidence (`benchmarks-before-after.md`, `final-report.md`) and
  Archon JSONL logs. Nothing here is estimated; unmeasurable items are marked.

## Live product state at V2 start

- Running package: `g0-contracts-data-truth` · RUN `02b7546150d4ae0de3405d431b53f911`
  · profile **LEGACY** · node `implement-iterate` iter≥2 · idle 0m · pausedFatal null
- Supervisor: active (PID 165558), state file
  `/home/minhquan_eth/.local/state/foresift/autopilot-state.json`, activeRuns=[02b75461…]
- Next package: `g0-security-perimeter` PENDING (deps unproven) → will resolve to
  `foresift-work-package-optimized` via `workPackageWorkflow()` when eligible.

## MEASURED first-pass facts carried as baseline

Source: `.optimizer-evidence/benchmarks-before-after.md`, Archon logs of run 02b75461….

| Metric                                              | Value                                                                                                              | Source                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| LEGACY implement iteration wall-clock               | 1030 s (~17 min) for one full iteration                                                                            | run-log node timestamps     |
| Tool events inside one implementation iteration     | ~363 tool events / 102 assistant messages (Bash 201, Edit 61, Write 48, Read 40)                                   | JSONL event histogram       |
| Deterministic bash nodes (preflight/status/recheck) | ≤3 s each                                                                                                          | run-log node timestamps     |
| GitHub CI "Verify" check                            | 21–33 s per merged PR (#13…#20); PR open→merge < 80 s                                                              | gh run list, benchmarks doc |
| FULL-gate executions in product so far              | 0 (no run has reached a gate node)                                                                                 | benchmarks-before-after.md  |
| In-vivo OPTIMIZED end-to-end runs                   | none — G0 is the only product package started and it is LEGACY by design                                           | autopilot status            |
| Checkpoint context-read reduction in vivo           | NOT MEASURABLE FROM CURRENT EVIDENCE (no instrumentation; structural count only: 0 durable checkpoints before #17) | benchmarks doc risk note    |
| FAST invocations in vivo                            | NOT MEASURABLE FROM CURRENT EVIDENCE (no OPTIMIZED package has run)                                                | same                        |

Local check durations on the control-plane repo (this machine, warm, 2026-08-23):
`spec:verify` 0.8 s · `typecheck` 2.0 s · `lint` 2.7 s · targeted eslint (1 file) 0.9 s ·
full vitest suite 5.7 s. These scale with product code size; ratios hold.

## STRUCTURAL second-pass baseline of the current OPTIMIZED lane (from code)

Counted on `foresift-work-package-optimized.yaml` @ 084d21b for a CLEAN package
(planning complete, implementation green, review finds nothing):

1. **FULL verifications of an unchanged HEAD: 3×**
   - `gate-router`: bare `pnpm foresift:gate --package` — writes NO attestation;
   - convergence `gate-iter`: bare `pnpm foresift:gate` again (loop body always runs
     ≥1 iteration — Archon v0.9 evaluates the guard only after a full body);
   - `ci-merge`: `wp:full-gate --check` misses (no attestation exists anywhere) →
     `wp:full-gate --run` executes the identical gate a third time.
2. **Non-implementation AI invocations on the clean path: ≥10**
   create-pr ×1 · review block ≈7 (scope/sync/5 reviewers/synthesize/fixer) ·
   converge ×1 · judge ×1 (model large) · ci-merge ×1.
3. **Convergence always runs**: no deterministic skip router exists; a clean review
   still costs converge AI + a FULL gate + judge AI.
4. **Checkpoint self-invalidation defect CONFIRMED by code read**
   (`foresift-wp-implement-optimized.md` slice boundary): order is FAST → commit →
   `wp:checkpoint --build` → _then_ mark tasks `- [x]` in tasks.md. tasks.md is a
   hashed checkpoint source (`package-checkpoint.mjs` defaultSources.tasks), so every
   productive slice invalidates its own checkpoint before the next turn reads it.
   The next turn must rebuild all context from authority — the exact cost the
   checkpoint exists to avoid.
5. **Checkpoint capsule under-derived**: requirementIds/acceptanceIds/prdReferences/
   adrReferences are populated only if the agent passes CLI flags; nothing is derived
   from the authoritative manifest (which does carry acceptanceCriteria, sections,
   lines, ADR ids per requirement).
6. **FAST scope is manual**: `--file` enumeration by the agent; JS-only checks
   (eslint + vitest related); any non-JS change either goes unchecked or escalates to
   the full suite; deletions/renames/multi-commit slices have no deterministic scope.
7. **create-pr and ci-merge are AI command nodes** even though both are mechanical
   on the clean path (push/discover/create PR; attestation-check → land).
8. Gate failures carry no structured manifest — repair agents re-read free-form logs
   (`gate-log.txt`) and re-run the whole gate after every repair edit.
