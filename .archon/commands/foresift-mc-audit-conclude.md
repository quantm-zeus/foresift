---
description: Execute the milestone audit verdict after deterministic coverage is proven
argument-hint: plan-or-audit-current-milestone
---

# Foresift milestone audit conclusion (post-loop, one-shot)

**Artifacts**: $ARTIFACTS_DIR

You run AFTER the audit continuation loop has proven — deterministically — that
every required requirement carries an audited, evidenced verdict. You never
audit requirements yourself and never change verdicts; you only execute the
recorded verdict.

1. Read `$ARTIFACTS_DIR/milestone-audit-progress.json`
   (`node scripts/automation/audit-progress.mjs --status`) and
   `$ARTIFACTS_DIR/milestone-audit-report.md`. Determine the milestone id and
   whether this is the FINAL product-wide audit (`isFinal`).
2. Read `specs/implementation/current-milestone.json`.

## If gaps exist (any verdict GAP)

Append narrowly scoped REMEDIATION work packages to the SAME milestone in
`specs/implementation/current-milestone.json` — schema-compliant per
`specs/implementation/README.md`: ids prefixed `remediation-`, real
dependencies, honest risk/parallelizable/writeScopes/verificationCommands, and
`requirementIds` covering exactly the gapped requirements from the progress
artifact. Do NOT mark any status yourself (statuses are machine-owned). Keep
the total package count within the 2–8 bound by merging related gaps into one
package where genuinely cohesive; if the bound cannot hold, record the
conflict in `$ARTIFACTS_DIR/milestone-audit-report.md` and append only the
highest-severity remediation packages.

## If no gaps and not final

Archive the milestone:
- write `specs/implementation/history/<milestoneId>.json` (copy of the
  converged state plus audit summary and evidence index);
- set its roadmap entry `status: "PROVEN"` in
  `specs/implementation/roadmap.json`;
- set `currentMilestoneId: null` in the roadmap;
- DELETE `specs/implementation/current-milestone.json` so the next planning
  cycle starts clean.

## If no gaps and final (G7)

Additionally record completion in
`specs/implementation/history/FINAL-AUDIT.md`: the product-wide verdict, the
evidence index, and a statement that every manifest requirement is
implemented-and-verified or explicitly superseded. Leave roadmap entries
PROVEN.

## Hard rules

- Never edit anything under `docs/spec/**`.
- Never introduce trading execution, custody, wallet signing, private-key
  handling, or transaction submission.
- Commit nothing; leave changes staged in the working tree for the landing
  phase.

End with a one-paragraph summary: verdict executed (GAPS/ARCHIVED/FINAL),
package or archive actions taken.
