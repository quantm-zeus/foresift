---
description: Create the pull request for a Foresift work package
argument-hint: <package-id>
---

# Foresift work-package PR creation

**Package**: $ARGUMENTS

Create (or update) the package's GitHub pull request.

1. Verify branch state:
   - current branch must be `foresift/$ARGUMENTS` (create it from `main` only if
     it does not exist yet — it normally already exists, cut by Archon);
   - push all commits: `git push -u origin foresift/$ARGUMENTS` (normal push only;
     never force).
2. Determine the PR title/body:
   - Title: `feat(<package-id>): <objective>` using the objective from
     `specs/implementation/current-milestone.json`.
   - Body must include: the requirement ID list, a summary of the implementation,
     the deterministic gate evidence (`pnpm foresift:gate -- --package $ARGUMENTS`
     output tail), links to `specs/$ARGUMENTS/spec.md`, and
     `$ARTIFACTS_DIR/out-of-scope-notes.md` content if present. State plainly that
     this PR was produced autonomously and reviewed by machine gates.
3. Create or update:
   - If no open PR exists for the head branch: `gh pr create --base main --title ... --body-file ...`
   - Else: `gh pr edit` with the refreshed body.
4. Write the PR number to `$ARTIFACTS_DIR/.pr-number` (downstream review nodes read it):
   `gh pr view --json number -q '.number' > $ARTIFACTS_DIR/.pr-number`
5. Confirm base is `main`; if not, retarget with `gh pr edit --base main`.

Never merge here — merging happens only in the final CI-gated phase.
End your reply with the PR URL and number.
