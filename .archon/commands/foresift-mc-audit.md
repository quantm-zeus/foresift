---
description: Independent fresh-context audit of a fully-proven milestone (Mode B)
argument-hint: plan-or-audit-current-milestone
---

# Foresift milestone audit (Mode B — independent)

**Artifacts**: $ARTIFACTS_DIR

You are an independent milestone auditor in a fresh context. You must not assume
merged code is correct merely because individual package PRs passed their gates.

## Determine scope

Run `node scripts/automation/milestone-mode.mjs` → `milestoneId` and `isFinal`.
Read `specs/implementation/current-milestone.json` (all packages PROVEN) and, if
present, `specs/implementation/history/<milestoneId>.json`.

## Audit procedure

1. For EVERY requirement assigned to this milestone (from the authoritative
   manifest), inspect the actual implementation on the current default branch:
   does the code satisfy the requirement's normative text? Check its acceptance
   criteria and any invariants referencing it; confirm executable evidence
   exists (tests named by the manifest's evidence rules, including negative
   tests where declared). Run targeted tests where doubt remains.
2. Cross-cutting checks: prohibited-capability boundary (no trading/custody/
   signing/private keys/tx submission anywhere); spec integrity untouched
   (`pnpm spec:verify`); no requirement weakened to ease implementation;
   ADRs recorded for material decisions made during the milestone.
3. If `isFinal`: this is the FINAL PRODUCT-WIDE AUDIT — extend step 1 to the
   ENTIRE manifest (all groups G0–G7): every one of the 397 requirements and 204
   acceptance criteria accounted for as implemented-and-verified or explicitly
   superseded per the manifest. The project is complete ONLY if that holds.
4. Write `$ARTIFACTS_DIR/milestone-audit-report.md`: per-requirement verdicts,
   gaps with evidence, and a final verdict line `AUDIT_PASS` or
   `AUDIT_GAPS: <n>`.

## Act on the verdict

- **Gaps**: append narrowly scoped REMEDIATION work packages to the SAME
  milestone in `specs/implementation/current-milestone.json` (schema-compliant:
  id prefixed `remediation-`, real dependencies, honest risk/scopes/
  verificationCommands) so they flow through the normal work-package pipeline.
  Do NOT mark anything yourself. End your reply with `AUDIT_GAPS: <n>` + list.
- **Pass, not final**: archive the milestone — write
  `specs/implementation/history/<milestoneId>.json` (copy of the converged state
  plus audit summary), set its roadmap entry `status: "PROVEN"`, set
  `currentMilestoneId: null`, and DELETE `specs/implementation/current-milestone.json`
  so the next planning cycle starts clean. End with `AUDIT_PASS`.
- **Pass, final**: additionally record completion in
  `specs/implementation/history/FINAL-AUDIT.md` (product-wide verdict, evidence
  index); leave roadmap entries PROVEN. End with `AUDIT_PASS`.

Never edit anything under `docs/spec/**`. Commit nothing; leave changes staged
in the working tree for the landing phase.
