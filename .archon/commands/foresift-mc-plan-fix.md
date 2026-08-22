---
description: Address reviewer findings in the drafted milestone plan (repair pass)
argument-hint: plan-or-audit-current-milestone
---

# Foresift milestone plan repair pass

**Artifacts**: $ARTIFACTS_DIR

You are a fresh planner applying the independent reviewer's findings to the
draft milestone plan.

1. Read `$ARTIFACTS_DIR/milestone-plan-review.md` (findings), the draft
   `specs/implementation/current-milestone.json` + `roadmap.json`, and enough of
   the authoritative manifest/PRD to judge each finding.
2. Fix every CRITICAL and HIGH finding by editing the plan files (coverage,
   dependencies, risk, scopes, verification commands, package count). MEDIUM/LOW:
   fix when clearly correct; otherwise note your disagreement in
   `$ARTIFACTS_DIR/milestone-plan-rebuttal.md`.
3. Re-verify mechanically that requirements are still covered exactly once and
   IDs all exist in the manifest before finishing.
4. Commit nothing. Summarize each change you made, keyed to the finding IDs.

Do not silently reinterpret authoritative requirements; if a finding would force
that, refuse it in the rebuttal file instead.
