# ADR-0004: until_bash guards receive artifact paths by argument, never by environment

- Status: Accepted
- Date: 2026-08-23
- Deciders: G0 blocker repair session (empirically probe-verified against Archon v0.9.0)

## Context

Foresift's Archon workflows decide loop continuation with deterministic
`until_bash` guards. During the `g0-contracts-data-truth` package (runs
`035accc0…`, `d06ebcb9…`, failed run recorded as PAUSED_FATAL), the scoped-plan
guard rejected completion on every one of its 4 iterations — twice — while the
in-loop `plan-recheck` bash node running the _identical validator command_
exited 0 each time, and the persisted verdict was
`{"complete":true,...,"tasks":65}`. The failure was therefore independent of
agent output quality.

A zero-AI-cost probe workflow (`loop_group` whose guard and body were plain
bash nodes logging their own environment) proved the mechanism on the exact
branch and invocation shape of the failing workflow:

|                                               | body bash node  | `until_bash` guard                                      |
| --------------------------------------------- | --------------- | ------------------------------------------------------- |
| cwd, node, script resolution                  | identical       | identical                                               |
| `$ARGUMENTS`                                  | exported        | exported                                                |
| **`ARTIFACTS_DIR` env var**                   | **exported**    | **ABSENT**                                              |
| bare-form `$ARTIFACTS_DIR` in command text    | n/a             | **textually substituted** to the absolute artifacts dir |
| brace-form `${ARTIFACTS_DIR}` in command text | expands via env | **NOT substituted; expands empty**                      |

Archon v0.9.0 substitutes only BARE-FORM references of a small variable set
(`$ARTIFACTS_DIR/$WORKFLOW_ID/$STATE_DIR/$BASE_BRANCH/$DOCS_DIR`) into the
guard's command string before execution and exports none of them as
environment variables to that execution. Regular workflow bash nodes get
`ARTIFACTS_DIR` as a real environment variable — which is exactly why
`plan-recheck` passed while the guard could not.

The scoped-plan guard invoked `package-plan-complete.mjs`, which resolved its
artifact copies from `process.env.ARTIFACTS_DIR`; inside the guard that read
yielded nothing and the validator failed closed with
`missing ARTIFACTS_DIR`. Two more latent instances of the same anti-pattern
were found in the sweep: the work-package gate-repair-loop guard (inline
`node -e` reading `process.env.ARTIFACTS_DIR`) and both milestone-control
audit-loop guards (`audit-progress.mjs --check`). The audit loops had never
executed yet (skipped in the successful milestone run), so this would have
surfaced later as another opaque PAUSED_FATAL.

## Decision

1. Validators invoked from `until_bash` guards accept an explicit
   `--artifacts-dir <path>` argument taking precedence over the
   `ARTIFACTS_DIR` environment variable (which remains the path for regular
   bash-node invocations). Guards pass it using archon's bare-form textual
   substitution: `--artifacts-dir "$ARTIFACTS_DIR"`.
2. Guard commands never reference `${ARTIFACTS_DIR}` (brace form) or
   `process.env.ARTIFACTS_DIR`.
3. Every work-package loop guard captures its full verdict JSON to
   `$ARTIFACTS_DIR/<stage>-guard-last.json` on every evaluation. Archon
   records only `completionDetected: false` for a failed guard — no output,
   no stderr — so without a captured artifact a guard failure is
   undiagnosable after the fact.
4. A static regression test scans all `.archon/workflows/**/*.yaml`
   `until_bash` blocks for the prohibited forms and for known validators
   missing the explicit flag.
5. Both workflow description blocks document the verified contract so future
   workflow authors do not rediscover it by exhaustion.

## Consequences

- Guard behavior is now independent of execution-context differences between
  bash nodes and guards; the same validator call is provably equivalent in both.
- Guard failures leave forensic verdicts on disk, converting future loop
  exhaustions from mysteries into one-file diagnoses.
- The contract is pinned to observed Archon v0.9.0 behavior. If Archon ever
  starts exporting these variables to guards, substitution and export agree on
  the same path, so the argument-passing form remains correct.
