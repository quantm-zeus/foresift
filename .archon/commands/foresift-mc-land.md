---
description: Land milestone planning/audit artifacts through a normal PR with CI
argument-hint: plan-or-audit-current-milestone
---

# Foresift milestone-control landing (branch → PR → CI → merge)

**Artifacts**: $ARTIFACTS_DIR

Land the working-tree changes to `specs/implementation/**` produced by the plan,
plan-fix, or audit phase through the repository's normal PR process.

1. Inspect `git status`. If nothing changed, end with `NOTHING_TO_LAND` (the
   workflow completes; this is legitimate for a no-op landing).
2. Branch: create/switch to `foresift/milestone-planning` and ensure it tracks
   origin. If the branch already has an open PR, reuse it.
3. Commit additively with a conventional message describing what landed
   (`chore(planning): decompose G0 into N work packages` /
   `chore(planning): audit <milestone> — remediation packages` /
   `chore(planning): archive <milestone> as PROVEN`). Never amend/rebase/force-push.
4. Push normally: `git push -u origin foresift/milestone-planning`.
5. Create or update the PR against `main`: title from the commit subject; body =
   rationale/review/audit artifact summaries (inline the key sections), the full
   requirement-coverage table for transparency, and an autonomy disclosure.
6. Exact-head CI: `gh pr checks <number> --watch --interval 30` (~45 min bound).
   - All green on the exact head SHA → merge:
     `gh pr merge <number> --squash --delete-branch`.
   - A check failed → fix the planning artifacts, push, repeat (max 3 attempts).
   - GitHub Actions cannot start jobs at all due to the known account-billing
     block ("The job was not started because recent account payments have
     failed...", see docs/setup/BOOTSTRAP_REPORT.md) → apply the documented
     fallback once: comment on the PR documenting the billing block with the run
     URL, run the clean-room equivalent deterministically — fresh clone of the
     repo at the exact head SHA into a NEW temp directory,
     `corepack pnpm install --frozen-lockfile && pnpm verify`, delete the temp
     clone — and merge only if it passed.
7. Report: PR URL, merge SHA, gate path used (CI vs documented fallback),
   and the mode that landed (PLAN / AUDIT / FINAL-AUDIT).
