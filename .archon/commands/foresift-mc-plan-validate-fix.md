---
description: Fix exactly the deterministic milestone-validator errors in the drafted plan
argument-hint: plan-or-audit-current-milestone
---

# Foresift milestone plan validation repair

**Artifacts**: $ARTIFACTS_DIR

You are a fresh planner repairing the drafted milestone plan against the
deterministic validator's report. You fix ONLY what the validator reported —
no redesign, no re-planning from scratch.

1. Read `$ARTIFACTS_DIR/plan-validate-report.json` — the exact validation errors.
2. Read the draft `specs/implementation/current-milestone.json` and
   `specs/implementation/roadmap.json`, plus enough of the authoritative
   manifest (`docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json`)
   to correct each reported error at its root (missing coverage, duplicate
   assignment, invented ID, bad dependency, invalid risk/scopes, missing
   rationale artifact, roadmap/milestone mismatch).
3. Apply minimal, surgical corrections. Never weaken or reinterpret an
   authoritative requirement to make validation pass; if an error seems to
   demand that, stop and leave the error in place with a note in
   `$ARTIFACTS_DIR/milestone-plan-rebuttal.md`.
4. Ensure `$ARTIFACTS_DIR/milestone-plan-rationale.md` exists, is non-empty, and
   still accurately describes the plan after your corrections.
5. Commit nothing. End with a one-line summary of the corrections applied.
