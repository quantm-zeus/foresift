# V4 EXTERNAL MAXIMUM-THROUGHPUT CONTROL-PLANE OPTIMIZER — FINAL REPORT

Date: 2026-08-25 · Branch: `foresift/sharded-wave-v4` → PR #53 · Baselines:
origin/main @ `5fca6c5` era + PR #51 (`de0b39e`) + durable WIP lineage
`foresift/sharded-wave-wip@4d48cb6`. Every claim below cites an artifact,
test, or live-run record; anything not directly observed is labeled as such.

## Mission outcome

| Mission obligation                                         | State               | Where                                                                                                                                   |
| ---------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Neutralize abandoned Archon Chat optimizer                 | DONE                | prior session; procedure preserved in findings doc R3                                                                                   |
| True FAST invocation on the wave path                      | DONE                | router runs ONE combined `wp:fast-verify --from-git --base <pinned>`; B2 artifacts                                                      |
| §14 RED really fails                                       | DONE                | defect #14 root-caused + fixed + regression-pinned; B1 false-green preserved as counter-example; B2 full RED→repair→green-recheck chain |
| §15 empty shards ⇒ ZERO AI providers                       | DONE                | sentinel/engine-token gates; A2 journal shows condition-skips before any dispatch                                                       |
| §16 strong retry preserved (L1/L2/L3)                      | DONE                | explicit retry blocks on every writer/guard/repair node incl. agy variants                                                              |
| §17 verify installed Archon v0.9, never upgrade            | DONE                | findings R1–R7, all empirical, zero production-Archon modifications                                                                     |
| §18 finish 16-item acceptance before production activation | DONE                | `.optimizer-evidence/v4-acceptance-matrix.md` (guard + regression + runtime proof per item)                                             |
| Hybrid Claude+Antigravity execution                        | DONE                | pure fail-closed routing; stream-json executor decoded (R6/R7); LIVE canary A3: AGY lane integrated beside CLAUDE core                  |
| Intra-package parallelism                                  | DONE                | sharded wave: serial core ∥ parallel shards at one pinned base                                                                          |
| Cross-package parallelism                                  | PRE-EXISTING        | roadmap policy + autopilot concurrency selection (V3-B)                                                                                 |
| Contract-first scheduling                                  | DONE (ADR 0017)     | scheduling IS the contract pipeline: task graph → briefs → admission → pinned worktrees                                                 |
| Bounded speculative roadmap pipelining                     | DEFERRED (ADR 0017) | G0 foundation policy serializes packages ⇒ zero benefit today; revisit at ≥2-concurrency milestones                                     |
| OFF/CANARY/PRODUCTION rollout routing                      | DONE + ACTIVATED    | frozen pure selector; flip = version-controlled commit; PRODUCTION authorized by acceptance matrix                                      |
| Retire this optimizer                                      | THIS REPORT         | see Retirement below                                                                                                                    |

## Defects found by real execution (numbering continues from V3)

- **#12** zero-progress green wave (vacuous FAST over empty integration) —
  fixed in router AND recheck (`exitCode:90` holds the loop closed).
- **#14** router stdout pollution silently disabled RED handling — fixed by
  the V3 gate-router stdout-discipline idiom; B1's green-over-red DAG is the
  preserved counter-example.
- **#15** `build-writer-briefs.mjs` SyntaxError crashed prep before any
  dispatch while hermetic suites stayed green — repaired.
- **#13** RETRACTED with proof (deliberate V3 law, pinned test).

Full table with fixes and proof columns:
`v4-defects-and-runtime-findings.md` Part A.

## Antigravity executor — what was actually proven

- `agy --print` executes NO tools and hallucinates success (reproduced ×2)
  ⇒ unusable as an executor (R6).
- Real tool execution requires stdin NDJSON
  `{"event":"user","message":{"role":"user","content":…}}` +
  `--input-format/--output-format stream-json` (R7), absolute paths for all
  writes (relative land in agy's scratch), and envelope status treated as
  FORENSIC ONLY (successful out-of-scratch turns can end `status:"ERROR"` via
  agy's artifact-path declarer — observed again inside A3's own forensics).
- Live A3 lane: wrote `docs/parallel-guide.md`, committed `e2d1f26` on its
  private lane branch, honest `foresift/writer-result@1`; guard recomputed
  branch/head/base; additive merge; TRUE FAST exit 0; checkpoint 2/2.

## Safety accounting

- Product boundary untouched: read-only intelligence system; no trading,
  custody, wallet signing, private-key handling, or transaction submission
  capability added or approached.
- Additive git history only (commits + one merge-commit base refresh after
  PR #52); no amend/rebase/force-push.
- No credentials committed; `.env` ignored; agy OAuth state lives outside
  the repo and is referenced but never copied.
- Production Archon and the product autopilot were never degraded during
  optimization work; canaries ran against disposable fixture repos.
- Verification authority strengthened, never weakened: full `pnpm verify`
  green at pushed HEAD (spec:verify, prettier, eslint, tsc, 1242 tests);
  the outer FORMAT/LINT/TYPECHECK layers caught real defects hermetic lane
  tests had missed (unused binding in integrator, missing d.mts shims for
  the new modules incl. the un-extended generations shim from an earlier V4
  commit).

## Rollout

`SHARDED_WAVE_ROLLOUT` activated OFF → PRODUCTION in commit `6a40599`,
authorized exclusively by the acceptance matrix. Flip-safety verified in
code: supervisor-tracked runs persist their launch workflow and adoption
matches `(workflow, message)` (`discoverRunId(entry.workflow, …)`), so no
tracked run changes identity mid-flight; the LEGACY forensic row stays
retired forever (`usesOptimizedWorkflow` upstream of admission). Hybrid AGY
lanes remain opt-in (`FORESIFT_AGY_LANES`, unset everywhere ⇒ CLAUDE).

## Retirement

The V4 optimizer retires with this report: no standing optimizer processes
or chat conversations remain; the sharded wave becomes ORDINARY product
control plane under the standard supervisor (launch identity, adoption,
retry L3, milestone bookkeeping all unchanged).

## Post-merge landing record & autonomy verification (appended 2026-08-25)

- **Landing**: PR #53 squash-merged to `main` as **`1aeb68c`** at
  2026-08-25T05:11:02Z; authorizing CI run **`32811287374`** concluded
  `success` at head `9650be6`. The product checkout (`/home/minhquan_eth/foresift`)
  was restored to `main@1aeb68c` fast-forward-only — which also cured the
  per-tick "could not fast-forward main" warning caused by a stale parked
  branch — and the supervisor restarted onto the landed code.
- **Autonomy verification surfaced a real incident, resolved through supported
  doors only** (defect #16, findings doc): the owner had manually merged the
  finished g0-security-perimeter work as PR #52 straight off the Archon
  workspace branch four seconds before its workflow reported completion,
  invisible to the supervisor's head-keyed merge check ⇒ fail-closed
  PAUSED_FATAL over already-merged work. No JSON was hand-edited:
  `--recover-fatal` re-verified launch identity, retired the dead run, launched
  ONE fresh continuation (**`7bb356d4…`**) on the SAME branch/worktree, restored
  tracking, cleared the pause, exit 0; supervisor resumed autonomous ticking.
- **Continuation disposition — retired without losing product work** (owner
  correction: do not let the obsolete pre-V4 workflow traverse planning →
  implementation → review → convergence again). Proven first: every T-scoped
  task of the package was already merged via PR #52; the only unchecked boxes
  in current-main authority are five governance-deferred R-items whose own text
  places their wiring OUTSIDE this package's writeScopes. The run's post-merge
  commits were out-of-scope responses to exactly those deferred items (defect
  #17). It was retired through Archon's supported abandon (status `cancelled`
  at 2026-08-25T07:29:35Z); log retained; worktree untouched; every surplus
  delta preserved as patch artifacts under
  `~/.local/state/foresift/v4-security-run-retirement/`.
- **Main-push CI flake diagnosed and cleared**: push-run `32811833226` failed
  via a V8 JIT worker crash (`jit_page_->allocations_.erase(addr)`) while the
  squashed tree is BYTE-IDENTICAL to the green branch head (`git diff 9650be6
1aeb68c` empty); a supported rerun of the SAME sha concluded success ⇒
  environmental, gate evidence valid at HEAD.
- **New control-plane capability shipped**: `--finalize-from-main <id>`
  (module `finalize-from-main.mjs`, 14 regression tests) — deterministic,
  fail-closed RUNNING→PROVEN from landed truth ONLY: merged-PR ancestry from
  current origin/main, T-scoped completeness read AT that commit, green CI on
  exactly origin/main HEAD, and no live competing execution; it refuses with
  precise reasons otherwise and never invokes an AI provider. Defects #16/#17
  are its founding cases.
- **Security finalization**: [PENDING — executed after this PR lands]
- **First production selection under active routing**: [PENDING]
