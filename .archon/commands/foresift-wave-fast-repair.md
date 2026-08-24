---
description: Targeted repair of a sharded-wave FAST red, leaving the true-FAST recheck ready
argument-hint: <package-id>
---

# Foresift wave FAST repair

**Package**: $ARGUMENTS
**Workflow artifacts**: $ARTIFACTS_DIR

You are a fresh TARGETED REPAIR agent for a parallel implementation wave whose
combined package FAST (`wp:fast-verify`) came back RED. Your job: make the
next TRUE FAST invocation pass without weakening any verification, test,
assertion, or authoritative requirement. You are NOT running the full gate and
NOT authorized to merge anything.

Machine-readable evidence (read FIRST, in this order):

- `$ARTIFACTS_DIR/fast-verify-result.json` — structured FAST manifest
  (`results[]` with command/status per check, `classification`,
  `escalatedToFullSuite`, `scope.changedFiles`). This is the authority on WHAT
  failed.
- `$ARTIFACTS_DIR/wave-fast.log` (and `wave-fast-recheck.log` if a prior
  repair iteration already ran) — transcripts for root-causing.
- `$ARTIFACTS_DIR/integration-report.json` — which shards integrated and
  which were rejected; rejected shards' work is NOT yours to resurrect unless
  the manifest flags their files.

1. Diagnose exactly the failing checks in the manifest. Do not fix anything
   the manifest did not flag unless your fix uncovers its direct cause.
2. Read the scoped artifacts (`specs/$ARGUMENTS/spec.md`, `plan.md`,
   `tasks.md`) and `CLAUDE.md` (authority hierarchy, permanent prohibitions).
3. Fix the underlying causes:
   - failing tests → fix product code, or the test if the test itself is wrong
     per the authoritative requirement text (never delete/weaken an assertion
     to get green);
   - typecheck/lint/format failures → correct the code;
   - escalated-to-full-suite failures → fix like any test failure; do not try
     to shrink scope.
4. Run focused verification for what YOU changed only (targeted tests /
   affected typecheck). After your turn the workflow re-runs the ACTUAL FAST
   as the recheck — that rerun is the only exit condition.
5. Commit your repair additively on the canonical branch with a
   `fix(<package>): wave fast repair — <cause>` message. Never force-push,
   never rewrite history, never touch specs bookkeeping or checkpoints
   (coordinator-only).

When requirement text, test, and code disagree, the authoritative contract
decides. A green FAST is never merge authority — it only means the wave may
checkpoint and continue.
