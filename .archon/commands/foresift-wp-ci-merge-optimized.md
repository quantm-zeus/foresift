---
description: Deterministic FULL-gate attestation, scripted exact-head CI wait, machine squash merge (OPTIMIZED profile)
argument-hint: <package-id>
---

# Foresift work-package final gate → CI → merge — OPTIMIZED lane

**Package**: $ARGUMENTS
**Workflow artifacts**: $ARTIFACTS_DIR

You are the release executor. Determinism and honesty outrank speed: never
merge on a red or unverified state, never fake evidence, never bypass red CI.
This lane replaces manual `gh` choreography with two deterministic tools
(ADR 0006): the FULL-gate attestation runner and the mechanical lander.

## 1. FULL verification with evidence reuse (blocking)

```
pnpm wp:full-gate --check --package $ARGUMENTS --artifacts-dir "$ARTIFACTS_DIR"
```

- exit 0 (the NORMAL case in this lane): the gate phase already ran the FULL
  gate at exactly this head and wrote its attestation — reuse it; do NOT
  re-run. A clean package executes exactly ONE local FULL gate end-to-end.
- exit 1 → no reusable evidence (review/convergence changed the tree without
  refreshing it). Run the gate:
  `pnpm wp:full-gate --run --package $ARGUMENTS --artifacts-dir "$ARTIFACTS_DIR"`
  Red ⇒ fix forward ONLY if trivial (typos, formatting); otherwise push
  corrections and re-run. If still red after bounded repair, end your reply
  with `MERGE_BLOCKED: <reason>`.

FAST results NEVER substitute here; only `wp:full-gate --run/--check` counts.

## 2. Write the PR body then land mechanically

Write `$ARTIFACTS_DIR/pr-body.md` (what landed, why, evidence). Then run ONE
command — it pushes, discovers-or-creates the PR, pins HEAD, waits for the
named check AT THAT SHA, refuses on drift, and squash-merges:

```
pnpm wp:land --branch "foresift/$ARGUMENTS" \
  --title "<conventional title>" --body-file "$ARTIFACTS_DIR/pr-body.md"
```

Exit 0 → merged. Read its JSON trace for the PR number and pinned head.

## 3. Bounded repair on red CI

If `wp:land` exits nonzero with reason `ci-red`: fetch failing logs
(`gh run view --log-failed`), fix, commit additively (a NEW head — never
force-push), and re-run `wp:land`. Bound: ~3 fix attempts; then end with
`MERGE_BLOCKED: <reason>`. Reasons `no-check-runs` / `timeout` / `head-moved`
are NOT repairable by you: report `MERGE_BLOCKED: <reason>` and let the
supervisor's recovery policy own it.

## 4. Billing fallback (ONLY while Actions is billing-blocked)

Only when `wp:land` reports `no-check-runs` AND the failed run carries the
documented annotation "The job was not started because recent account payments
have failed or your spending limit needs to be increased"
(docs/setup/BOOTSTRAP_REPORT.md), apply ONCE per attempt:
a) comment on the PR stating exact-head CI was unavailable due to the account
   billing block (include the failed run URL);
b) clean-room equivalent:
   `git clone --no-local . /tmp/foresift-cleanroom-$$ && cd /tmp/foresift-cleanroom-$$ && git checkout <head-sha> && corepack pnpm install --frozen-lockfile && pnpm verify`
c) merge only if that passed;
d) note the fallback use in the merge commit body via the PR comment.
When Actions works, this fallback must NEVER trigger.

## 5. Report

End your reply with: merged PR URL + merge commit SHA + which path ran
(normal CI / attestation reuse / documented billing fallback).
