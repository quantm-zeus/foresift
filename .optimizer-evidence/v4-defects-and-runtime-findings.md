# V4 control-plane optimizer — live defects & Archon v0.9 runtime findings

Continues the V3 ledger (`.optimizer-evidence/v3-final-report.md` Part III,
defects #1–#10; supervisor code also carries #11/#11b from PR #50). All items
below were found by REAL execution during the V4 mission (2026-08-24/25), not
by inspection alone.

## Part A — Live defects (numbering continues from V3)

| #   | Defect                                                                                                                                                                                                                                                                                                                                                                                                                                 | Fix                                                                                                                                                                                                                                  | Proof                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 12  | Zero-progress green wave: a wave that DISPATCHED writer lanes but integrated NONE of them rode a vacuously green FAST (diff-vs-base empty ⇒ FAST passes trivially) and wrote a success checkpoint over zero progress; the repair loop's own recheck FAST would have converted its RED back to green the identical way                                                                                                                  | Integration-empty guards in BOTH the wave router and the repair recheck (`exitCode:90`, loop held closed ⇒ exit-0 impossible until a lane actually integrates); exhaustion fails the node loudly and no checkpoint fires             | Canary run A1: integration rejected every lane ("Committer identity unknown") yet DAG finished green; regression `never lets a fully-rejected wave settle green over zero progress` |
| 14  | Router stdout pollution silently disabled RED handling: `integrate-and-fast` dumped the integration-report JSON to stdout before echoing its verdict, so the captured node output was multiline and the repair loop's when-gate `== 'WAVE_FAST_RED'` NEVER matched. Canary run B completed GREEN through a genuinely FAILED FAST (artifacts record `exitCode:1`, `"❌ FAST VERIFY FAILED"`) — exactly the false-FAST shape §14 forbids | STDOUT DISCIPLINE per the proven V3 gate-router idiom: ALL diagnostics go to files; the router's stdout is the bare verdict token and nothing else; enforced structurally by regression `keeps router stdout to bare verdict tokens` | Canary run B1 artifacts (green DAG vs red FAST manifest) vs run B2 rerun behavior                                                                                                   |
| 15  | `build-writer-briefs.mjs` shipped broken in the durable WIP: a stray closing backtick inside a template literal made `prep` crash with SyntaxError BEFORE any writer dispatch. Hermetic lane tests never imported this module, so the suite stayed green while the real workflow could never start                                                                                                                                     | Repaired the template literal; verified by direct invocation on a real task graph and by canary run A2 completing prep→checkpoint end-to-end                                                                                         | Run A1 prep failure (13 downstream nodes skipped); post-fix A2 full green path                                                                                                      |
| 13  | (RETRACTED candidate) Suspected defect: `usesOptimizedWorkflow` lets `generation >= 1` override the LEGACY profile carve-out. Review showed this is DELIBERATE V3 law pinned by `v3-generations.spec.ts` ("regardless of legacy profile"); the LEGACY protection applies to the generation-0 forensic row itself. Number left vacant intentionally so renumbering never confuses evidence trails                                       | None — precedence note added to `package-generations.mjs`; the sharded-wave rollout inherits the boundary unchanged                                                                                                                  | `v3-generations.spec.ts` pinning test                                                                                                                                               |

## Part B — Installed-Archon (v0.9) runtime findings, empirical

Verified 2026-08-25 against the production install (`archon-dashboard.service`);
no upgrade performed (mission §17: verify installed behavior, don't upgrade).

- **R1 — No conversation-stop endpoint.** The web UI/chat has no working
  "stop" for an executing conversation: binary strings expose no stop/abort
  route, and `DELETE /conversations/{id}` performs a soft delete ONLY — the
  row flips deleted while the in-memory runner keeps executing.
- **R2 — Killed executors are revived by crash-classified retries.** Killing
  a chat executor subprocess is classified by the provider adapter as
  `errorClass="crash"` (journal: `provider.claude … retrying_subprocess`),
  which the retry table treats as retryable — so SIGKILL of executor children
  RESPAWNS them (observed ×3). FATAL auth errors are the exception; plain
  kills are not.
- **R3 — Safe neutralization procedure for a runaway chat-driven execution**
  (used live; product runs untouched):
  1. classify active runs first (PRODUCT / ABANDONED_OPTIMIZER / UNKNOWN);
     act only on positively identified optimizer executions;
  2. API-delete the conversation AND deactivate its DB session row;
  3. `systemctl --user restart archon-dashboard.service` — SAFE because
     workflow runs execute in DETACHED CLI processes parented to init
     (verified by process-parentage probe: run CLI PPID=1, worker child of
     the run CLI, NOT of serve). The restart drops only serve-held state.
  4. afterwards: zero executor children under the fresh serve; product run
     unaffected.
- **R4 — `when:` evaluator semantics.** Supports `==`, `!=`, `<`, `>`;
  parse failures fail closed. Condition-skipped parents count as NEITHER
  success nor failure under `trigger_rule` (v0.9), so skip-cascades must be
  bridged with always-completing nodes under
  `none_failed_min_one_success` (same root cause as V3 defect #5).
- **R5 — bash-node `$node.output` capture.** The captured output is the
  node's raw stdout text; verdict-routing when-gates therefore require the
  V3 gate-router stdout discipline (single token). See defect #14.
- **R6 — `agy --print` does NOT execute tools.** Headless print mode
  (`--print`, even with `--mode accept-edits`) answers WITHOUT running any
  tool: asked to create+commit a file it replied `SUCCESS`/"AGY_WRITE_OK"
  with `num_turns:1` while NO file existed (reproduced twice) — a
  hallucinated completion that only an artifact-level contract check
  exposes. Never use print mode as an executor.
- **R7 — agy stream-json turn protocol (decoded empirically 2026-08-25).**
  Real tool execution requires stdin NDJSON:
  `{"event":"user","message":{"role":"user","content":PROMPT}}`, one line
  per turn, with `--input-format stream-json --output-format stream-json`
  (a positional prompt is rejected in this mode). Verified live:
  `write_to_file` + git add/commit + result reporting all execute for real.
  Three operational quirks discovered by probe:
  1. RELATIVE paths resolve against agy's own scratch dir
     (`~/.gemini/antigravity-cli/scratch/…`), NOT the process cwd — prompts
     must pin ABSOLUTE paths for every write;
  2. a fully-successful out-of-scratch-writing turn can end
     `status:"ERROR"` because agy's artifact-path permission declarer
     rejects paths outside its `brain/<conversation>/` dir AFTER the work
     already happened ⇒ envelope status is FORENSIC ONLY; the binding gate
     is the writer-result completion contract + wave guards;
  3. unsupported input events are cheap to detect: stderr warning
     `ignoring unsupported stream input message event %q`.
     Executor rewritten accordingly (`exec-agy-writer.mjs` main()); proven
     end-to-end on a disposable repo: exact file content, real commit on the
     pinned lane branch, honest `foresift/writer-result@1` manifest whose
     headSha matched `git rev-parse HEAD`.

## Part C — Runtime canary methodology (reusable)

Disposable fixture repos under `/tmp/foresift-wave-smoke` (builder script kept
outside the wiped root): real `scripts/`, real authoritative spec files +
SHA256SUMS, real sharded-wave YAML + commands, milestone with two packages
(one RUNNING DOC_ONLY objective, requirement FR-CORE-006), prettier symlink.
Fixture A = green-capable (empty parallel lanes prove §15 zero-dispatch).
Fixture B = same + first hash char of SHA256SUMS flipped ⇒ deterministic
spec:verify failure INSIDE the true FAST ⇒ guaranteed honest RED (§14).
Launched via `archon workflow run foresift-sharded-wave pkg-smoke
--no-worktree`; artifacts land under
`~/.archon/workspaces/_local/<repo>/artifacts/runs/<runId>/`.
