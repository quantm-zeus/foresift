---
description: BOUNDED AI FALLBACK for final landing — diagnose, fix forward, re-run the mechanical script (OPTIMIZED profile)
argument-hint: <package-id>
---

# Foresift work-package landing fallback — OPTIMIZED lane

**Package**: $ARGUMENTS
**Workflow artifacts**: $ARTIFACTS_DIR

You are running ONLY because the deterministic lander
(`package-final-land.mjs`) exited non-zero — the `final-land-router` node
emitted `LANDING_NEEDS_AI`. On the clean path you are never invoked. Your role
is bounded diagnosis and fix-forward; the merge itself stays mechanical.

## 1. Read the mechanical evidence first (blocking)

```
cat "$ARTIFACTS_DIR/land-result.json"
cat "$ARTIFACTS_DIR/final-land-log.txt"
```

`land-result.json.reason` classifies the failure:

- `full-gate-red` — verification failed at this head. Fix ONLY if trivial
  (typos, formatting); otherwise push corrections as NEW COMMITS and continue
  to step 3 (the script re-runs the gate itself).
- `ci-red` — exact-head CI is red. This is NEVER bypassed and NEVER retried
  into greenness: fetch the failing logs (`gh run view --log-failed`), fix,
  commit additively (a NEW head — never force-push / amend / rebase).
- `dirty-tree`, `no-check-runs`, `timeout`, `head-moved`,
  `body-write-failed`, `lander-exit-*`, or anything unrecognized — NOT
  repairable by you. End your reply with `MERGE_BLOCKED: <reason>` and let
  the supervisor's recovery policy own it.

## 2. Hard boundaries (unchanged from ADR 0006/0008)

- Red CI / red gates are never bypassed, weakened, or waited out.
- No force-push, no amend, no rebase of published branches.
- FAST results never substitute for FULL-gate evidence.
- The billing fallback from earlier revisions is RETIRED here: if CI never
  started, report `MERGE_BLOCKED: no-check-runs` — a human decides.

## 3. End by re-running the MECHANICAL script — always

Whatever you fixed, do not merge manually. Your final action is:

```
node scripts/automation/package-final-land.mjs \
  --package "$ARGUMENTS" \
  --branch "$(git rev-parse --abbrev-ref HEAD)" \
  --artifacts-dir "$ARTIFACTS_DIR"
```

It re-establishes exact-head FULL-gate evidence (attestation reuse first),
re-composes the PR body, and lands mechanically with the pinned-head CI wait.
Exit 0 ⇒ landed; overwrite `land-result.json` is your verdict record. Exit 4
again after ~2 fallback attempts ⇒ end your reply with
`MERGE_BLOCKED: <reason>` — escalating further is not yours to decide.

## 4. Report

End your reply with: what failed mechanically, what you changed (commits),
the final script exit code, and either the merged PR URL + squash SHA or
`MERGE_BLOCKED: <reason>`.
