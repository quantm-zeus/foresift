# V3 §30 — Restart race matrix (`--restart-package --fresh-generation`)

Every crash/concurrency window of the fresh-generation restart command
(`scripts/automation/foresift-autopilot.mjs`, `cmdRestartPackage`), the required
behavior, and the hermetic proof. All rows run at every pushed HEAD via
`pnpm verify` (PROVEN). Evidence: `GEN` = `tests/automation/v3-generations.spec.ts`
(`--restart-package CLI flows` describe for B/F/H; `§30 restart race matrix`
describe for A/C/E/J).

Ordering invariant preserved by the implementation: live-run safety refusals
precede every replay/idempotency path; anomalies on disk surface as refusals,
never as friendly no-ops.

| ID      | Window / fault                                                             | Required behavior                                                                                                                   | Evidence                                                           |
| ------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| A       | Second invocation while another autopilot process holds the singleton lock | Exit 3 refusal naming the lock rule; NOTHING mutated — no intent written behind the lock                                            | GEN Case A                                                         |
| B       | Crash BEFORE the generation persist (intent written)                       | Rerun recomputes the same target, adopts the matching intent verbatim, converges on one receipt                                     | GEN Case C test exercises the adopt path; intent-adoption asserted |
| C       | Crash AFTER the persist, BEFORE the receipt                                | Intent target EQUALS milestone generation ⇒ resume AT that generation; receipt records the ORIGINAL transition; never re-increments | GEN Case C (+ guard row below)                                     |
| C-guard | Same as C but the persisted generation already launched                    | REFUSED "refusing to backfill a completed generation" — history is never laundered into paperwork                                   | GEN Case C guard                                                   |
| E       | Crash between receipt write and intent deletion                            | Target-generation receipt replays AND consumes the surviving intent; a later genuine restart proceeds unblocked                     | GEN Case E                                                         |
| F       | Duplicate invocation after completion (no launch since)                    | Prior receipt replayed; cannot create generation 2 (§7 hard rule)                                                                   | GEN §7 replay test                                                 |
| F′      | Deliberate re-restart past a completed-but-unlaunched generation           | `--confirm-new-generation` advances explicitly                                                                                      | GEN confirm-new-generation test                                    |
| H       | Stale/foreign intent targeting a different generation                      | Fail-closed refusal naming both files; the command never deletes a foreign intent (sticky until operator inspects)                  | GEN stale-intent test                                              |
| I1      | Tracked live active run exists                                             | Refusal BEFORE any mutation ("stop/abandon it first")                                                                               | GEN Case B test                                                    |
| I2      | Live current-generation run row in Archon                                  | Refusal BEFORE any mutation ("current-generation run(s) still live")                                                                | GEN live-row test                                                  |
| J1      | Salvage manifest unreadable (garbage bytes)                                | Refusal BEFORE touching anything; no intent, no mutation                                                                            | GEN Case J1                                                        |
| J2      | Manifest schema ≠ `foresift/salvage-manifest@1`                            | Refusal naming both schemas BEFORE touching anything                                                                                | GEN foreign-schema test                                            |
| J3      | Manifest names ANOTHER package                                             | Refusal with the mismatch named                                                                                                     | GEN Case J2                                                        |

Defects found and fixed while proving this matrix (2026-08-23, PR for this doc):

- **C used to refuse instead of converge** — every rerun after a
  persist-crash hit the stale-intent error, breaking the documented
  crash-safety contract.
- **E leaked a poison intent** — the replay left the intent on disk, so all
  FUTURE genuine restarts were refused until an operator hand-deleted it.
