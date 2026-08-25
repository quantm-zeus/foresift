# V4 sharded-wave — §18 acceptance matrix

Every obligation from the V4 mission's "16-item sharded-wave acceptance"
mapped to its structural guard, its regression test, and — where the item is
a runtime property — a REAL canary run's artifacts. Canary runs were executed
against disposable fixture repos under `/tmp/foresift-wave-smoke` using the
real workflow YAML, real scripts, real authoritative spec files, and real
provider dispatch (methodology: `v4-defects-and-runtime-findings.md` Part C).

## Run evidence index

| Run | Repo / id                                | Shape                                                                                                                                          | Terminal state                                                                 |
| --- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| A1  | repo-a `acad b8e15804…`                  | prep crashed (defect #15 SyntaxError), 13 downstream nodes skipped                                                                             | failed loud, zero provider dispatch                                            |
| A2  | repo-a `6193e829…` (+ rerun `f84a5246…`) | green path, BOTH parallel lanes empty                                                                                                          | success; checkpoint 1/1; zero AI on empty lanes                                |
| B1  | repo-b `5fafe1d4…`                       | FAST genuinely RED (`exitCode:1`) yet DAG green — **defect #14 false green**, checkpoint written over red                                      | preserved as the smoking-gun artifact                                          |
| B2  | repo-b `9cb836a7…`                       | same tampered fixture after fix: RED → bounded targeted repair (7m15s) → recheck `{"exitCode":0,"phase":"recheck"}` → checkpoint on green only | success                                                                        |
| A3  | repo-a `d6125fff…`                       | HYBRID live canary (`FORESIFT_AGY_LANES=shard-1`): core lane CLAUDE ∥ shard-1 lane **AGY**, both non-empty                                     | success; integrated=[T101,T102], rejected=[], TRUE FAST exit 0, checkpoint 2/2 |

## Matrix

| #   | Obligation                                                                                                        | Structural guard                                                                                                                                          | Regression / unit pin                                                                | Runtime proof                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 1   | Deterministic task graph; write-disjoint shard plan ([P] units → parallel shards, demotion rules)                 | `build-implementation-task-graph.mjs` pure parsing + first-fit disjoint planner                                                                           | impl-wave.spec.ts "derives units…" / "plans shards that are pairwise write-disjoint" | graph artifacts of every run (e.g. A3 `task-graph.json`: core=[T101], shard-1=[T102], disjoint paths)      |
| 2   | Every lane pinned at the SAME base HEAD                                                                           | prep writes `base-head.txt`; worktrees branched at that sha; guards/integration recompute against it                                                      | impl-wave.spec.ts guard tests assert diff-vs-pinned-base                             | A3 `shard-meta.json` + `base-head.txt`; canonical merge graph                                              |
| 3   | Per-lane PRIVATE git worktrees                                                                                    | prep creates `wt/<lane>` + branch per shard before any dispatch                                                                                           | impl-wave.spec.ts multi-worktree fixture                                             | A3 `wt/shard-1` carried the agy commit `e2d1f26` off-trunk                                                 |
| 4   | Per-lane briefs with exact sentinels; brief isolation between lanes                                               | brief emitters print the exact sentinel when a lane is empty; writers read ONLY their sibling emitter output                                              | sentinel equality pinned in hybrid-engine.spec.ts ("EXACT brief-emitter sentinel")   | A2/A3 `briefs/*.md`                                                                                        |
| 5   | Empty shards invoke ZERO AI providers (§15)                                                                       | writer AND guard nodes `when`-gated off the sentinel/engine tokens before any provider dispatch                                                           | impl-wave.spec.ts lane-gate suite                                                    | A2 journal: `dag_node_skipped_condition` for both parallel writers+guards; zero provider calls             |
| 6   | Concurrent intra-package lanes (serial core ∥ parallel shards)                                                    | sibling DAG nodes without edges execute concurrently (v0.9 proven R3)                                                                                     | topology asserted by lane-gate tests                                                 | A3 log: `writer-core` and `writer-shard-1-agy` overlap; both complete                                      |
| 7   | Hybrid engine routing: PURE, deterministic, fail-closed; core NEVER AGY                                           | `decideWriterEngine` — AGY requires opt-in env AND runnable binary; core hard-excluded                                                                    | hybrid-engine.spec.ts (default CLAUDE, fail-closed missing binary, core never AGY)   | A3 `engine-shard-1.txt` == `AGY`, engine-shard-2 == sentinel                                               |
| 8   | Antigravity executor performs REAL tool execution inside the authority boundary                                   | stream-json turn protocol (R7); result.json contract mandatory; envelope status forensic-only; guards recompute all                                       | executor e2e probe (disposable repo: exact content, real commit, honest manifest)    | A3: agy wrote `docs/parallel-guide.md`, committed `e2d1f26`, guard recomputed head/base, integrator merged |
| 9   | Wave guard NEVER trusts writer claims                                                                             | `wave-guard.mjs` recomputes diff/branch/head from git and OVERWRITES result.json facts                                                                    | impl-wave.spec.ts guard tests incl. evil-branch rejection                            | A3 integration report computed facts match git                                                             |
| 10  | Additive integration; per-lane skip-closed rejection                                                              | `merge --no-ff` per lane; rejected lane never corrupts canonical, stays in report                                                                         | integrator tests (rejection paths)                                                   | A1: every lane rejected (committer identity) yet report preserved; canonical untouched                     |
| 11  | ONE TRUE combined package FAST after integration (never per-writer, never FULL here)                              | router invokes `package-fast-verify.mjs --from-git --base <pinned>` exactly once per wave/recheck                                                         | impl-wave.spec.ts statement extractor: EVERY FAST invocation fully scoped            | B2 `wave-fast.log` / `wave-fast-recheck.log`                                                               |
| 12  | RED provably fails the wave path: bounded targeted repair converges or fails LOUD; checkpoint ONLY on green (§14) | repair loop gated on bare `WAVE_FAST_RED`; loop exits only via genuine recheck exit 0; exhaustion fails node; `wave-settled` blocked while repair failing | defect-#14 regression (bare-echo stdout discipline); bridge semantics tests          | B2 full chain (RED→repair→green recheck→checkpoint); B1 preserved counter-example pre-fix                  |
| 13  | Zero-progress green waves impossible (#12)                                                                        | integration-empty guards in router AND recheck (`exitCode:90` holds loop closed; vacuous pass impossible)                                                 | impl-wave.spec.ts "never lets a fully-rejected wave settle green"                    | guard logic exercised in A1-shaped fixtures                                                                |
| 14  | Router stdout discipline (#14) — verdict tokens only                                                              | diagnostics to files; stdout is ONE token; enforced by statement-level regression                                                                         | impl-wave.spec.ts "keeps router stdout to bare verdict tokens"                       | B1 vs B2 behavior delta                                                                                    |
| 15  | Strong retry layers preserved (L1 node retries, L2 repair retries, L3 autopilot recovery)                         | explicit `retry {max_attempts, delay_ms, on_error: all}` on every writer/guard/repair node incl. agy variants                                             | lane-gate tests assert retry blocks on ALL variants                                  | defect-#10 policy unchanged (v0.9 R2/R4 context in findings doc)                                           |
| 16  | OFF/CANARY/PRODUCTION rollout routing: deterministic, fail-closed, flip-safe                                      | frozen `SHARDED_WAVE_ROLLOUT`; unknown mode ⇒ historical routing; autopilot routes via `workPackageWorkflowFor`                                           | sharded-wave-rollout.spec.ts (ships OFF, admit sets, gen-0 g0 unreachable)           | routing exercised in unit layer; flip commit lands WITH this matrix                                        |

## Cross-cutting obligations

- **Installed-Archon verification without upgrade (mission §17)** —
  `v4-defects-and-runtime-findings.md` Part B (R1–R7), all empirical against
  the production v0.9 install; no production Archon files modified.
- **Additive git history** — entire V4 branch is normal commits + one
  merge-commit base refresh from origin/main (post-PR#52); no amend, no
  rebase, no force-push.
- **Product safety boundary** — no trading/custody/signing/private-key/
  transaction-submission capability touched; all changes are control-plane
  automation under `scripts/automation/` + `.archon/workflows/foresift/`.
- **Durable FULL authority** — FAST remains non-attesting and
  non-merge-authorizing; the authoritative FULL gate stays downstream in the
  standard package flow (override §18).

## Conclusion

With A3, every §18 acceptance surface carries runtime evidence in addition to
its structural guard and regression pin. The rollout flip OFF → PRODUCTION is
authorized by this record and lands as its own version-controlled commit per
the flip-safety contract.
